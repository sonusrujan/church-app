import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db, rawQuery } from "../services/dbClient";
import { logger } from "../utils/logger";
import { enqueueJob } from "../services/jobQueueService";

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

const router = Router();

/**
 * Razorpay webhook signatures must be verified with the webhook secret from
 * the Razorpay dashboard, not the API key secret used for orders.
 */
function verifyWebhook(body: string, signature: string): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    logger.error("RAZORPAY_WEBHOOK_SECRET is not configured; rejecting Razorpay webhook");
    return false;
  }
  return verifyWebhookSignature(body, signature, RAZORPAY_WEBHOOK_SECRET);
}

router.post("/razorpay", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }

    // PAY-008: Require raw body; refuse to process without it
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error("Webhook received without rawBody — verify Express body-parser config");
      return res.status(500).json({ error: "Webhook processing unavailable" });
    }
    const body = rawBody.toString("utf8");

    const verified = verifyWebhook(body, signature);

    if (!verified) {
      logger.warn({ ip: req.ip }, "Razorpay webhook signature verification failed");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body;
    // Use Razorpay's entity ID (payment_id or refund_id) for deterministic dedup.
    const entityId = event?.payload?.payment?.entity?.id || event?.payload?.refund?.entity?.id || "";
    if (!entityId) {
      logger.warn({ eventType: event?.event }, "Webhook event has no entity ID, skipping");
      return res.status(200).json({ status: "skipped_no_entity_id" });
    }
    const razorpayEventId = `${event.event}_${entityId}`;
    const eventType = event?.event || "unknown";
    const payload = event?.payload || {};

    // CRIT-02: Dedup BEFORE processing — insert first, skip if already exists
    const { error: insertError } = await db
      .from("razorpay_webhook_events")
      .insert({
        event_id: razorpayEventId,
        event_type: eventType,
        payload: event,
        processed: false,
      });

    if (insertError) {
      // Unique constraint violation = already processed or in-progress
      if (insertError.code === "23505") {
        logger.info({ eventId: razorpayEventId }, "Webhook event already recorded, skipping duplicate");
        return res.status(200).json({ status: "duplicate_skipped" });
      }
      logger.error({ err: insertError }, "Failed to store Razorpay webhook event");
      return res.status(500).json({ status: "storage_failed" });
    }

    // Process the event — only reached if this is the first insert
    try {
      if (eventType === "payment.captured") {
        await handlePaymentCaptured(payload);
      } else if (eventType === "payment.failed") {
        await handlePaymentFailed(payload);
      } else if (eventType === "refund.processed") {
        await handleRefundProcessed(payload);
      }

      // Mark as processed
      await db
        .from("razorpay_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("event_id", razorpayEventId);

      return res.status(200).json({ status: "ok" });
    } catch (processingErr: any) {
      // Mark as failed but keep the row so notifications are not re-sent on retry.
      // Razorpay will retry with the same event; the dedup insert will skip it.
      logger.error({ err: processingErr, eventId: razorpayEventId }, "Webhook event processing failed");
      await db
        .from("razorpay_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString(), error: (processingErr as Error)?.message || "processing_failed" })
        .eq("event_id", razorpayEventId)
        .eq("processed", false);
      return res.status(200).json({ status: "processing_failed_no_retry" });
    }
  } catch (err: any) {
    logger.error({ err }, "Razorpay webhook processing error");
    // Return 500 so Razorpay retries
    return res.status(500).json({ status: "error" });
  }
});

