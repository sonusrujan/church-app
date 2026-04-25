import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin, isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { logger } from "../utils/logger";
import {
  getChurchSaaSSettings,
  updateChurchSaaSSettings,
  createChurchSubscription,
  getChurchSubscription,
  updateChurchSubscriptionStatus,
  listChurchSubscriptionStatuses,
  recordChurchSubscriptionPayment,
  getChurchSubscriptionPayments,
  getSuperAdminRevenue,
  getPlatformFeeSummary,
} from "../services/churchSubscriptionService";
import {
  getPlatformConfig,
  updatePlatformConfig,
  getPlatformPaymentCredentials,
} from "../services/platformConfigService";
import {
  createPaymentOrder,
  verifyPayment,
  fetchRazorpayOrder,
} from "../services/paymentService";
import { db } from "../services/dbClient";

const router = Router();

function paramStr(val: string | string[]): string {
  return Array.isArray(val) ? val[0] : val;
}

// ═══ My Church SaaS Settings (any admin can view own church) ═══

router.get("/my-settings", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admins can view SaaS settings" });
    }
    const settings = await getChurchSaaSSettings(churchId);
    const sub = await getChurchSubscription(churchId);
    return res.json({ settings, subscription: sub || null });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get my SaaS settings") });
  }
});

// ═══ SaaS Settings (Super Admin Only) ═══

router.get("/settings/:churchId", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = paramStr(req.params.churchId);
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const settings = await getChurchSaaSSettings(churchId);
    return res.json(settings);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get SaaS settings") });
  }
});

router.patch("/settings/:churchId", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = paramStr(req.params.churchId);
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const updated = await updateChurchSaaSSettings(churchId, {
      member_subscription_enabled: req.body?.member_subscription_enabled,
      church_subscription_enabled: req.body?.church_subscription_enabled,
      church_subscription_amount: typeof req.body?.church_subscription_amount === "number" ? req.body.church_subscription_amount : undefined,
      platform_fee_enabled: req.body?.platform_fee_enabled,
      platform_fee_percentage: typeof req.body?.platform_fee_percentage === "number" ? req.body.platform_fee_percentage : undefined,
      service_enabled: req.body?.service_enabled,
    });

    logSuperAdminAudit(req, "saas.settings.update", { church_id: churchId });
    persistAuditLog(req, "saas.settings.update", "church", churchId, req.body);

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update SaaS settings") });
  }
});

// ═══ Church Subscriptions (Super Admin Only) ═══

router.get("/subscription/:churchId", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = paramStr(req.params.churchId);
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const sub = await getChurchSubscription(churchId);
    return res.json(sub || { status: "none" });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get church subscription") });
  }
});

router.post("/subscription", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { church_id, amount, billing_cycle, start_date } = req.body;
    if (!church_id || !UUID_REGEX.test(church_id)) {
      return res.status(400).json({ error: "Valid church_id is required" });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }
    const sub = await createChurchSubscription({
      church_id,
      amount: Number(amount),
      billing_cycle: billing_cycle || "monthly",
      start_date: typeof start_date === "string" && start_date.trim() ? start_date.trim() : undefined,
    });

    logSuperAdminAudit(req, "church_subscription.create", { church_id, amount, start_date: start_date || null });
    persistAuditLog(req, "church_subscription.create", "church_subscription", sub.id, { church_id, amount, start_date: start_date || null });

    return res.json(sub);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create church subscription") });
  }
});

router.patch("/subscription/:id/status", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const id = paramStr(req.params.id);
    const { status } = req.body;
    if (!["active", "inactive", "overdue", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const updated = await updateChurchSubscriptionStatus(id, status);

    logSuperAdminAudit(req, "church_subscription.status_update", { subscription_id: id, status });
    persistAuditLog(req, "church_subscription.status_update", "church_subscription", id, { status });

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update subscription status") });
  }
});

// ═══ Church Subscription Status Overview ═══

router.get("/overview", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const filter = typeof req.query.filter === "string" ? req.query.filter : undefined;
    const validFilter = filter === "active" || filter === "inactive" ? filter : undefined;
    const statuses = await listChurchSubscriptionStatuses(validFilter);
    return res.json(statuses);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get subscription overview") });
  }
});

// ═══ Church Subscription Payments ═══

router.post("/payment", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { church_subscription_id, church_id, amount, payment_method, transaction_id, note, payment_date } = req.body;
    if (!church_subscription_id || !church_id || !amount) {
      return res.status(400).json({ error: "church_subscription_id, church_id, and amount are required" });
    }
    const payment = await recordChurchSubscriptionPayment({
      church_subscription_id,
      church_id,
      amount: Number(amount),
      payment_method,
      transaction_id,
      note,
      payment_date: typeof payment_date === "string" && payment_date.trim() ? payment_date.trim() : undefined,
    });

    logSuperAdminAudit(req, "church_subscription.payment", { church_id, amount, payment_date: payment_date || null });
    persistAuditLog(req, "church_subscription.payment", "church_subscription_payment", payment.id, { church_id, amount, payment_date: payment_date || null });

    return res.json(payment);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to record payment") });
  }
});

router.get("/payments/:churchId", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = paramStr(req.params.churchId);
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const payments = await getChurchSubscriptionPayments(churchId, limit);
    return res.json(payments);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get payments") });
  }
});

// ═══ Super Admin Revenue Dashboard ═══

router.get("/revenue", requireAuth, requireRegisteredUser, requireSuperAdmin, async (_req: AuthRequest, res) => {
  try {
    const revenue = await getSuperAdminRevenue();
    return res.json(revenue);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get revenue") });
  }
});

