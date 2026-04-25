import { db, pool } from "./dbClient";
import { logger } from "../utils/logger";
import { enqueueEmailJob } from "./jobQueueService";
import { APP_NAME } from "../config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MemberLookupRow = {
  id: string;
  full_name: string;
  email: string;
  user_id: string | null;
  church_id: string | null;
};

export async function createChurchEvent(input: {
  church_id: string;
  title: string;
  message: string;
  event_date?: string;
  end_time?: string;
  location?: string;
  image_url?: string;
  created_by?: string;
}) {
  const title = String(input.title || "").trim().replace(/<[^>]*>/g, "");
  const message = String(input.message || "").trim().replace(/<[^>]*>/g, "");

  if (!title || !message) {
    throw new Error("title and message are required");
  }

  let eventDate: string | null = null;
  if (typeof input.event_date === "string" && input.event_date.trim()) {
    const parsed = new Date(input.event_date);
    if (isNaN(parsed.getTime())) {
      throw new Error("Invalid event_date format");
    }
    eventDate = parsed.toISOString();
  }

  if (eventDate) {
    const eventDay = new Date(eventDate);
    eventDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (eventDay < today) {
      throw new Error("Event date cannot be in the past");
    }
  }

  const imageUrl = typeof input.image_url === "string" && input.image_url.trim()
    ? input.image_url.trim()
    : null;

  let endTime: string | null = null;
  if (typeof input.end_time === "string" && input.end_time.trim()) {
    const parsed = new Date(input.end_time);
    if (!isNaN(parsed.getTime())) endTime = parsed.toISOString();
  }

  const location = typeof input.location === "string" ? input.location.trim().replace(/<[^>]*>/g, "").slice(0, 500) : null;

  const { data, error } = await db
    .from("church_events")
    .insert([
      {
        church_id: input.church_id,
        title,
        message,
        event_date: eventDate,
        end_time: endTime,
        location,
        image_url: imageUrl,
        created_by: input.created_by || null,
      },
    ])
    .select("id, church_id, title, message, event_date, end_time, location, image_url, created_by, created_at")
    .single();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "createChurchEvent failed");
    throw error;
  }

  return data;
}

export async function listChurchEvents(churchId: string) {
  const { data, error } = await db
    .from("church_events")
    .select("id, church_id, title, message, event_date, end_time, location, image_url, created_by, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error, churchId }, "listChurchEvents failed");
    throw error;
  }

  return data || [];
}

export async function createChurchNotification(input: {
  church_id: string;
  title: string;
  message: string;
  image_url?: string;
  created_by?: string;
  idempotency_key?: string;
}) {
  const title = String(input.title || "").trim().replace(/<[^>]*>/g, "");
  const message = String(input.message || "").trim().replace(/<[^>]*>/g, "");

  if (!title || !message) {
    throw new Error("title and message are required");
  }

  const imageUrl = typeof input.image_url === "string" && input.image_url.trim()
    ? input.image_url.trim()
    : null;

  // Idempotency: if a key is provided and a row already exists for it, return that row
  // rather than creating a duplicate. Prevents double-fires from retried fetch calls.
  if (input.idempotency_key) {
    const { data: existing } = await db
      .from("church_notifications")
      .select("id, church_id, title, message, image_url, created_by, created_at")
      .eq("idempotency_key", input.idempotency_key)
      .maybeSingle();
    if (existing) return existing;
  }

  const insertRow: Record<string, any> = {
    church_id: input.church_id,
    title,
    message,
    image_url: imageUrl,
    created_by: input.created_by || null,
  };
  if (input.idempotency_key) insertRow.idempotency_key = input.idempotency_key;

  const { data, error } = await db
    .from("church_notifications")
    .insert([insertRow])
    .select("id, church_id, title, message, image_url, created_by, created_at")
    .single();

  if (error) {
    // Race: another concurrent call won the unique-index; fetch and return it.
    if (input.idempotency_key && (error as any).code === "23505") {
      const { data: winner } = await db
        .from("church_notifications")
        .select("id, church_id, title, message, image_url, created_by, created_at")
        .eq("idempotency_key", input.idempotency_key)
        .maybeSingle();
      if (winner) return winner;
    }
    logger.error({ err: error, churchId: input.church_id }, "createChurchNotification failed");
    throw error;
  }

  return data;
}

