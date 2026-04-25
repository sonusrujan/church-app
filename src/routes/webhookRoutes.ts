import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";
import { getEffectivePaymentConfig } from "../services/churchPaymentService";
import { enqueueEmailJob } from "../services/jobQueueService";

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

const router = Router();

/**
 * PAY-003: Multi-key webhook verification.
 * Tries the global RAZORPAY_KEY_SECRET first.
 * If that fails, extracts order_id from the payload and looks up the church's
 * own key_secret via the payment_reconciliation_queue → getEffectivePaymentConfig.
 */
async function verifyWebhookMultiKey(body: string, signature: string, parsedEvent: any): Promise<boolean> {
  // 1) Try global key first
  if (RAZORPAY_KEY_SECRET && verifyWebhookSignature(body, signature, RAZORPAY_KEY_SECRET)) {
    return true;
  }

  // 2) Fallback: look up church-specific key via order_id
  const orderId = parsedEvent?.payload?.payment?.entity?.order_id
    || parsedEvent?.payload?.refund?.entity?.order_id;
  if (!orderId) return false;

  try {
    const { data: recon } = await db
      .from("payment_reconciliation_queue")
      .select("church_id")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();

    if (recon?.church_id) {
      const config = await getEffectivePaymentConfig(recon.church_id);
      if (config.key_secret && verifyWebhookSignature(body, signature, config.key_secret)) {
        return true;
      }
    }

    // Also try looking up church_id from payments table
    const { data: paymentRow } = await db
      .from("payments")
      .select("church_id")
      .eq("transaction_id", parsedEvent?.payload?.payment?.entity?.id)
      .maybeSingle();

    if (paymentRow?.church_id) {
      const config = await getEffectivePaymentConfig(paymentRow.church_id);
      if (config.key_secret && verifyWebhookSignature(body, signature, config.key_secret)) {
        return true;
      }
    }
  } catch (err) {
    logger.warn({ err, orderId }, "Per-church webhook key lookup failed");
  }

  return false;
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

    // PAY-003: Multi-key verification (global + per-church fallback)
    const verified = await verifyWebhookMultiKey(body, signature, req.body);

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
      // Mark as failed but keep the row so notifications aren't re-sent on retry.
      // Razorpay will retry with the same event — the dedup insert will skip it.
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
            }).catch((err) => { logger.warn({ err }, "Failed to send payment_success notification"); });
          }

          // Send confirmation email
          try {
            const { data: memberFull } = await db.from("members").select("full_name, email").eq("id", p.member_id).maybeSingle();
            if (memberFull?.email) {
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
    const refundId = refund.id;
    const refundAmount = Number(refund.amount) / 100;
    const refundStatus = String(refund.status || "processed");

    logger.info({ paymentId, refundId, refundAmount, refundStatus }, "Razorpay refund.processed webhook received");

    if (!paymentId || !refundId) return;

    // 1) Locate the payment row by Razorpay payment_id
    const { data: paymentRow } = await db
      .from("payments")
      .select("id, member_id, subscription_id, amount, payment_status, church_id")
      .eq("transaction_id", paymentId)
      .maybeSingle();

    if (!paymentRow) {
      logger.warn({ paymentId, refundId }, "Refund webhook: no matching payment row — skipping");
      return;
    }

    // 2) Determine if any refund record was already persisted (admin-initiated flow sets gatewayRefundId in reason)
    const { data: existingRefunds } = await db
      .from("payment_refunds")
      .select("id, refund_amount, refund_reason")
      .eq("payment_id", paymentRow.id);

    const totalPriorRefunds = (existingRefunds || []).reduce(
      (sum: number, r: any) => sum + (Number(r.refund_amount) || 0),
      0,
    );

    const alreadyTracked = (existingRefunds || []).some((r: any) =>
      typeof r.refund_reason === "string" && r.refund_reason.includes(refundId),
    );

    // 3) Insert a refund row if this refund is not already tracked (e.g. async gateway refund initiated outside admin flow)
    if (!alreadyTracked) {
      await db.from("payment_refunds").insert({
        payment_id: paymentRow.id,
        member_id: paymentRow.member_id,
        refund_amount: refundAmount,
        refund_method: "razorpay",
        refund_reason: `Razorpay webhook refund ID: ${refundId}`,
        recorded_by: null,
      });
    }

    // 4) Flip payment_status based on full vs partial
    const paymentAmount = Number(paymentRow.amount) || 0;
    const totalRefunded = (alreadyTracked ? totalPriorRefunds : totalPriorRefunds + refundAmount);
    const newStatus = totalRefunded >= paymentAmount - 0.01 ? "refunded" : "partially_refunded";

    await db
      .from("payments")
      .update({ payment_status: newStatus })
      .eq("id", paymentRow.id)
      .neq("payment_status", newStatus);

    // 5) Reverse monthly dues on full refund
    if (newStatus === "refunded") {
      try {
        const { reversePaymentAllocations } = await import("../services/subscriptionMonthlyDuesService");
        const reversedCount = await reversePaymentAllocations(paymentRow.id);
        logger.info({ paymentId: paymentRow.id, reversedCount }, "Refund webhook: reversed monthly allocations");
      } catch (revErr) {
        logger.warn({ err: revErr, paymentId: paymentRow.id }, "Refund webhook: failed to reverse allocations");
      }

      // 6) If this was a subscription payment, reverse subscription next_payment_date on full refund
      if (paymentRow.subscription_id) {
        try {
          const { data: sub } = await db
            .from("subscriptions")
            .select("id, billing_cycle, next_payment_date, status")
            .eq("id", paymentRow.subscription_id)
            .maybeSingle();
          if (sub) {
            await db
              .from("subscriptions")
              .update({ status: "overdue" })
              .eq("id", paymentRow.subscription_id)
              .neq("status", "cancelled");
          }
        } catch (subErr) {
          logger.warn({ err: subErr }, "Refund webhook: failed to rollback subscription status");
        }
      }
    }

    // 7) Notify the member
    try {
      const { queueNotification } = await import("../services/notificationService");
      if (paymentRow.member_id && paymentRow.church_id) {
        const { data: member } = await db
          .from("members")
          .select("user_id, email, full_name")
          .eq("id", paymentRow.member_id)
          .maybeSingle();
        if (member?.user_id) {
          queueNotification({
            church_id: paymentRow.church_id,
            recipient_user_id: member.user_id,
            channel: "push",
            notification_type: "refund_processed",
            subject: "Refund Processed",
            body: `A refund of ₹${refundAmount.toFixed(2)} has been processed to your original payment method.`,
          }).catch((e) => logger.warn({ err: e }, "refund_processed push failed"));
        }
        if (member?.email) {
          const subject = `Refund Confirmation — ₹${refundAmount.toFixed(2)}`;
          const text = `Dear ${member.full_name || "Member"},\n\nA refund of ₹${refundAmount.toFixed(2)} has been processed for your payment.\n\nRefund ID: ${refundId}\nOriginal Payment: ${paymentId}\n\nThe amount should appear in your account within 5-7 business days.`;
          await enqueueEmailJob(member.email, subject, text);
        }
      }
    } catch (notifErr) {
      logger.warn({ err: notifErr }, "Refund webhook: notification dispatch failed");
    }
  } catch (err) {
    logger.error({ err }, "handleRefundProcessed failed");
  }
}

export default router;
