import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { enqueueEmailJob } from "./jobQueueService";
import { queueNotification } from "./notificationService";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";
import { APP_NAME } from "../config";

/**
 * Processes subscription reminders:
 * - "upcoming": 3 days before next_payment_date
 * - "overdue_7": 7 days past due
 * - "overdue_14": 14 days past due
 * - "overdue_30": 30 days past due (final warning before grace period expiry)
 *
 * Uses the church's grace_period_days to determine when to deactivate.
 */

type ReminderType = "upcoming" | "overdue_7" | "overdue_14" | "overdue_30";

interface SubscriptionForReminder {
  id: string;
  member_id: string;
  status: string;
  next_payment_date: string;
  billing_cycle: string;
  amount: number | string;
  members: {
    id: string;
    full_name: string;
    email: string;
    user_id: string | null;
    phone_number: string | null;
    church_id: string;
  };
}

export async function processSubscriptionReminders(): Promise<{ sent: number; skipped: number }> {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let sent = 0;
  let skipped = 0;

  // Get subscriptions with member info (active + overdue), excluding soft-deleted members
  // Limit to 2000 per run to avoid unbounded memory usage
  const { data: subscriptions, error: subErr } = await db
    .from("subscriptions")
    .select(`
      id, member_id, status, next_payment_date, billing_cycle, amount,
      members!inner(id, full_name, email, user_id, phone_number, church_id)
    `)
    .in("status", ["active", "overdue"])
    .is("members.deleted_at", null)
    .order("next_payment_date", { ascending: true })
    .limit(2000);

  if (subErr || !subscriptions) {
    logger.error({ err: subErr }, "processSubscriptionReminders fetch failed");
    return { sent: 0, skipped: 0 };
  }

  // Pass 1: determine which subscriptions need reminders and what type
  const candidates: Array<{ sub: SubscriptionForReminder; reminderType: ReminderType }> = [];

  for (const sub of subscriptions as unknown as SubscriptionForReminder[]) {
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dueDate = new Date(sub.next_payment_date);
    const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const daysDiff = Math.round((todayDate.getTime() - dueDateOnly.getTime()) / (1000 * 60 * 60 * 24));

    let reminderType: ReminderType | null = null;

    if (daysDiff >= -3 && daysDiff <= -2) {
      reminderType = "upcoming";
    } else if (daysDiff >= 7 && daysDiff <= 8) {
      reminderType = "overdue_7";
    } else if (daysDiff >= 14 && daysDiff <= 15) {
      reminderType = "overdue_14";
    } else if (daysDiff >= 30 && daysDiff <= 31) {
      reminderType = "overdue_30";
    }

    if (reminderType) {
      candidates.push({ sub, reminderType });
    }
  }

  if (!candidates.length) return { sent: 0, skipped: 0 };

  // Pass 2: batch-check which reminders were already sent today
  const candidateSubIds = candidates.map(c => c.sub.id);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const { data: existingReminders } = await db
    .from("subscription_reminders")
    .select("subscription_id, reminder_type")
    .in("subscription_id", candidateSubIds)
    .gte("sent_at", todayStart);

  const alreadySent = new Set(
    (existingReminders || []).map((r: any) => `${r.subscription_id}:${r.reminder_type}`)
  );

  // Pass 3: send reminders and batch-insert records
  const toInsert: Array<Record<string, unknown>> = [];

  for (const { sub, reminderType } of candidates) {
    if (alreadySent.has(`${sub.id}:${reminderType}`)) {
      skipped++;
      continue;
    }

    const member = sub.members;
    if (!member?.email && !member?.phone_number && !member?.user_id) {
      skipped++;
      continue;
    }

    const subject = reminderType === "upcoming"
      ? `${APP_NAME}: Subscription payment due in 3 days`
      : `${APP_NAME}: Subscription payment overdue`;

    const amount = Number(sub.amount) || 0;
    const text = buildReminderText(reminderType, member.full_name, amount, sub.next_payment_date);

    try {
      const channelsSent: string[] = [];

      // Email (if available)
      if (member.email) {
        await enqueueEmailJob(member.email, subject, text);
        channelsSent.push("email");
      }

      // Push notification
      if (member.user_id) {
        const pushBody = reminderType === "upcoming"
          ? `Your subscription of ₹${amount.toFixed(0)} is due in 3 days.`
          : `Your subscription of ₹${amount.toFixed(0)} is overdue. Please pay soon.`;
        try {
          await queueNotification({
            church_id: member.church_id,
            recipient_user_id: member.user_id,
            channel: "push",
            notification_type: "subscription_reminder",
            subject,
            body: pushBody,
            metadata: { url: "/donate" },
          });
          channelsSent.push("push");
        } catch (_) { /* push failure is non-fatal */ }
      }

      // SMS (always — phone-only users rely on this)
      if (member.phone_number) {
        const smsBody = reminderType === "upcoming"
          ? `${APP_NAME}: Your subscription of Rs.${amount.toFixed(0)} is due in 3 days. Please pay on time.`
          : `${APP_NAME}: Your subscription of Rs.${amount.toFixed(0)} is overdue. Please pay at your earliest convenience.`;
        try {
          await queueNotification({
            church_id: member.church_id,
            recipient_phone: member.phone_number,
            channel: "sms",
            notification_type: "subscription_reminder",
            body: smsBody,
          });
          channelsSent.push("sms");
        } catch (_) { /* sms failure is non-fatal */ }
      }

      toInsert.push({
        subscription_id: sub.id,
        member_id: sub.member_id,
        church_id: member.church_id,
        reminder_type: reminderType,
        channels_sent: channelsSent,
      });

      sent++;
    } catch (err) {
      logger.warn({ err, subId: sub.id, reminderType }, "Failed to send subscription reminder");
      skipped++;
    }
  }

  // Batch insert all reminder records
  if (toInsert.length) {
    const { error: insertErr } = await db
      .from("subscription_reminders")
      .insert(toInsert);
    if (insertErr) {
      logger.warn({ err: insertErr }, "Batch subscription_reminders insert failed");
    }
  }

  return { sent, skipped };
}