export async function listChurchNotifications(churchId: string, limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { data, error } = await db
    .from("church_notifications")
    .select("id, church_id, title, message, image_url, created_by, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    logger.error({ err: error, churchId }, "listChurchNotifications failed");
    throw error;
  }

  // Filter out any legacy family-related notifications
  return (data || []).filter((n: any) => {
    const t = (n.title || "").toLowerCase();
    return !t.includes("family member");
  });
}

// ── Event update / delete ──

export async function updateChurchEvent(
  eventId: string,
  churchId: string,
  input: { title?: string; message?: string; event_date?: string | null; end_time?: string | null; location?: string | null; image_url?: string | null },
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof input.title === "string") {
    const t = input.title.trim().replace(/<[^>]*>/g, "");
    if (!t) throw new Error("title cannot be empty");
    updates.title = t;
  }
  if (typeof input.message === "string") {
    const m = input.message.trim().replace(/<[^>]*>/g, "");
    if (!m) throw new Error("message cannot be empty");
    updates.message = m;
  }
  if (input.event_date !== undefined) {
    if (input.event_date === null || input.event_date === "") {
      updates.event_date = null;
    } else {
      const d = new Date(input.event_date);
      if (isNaN(d.getTime())) throw new Error("Invalid event_date");
      updates.event_date = d.toISOString();
    }
  }
  if (input.image_url !== undefined) {
    updates.image_url = typeof input.image_url === "string" && input.image_url.trim() ? input.image_url.trim() : null;
  }
  if (input.end_time !== undefined) {
    if (input.end_time === null || input.end_time === "") {
      updates.end_time = null;
    } else {
      const et = new Date(input.end_time);
      if (!isNaN(et.getTime())) updates.end_time = et.toISOString();
    }
  }
  if (input.location !== undefined) {
    updates.location = typeof input.location === "string" ? input.location.trim().replace(/<[^>]*>/g, "").slice(0, 500) : null;
  }

  const { data, error } = await db
    .from("church_events")
    .update(updates)
    .eq("id", eventId)
    .eq("church_id", churchId)
    .select("id, church_id, title, message, event_date, end_time, location, image_url, created_by, created_at")
    .single();

  if (error) {
    logger.error({ err: error, eventId, churchId }, "updateChurchEvent failed");
    throw error;
  }
  return data;
}

// ── Notification update / delete ──

export async function updateChurchNotification(
  notificationId: string,
  churchId: string,
  input: { title?: string; message?: string; image_url?: string | null },
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof input.title === "string") {
    const t = input.title.trim().replace(/<[^>]*>/g, "");
    if (!t) throw new Error("title cannot be empty");
    updates.title = t;
  }
  if (typeof input.message === "string") {
    const m = input.message.trim().replace(/<[^>]*>/g, "");
    if (!m) throw new Error("message cannot be empty");
    updates.message = m;
  }
  if (input.image_url !== undefined) {
    updates.image_url = typeof input.image_url === "string" && input.image_url.trim() ? input.image_url.trim() : null;
  }

  const { data, error } = await db
    .from("church_notifications")
    .update(updates)
    .eq("id", notificationId)
    .eq("church_id", churchId)
    .select("id, church_id, title, message, image_url, created_by, created_at")
    .single();

  if (error) {
    logger.error({ err: error, notificationId, churchId }, "updateChurchNotification failed");
    throw error;
  }
  return data;
}

// ── List all events/notifications across churches (super admin) ──

export async function listAllEvents(limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { data, error } = await db
    .from("church_events")
    .select("id, church_id, title, message, event_date, end_time, location, created_by, created_at")
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    logger.error({ err: error }, "listAllEvents failed");
    throw error;
  }
  return data || [];
}

export async function listAllNotifications(limit = 100, offset = 0) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { data, error } = await db
    .from("church_notifications")
    .select("id, church_id, title, message, created_by, created_at")
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    logger.error({ err: error }, "listAllNotifications failed");
    throw error;
  }
  return data || [];
}

function normalizeLeaderIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

