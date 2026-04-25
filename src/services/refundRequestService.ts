import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

export type RefundRequestRow = {
  id: string;
  payment_id: string;
  member_id: string;
  church_id: string;
  transaction_id: string | null;
  amount: number;
  reason: string | null;
  status: "pending" | "forwarded" | "approved" | "denied" | "processed";
  forwarded_by: string | null;
  forwarded_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  member?: { full_name: string; email: string };
  payment?: { amount: number; payment_method: string; payment_date: string; receipt_number: string | null };
};

export async function createRefundRequest(input: {
  payment_id: string;
  member_id: string;
  church_id: string;
  transaction_id?: string;
  amount: number;
  reason?: string;
}): Promise<RefundRequestRow> {
  // LOW-03: Validate amount is positive
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Refund amount must be a positive number");
  }

  // Check if request already exists for this payment
  const { data: existing } = await db
    .from("refund_requests")
    .select("id, status")
    .eq("payment_id", input.payment_id)
    .in("status", ["pending", "forwarded", "approved"])
    .maybeSingle();

  if (existing) {
    throw new Error("A refund request already exists for this payment");
  }

  const { data, error } = await db
    .from("refund_requests")
    .insert({
      payment_id: input.payment_id,
      member_id: input.member_id,
      church_id: input.church_id,
      transaction_id: input.transaction_id || null,
      amount: input.amount,
      reason: input.reason || null,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "createRefundRequest failed");
    throw error;
  }
  return data as RefundRequestRow;
}

export async function listRefundRequests(
  churchId: string,
  statusFilter?: string,
  limit = 100,
): Promise<RefundRequestRow[]> {
  if (!churchId) throw new Error("churchId is required");

  const params: unknown[] = [churchId, limit];
  let sql = `
    SELECT rr.*,
      m.full_name        AS member_full_name,
      m.email            AS member_email,
      p.amount           AS payment_amount,
      p.payment_method   AS payment_method,
      p.payment_date     AS payment_date,
      p.receipt_number   AS payment_receipt_number
    FROM refund_requests rr
    LEFT JOIN members m ON m.id = rr.member_id
    LEFT JOIN payments p ON p.id = rr.payment_id
    WHERE rr.church_id = $1`;

  if (statusFilter && statusFilter !== "all") {
    params.push(statusFilter);
    sql += ` AND rr.status = $${params.length}`;
  }

  sql += ` ORDER BY rr.created_at DESC LIMIT $2`;

  try {
    const { rows } = await rawQuery(sql, params);
    return rows.map((row: any) => ({
      id: row.id,
      payment_id: row.payment_id,
      member_id: row.member_id,
      church_id: row.church_id,
      transaction_id: row.transaction_id,
      amount: row.amount,
      reason: row.reason,
      status: row.status,
      forwarded_by: row.forwarded_by,
      forwarded_at: row.forwarded_at,
      reviewed_by: row.reviewed_by,
      review_note: row.review_note,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      member: row.member_full_name
        ? { full_name: row.member_full_name, email: row.member_email }
        : undefined,
      payment: row.payment_amount != null
        ? { amount: row.payment_amount, payment_method: row.payment_method, payment_date: row.payment_date, receipt_number: row.payment_receipt_number }
        : undefined,
    })) as RefundRequestRow[];
  } catch (err) {
    logger.error({ err }, "listRefundRequests failed");
    throw err;
  }
}

export async function forwardRefundRequest(
  requestId: string,
  forwardedBy: string,
  churchId: string,
): Promise<RefundRequestRow> {
  // Verify the request belongs to the admin's church
  const { data: req } = await db
    .from("refund_requests")
    .select("id, church_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!req) throw new Error("Refund request not found");
  if (req.church_id !== churchId) throw new Error("Request does not belong to your church");
  if (req.status !== "pending") throw new Error("Only pending requests can be forwarded");

  const { data, error } = await db
    .from("refund_requests")
    .update({
      status: "forwarded",
      forwarded_by: forwardedBy,
      forwarded_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "forwardRefundRequest failed");
    throw error;
  }
  return data as RefundRequestRow;
}

export async function reviewRefundRequest(
  requestId: string,
  decision: "approved" | "denied",
  reviewedBy: string,
  reviewNote?: string,
  callerChurchId?: string,
): Promise<RefundRequestRow> {
  const { data: req } = await db
    .from("refund_requests")
    .select("id, status, church_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!req) throw new Error("Refund request not found");
  if (callerChurchId && req.church_id !== callerChurchId) {
    throw new Error("Refund request does not belong to your church");
  }
  if (!["pending", "forwarded"].includes(req.status)) {
    throw new Error("Only pending or forwarded requests can be reviewed");
  }

  const { data, error } = await db
    .from("refund_requests")
    .update({
      status: decision,
      reviewed_by: reviewedBy,
      review_note: reviewNote || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error }, "reviewRefundRequest failed");
    throw error;
  }
  return data as RefundRequestRow;
}

export async function getMemberRefundRequests(memberId: string): Promise<RefundRequestRow[]> {
  const { data, error } = await db
    .from("refund_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error, memberId }, "getMemberRefundRequests failed");
    throw error;
  }
  return (data || []) as RefundRequestRow[];
}