function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  try {
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

async function handlePaymentCaptured(payload: any) {
  try {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const orderId = payment.order_id;
    const paymentId = payment.id;
    const amount = Number(payment.amount) / 100;

    logger.info(
      { orderId, paymentId, amount },
      "Razorpay payment.captured webhook received"
    );

    // SaaS fee reconciliation: if this order was created for a church→platform
    // subscription payment and /api/saas/pay/verify never fired, activate the
    // subscription here so the church doesn't stay trial-locked.
    try {
      const { data: pendingSaas } = await db
        .from("church_subscription_pending_orders")
        .select("razorpay_order_id, church_subscription_id, church_id, expected_amount, reconciled_at")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();

      if (pendingSaas && !pendingSaas.reconciled_at) {
        const expected = Number(pendingSaas.expected_amount);
        if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount - expected) > 0.5) {
          logger.warn(
            { orderId, paymentId, amount, expected },
            "SaaS webhook: captured amount does not match expected — skipping activation"
          );
        } else {
          const { recordChurchSubscriptionPayment } = await import(
            "../services/churchSubscriptionService"
          );
          await recordChurchSubscriptionPayment({
            church_subscription_id: pendingSaas.church_subscription_id,
            church_id: pendingSaas.church_id,
            amount,
            payment_method: "razorpay",
            transaction_id: paymentId,
            note: "reconciled via webhook",
          });
          await db
            .from("church_subscription_pending_orders")
            .update({ reconciled_at: new Date().toISOString() })
            .eq("razorpay_order_id", orderId);
          logger.info(
            { orderId, paymentId, churchId: pendingSaas.church_id },
            "SaaS subscription activated via webhook reconciliation"
          );
        }
      }
    } catch (saasErr) {
      logger.error({ err: saasErr, orderId }, "SaaS webhook reconciliation failed");
    }

    // Check if we have a pending reconciliation for this order
    const { data: pendingRecon } = await db
      .from("payment_reconciliation_queue")
      .select("*")
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingRecon) {
      // Use optimistic locking: only update if status is still pending
      await db
        .from("payment_reconciliation_queue")
        .update({
          razorpay_payment_id: paymentId,
          status: "reconciled",
          reconciled_at: new Date().toISOString(),
        })
        .eq("id", pendingRecon.id)
        .eq("status", "pending");
    }

    // Update any payments that match this transaction_id to success
    const { data: updatedPayments } = await db
      .from("payments")
      .update({ payment_status: "success" })
      .eq("transaction_id", paymentId)
      .eq("payment_status", "pending")
      .select("id, member_id, amount, payment_category");

    if (updatedPayments?.length) {
      await enqueueJob({
        job_type: "payment_captured_side_effects",
        payload: {
          payment_ids: updatedPayments.map((p: any) => p.id),
          razorpay_payment_id: paymentId,
        },
      });
    }
  } catch (err) {
    logger.error({ err }, "handlePaymentCaptured failed");
  }
}

async function handlePaymentFailed(payload: any) {
  try {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const paymentId = payment.id;
    const amount = Number(payment.amount) / 100;
    logger.info({ paymentId, amount }, "Razorpay payment.failed webhook received");

    const { data: failedPayments } = await db
      .from("payments")
      .update({ payment_status: "failed" })
      .eq("transaction_id", paymentId)
      .eq("payment_status", "pending")
      .select("id, member_id, amount, payment_category");

    if (failedPayments?.length) {
      await enqueueJob({
        job_type: "payment_failed_side_effects",
        payload: {
          payment_ids: failedPayments.map((p: any) => p.id),
          razorpay_payment_id: paymentId,
        },
      });
    }
  } catch (err) {
    logger.error({ err }, "handlePaymentFailed failed");
  }
}

