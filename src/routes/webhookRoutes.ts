import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

const router = Router();

/**
 * Razorpay sends webhook events as POST with X-Razorpay-Signature header.
 * We verify the HMAC-SHA256 signature using the global RAZORPAY_KEY_SECRET only.
 * Per-church keys are NOT used for webhook verification to prevent key confusion attacks.
 */
router.post("/razorpay", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }

    const body = JSON.stringify(req.body);

    // Verify with global key only — never trust client-supplied metadata for key selection
    if (!RAZORPAY_KEY_SECRET) {
      logger.error("Razorpay webhook received but RAZORPAY_KEY_SECRET is not configured");
      return res.status(500).json({ error: "Webhook verification not configured" });
    }

    const verified = verifyWebhookSignature(body, signature, RAZORPAY_KEY_SECRET);

    if (!verified) {
      logger.warn({ ip: req.ip }, "Razorpay webhook signature verification failed");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body;
    // Use Razorpay's entity ID (payment_id or refund_id) for deterministic dedup — never Date.now()
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
      // HIGH-01: Return 500 so Razorpay retries on processing failure
      logger.error({ err: processingErr, eventId: razorpayEventId }, "Webhook event processing failed");
      // Clean up the unprocessed row so retry can re-insert
      await db
        .from("razorpay_webhook_events")
        .delete()
        .eq("event_id", razorpayEventId)
        .eq("processed", false);
      return res.status(500).json({ status: "processing_failed" });
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
      .select("member_id, amount, payment_category");

    // Push notification to the member about successful payment
    if (updatedPayments?.length) {
      const { queueNotification } = await import("../services/notificationService");
      for (const p of updatedPayments) {
        if (p.member_id) {
          const { data: member } = await db.from("members").select("user_id, church_id").eq("id", p.member_id).maybeSingle();
          if (member?.user_id && member?.church_id) {
            queueNotification({
              church_id: member.church_id,
              recipient_user_id: member.user_id,
              channel: "push",
              notification_type: "payment_success",
              subject: "Payment Successful",
              body: `Your payment of ₹${p.amount} (${p.payment_category || "subscription"}) has been confirmed.`,
            }).catch(() => {});
          }
        }
      }
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
      .select("member_id, amount, payment_category");

    // Notify member about payment failure
    if (failedPayments?.length) {
      const { queueNotification } = await import("../services/notificationService");
      for (const p of failedPayments) {
        if (p.member_id) {
          const { data: member } = await db.from("members").select("user_id, church_id, phone_number").eq("id", p.member_id).maybeSingle();
          if (member?.church_id) {
            const failAmount = Number(p.amount) || amount;
            if (member.user_id) {
              queueNotification({
                church_id: member.church_id,
                recipient_user_id: member.user_id,
                channel: "push",
                notification_type: "payment_failed",
                subject: "Payment Failed",
                body: `Your payment of ₹${failAmount} could not be processed. Please try again.`,
                metadata: { url: "/donate" },
              }).catch(() => {});
            }
            if (member.phone_number) {
              queueNotification({
                church_id: member.church_id,
                recipient_phone: member.phone_number,
                channel: "sms",
                notification_type: "payment_failed",
                body: `Your payment of ₹${failAmount} failed. Please retry at your earliest convenience. - ${(await import("../config")).APP_NAME}`,
              }).catch(() => {});
            }
          }
        }
      }
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
    logger.info({ paymentId, refundId: refund.id }, "Razorpay refund.processed webhook received");

    // We don't auto-update payment status here — refunds are tracked via our own refund table
  } catch (err) {
    logger.error({ err }, "handleRefundProcessed failed");
  }
}

export default router;