export async function createPrayerRequest(input: {
  church_id: string;
  member_email: string;
  member_phone?: string;
  member_user_id?: string;
  leader_ids: unknown;
  details: string;
  is_anonymous?: boolean;
}) {
  const details = String(input.details || "").trim().replace(/<[^>]*>/g, "");
  if (!details) {
    throw new Error("Prayer request details are required");
  }

  const normalizedEmail = String(input.member_email || "").trim().toLowerCase();
  const normalizedPhone = String(input.member_phone || "").trim();

  if ((!normalizedEmail || !normalizedEmail.includes("@")) && !normalizedPhone && !input.member_user_id) {
    throw new Error("Member identification is required (email or phone)");
  }

  const leaderIds = normalizeLeaderIds(input.leader_ids);
  if (!leaderIds.length) {
    throw new Error("Select at least one leader");
  }

  const { data: leaders, error: leadersError } = await db
    .from("church_leadership")
    .select("id, church_id, full_name, phone_number, email, bio, is_active")
    .in("id", leaderIds)
    .eq("church_id", input.church_id)
    .eq("is_active", true);

  if (leadersError) {
    logger.error({ err: leadersError, churchId: input.church_id }, "createPrayerRequest leaders lookup failed");
    throw leadersError;
  }

  const recipients = (leaders || []) as Array<{
    id: string;
    church_id: string;
    full_name: string;
    phone_number: string | null;
    email: string | null;
    bio: string | null;
    is_active: boolean;
  }>;
  if (recipients.length !== leaderIds.length) {
    throw new Error("One or more selected leaders are invalid for your church");
  }

  // Resolve member by user_id, then email, then phone
  let member: MemberLookupRow | null = null;

  if (input.member_user_id) {
    const { data: byUserId } = await db
      .from("members")
      .select("id, full_name, email, user_id, church_id")
      .eq("user_id", input.member_user_id)
      .eq("church_id", input.church_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<MemberLookupRow>();
    if (byUserId) member = byUserId;
  }

  if (!member && normalizedPhone) {
    const { data: byPhone, error: phoneError } = await db
      .from("members")
      .select("id, full_name, email, user_id, church_id")
      .eq("phone_number", normalizedPhone)
      .eq("church_id", input.church_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<MemberLookupRow>();
    if (phoneError) {
      logger.error({ err: phoneError, phone: normalizedPhone }, "createPrayerRequest member lookup by phone failed");
      throw phoneError;
    }
    if (byPhone) member = byPhone;
  }

  if (!member) {
    throw new Error("Member profile not found for prayer request");
  }

  const isAnonymous = !!input.is_anonymous;
  const { data: prayerRequest, error: prayerRequestError } = await db
    .from("prayer_requests")
    .insert([
      {
        church_id: input.church_id,
        member_id: member.id,
        member_name: isAnonymous ? "Anonymous" : member.full_name,
        member_email: isAnonymous ? null : member.email,
        details,
        status: "sent",
        is_anonymous: isAnonymous,
      },
    ])
    .select("id, church_id, member_id, member_name, member_email, details, status, created_at, is_anonymous")
    .single();

  if (prayerRequestError) {
    logger.error({ err: prayerRequestError, memberId: member.id }, "createPrayerRequest insert failed");
    throw prayerRequestError;
  }

  const deliveryRows: Array<{
    prayer_request_id: string;
    leader_id: string;
    pastor_email: string | null;
    delivery_status: string;
    delivery_note: string | null;
    delivered_at: string | null;
  }> = [];

  for (const recipient of recipients) {
    if (!recipient.email && !recipient.phone_number) {
      deliveryRows.push({
        prayer_request_id: prayerRequest.id,
        leader_id: recipient.id,
        pastor_email: null,
        delivery_status: "skipped",
        delivery_note: "Leader contact info missing",
        delivered_at: null,
      });
      continue;
    }

    const displayName = isAnonymous ? "an anonymous member" : member.full_name;
    const subject = `${APP_NAME.toUpperCase} Prayer Request from ${displayName}`;
    const memberContact = isAnonymous ? "[identity withheld]" : (member.email || "phone user");
    const text = [
      `Prayer request from ${displayName} (${memberContact})`,
      "",
      details,
      "",
      `Requested at: ${new Date().toISOString()}`,
    ].join("\n");

    // Send email if available
    if (recipient.email) {
      try {
        await enqueueEmailJob(recipient.email, subject, text);
        deliveryRows.push({
          prayer_request_id: prayerRequest.id,
          leader_id: recipient.id,
          pastor_email: recipient.email,
          delivery_status: "queued",
          delivery_note: "Queued for async email delivery",
          delivered_at: null,
        });
      } catch (queueErr) {
        logger.warn({ err: queueErr, leaderId: recipient.id }, "Failed to queue prayer request email");
        deliveryRows.push({
          prayer_request_id: prayerRequest.id,
          leader_id: recipient.id,
          pastor_email: recipient.email,
          delivery_status: "failed",
          delivery_note: "Failed to queue email for delivery",
          delivered_at: null,
        });
      }
    }

    // Also send SMS if leader has phone number
    if (recipient.phone_number) {
      try {
        const smsBody = `${APP_NAME}: Prayer request from ${displayName} — "${details.slice(0, 120)}${details.length > 120 ? "..." : ""}"`;
        const { sendSmsNow } = await import("./notificationService");
        const smsResult = await sendSmsNow(recipient.phone_number, smsBody);
        if (!smsResult.success) {
          logger.warn({ leaderId: recipient.id, phone: recipient.phone_number, error: smsResult.error }, "Prayer request SMS failed");
        }
        // If no email was sent, record the SMS as the delivery
        if (!recipient.email) {
          deliveryRows.push({
            prayer_request_id: prayerRequest.id,
            leader_id: recipient.id,
            pastor_email: null,
            delivery_status: smsResult.success ? "queued" : "failed",
            delivery_note: smsResult.success ? "Delivered via SMS" : `SMS failed: ${smsResult.error}`,
            delivered_at: smsResult.success ? new Date().toISOString() : null,
          });
        }
      } catch (smsErr) {
        logger.warn({ err: smsErr, leaderId: recipient.id }, "Failed to send prayer request SMS");
        if (!recipient.email) {
          deliveryRows.push({
            prayer_request_id: prayerRequest.id,
            leader_id: recipient.id,
            pastor_email: null,
            delivery_status: "failed",
            delivery_note: "Failed to send SMS",
            delivered_at: null,
          });
        }
      }
    }
  }

  const { data: insertedRecipients, error: recipientsError } = await db
    .from("prayer_request_recipients")
    .insert(deliveryRows)
    .select("id, prayer_request_id, leader_id, pastor_email, delivery_status, delivery_note, delivered_at, created_at");

  if (recipientsError) {
    logger.error({ err: recipientsError, prayerRequestId: prayerRequest.id }, "createPrayerRequest recipients insert failed");
    throw recipientsError;
  }

  // Push confirmation to the submitter
  const queuedCount = deliveryRows.filter(r => r.delivery_status === "queued").length;
  if (member.user_id && member.church_id && queuedCount > 0) {
    try {
      const { queueNotification } = await import("./notificationService");
      await queueNotification({
        church_id: member.church_id,
        recipient_user_id: member.user_id,
        channel: "push",
        notification_type: "prayer_request_confirmation",
        subject: "Prayer Request Submitted",
        body: `Your prayer request has been sent to ${queuedCount} leader${queuedCount > 1 ? "s" : ""}. They will keep you in their prayers.`,
        metadata: { url: "/prayer-request" },
      });
    } catch (notifErr) {
      logger.warn({ err: notifErr }, "Failed to send prayer request confirmation push");
    }
  }

  return {
    prayer_request: prayerRequest,
    recipients: insertedRecipients || [],
  };
}

export async function listPrayerRequests(churchId: string, memberIdentifier?: { email: string; phone: string; user_id: string }) {
  // If filtering by member, first resolve the member_id to query prayer_requests accurately
  if (memberIdentifier) {
    let memberId: string | null = null;

    // Try user_id lookup first
    if (memberIdentifier.user_id) {
      const { data: byUserId } = await db
        .from("members")
        .select("id")
        .eq("user_id", memberIdentifier.user_id)
        .eq("church_id", churchId)
        .limit(1)
        .maybeSingle();
      if (byUserId) memberId = byUserId.id;
    }

    // Fallback to phone
    if (!memberId && memberIdentifier.phone) {
      const { data: byPhone } = await db
        .from("members")
        .select("id")
        .eq("phone_number", memberIdentifier.phone)
        .eq("church_id", churchId)
        .limit(1)
        .maybeSingle();
      if (byPhone) memberId = byPhone.id;
    }

    if (!memberId) return [];

    const { data, error } = await db
      .from("prayer_requests")
      .select("id, church_id, member_id, member_name, member_email, details, status, created_at")
      .eq("church_id", churchId)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      logger.error({ err: error, churchId, memberId }, "listPrayerRequests failed");
      throw error;
    }
    return data || [];
  }

  // Admin view: all requests
  const { data, error } = await db
    .from("prayer_requests")
    .select("id, church_id, member_id, member_name, member_email, details, status, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    logger.error({ err: error, churchId }, "listPrayerRequests failed");
    throw error;
  }

  return data || [];
}

// ── Delete functions ──

export async function deleteChurchEvent(eventId: string, churchId: string) {
  const { error } = await db
    .from("church_events")
    .delete()
    .eq("id", eventId)
    .eq("church_id", churchId);
  if (error) {
    logger.error({ err: error, eventId, churchId }, "deleteChurchEvent failed");
    throw error;
  }
  return { deleted: true, id: eventId };
}

export async function deleteChurchNotification(notificationId: string, churchId: string) {
  const { error } = await db
    .from("church_notifications")
    .delete()
    .eq("id", notificationId)
    .eq("church_id", churchId);
  if (error) {
    logger.error({ err: error, notificationId, churchId }, "deleteChurchNotification failed");
    throw error;
  }
  return { deleted: true, id: notificationId };
}

export async function deletePrayerRequest(requestId: string, churchId: string) {
  // Delete recipients first (FK constraint)
  await db
    .from("prayer_request_recipients")
    .delete()
    .eq("prayer_request_id", requestId);

  const { error } = await db
    .from("prayer_requests")
    .delete()
    .eq("id", requestId)
    .eq("church_id", churchId);
  if (error) {
    logger.error({ err: error, requestId, churchId }, "deletePrayerRequest failed");
    throw error;
  }
  return { deleted: true, id: requestId };
}

/**
 * Delete all events whose event_date has passed (the day after the scheduled date).
 * Events with no event_date are left untouched.
 */
export async function cleanupExpiredEvents(): Promise<{ deleted: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data, error } = await db
    .from("church_events")
    .delete()
    .not("event_date", "is", null)
    .lt("event_date", todayISO)
    .select("id");

  if (error) {
    logger.error({ err: error }, "cleanupExpiredEvents failed");
    throw error;
  }

  const count = data?.length || 0;
  if (count > 0) {
    logger.info({ deleted: count }, "cleanupExpiredEvents: removed past events");
  }
  return { deleted: count };
}

