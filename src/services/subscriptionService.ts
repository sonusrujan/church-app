import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";

interface CreatedSubscriptionRow {
  id: string;
  member_id: string;
  plan_name: string;
  amount: number | string;
  billing_cycle: string;
  start_date: string;
  next_payment_date: string;
  status: string;
}

export interface CreateSubscriptionInput {
  member_id: string;
  plan_name: string;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  start_date: string;
  next_payment_date: string;
  status?: "active" | "paused" | "cancelled" | "overdue" | "pending_first_payment";
}

export async function createSubscription(
  input: CreateSubscriptionInput & { family_member_id?: string | null }
) {
  // ── Enforce: one active/pending subscription per member (family_member_id slot) ──
  // Regular members get exactly 1 subscription.
  // Family member subscriptions have family_member_id set; the head can have
  // one direct subscription (family_member_id IS NULL) plus one per family member.
  const existingQuery = db
    .from("subscriptions")
    .select("id, plan_name, status")
    .eq("member_id", input.member_id)
    .in("status", ["active", "pending_first_payment", "overdue"]);

  if (input.family_member_id) {
    existingQuery.eq("family_member_id", input.family_member_id);
  } else {
    existingQuery.is("family_member_id", null);
  }

  const { data: existingSubs } = await existingQuery;

  if (existingSubs && existingSubs.length > 0) {
    const existing = existingSubs[0] as { id: string; plan_name: string; status: string };
    throw new Error(
      `This member already has an active subscription ("${existing.plan_name}", status: ${existing.status}). ` +
      `Cancel or update the existing one instead of creating a new one.`
    );
  }

  const { data, error } = await db
    .from("subscriptions")
    .insert([
      {
        member_id: input.member_id,
        family_member_id: input.family_member_id || null,
        plan_name: input.plan_name,
        amount: input.amount,
        billing_cycle: input.billing_cycle,
        start_date: input.start_date,
        next_payment_date: input.next_payment_date,
        status: input.status || "pending_first_payment",
      },
    ])
    .select("id, member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status")
    .single<CreatedSubscriptionRow>();

  if (error) {
    if ((error as any).code === "23505") {
      throw new Error("An active subscription with this plan already exists for this member");
    }
    logger.error({ err: error }, "createSubscription failed");
    throw error;
  }

  if (!data) {
    throw new Error("Subscription created but no row returned");
  }

  try {
    await recordSubscriptionEvent({
      member_id: input.member_id,
      subscription_id: data.id,
      event_type: "subscription_created",
      status_after: data.status || input.status || "active",
      amount: Number(data.amount ?? input.amount),
      source: "admin",
      metadata: {
        plan_name: data.plan_name,
        billing_cycle: data.billing_cycle,
        start_date: data.start_date,
        next_payment_date: data.next_payment_date,
      },
    });
  } catch (eventErr) {
    logger.warn({ err: eventErr, subscriptionId: data.id }, "createSubscription event insert failed");
  }

  return data;
}

export async function getMemberSubscriptions(member_id: string, church_id?: string) {
  // If church_id provided, verify the member belongs to this church
  if (church_id) {
    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", member_id)
      .eq("church_id", church_id)
      .maybeSingle();
    if (!member) {
      throw new Error("Member not found or does not belong to your church");
    }
  }

  // Direct subscriptions: where member_id matches
  const { data: directSubs, error: directErr } = await db
    .from("subscriptions")
    .select("*")
    .eq("member_id", member_id);

  if (directErr) {
    logger.error({ err: directErr }, "getMemberSubscriptions direct query failed");
    throw directErr;
  }

  // Also check if this member is a linked family member (family_members.linked_to_member_id)
  // and return the subscriptions associated with their family_member row
  const { data: familyLink } = await db
    .from("family_members")
    .select("id, member_id")
    .eq("linked_to_member_id", member_id)
    .maybeSingle<{ id: string; member_id: string }>();

  if (familyLink) {
    const { data: familySubs, error: famErr } = await db
      .from("subscriptions")
      .select("*")
      .eq("family_member_id", familyLink.id);

    if (!famErr && familySubs?.length) {
      // Merge, deduplicating by id
      const existingIds = new Set((directSubs || []).map((s: any) => s.id));
      for (const fs of familySubs) {
        if (!existingIds.has(fs.id)) {
          (directSubs || []).push(fs);
        }
      }
    }
  }

  return directSubs || [];
}
