import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { fetchRazorpayOrder } from "./paymentService";
import { getEffectivePaymentConfig } from "./churchPaymentService";

const RAZORPAY_FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Payment Reconciliation Service (4.1)
 *
 * Checks for pending/mismatched payments against Razorpay records.
 * Verifies that orders marked as paid in Razorpay have corresponding
 * successful payment records in our database.
 */

export async function reconcilePendingPayments(): Promise<{
  reconciled: number;
  failed: number;
  already_ok: number;
  manual_review: number;
}> {
  // Fetch pending reconciliation items
  const { data: queue, error } = await db
    .from("payment_reconciliation_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", 5)
    .order("created_at", { ascending: true })
    .limit(50);

  if (error || !queue) {
    logger.error({ err: error }, "reconcilePendingPayments: queue fetch failed");
    return { reconciled: 0, failed: 0, already_ok: 0, manual_review: 0 };
  }

  let reconciled = 0;
  let failed = 0;
  let already_ok = 0;
  let manual_review = 0;

  // Process items in parallel with concurrency limit of 5
  const CONCURRENCY = 5;
  for (let i = 0; i < queue.length; i += CONCURRENCY) {
    const batch = queue.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (item: any) => {
        if (!item.church_id) {
          await markReconciliationFailed(item.id, item.attempts, "No church_id");
          return "failed" as const;
        }

        const config = await getEffectivePaymentConfig(item.church_id);
        if (!config.payments_enabled || !config.key_id || !config.key_secret) {
          await markReconciliationFailed(item.id, item.attempts, "Payment config unavailable");
          return "failed" as const;
        }

        const order = await withTimeout(
          fetchRazorpayOrder(item.razorpay_order_id, {
            key_id: config.key_id,
            key_secret: config.key_secret,
          }),
          RAZORPAY_FETCH_TIMEOUT_MS,
          `Razorpay fetch for order ${item.razorpay_order_id}`,
        );

        if (order.status === "paid") {
          const { data: existing } = await db
            .from("payments")
            .select("id")
            .eq("transaction_id", item.razorpay_payment_id || item.razorpay_order_id)
            .eq("payment_status", "success")
            .maybeSingle();

          if (existing) {
            await db
              .from("payment_reconciliation_queue")
              .update({ status: "reconciled", reconciled_at: new Date().toISOString() })
              .eq("id", item.id);
            return "already_ok" as const;
          } else {
            await db
              .from("payment_reconciliation_queue")
              .update({ status: "manual_review", error_message: "Razorpay shows paid but no matching payment record" })
              .eq("id", item.id);
            return "manual_review" as const;
          }
        } else {
          await markReconciliationFailed(item.id, item.attempts, `Razorpay order status: ${order.status}`);
          return "failed" as const;
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value === "already_ok") already_ok++;
        else if (result.value === "manual_review") manual_review++;
        else if (result.value === "failed") failed++;
      } else {
        failed++;
      }
    }
  }

  return { reconciled, failed, already_ok, manual_review };
}

async function markReconciliationFailed(id: string, currentAttempts: number, errorMsg: string) {
  await db
    .from("payment_reconciliation_queue")
    .update({
      status: currentAttempts + 1 >= 5 ? "failed" : "pending",
      attempts: currentAttempts + 1,
      error_message: errorMsg,
    })
    .eq("id", id);
}

/**
 * Add a payment to the reconciliation queue.
 * Called when a payment order is created but verification hasn't completed.
 */
export async function queueForReconciliation(input: {
  razorpay_order_id: string;
  church_id: string;
  member_id: string;
  subscription_ids?: string[];
  expected_amount: number;
}): Promise<void> {
  const { error } = await db
    .from("payment_reconciliation_queue")
    .insert({
      razorpay_order_id: input.razorpay_order_id,
      church_id: input.church_id,
      member_id: input.member_id,
      subscription_ids: input.subscription_ids || [],
      expected_amount: input.expected_amount,
      status: "pending",
    });

  if (error) {
    logger.warn({ err: error, orderId: input.razorpay_order_id }, "queueForReconciliation: insert failed");
  }
}