/**
 * Get pending admin counts for badge indicators.
 * Returns counts of pending membership requests, family requests,
 * cancellation requests, account deletion requests, refund requests,
 * prayer requests, and upcoming events for the given church.
 */
export async function getAdminPendingCounts(churchId: string): Promise<{
  membership_requests: number;
  family_requests: number;
  cancellation_requests: number;
  account_deletion_requests: number;
  refund_requests: number;
  prayer_requests: number;
  events: number;
  notifications: number;
}> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM membership_requests WHERE church_id = $1 AND status = 'pending') AS membership_requests,
       (SELECT COUNT(*)::int FROM family_member_create_requests WHERE church_id = $1 AND status = 'pending') AS family_requests,
       (SELECT COUNT(*)::int FROM cancellation_requests WHERE church_id = $1 AND status = 'pending') AS cancellation_requests,
       (SELECT COUNT(*)::int FROM account_deletion_requests WHERE church_id = $1 AND status = 'pending') AS account_deletion_requests,
       (SELECT COUNT(*)::int FROM refund_requests WHERE church_id = $1 AND status = 'pending') AS refund_requests,
       (SELECT COUNT(*)::int FROM prayer_requests WHERE church_id = $1 AND status = 'sent' AND created_at >= NOW() - INTERVAL '7 days') AS prayer_requests,
       (SELECT COUNT(*)::int FROM church_events WHERE church_id = $1 AND starts_at >= NOW()) AS events,
       (SELECT COUNT(*)::int FROM church_notifications WHERE church_id = $1 AND created_at >= NOW() - INTERVAL '7 days') AS notifications`,
    [churchId],
  );
  return rows[0];
}

// ── RSVP ──────────────────────────────────────────────────────

export async function toggleEventRsvp(eventId: string, userId: string, status: "going" | "interested" = "going") {
  const { rows: existing } = await pool.query(
    `SELECT id, status FROM event_rsvps WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId],
  );

  if (existing.length > 0) {
    // If same status, remove (toggle off)
    if (existing[0].status === status) {
      await pool.query(`DELETE FROM event_rsvps WHERE id = $1`, [existing[0].id]);
      return null;
    }
    // Update status
    const { rows } = await pool.query(
      `UPDATE event_rsvps SET status = $1 WHERE id = $2 RETURNING *`,
      [status, existing[0].id],
    );
    return rows[0];
  }

  // Create new RSVP
  const { rows } = await pool.query(
    `INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1, $2, $3) RETURNING *`,
    [eventId, userId, status],
  );
  return rows[0];
}

