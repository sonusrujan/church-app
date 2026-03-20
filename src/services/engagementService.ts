import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";
import { sendEmail } from "./mailerService";
import { APP_NAME } from "../config";

type PastorRecipientRow = {
  id: string;
  church_id: string;
  full_name: string;
  phone_number: string;
  email: string | null;
  details: string | null;
  is_active: boolean;
};

type MemberLookupRow = {
  id: string;
  full_name: string;
  email: string;
  church_id: string | null;
};

export async function createChurchEvent(input: {
  church_id: string;
  title: string;
  message: string;
  event_date?: string;
  created_by?: string;
}) {
  const title = String(input.title || "").trim();
  const message = String(input.message || "").trim();

  if (!title || !message) {
    throw new Error("title and message are required");
  }

  const eventDate =
    typeof input.event_date === "string" && input.event_date.trim()
      ? new Date(input.event_date).toISOString()
      : null;

  const { data, error } = await supabaseAdmin
    .from("church_events")
    .insert([
      {
        church_id: input.church_id,
        title,
        message,
        event_date: eventDate,
        created_by: input.created_by || null,
      },
    ])
    .select("id, church_id, title, message, event_date, created_by, created_at")
    .single();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "createChurchEvent failed");
    throw error;
  }

  return data;
}

export async function listChurchEvents(churchId: string) {
  const { data, error } = await supabaseAdmin
    .from("church_events")
    .select("id, church_id, title, message, event_date, created_by, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

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
  created_by?: string;
}) {
  const title = String(input.title || "").trim();
  const message = String(input.message || "").trim();

  if (!title || !message) {
    throw new Error("title and message are required");
  }

  const { data, error } = await supabaseAdmin
    .from("church_notifications")
    .insert([
      {
        church_id: input.church_id,
        title,
        message,
        created_by: input.created_by || null,
      },
    ])
    .select("id, church_id, title, message, created_by, created_at")
    .single();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "createChurchNotification failed");
    throw error;
  }

  return data;
}

export async function listChurchNotifications(churchId: string) {
  const { data, error } = await supabaseAdmin
    .from("church_notifications")
    .select("id, church_id, title, message, created_by, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error, churchId }, "listChurchNotifications failed");
    throw error;
  }

  return data || [];
}

function normalizePastorIds(value: unknown) {
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
  pastor_ids: unknown;
  details: string;
}) {
  const details = String(input.details || "").trim();
  if (!details) {
    throw new Error("Prayer request details are required");
  }

  const pastorIds = normalizePastorIds(input.pastor_ids);
  if (!pastorIds.length) {
    throw new Error("Select at least one pastor");
  }

  const { data: pastors, error: pastorsError } = await supabaseAdmin
    .from("pastors")
    .select("id, church_id, full_name, phone_number, email, details, is_active")
    .in("id", pastorIds)
    .eq("church_id", input.church_id)
    .eq("is_active", true);

  if (pastorsError) {
    logger.error({ err: pastorsError, churchId: input.church_id }, "createPrayerRequest pastors lookup failed");
    throw pastorsError;
  }

  const recipients = (pastors || []) as PastorRecipientRow[];
  if (recipients.length !== pastorIds.length) {
    throw new Error("One or more selected pastors are invalid for your church");
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from("members")
    .select("id, full_name, email, church_id")
    .ilike("email", input.member_email.trim().toLowerCase())
    .eq("church_id", input.church_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<MemberLookupRow>();

  if (memberError) {
    logger.error({ err: memberError, email: input.member_email }, "createPrayerRequest member lookup failed");
    throw memberError;
  }

  if (!member) {
    throw new Error("Member profile not found for prayer request");
  }

  const { data: prayerRequest, error: prayerRequestError } = await supabaseAdmin
    .from("prayer_requests")
    .insert([
      {
        church_id: input.church_id,
        member_id: member.id,
        member_name: member.full_name,
        member_email: member.email,
        details,
        status: "sent",
      },
    ])
    .select("id, church_id, member_id, member_name, member_email, details, status, created_at")
    .single();

  if (prayerRequestError) {
    logger.error({ err: prayerRequestError, memberId: member.id }, "createPrayerRequest insert failed");
    throw prayerRequestError;
  }

  const deliveryRows: Array<{
    prayer_request_id: string;
    pastor_id: string;
    pastor_email: string | null;
    delivery_status: string;
    delivery_note: string | null;
    delivered_at: string | null;
  }> = [];

  for (const recipient of recipients) {
    if (!recipient.email) {
      deliveryRows.push({
        prayer_request_id: prayerRequest.id,
        pastor_id: recipient.id,
        pastor_email: null,
        delivery_status: "skipped",
        delivery_note: "Pastor email missing",
        delivered_at: null,
      });
      continue;
    }

    const subject = `${APP_NAME} Prayer Request from ${member.full_name}`;
    const text = [
      `Prayer request from ${member.full_name} (${member.email})`,
      "",
      details,
      "",
      `Requested at: ${new Date().toISOString()}`,
    ].join("\n");

    const sendResult = await sendEmail({
      to: recipient.email,
      subject,
      text,
    });

    deliveryRows.push({
      prayer_request_id: prayerRequest.id,
      pastor_id: recipient.id,
      pastor_email: recipient.email,
      delivery_status: sendResult.delivered ? "sent" : "queued",
      delivery_note: sendResult.note,
      delivered_at: sendResult.delivered ? new Date().toISOString() : null,
    });
  }

  const { data: insertedRecipients, error: recipientsError } = await supabaseAdmin
    .from("prayer_request_recipients")
    .insert(deliveryRows)
    .select("id, prayer_request_id, pastor_id, pastor_email, delivery_status, delivery_note, delivered_at, created_at");

  if (recipientsError) {
    logger.error({ err: recipientsError, prayerRequestId: prayerRequest.id }, "createPrayerRequest recipients insert failed");
    throw recipientsError;
  }

  return {
    prayer_request: prayerRequest,
    recipients: insertedRecipients || [],
  };
}

export async function listPrayerRequests(churchId: string, memberEmail?: string) {
  let query = supabaseAdmin
    .from("prayer_requests")
    .select("id, church_id, member_id, member_name, member_email, details, status, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (memberEmail) {
    query = query.ilike("member_email", memberEmail.trim().toLowerCase());
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error, churchId, memberEmail }, "listPrayerRequests failed");
    throw error;
  }

  return data || [];
}