router.get("/platform-fees", requireAuth, requireRegisteredUser, requireSuperAdmin, async (_req: AuthRequest, res) => {
  try {
    const summary = await getPlatformFeeSummary();
    return res.json(summary);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get platform fee summary") });
  }
});

// ═══ Platform Razorpay Config (Super Admin Only) ═══

router.get("/platform-config", requireAuth, requireRegisteredUser, requireSuperAdmin, async (_req: AuthRequest, res) => {
  try {
    const config = await getPlatformConfig();
    return res.json(config);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get platform config") });
  }
});

router.post("/platform-config", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const updated = await updatePlatformConfig({
      key_id: typeof req.body?.key_id === "string" ? req.body.key_id : undefined,
      key_secret: typeof req.body?.key_secret === "string" ? req.body.key_secret : undefined,
      public_donation_fee_percent: typeof req.body?.public_donation_fee_percent === "number"
        ? req.body.public_donation_fee_percent
        : undefined,
    });

    logSuperAdminAudit(req, "platform_config.update", {
      key_id_set: Boolean(typeof req.body?.key_id === "string" && req.body.key_id.trim()),
      key_secret_rotated: Boolean(typeof req.body?.key_secret === "string" && req.body.key_secret.trim()),
      public_donation_fee_percent: req.body?.public_donation_fee_percent,
    });

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update platform config") });
  }
});

// ═══ Church SaaS Fee Payment (Church Admin — pays using platform Razorpay keys) ═══

router.post("/pay/order", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admins can pay platform fees" });
    }

    // Get church subscription — auto-create from SaaS settings if missing
    let subscription = await getChurchSubscription(churchId);
    if (!subscription) {
      // Fall back to SaaS settings on the churches table
      const settings = await getChurchSaaSSettings(churchId);
      if (settings.church_subscription_enabled && settings.church_subscription_amount > 0) {
        subscription = await createChurchSubscription({
          church_id: churchId,
          amount: settings.church_subscription_amount,
          billing_cycle: "monthly",
        });
        logger.info({ churchId, amount: settings.church_subscription_amount }, "Auto-created church subscription from SaaS settings");
      } else {
        return res.status(400).json({ error: "No platform subscription found for your church. Contact the super admin." });
      }
    }
    if (subscription.status === "cancelled") {
      return res.status(400).json({ error: "Your SaaS subscription has been cancelled. Contact the super admin." });
    }

    // Get platform Razorpay credentials
    const credentials = await getPlatformPaymentCredentials();
    if (!credentials.configured) {
      return res.status(503).json({ error: "Platform payment gateway is not configured yet. Contact the super admin." });
    }

    const amount = Number(subscription.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid subscription amount" });
    }

    const receipt = `saas_${churchId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

    const order = await createPaymentOrder(amount, "INR", receipt, {
      key_id: credentials.key_id,
      key_secret: credentials.key_secret,
    }, {
      type: "saas_fee",
      church_id: churchId,
      church_subscription_id: subscription.id,
    });

    // Record the pending order so the Razorpay webhook can reconcile this
    // payment if the synchronous /pay/verify call is never made (e.g. browser
    // closed after Razorpay success, cross-origin handoff failure).
    const { error: pendingErr } = await db
      .from("church_subscription_pending_orders")
      .insert({
        razorpay_order_id: order.id,
        church_subscription_id: subscription.id,
        church_id: churchId,
        expected_amount: amount,
      });
    if (pendingErr) {
      // Non-fatal: order still works via /pay/verify. Just log — duplicate
      // inserts (23505) happen on retry and are safe.
      if (pendingErr.code !== "23505") {
        logger.warn({ err: pendingErr, order_id: order.id }, "Failed to record pending SaaS order");
      }
    }

    return res.json({
      order,
      key_id: credentials.key_id,
      church_id: churchId,
      subscription_id: subscription.id,
      amount,
      billing_cycle: subscription.billing_cycle,
    });
  } catch (err: any) {
    logger.error({ err }, "SaaS pay order failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create SaaS payment order") });
  }
});

router.post("/pay/verify", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admins can verify SaaS payments" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    // Get platform credentials
    const credentials = await getPlatformPaymentCredentials();
    if (!credentials.configured) {
      return res.status(503).json({ error: "Platform payment gateway is not configured" });
    }

    // Verify signature
    const isValid = await verifyPayment(razorpay_signature, razorpay_order_id, razorpay_payment_id, {
      key_id: credentials.key_id,
      key_secret: credentials.key_secret,
    });
    if (!isValid) {
      return res.status(400).json({ error: "Invalid payment signature" });
    }

    // Fetch actual amount from Razorpay
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id, {
      key_id: credentials.key_id,
      key_secret: credentials.key_secret,
    });
    const verifiedAmount = razorpayOrder.amount;
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return res.status(400).json({ error: "Could not verify payment amount with Razorpay" });
    }

    // Get the subscription for this church
    const subscription = await getChurchSubscription(churchId);
    if (!subscription) {
      return res.status(400).json({ error: "No SaaS subscription found for your church" });
    }

    // Record the payment
    const payment = await recordChurchSubscriptionPayment({
      church_subscription_id: subscription.id,
      church_id: churchId,
      amount: verifiedAmount,
      payment_method: "razorpay",
      transaction_id: razorpay_payment_id,
    });

    logger.info({ churchId, paymentId: payment.id, amount: verifiedAmount }, "SaaS fee payment recorded");

    return res.json({ success: true, payment });
  } catch (err: any) {
    logger.error({ err }, "SaaS pay verify failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify SaaS payment") });
  }
});

// ═══ Church Admin: View own SaaS payment history ═══

router.get("/my-payments", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admins can view SaaS payment history" });
    }
    const payments = await getChurchSubscriptionPayments(churchId, 50);
    return res.json(payments);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get SaaS payment history") });
  }
});

export default router;