export async function getEventRsvpCounts(eventId: string) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM event_rsvps WHERE event_id = $1 GROUP BY status`,
    [eventId],
  );
  const counts: Record<string, number> = { going: 0, interested: 0 };
  for (const r of rows) counts[r.status] = r.count;
  return counts;
}

export async function getUserRsvp(eventId: string, userId: string) {
  const { rows } = await pool.query(
    `SELECT status FROM event_rsvps WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId],
  );
  return rows[0]?.status || null;
}

export async function getEventRsvpSummaries(eventIds: string[], userId: string) {
  if (!eventIds.length) return {};
  const { rows: countRows } = await pool.query(
    `SELECT event_id, status, COUNT(*)::int AS count FROM event_rsvps WHERE event_id = ANY($1) GROUP BY event_id, status`,
    [eventIds],
  );
  const { rows: userRows } = await pool.query(
    `SELECT event_id, status FROM event_rsvps WHERE event_id = ANY($1) AND user_id = $2`,
    [eventIds, userId],
  );
  const result: Record<string, { going: number; interested: number; myStatus: string | null }> = {};
  for (const id of eventIds) result[id] = { going: 0, interested: 0, myStatus: null };
  for (const r of countRows) {
    if (result[r.event_id]) result[r.event_id][r.status as "going" | "interested"] = r.count;
  }
  for (const r of userRows) {
    if (result[r.event_id]) result[r.event_id].myStatus = r.status;
  }
  return result;
}

