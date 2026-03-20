import { supabaseAdmin } from "./supabaseClient";
import { logger } from "../utils/logger";

type SubscriptionEventSource =
  | "system"
  | "admin"
  | "member"
  | "payment_gateway"
  | "reconciler";

interface MemberChurchRow {
  church_id: string | null;
}

interface ReconcileCandidateRow {
  id: string;
  member_id: string;
  status: string;
  next_payment_date: string;
  members: MemberChurchRow | MemberChurchRow[] | null;
}

interface ReconcileUpdatedRow {
  id: string;
  member_id: string;
  status: string;
  next_payment_date: string;
}

export interface SubscriptionEventRow {
  id: string;
  member_id: string;
  subscription_id: string | null;
  church_id: string | null;
  event_type: string;
  status_before: string | null;
  status_after: string | null;
  amount: number | string | null;
  source: string;
  metadata: Record<string, unknown>;
  event_at: string;
  created_at: string;
}

export interface RecordSubscriptionEventInput {
  member_id: string;
  subscription_id?: string | null;
  church_id?: string | null;
  event_type: string;
  status_before?: string | null;
  status_after?: string | null;
  amount?: number | null;
  source?: SubscriptionEventSource;
  metadata?: Record<string, unknown>;
  event_at?: string;
}

function getChurchIdFromJoin(members: MemberChurchRow | MemberChurchRow[] | null) {
  if (!members) {
    return null;
  }
  if (Array.isArray(members)) {
    return members[0]?.church_id || null;
  }
  return members.church_id || null;
}

async function getMemberChurchId(memberId: string) {
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("church_id")
    .eq("id", memberId)
    .maybeSingle<MemberChurchRow>();

  if (error) {
    logger.error({ err: error, memberId }, "getMemberChurchId failed");
    throw error;
  }

  return data?.church_id || null;
}

export async function recordSubscriptionEvent(input: RecordSubscriptionEventInput) {
  const churchId =
    input.church_id !== undefined ? input.church_id : await getMemberChurchId(input.member_id);

  const payload = {
    member_id: input.member_id,
    subscription_id: input.subscription_id || null,
    church_id: churchId,
    event_type: input.event_type,
    status_before: input.status_before || null,
    status_after: input.status_after || null,
    amount: input.amount !== undefined ? input.amount : null,
    source: input.source || "system",
    metadata: input.metadata || {},
    event_at: input.event_at || new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("subscription_events")
    .insert([payload])
    .select(
      "id, member_id, subscription_id, church_id, event_type, status_before, status_after, amount, source, metadata, event_at, created_at"
    )
    .single<SubscriptionEventRow>();

  if (error) {
    logger.error({ err: error, payload }, "recordSubscriptionEvent failed");
    throw error;
  }

  return data;
}

export async function listMemberSubscriptionEvents(memberId: string, limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(limit, 100));
  const { data, error } = await supabaseAdmin
    .from("subscription_events")
    .select(
      "id, member_id, subscription_id, church_id, event_type, status_before, status_after, amount, source, metadata, event_at, created_at"
    )
    .eq("member_id", memberId)
    .order("event_at", { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    logger.error({ err: error, memberId }, "listMemberSubscriptionEvents failed");
    throw error;
  }

  return (data || []) as SubscriptionEventRow[];
}

export async function reconcileOverdueSubscriptions(churchId?: string) {
  const todayDate = new Date().toISOString().slice(0, 10);

  let overdueQuery = supabaseAdmin
    .from("subscriptions")
    .select("id, member_id, status, next_payment_date, members!inner(church_id)")
    .eq("status", "active")
    .lt("next_payment_date", todayDate);

  if (churchId) {
    overdueQuery = overdueQuery.eq("members.church_id", churchId);
  }

  const { data: candidates, error: candidatesError } =
    await overdueQuery.returns<ReconcileCandidateRow[]>();

  if (candidatesError) {
    logger.error({ err: candidatesError, churchId }, "reconcileOverdueSubscriptions lookup failed");
    throw candidatesError;
  }

  const rows = candidates || [];
  if (!rows.length) {
    return { updated_count: 0, event_count: 0 };
  }

  const subscriptionIds = rows.map((row) => row.id);
  const churchBySubscriptionId = new Map<string, string | null>();
  for (const row of rows) {
    churchBySubscriptionId.set(row.id, getChurchIdFromJoin(row.members));
  }

  const { data: updatedRows, error: updateError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "overdue" })
    .in("id", subscriptionIds)
    .eq("status", "active")
    .select("id, member_id, status, next_payment_date")
    .returns<ReconcileUpdatedRow[]>();

  if (updateError) {
    logger.error({ err: updateError, churchId }, "reconcileOverdueSubscriptions update failed");
    throw updateError;
  }

  let eventCount = 0;
  for (const row of updatedRows || []) {
    try {
      await recordSubscriptionEvent({
        member_id: row.member_id,
        subscription_id: row.id,
        church_id: churchBySubscriptionId.get(row.id) ?? null,
        event_type: "subscription_marked_overdue",
        status_before: "active",
        status_after: "overdue",
        source: "reconciler",
        metadata: {
          next_payment_date: row.next_payment_date,
          reconciled_at: new Date().toISOString(),
        },
      });
      eventCount += 1;
    } catch (eventErr) {
      logger.warn(
        { err: eventErr, subscriptionId: row.id },
        "reconcileOverdueSubscriptions event insert failed"
      );
    }
  }

  return {
    updated_count: (updatedRows || []).length,
    event_count: eventCount,
  };
}