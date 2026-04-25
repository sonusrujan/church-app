import { db, getClient, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";

// ── Types ──

export interface CancellationRequestRow {
  id: string;
  subscription_id: string;
  member_id: string;
  church_id: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

// ── Functions ──

export async function createCancellationRequest(
  subscriptionId: string,
  memberId: string,
  churchId: string,
  reason?: string
) {
  // Verify subscription exists and belongs to member
  const { data: subscription, error: subError } = await db
    .from("subscriptions")
    .select("id, status, member_id, plan_name")
    .eq("id", subscriptionId)
    .eq("member_id", memberId)
    .single();

  if (subError || !subscription) {
    throw new Error("Subscription not found.");
  }

  if (subscription.status === "cancelled") {
    throw new Error("This subscription is already cancelled.");
  }

  // Check if a pending request already exists for this subscription
  const { data: existing } = await db
    .from("cancellation_requests")
    .select("id")
    .eq("subscription_id", subscriptionId)
    .eq("status", "pending")
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error("A cancellation request is already pending for this subscription.");
  }

  const { data, error } = await db
    .from("cancellation_requests")
    .insert([{
      subscription_id: subscriptionId,
      member_id: memberId,
      church_id: churchId,
      reason: reason?.trim().replace(/<[^>]*>/g, "") || null,
    }])
    .select("*")
    .single<CancellationRequestRow>();

  if (error) {
    logger.error({ err: error }, "createCancellationRequest failed");
    throw new Error("Failed to submit cancellation request.");
  }

  return data;
}

export async function listCancellationRequests(churchId: string, status?: string) {
  const params: unknown[] = [churchId];
  let sql = `
    SELECT cr.*,
      s.plan_name   AS sub_plan_name,
      s.amount       AS sub_amount,
      s.billing_cycle AS sub_billing_cycle,
      m.full_name    AS member_full_name,
      m.email        AS member_email
    FROM cancellation_requests cr
    LEFT JOIN subscriptions s ON s.id = cr.subscription_id
    LEFT JOIN members m ON m.id = cr.member_id
    WHERE cr.church_id = $1`;

  if (status) {
    params.push(status);
    sql += ` AND cr.status = $${params.length}`;
  }

  sql += ` ORDER BY cr.created_at DESC LIMIT 200`;

  try {
    const { rows } = await rawQuery(sql, params);
    return rows.map((row: any) => ({
      id: row.id,
      subscription_id: row.subscription_id,
      member_id: row.member_id,
      church_id: row.church_id,
      reason: row.reason,
      status: row.status,
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      review_note: row.review_note,
      created_at: row.created_at,
      subscription: row.sub_plan_name
        ? { plan_name: row.sub_plan_name, amount: row.sub_amount, billing_cycle: row.sub_billing_cycle }
        : undefined,
      member: row.member_full_name
        ? { full_name: row.member_full_name, email: row.member_email }
        : undefined,
    }));
  } catch (err) {
    logger.error({ err, churchId }, "listCancellationRequests failed");
    throw err;
  }
}

export async function reviewCancellationRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  reviewNote?: string,
  callerChurchId?: string
) {
  // Fetch the request
  const { data: request, error: fetchError } = await db
    .from("cancellation_requests")
    .select("*")
    .eq("id", requestId)
    .eq("status", "pending")
    .single<CancellationRequestRow>();

  if (fetchError || !request) {
    throw new Error("Request not found or already reviewed.");
  }

  // Church-scoping: non-super-admins can only review requests for their own church
  if (callerChurchId && request.church_id !== callerChurchId) {
    throw new Error("You cannot review requests for another church.");
  }

  // Update the request and (if approved) cancel the subscription atomically
  const client = await getClient();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE "cancellation_requests" SET "status" = $1, "reviewed_by" = $2, "reviewed_at" = $3, "review_note" = $4 WHERE "id" = $5`,
      [decision, reviewedBy, new Date().toISOString(), reviewNote?.trim() || null, requestId],
    );

    if (decision === "approved") {
      const cancelResult = await client.query(
        `UPDATE "subscriptions" SET "status" = 'cancelled' WHERE "id" = $1`,
        [request.subscription_id],
      );

      if (cancelResult.rowCount === 0) {
        throw new Error("Failed to cancel subscription");
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err, requestId }, "reviewCancellationRequest transaction failed");
    throw err;
  } finally {
    client.release();
  }

  // Non-blocking event recording (after commit)
  if (decision === "approved") {
    try {
      await recordSubscriptionEvent({
        member_id: request.member_id,
        subscription_id: request.subscription_id,
        church_id: request.church_id,
        event_type: "subscription_cancelled",
        status_before: "active",
        status_after: "cancelled",
        source: "admin",
        metadata: {
          cancellation_request_id: requestId,
          reason: request.reason,
        },
      });
    } catch {
      // Non-blocking
    }
  }

  return { status: decision, request_id: requestId };
}