function buildReminderText(type: ReminderType, name: string, amount: number, dueDate: string): string {
  const formattedAmount = `₹${amount.toFixed(2)}`;
  const formattedDate = new Date(dueDate).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  switch (type) {
    case "upcoming":
      return [
        `Dear ${name},`,
        "",
        `Your subscription payment of ${formattedAmount} is due on ${formattedDate}.`,
        "Please ensure timely payment to avoid any disruption.",
        "",
        `Thank you,`,
        `${APP_NAME} Team`,
      ].join("\n");

    case "overdue_7":
      return [
        `Dear ${name},`,
        "",
        `Your subscription payment of ${formattedAmount} was due on ${formattedDate} and is now 7 days overdue.`,
        "Please make the payment at your earliest convenience.",
        "",
        `Thank you,`,
        `${APP_NAME} Team`,
      ].join("\n");

    case "overdue_14":
      return [
        `Dear ${name},`,
        "",
        `Your subscription payment of ${formattedAmount} is now 14 days overdue (originally due ${formattedDate}).`,
        "Please make the payment immediately to maintain your active subscription.",
        "",
        `Thank you,`,
        `${APP_NAME} Team`,
      ].join("\n");

    case "overdue_30":
      return [
        `Dear ${name},`,
        "",
        `FINAL NOTICE: Your subscription payment of ${formattedAmount} is now 30 days overdue (originally due ${formattedDate}).`,
        "Your subscription may be deactivated if payment is not received soon.",
        "Please contact your church administrator if you need assistance.",
        "",
        `Thank you,`,
        `${APP_NAME} Team`,
      ].join("\n");
  }
}

/**
 * Check churches' grace periods and deactivate subscriptions that are overdue beyond the grace period.
 * Uses a batched approach: fetches all overdue subs with their church's grace period in one pass.
 */
