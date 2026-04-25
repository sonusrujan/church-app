import { db, rawQuery, getClient } from "./dbClient";
import { logger } from "../utils/logger";
import { enqueueJob } from "./jobQueueService";
// AWS SNS imports — kept for future use
// import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import Twilio from "twilio";
import { AWS_REGION, APP_NAME, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID } from "../config";
import webpush from "web-push";
import https from "https";
import net from "net";
import dns from "dns";

// ── Force IPv4 for push delivery ──
// Node.js 20+ Happy Eyeballs (autoSelectFamily) tries IPv6 first.
// AWS VPC has no IPv6 → ETIMEDOUT.  Agent-level autoSelectFamily: false
// doesn't propagate to tls.connect() in Node.js 20, so we use three layers:
// 1. Global: disable Happy Eyeballs entirely
// 2. DNS: prefer IPv4 results
// 3. Agent: createConnection override forces family=4
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}
dns.setDefaultResultOrder("ipv4first");

const pushAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  timeout: 15000,
} as any);

// Override createConnection to guarantee family=4 on every socket
const _origCC = (pushAgent as any).createConnection.bind(pushAgent);
(pushAgent as any).createConnection = function (options: any, oncreate: any) {
  if (typeof options === "object" && options !== null) {
    options.family = 4;
    options.autoSelectFamily = false;
  }
  return _origCC(options, oncreate);
};

// ── Notification Service — multi-channel (email, SMS, push) ──

// AWS SNS client — kept commented for future use
// let snsClient: SNSClient | null = null;
// function getSnsClient(): SNSClient {
//   if (!snsClient) {
//     snsClient = new SNSClient({
//       region: AWS_REGION,
//       ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
//         ? { credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } }
//         : {}),
//     });
//   }
//   return snsClient;
// }

// ── Twilio client for SMS notifications ──
let twilioClient: ReturnType<typeof Twilio> | null = null;
function getTwilioClient() {
  if (!twilioClient) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error("Twilio credentials not configured for SMS");
    }
    twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

export type NotificationChannel = "email" | "sms" | "push";

export interface SendNotificationInput {
  church_id: string;
  recipient_user_id?: string;
  recipient_phone?: string;
  recipient_email?: string;
  channel: NotificationChannel;
  notification_type: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

/**
 * Queue a notification for async delivery.
 * Uses a transaction to ensure delivery record + job are created atomically.
 */
export async function queueNotification(input: SendNotificationInput): Promise<string> {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // Insert notification_deliveries record
    const deliveryResult = await client.query(
      `INSERT INTO notification_deliveries
       (church_id, recipient_user_id, recipient_phone, recipient_email, channel, notification_type, subject, body, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
       RETURNING id`,
      [
        input.church_id,
        input.recipient_user_id || null,
        input.recipient_phone || null,
        input.recipient_email || null,
        input.channel,
        input.notification_type,
        input.subject || null,
        input.body,
        JSON.stringify(input.metadata || {}),
      ]
    );
    const deliveryId = deliveryResult.rows[0].id as string;

    // Insert job_queue record in the same transaction
    const jobType = input.channel === "email" ? "send_email" : input.channel === "sms" ? "send_sms" : "send_push";
    await client.query(
      `INSERT INTO job_queue (job_type, payload, scheduled_for, max_attempts, status, attempts)
       VALUES ($1, $2, NOW(), 3, 'pending', 0)`,
      [
        jobType,
        JSON.stringify({
          delivery_id: deliveryId,
          channel: input.channel,
          to: input.recipient_email || input.recipient_phone || "",
          recipient_user_id: input.recipient_user_id || "",
          subject: input.subject || "",
          body: input.body,
          url: (input.metadata?.url as string) || "",
        }),
      ]
    );

    await client.query("COMMIT");
    return deliveryId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "queueNotification failed");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Send SMS immediately via Twilio Messaging Service.
 */
export async function sendSmsNow(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getTwilioClient();
    // Use Messaging Service SID if configured for sender ID management
    if (TWILIO_MESSAGING_SERVICE_SID) {
      await client.messages.create({
        to: phone,
        body: message,
        messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
      });
    } else {
      await client.messages.create({
        to: phone,
        body: message,
      });
    }
    return { success: true };
  } catch (err: any) {
    logger.error({ err, phone }, "sendSmsNow (Twilio) failed");
    return { success: false, error: err?.message || "SMS send failed" };
  }
}

// AWS SNS sendSmsNow — kept commented for future use
// export async function sendSmsNow_SNS(phone: string, message: string): Promise<{ success: boolean; error?: string }> {
//   try {
//     const sns = getSnsClient();
//     await sns.send(
//       new PublishCommand({
//         PhoneNumber: phone,
//         Message: message,
//         MessageAttributes: {
//           "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: APP_NAME.slice(0, 11) },
//           "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
//         },
//       })
//     );
//     return { success: true };
//   } catch (err: any) {
//     logger.error({ err, phone }, "sendSmsNow failed");
//     return { success: false, error: err?.message || "SMS send failed" };
//   }
// }