async function handleRefundProcessed(payload: any) {
  try {
    const refund = payload?.refund?.entity;
    if (!refund) return;

    const paymentId = refund.payment_id;
    const refundId = refund.id;
    const refundAmount = Number(refund.amount) / 100;
    const refundStatus = String(refund.status || "processed");

    logger.info({ paymentId, refundId, refundAmount, refundStatus }, "Razorpay refund.processed webhook received");

    if (!paymentId || !refundId) return;

    // One Razorpay payment can map to multiple local rows for multi-subscription checkout.
    const { data: paymentRows } = await db
      .from("payments")
      .select("id, member_id, subscription_id, amount, payment_status, church_id")
      .eq("transaction_id", paymentId);

    if (!paymentRows?.length) {
      logger.warn({ paymentId, refundId }, "Refund webhook: no matching payment row — skipping");
      return;
    }

    const localPayments = paymentRows as Array<{
      id: string;
      member_id: string | null;
      subscription_id: string | null;
      amount: number | string;
      payment_status: string | null;
      church_id: string | null;
    }>;
    const paymentIds = localPayments.map((row) => row.id);
    const totalPaymentAmount = localPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    if (!Number.isFinite(totalPaymentAmount) || totalPaymentAmount <= 0) {
      logger.warn({ paymentId, refundId }, "Refund webhook: invalid local payment total");
      return;
    }

    const { data: existingRefunds } = await db
      .from("payment_refunds")
      .select("id, payment_id, refund_amount, refund_reason, razorpay_refund_id")
      .in("payment_id", paymentIds);
    const refundsByPayment = new Map<string, any[]>();
    for (const row of existingRefunds || []) {
      const list = refundsByPayment.get(row.payment_id) || [];
      list.push(row);
      refundsByPayment.set(row.payment_id, list);
    }

    let remainingRefund = refundAmount;
    for (let i = 0; i < localPayments.length; i++) {
      const paymentRow = localPayments[i];
      const paymentAmount = Number(paymentRow.amount) || 0;
      const proportionalAmount = i === localPayments.length - 1
        ? remainingRefund
        : Math.round(refundAmount * (paymentAmount / totalPaymentAmount) * 100) / 100;
      const rowRefundAmount = Math.min(paymentAmount, Math.max(0, proportionalAmount));
      remainingRefund = Math.max(0, Math.round((remainingRefund - rowRefundAmount) * 100) / 100);
      if (rowRefundAmount <= 0) continue;

      const rowRefunds = refundsByPayment.get(paymentRow.id) || [];
      const alreadyTracked = rowRefunds.some((r) =>
        r.razorpay_refund_id === refundId ||
        (typeof r.refund_reason === "string" && r.refund_reason.includes(refundId)),
      );
      const totalPriorRefunds = rowRefunds.reduce((sum, r) => sum + (Number(r.refund_amount) || 0), 0);

      if (!alreadyTracked) {
        const { error: refundInsertError } = await db.from("payment_refunds").insert({
          payment_id: paymentRow.id,
          member_id: paymentRow.member_id,
          church_id: paymentRow.church_id,
          refund_amount: rowRefundAmount,
          refund_method: "razorpay",
          refund_reason: `Razorpay webhook refund ID: ${refundId}`,
          razorpay_refund_id: refundId,
          refund_status: refundStatus,
          recorded_by: null,
        });
        if (refundInsertError?.code !== "23505" && refundInsertError) {
          throw refundInsertError;
        }
      }

      const totalRefunded = alreadyTracked ? totalPriorRefunds : totalPriorRefunds + rowRefundAmount;
      const newStatus = totalRefunded >= paymentAmount - 0.01 ? "refunded" : "partially_refunded";

      await db
        .from("payments")
        .update({ payment_status: newStatus })
        .eq("id", paymentRow.id)
        .neq("payment_status", newStatus);

      if (!alreadyTracked) {
        await rawQuery(
          `UPDATE platform_fee_collections
           SET refunded_amount = LEAST(fee_amount, refunded_amount + ROUND((fee_amount * $2 / NULLIF($3, 0))::numeric, 2)),
               refunded_at = now()
           WHERE payment_id = $1`,
          [paymentRow.id, rowRefundAmount, paymentAmount],
        );
        await rawQuery(
          `UPDATE payment_transfers
           SET reversed_amount = LEAST(transfer_amount, reversed_amount + ROUND((transfer_amount * $2 / NULLIF($3, 0))::numeric, 2)),
               reversed_at = now(),
               transfer_status = CASE WHEN $4 THEN 'reversed' ELSE transfer_status END,
               updated_at = now()
           WHERE payment_id = $1`,
          [paymentRow.id, rowRefundAmount, paymentAmount, newStatus === "refunded"],
        );
      }

      if (newStatus === "refunded") {
        try {
          const { reversePaymentAllocations } = await import("../services/subscriptionMonthlyDuesService");
          const reversedCount = await reversePaymentAllocations(paymentRow.id);
          logger.info({ paymentId: paymentRow.id, reversedCount }, "Refund webhook: reversed monthly allocations");
        } catch (revErr) {
          logger.warn({ err: revErr, paymentId: paymentRow.id }, "Refund webhook: failed to reverse allocations");
        }

        if (paymentRow.subscription_id) {
          await db
            .from("subscriptions")
            .update({ status: "overdue" })
            .eq("id", paymentRow.subscription_id)
            .neq("status", "cancelled");
        }
      }

      if (!alreadyTracked) {
        await enqueueJob({
          job_type: "refund_processed_side_effects",
          payload: {
            payment_id: paymentRow.id,
            razorpay_payment_id: paymentId,
            razorpay_refund_id: refundId,
            refund_amount: rowRefundAmount,
          },
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "handleRefundProcessed failed");
  }
}

export default router;