export async function enforceGracePeriods(): Promise<{ deactivated: number }> {
  // Get all overdue subscriptions with member's church info and church's grace period
  // Limit to 2000 per run to avoid unbounded memory usage
  const { data: overdueSubs, error } = await db
    .from("subscriptions")
    .select(`
      id, member_id, next_payment_date, status, plan_name, amount,
      members!inner(church_id, deleted_at, full_name, email, phone_number, user_id)
    `)
    .eq("status", "overdue")
    .is("members.deleted_at", null)
    .limit(2000);

  if (error || !overdueSubs) {
    logger.error({ err: error }, "enforceGracePeriods: failed to fetch overdue subs");
    return { deactivated: 0 };
  }

  if (!overdueSubs.length) return { deactivated: 0 };

  // Collect unique church IDs and fetch their grace periods in one query
  const churchIds = [...new Set((overdueSubs as any[]).map((s) => s.members?.church_id).filter(Boolean))];
  const { data: churches, error: churchErr } = await db
    .from("churches")
    .select("id, grace_period_days")
    .in("id", churchIds)
    .is("deleted_at", null);

  if (churchErr || !churches) {
    logger.error({ err: churchErr }, "enforceGracePeriods: failed to fetch churches");
    return { deactivated: 0 };
  }

  const graceMap = new Map<string, number>();
  for (const c of churches) graceMap.set(c.id, c.grace_period_days || 30);

  const today = new Date();
  const toDeactivate: string[] = [];
  const deactivatedSubs: Array<{ id: string; member_id: string; church_id: string; member: any }> = [];

  for (const sub of overdueSubs as any[]) {
    const churchId = sub.members?.church_id;
    const graceDays = graceMap.get(churchId) || 30;
    const cutoffDate = new Date(today.getTime() - graceDays * 24 * 60 * 60 * 1000);
    const nextPayment = new Date(sub.next_payment_date);

    if (nextPayment < cutoffDate) {
      toDeactivate.push(sub.id);
      deactivatedSubs.push({ id: sub.id, member_id: sub.member_id, church_id: churchId, member: sub.members });
    }
  }

  if (!toDeactivate.length) return { deactivated: 0 };

  // Batch update all at once
  const { error: updateErr, count } = await db
    .from("subscriptions")
    .update({ status: "cancelled" })
    .in("id", toDeactivate);

  if (updateErr) {
    logger.error({ err: updateErr }, "enforceGracePeriods: batch update failed");
    return { deactivated: 0 };
  }

  // Record audit events and send notifications for each cancelled subscription
  for (const sub of deactivatedSubs) {
    try {
      await recordSubscriptionEvent({
        member_id: sub.member_id,
        subscription_id: sub.id,
        church_id: sub.church_id,
        event_type: "subscription_grace_period_expired",
        status_before: "overdue",
        status_after: "cancelled",
        source: "system",
        metadata: { cancelled_at: new Date().toISOString() },
      });
    } catch (eventErr) {
      logger.warn({ err: eventErr, subscription_id: sub.id }, "enforceGracePeriods: failed to record event");
    }

    // Notify the member about cancellation
    try {
      const member = sub.member;
      if (member?.email) {
        await enqueueEmailJob(
          member.email,
          `${APP_NAME} — Subscription Cancelled`,
          `Dear ${member.full_name || "Member"},\n\nYour subscription has been cancelled because payment was overdue beyond the allowed grace period.\n\nPlease contact your church admin to reactivate your subscription.\n\nThank you,\n${APP_NAME}`,
        );
      }
      if (member?.user_id) {
        await queueNotification({
          church_id: sub.church_id,
          recipient_user_id: member.user_id,
          channel: "push",
          notification_type: "subscription_cancelled",
          subject: "Subscription Cancelled",
          body: "Your subscription has been cancelled due to non-payment beyond the grace period.",
        }).catch(() => {});
      }
      if (member?.phone_number) {
        await queueNotification({
          church_id: sub.church_id,
          recipient_phone: member.phone_number,
          channel: "sms",
          notification_type: "subscription_cancelled",
          subject: "Subscription Cancelled",
          body: `${APP_NAME}: Your subscription has been cancelled due to non-payment. Contact your church admin to reactivate.`,
        }).catch(() => {});
      }
    } catch (notifyErr) {
      logger.warn({ err: notifyErr, subscription_id: sub.id }, "enforceGracePeriods: failed to notify member");
    }
  }

  return { deactivated: count || toDeactivate.length };
}