/**
 * Send bulk notifications to all members of a church.
 */
export async function notifyChurchMembers(input: {
  church_id: string;
  notification_type: string;
  subject?: string;
  body: string;
  channels: NotificationChannel[];
  url?: string;
}): Promise<{ queued: number }> {
  const { data: members, error } = await db
    .from("members")
    .select("id, user_id, email, phone_number")
    .eq("church_id", input.church_id)
    .is("deleted_at", null);

  if (error || !members) {
    logger.error({ err: error, churchId: input.church_id }, "notifyChurchMembers: failed to fetch members");
    return { queued: 0 };
  }

  logger.info(
    { churchId: input.church_id, memberCount: members.length, channels: input.channels, type: input.notification_type },
    "notifyChurchMembers: starting",
  );

  let queued = 0;

  // Collect all notification deliveries and job queue entries in arrays first
  const deliveryRows: Record<string, unknown>[] = [];
  const jobRows: Array<{ job_type: string; payload: Record<string, unknown> }> = [];

  let pushEligible = 0;

  for (const member of members) {
    for (const channel of input.channels) {
      if (channel === "email" && member.email) {
        deliveryRows.push({
          church_id: input.church_id,
          recipient_user_id: member.user_id || null,
          recipient_email: member.email,
          channel: "email",
          notification_type: input.notification_type,
          subject: input.subject || null,
          body: input.body,
          status: "pending",
          metadata: {},
        });
        jobRows.push({
          job_type: "send_email",
          payload: { channel: "email", to: member.email, subject: input.subject || "", body: input.body },
        });
      }

      if (channel === "sms" && member.phone_number) {
        deliveryRows.push({
          church_id: input.church_id,
          recipient_user_id: member.user_id || null,
          recipient_phone: member.phone_number,
          channel: "sms",
          notification_type: input.notification_type,
          body: input.body,
          status: "pending",
          metadata: {},
        });
        jobRows.push({
          job_type: "send_sms",
          payload: { channel: "sms", to: member.phone_number, subject: "", body: input.body },
        });
      }

      if (channel === "push" && member.user_id) {
        pushEligible++;
        deliveryRows.push({
          church_id: input.church_id,
          recipient_user_id: member.user_id,
          channel: "push",
          notification_type: input.notification_type,
          subject: input.subject || null,
          body: input.body,
          status: "pending",
          metadata: {},
        });
        jobRows.push({
          job_type: "send_push",
          payload: {
            channel: "push",
            to: "",
            recipient_user_id: member.user_id,
            subject: input.subject || "",
            body: input.body,
            url: input.url || "/home",
          },
        });
      }
    }
  }

  if (input.channels.includes("push")) {
    logger.info(
      { churchId: input.church_id, totalMembers: members.length, pushEligible, withUserId: members.filter((m: any) => m.user_id).length },
      "notifyChurchMembers: push eligibility",
    );
  }

  if (!deliveryRows.length) {
    logger.warn({ churchId: input.church_id, channels: input.channels }, "notifyChurchMembers: no eligible recipients");
    return { queued: 0 };
  }

  // Batch insert all deliveries + jobs atomically per batch
  const BATCH_SIZE = 500;
  for (let i = 0; i < deliveryRows.length; i += BATCH_SIZE) {
    const batch = deliveryRows.slice(i, i + BATCH_SIZE);
    const jobBatch = jobRows.slice(i, i + BATCH_SIZE);

    const client = await getClient();
    try {
      await client.query("BEGIN");

      // Build bulk INSERT for notification_deliveries
      const deliveryValues: unknown[] = [];
      const deliveryPlaceholders: string[] = [];
      batch.forEach((row, idx) => {
        const base = idx * 9;
        deliveryPlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, 'pending', $${base + 8}::jsonb)`);
        deliveryValues.push(
          row.church_id, row.recipient_user_id || null, row.recipient_phone || null,
          row.recipient_email || null, row.channel, row.notification_type,
          row.body, JSON.stringify(row.metadata || {})
        );
      });

      const insertResult = await client.query(
        `INSERT INTO notification_deliveries
         (church_id, recipient_user_id, recipient_phone, recipient_email, channel, notification_type, body, status, metadata)
         VALUES ${deliveryPlaceholders.join(", ")}
         RETURNING id`,
        deliveryValues
      );
      const inserted = insertResult.rows as Array<{ id: string }>;

      if (inserted.length > 0) {
        // Build bulk INSERT for job_queue
        const jobValues: unknown[] = [];
        const jobPlaceholders: string[] = [];
        inserted.forEach((row, idx) => {
          const base = idx * 2;
          jobPlaceholders.push(`($${base + 1}, $${base + 2}::jsonb, NOW(), 3, 'pending', 0)`);
          jobValues.push(
            jobBatch[idx]?.job_type || "send_email",
            JSON.stringify({ ...jobBatch[idx]?.payload, delivery_id: row.id })
          );
        });

        await client.query(
          `INSERT INTO job_queue (job_type, payload, scheduled_for, max_attempts, status, attempts)
           VALUES ${jobPlaceholders.join(", ")}`,
          jobValues
        );

        queued += inserted.length;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error({ err, batchStart: i, churchId: input.church_id }, "notifyChurchMembers: batch insert failed");
    } finally {
      client.release();
    }
  }

  logger.info({ churchId: input.church_id, queued, type: input.notification_type }, "notifyChurchMembers: complete");
  return { queued };
}

/**
 * Save or update a push subscription for a user.
 */
export async function savePushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string
): Promise<void> {
  const { error } = await db
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint, p256dh, auth },
      { onConflict: "user_id,endpoint" }
    );

  if (error) {
    logger.error({ err: error }, "savePushSubscription failed");
    throw error;
  }
}

/**
 * Remove a push subscription.
 */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
}

/**
 * Send a Web Push notification to all subscriptions for a user.
 * Uses TTL + high-urgency headers for reliable, fast delivery.
 */
export async function sendPushNow(
  recipientUserId: string | undefined,
  title: string,
  body: string,
  url?: string,
): Promise<{ success: boolean; sent: number; error?: string }> {
  if (!recipientUserId) return { success: false, sent: 0, error: "No recipient user ID" };
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    logger.warn("sendPushNow: VAPID keys not configured, skipping push");
    return { success: false, sent: 0, error: "VAPID keys not configured" };
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: subs, error } = await db
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", recipientUserId);

  if (error || !subs || subs.length === 0) {
    return { success: true, sent: 0 }; // no subscriptions is not an error
  }

  const payload = JSON.stringify({
    title: title || APP_NAME,
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    url: url || "/",
    tag: `shalom-${Date.now()}`,
    timestamp: Date.now(),
  });

  // TTL: 4 hours max — discard stale notifications after that
  // Urgency: "high" tells push services to wake the device immediately
  const pushOptions: webpush.RequestOptions = {
    timeout: 15000,
    TTL: 14400,
    urgency: "high" as any,
    agent: pushAgent,
    headers: {
      Urgency: "high",
    },
  };

  let sent = 0;
  const staleIds: string[] = [];

  // Helper: send to one subscription with 1 retry
  async function sendToSub(sub: any): Promise<{ id: string; ok: boolean; err?: any }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          pushOptions,
        );
        return { id: sub.id, ok: true };
      } catch (err: any) {
        // Don't retry HTTP errors (4xx/5xx) — they won't succeed on retry
        if (err.statusCode) return { id: sub.id, ok: false, err };
        // Retry connection errors (ETIMEDOUT, ECONNRESET, etc.) once
        if (attempt === 0) {
          logger.info({ subId: sub.id, code: err.code || err.message }, "sendPushNow: retrying after connection error");
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        return { id: sub.id, ok: false, err };
      }
    }
    return { id: sub.id, ok: false, err: new Error("unreachable") };
  }

  // Send to all subscription endpoints in parallel
  const results = await Promise.allSettled(subs.map((sub: any) => sendToSub(sub)));

  for (const r of results) {
    const val = r.status === "fulfilled" ? r.value : { id: "", ok: false, err: (r as any).reason };
    if (val.ok) {
      sent++;
    } else if (val.err?.statusCode === 410 || val.err?.statusCode === 404) {
      staleIds.push(val.id);
    } else if (val.err?.statusCode === 429) {
      // Rate limited by push service — don't remove, will retry on next attempt
      logger.warn({ subId: val.id, statusCode: 429 }, "sendPushNow: rate limited by push service");
    } else {
      logger.warn({
        subId: val.id,
        statusCode: val.err?.statusCode,
        errMsg: val.err?.message || val.err?.code || String(val.err),
        errBody: val.err?.body?.slice?.(0, 200),
        endpoint: subs.find((s: any) => s.id === val.id)?.endpoint?.slice(0, 80),
      }, "sendPushNow: push delivery failed");
    }
  }

  // Clean up stale (unsubscribed) endpoints
  if (staleIds.length) {
    await db.from("push_subscriptions").delete().in("id", staleIds);
    logger.info({ count: staleIds.length }, "Removed stale push subscriptions");
  }

  logger.info({ recipientUserId, totalSubs: subs.length, sent, stale: staleIds.length }, "sendPushNow: complete");
  return { success: sent > 0 || subs.length === 0, sent };
}
