import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";
import { enqueueEmailJob } from "../services/jobQueueService";

// PAY-003: Use the dedicated webhook secret (Razorpay Dashboard → Settings → Webhooks).
// This is distinct from the API key secret (RAZORPAY_KEY_SECRET).
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

const router = Router();

function verifyWebhookSignature(body: string, signature: string): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET) {
    logger.error("RAZORPAY_WEBHOOK_SECRET is not configured — all webhooks will be rejected");
    return false;
  }
  try {
    const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

router.post("/razorpay", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }

    // PAY-008: Require raw body — refuse to process without it
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error("Webhook received without rawBody — verify Express body-parser config");
      return res.status(500).json({ error: "Webhook processing unavailable" });
    }
    const body = rawBody.toString("utf8");

    if (!verifyWebhookSignature(body, signature)) {
      logger.warn({ ip: req.ip }, "Razorpay webhook signature verification failed");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = req.body;
    const eventType = event?.event || "unknown";
    const payload = event?.payload || {};

    // Extract entity ID for deterministic dedup — covers payment, refund, and transfer events
    const entityId =
      event?.payload?.payment?.entity?.id ||
      event?.payload?.refund?.entity?.id ||
      event?.payload?.transfer?.entity?.id ||
      "";

    if (!entityId) {
      logger.warn({ eventType }, "Webhook event has no entity ID, skipping");
      return res.status(200).json({ status: "skipped_no_entity_id" });
    }
    const razorpayEventId = `${eventType}_${entityId}`;

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
      } else if (
        eventType === "transfer.processed" ||
        eventType === "transfer.settled" ||
        eventType === "transfer.failed" ||
        eventType === "transfer.reversed"
      ) {
        const { handleTransferWebhook } = await import("../services/razorpayRoutesService");
        await handleTransferWebhook(eventType, payload);
      }

      await db
        .from("razorpay_webhook_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("event_id", razorpayEventId);

      return res.status(200).json({ status: "ok" });
    } catch (processingErr: any) {
      logger.error({ err: processingErr, eventId: razorpayEventId }, "Webhook event processing failed");
      await db
        .from("razorpay_webhook_events")
        .update({
          processed: true,
          processed_at: new Date().toISOString(),
          error: (processingErr as Error)?.message || "processing_failed",
        })
        .eq("event_id", razorpayEventId)
        .eq("processed", false);
      return res.status(200).json({ status: "processing_failed_no_retry" });
    }
  } catch (err: any) {
    logger.error({ err }, "Razorpay webhook processing error");
    return res.status(500).json({ status: "error" });
  }
});

async function handlePaymentCaptured(payload: any) {
  try {
    const payment = payload?.payment?.entity;
    if (!payment) return;

    const orderId = payment.order_id;
    const paymentId = payment.id;
    const amount = Number(payment.amount) / 100;

    logger.info({ orderId, paymentId, amount }, "Razorpay payment.captured webhook received");

    // Update reconciliation queue
    const { data: pendingRecon } = await db
      .from("payment_reconciliation_queue")
      .select("*")
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingRecon) {
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

    // Update payment rows to success
    const { data: updatedPayments } = await db
      .from("payments")
      .update({ payment_status: "success" })
      .eq("transaction_id", paymentId)
      .eq("payment_status", "pending")
      .select("member_id, amount, payment_category");

    if (updatedPayments?.length) {
      const { queueNotification } = await import("../services/notificationService");
      for (const p of updatedPayments) {
        if (!p.member_id) continue;
        const { data: member } = await db.from("members").select("user_id, church_id").eq("id", p.member_id).maybeSingle();
        if (member?.user_id && member?.church_id) {
          queueNotification({
            church_id: member.church_id,
            recipient_user_id: member.user_id,
            channel: "push",
            notification_type: "payment_success",
            subject: "Payment Successful",
            body: `Your payment of ₹${p.amount} (${p.payment_category || "subscription"}) has been confirmed.`,
          }).catch((err) => { logger.warn({ err }, "Failed to send payment_success notification"); });
        }

        try {
          const { data: memberFull } = await db.from("members").select("full_name, email").eq("id", p.member_id).maybeSingle();
          if (memberFull?.email && member?.church_id) {
            const { data: church } = await db.from("churches").select("name").eq("id", member.church_id).maybeSingle();
            const churchName = church?.name || "Your Church";
            const memberName = memberFull.full_name || "Member";
            const cat = p.payment_category || "subscription";
            const subject = `Payment Confirmation — ₹${p.amount} (${cat})`;
            const text = `Dear ${memberName},\n\nYour payment of ₹${p.amount} for ${cat} at ${churchName} has been successfully processed.\n\nTransaction ID: ${paymentId}\nAmount: ₹${p.amount}\nCategory: ${cat}\nDate: ${new Date().toLocaleDateString("en-IN")}\n\nThank you for your contribution.\n\n— ${churchName}`;
            const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:20px"><h2 style="color:#2d5016">Payment Confirmation</h2><p>Dear ${memberName},</p><p>Your payment has been successfully processed.</p><table style="border-collapse:collapse;width:100%;margin:16px 0"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Amount</td><td style="padding:8px;border:1px solid #ddd">₹${p.amount}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Category</td><td style="padding:8px;border:1px solid #ddd">${cat}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Transaction ID</td><td style="padding:8px;border:1px solid #ddd">${paymentId}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Date</td><td style="padding:8px;border:1px solid #ddd">${new Date().toLocaleDateString("en-IN")}</td></tr><tr><td style="padding:8px;border:1px solid #ddd;font-weight:600">Church</td><td style="padding:8px;border:1px solid #ddd">${churchName}</td></tr></table><p>Thank you for your contribution.</p><p style="color:#888;font-size:0.85rem">— ${churchName}</p></div>`;
            await enqueueEmailJob(memberFull.email, subject, text, html);
          }
        } catch (emailErr) {
          logger.warn({ err: emailErr }, "Failed to send payment confirmation email");
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

    if (failedPayments?.length) {
      const { queueNotification } = await import("../services/notificationService");
      for (const p of failedPayments) {
        if (!p.member_id) continue;
        const { data: member } = await db.from("members").select("user_id, church_id, phone_number").eq("id", p.member_id).maybeSingle();
        if (!member?.church_id) continue;
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
          }).catch((err) => { logger.warn({ err }, "Failed to send payment_failed push notification"); });
        }
        if (member.phone_number) {
          queueNotification({
            church_id: member.church_id,
            recipient_phone: member.phone_number,
            channel: "sms",
            notification_type: "payment_failed",
            body: `Your payment of ₹${failAmount} failed. Please retry at your earliest convenience. - ${(await import("../config")).APP_NAME}`,
          }).catch((err) => { logger.warn({ err }, "Failed to send payment_failed SMS notification"); });
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
    logger.info({ paymentId: refund.payment_id, refundId: refund.id }, "Razorpay refund.processed webhook received");
    // Refunds are tracked via our own refund table; no auto-update needed here.
  } catch (err) {
    logger.error({ err }, "handleRefundProcessed failed");
  }
}

export default router;