// ── Notification Reads ────────────────────────────────────────

export async function markNotificationsRead(userId: string, notificationIds: string[]) {
  if (!notificationIds.length) return;
  const safeIds = notificationIds.filter((id) => UUID_RE.test(id)).slice(0, 500);
  if (!safeIds.length) return;
  const values = safeIds.map((id, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ");
  const params = safeIds.flatMap((id) => [id, userId]);
  await pool.query(
    `INSERT INTO notification_reads (notification_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    params,
  );
}

export async function getReadNotificationIds(userId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT notification_id FROM notification_reads WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.notification_id);
}

// ── Notification Preferences ──────────────────────────────────

const NOTIFICATION_CATEGORIES = ["events", "payments", "prayer", "family", "announcements"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export async function getNotificationPreferences(userId: string): Promise<Record<string, boolean>> {
  const defaults: Record<string, boolean> = {};
  for (const c of NOTIFICATION_CATEGORIES) defaults[c] = true;

  const { rows } = await pool.query(
    `SELECT category, enabled FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  for (const r of rows) defaults[r.category] = r.enabled;
  return defaults;
}

export async function updateNotificationPreference(userId: string, category: string, enabled: boolean) {
  if (!NOTIFICATION_CATEGORIES.includes(category as NotificationCategory)) {
    throw new Error("Invalid notification category");
  }
  await pool.query(
    `INSERT INTO notification_preferences (user_id, category, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, category)
     DO UPDATE SET enabled = $3, updated_at = NOW()`,
    [userId, category, enabled],
  );
}
