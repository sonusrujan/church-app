import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { createPaymentOrder, verifyPayment, storePayment, fetchRazorpayOrder } from "../services/paymentService";
import { getMemberDashboardByEmail } from "../services/userService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { logger } from "../utils/logger";
import { db } from "../services/dbClient";
import { getEffectivePaymentConfig } from "../services/churchPaymentService";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import { createReceiptNumber, generateReceiptPdfBuffer } from "../services/receiptService";
import {
  computeNextDueDate,
  isDueSubscription,
  normalizeSelectedSubscriptionIds,
} from "../utils/subscriptionHelpers";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DashboardSubscription = {
  id: string;
  plan_name?: string;
  amount: number | string;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
  family_member_id?: string | null;
  person_name?: string;
};

type DueSubscriptionInfo = {
  subscription_id: string;
  family_member_id: string | null;
  person_name: string;
  amount: number;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
};

type CurrentMemberDashboard = {
  member: {
    id: string;
  };
  church: {
    name: string;
  } | null;
  subscriptions: DashboardSubscription[];
  due_subscriptions: DueSubscriptionInfo[];
};

type PaymentReceiptRow = {
  id: string;
  member_id: string;
  subscription_id: string | null;
  amount: number | string;
  payment_method: string | null;
  transaction_id: string | null;
  payment_status: string | null;
  payment_date: string;
  receipt_number: string | null;
  receipt_generated_at: string | null;
};

async function getCurrentMemberDashboard(req: AuthRequest): Promise<CurrentMemberDashboard> {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const dashboard = await getMemberDashboardByEmail(req.user.email, req.user.phone);
  if (!dashboard?.member) {
    throw new Error("Member profile not found");
  }

  return {
    member: {
      id: dashboard.member.id,
    },
    church: dashboard.church ? { name: dashboard.church.name } : null,
    subscriptions: (dashboard.subscriptions || []) as DashboardSubscription[],
    due_subscriptions: (dashboard.due_subscriptions || []) as DueSubscriptionInfo[],
  };
}

async function resolvePaymentConfig(req: AuthRequest) {
  const churchId = req.user?.church_id || req.registeredProfile?.church_id || "";
  return getEffectivePaymentConfig(churchId || null);
}

// 3.1: Calculate platform fee to add ON TOP of payment amount
async function calculatePlatformFee(churchId: string | null | undefined, baseAmount: number): Promise<{ fee: number; percentage: number; enabled: boolean }> {
  if (!churchId) return { fee: 0, percentage: 0, enabled: false };
  try {
    const settings = await getChurchSaaSSettings(churchId);
    if (!settings.platform_fee_enabled || settings.platform_fee_percentage <= 0) {
      return { fee: 0, percentage: settings.platform_fee_percentage, enabled: false };
    }
    const fee = Math.round(baseAmount * settings.platform_fee_percentage) / 100;
    return { fee, percentage: settings.platform_fee_percentage, enabled: true };
  } catch {
    return { fee: 0, percentage: 0, enabled: false };
  }
}

router.get("/config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    return res.json({
      payments_enabled: paymentConfig.payments_enabled,
      key_id: paymentConfig.payments_enabled ? paymentConfig.key_id : "",
      source: paymentConfig.source,
      reason: paymentConfig.reason,
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load payment configuration") });
  }
});

router.post("/order", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const { currency, receipt, subscription_id } = req.body;

    // CRIT-05: Always derive amount from DB, never trust client-provided amount
    let numericAmount: number;
    if (subscription_id) {
      const ownedSubscription = (dashboard.subscriptions || []).find(
        (subscription) => subscription.id === subscription_id
      );
      if (!ownedSubscription) {
        return res.status(403).json({ error: "Subscription does not belong to current member" });
      }
      numericAmount = Number(ownedSubscription.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: "Subscription has an invalid amount" });
      }
    } else {
      // For non-subscription single payments (donations via authenticated route), accept client amount
      numericAmount = Number(req.body.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: "amount must be greater than 0" });
      }
    }

    // 3.1: Add platform fee ON TOP of the base amount
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, numericAmount);
    const totalAmount = numericAmount + platformFee.fee;

    const order = await createPaymentOrder(
      totalAmount,
      currency || "INR",
      receipt || "church_receipt",
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      },
      { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) }
    );
    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      base_amount: numericAmount,
      platform_fee: platformFee.fee,
      platform_fee_percentage: platformFee.percentage,
      total_amount: totalAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create order") });
  }
});

router.post("/verify", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      subscription_id,
      payment_method,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    const { data: existingPayment } = await db
      .from("payments")
      .select("id")
      .eq("transaction_id", razorpay_payment_id)
      .maybeSingle();
    if (existingPayment) {
      return res.status(200).json({ status: "already_processed", payment_id: existingPayment.id });
    }

    if (subscription_id) {
      const ownedSubscription = (dashboard.subscriptions || []).find(
        (subscription) => subscription.id === subscription_id
      );
      if (!ownedSubscription) {
        return res.status(403).json({ error: "Subscription does not belong to current member" });
      }
    }

    const isValid = await verifyPayment(
      razorpay_signature,
      razorpay_order_id,
      razorpay_payment_id,
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      }
    );
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Fetch actual order amount from Razorpay instead of trusting client-sent amount
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });
    const verifiedAmount = razorpayOrder.amount;
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return res.status(400).json({ error: "Could not verify payment amount with Razorpay" });
    }

    const payment = await storePayment({
      member_id: dashboard.member.id,
      subscription_id: subscription_id || null,
      church_id: req.user?.church_id || req.registeredProfile?.church_id || null,
      amount: verifiedAmount,
      payment_method,
      transaction_id: razorpay_payment_id,
      payment_status: "success",
      payment_date: new Date().toISOString(),
    });

    // 3.1: Record platform fee collection if applicable — use fee stored at order time
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    if (churchId) {
      const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
      const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);
      if (storedFee > 0) {
        const baseAmount = verifiedAmount - storedFee;
        const { error: feeErr } = await db.from("platform_fee_collections").insert({
          church_id: churchId,
          payment_id: payment.id,
          member_id: dashboard.member.id,
          base_amount: baseAmount,
          fee_percentage: storedPct,
          fee_amount: storedFee,
          collected_at: new Date().toISOString(),
        });
        if (feeErr) {
          logger.error({ err: feeErr, paymentId: payment.id }, "platform_fee_collections insert FAILED — refund cap may be incorrect");
        }
      }
    }

    return res.json({ success: true, payment });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify payment") });
  }
});

router.post("/donation/order", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const memberToken = dashboard.member.id.replace(/-/g, "").slice(0, 8);
    const receipt = `donation_${memberToken}_${Date.now()}`;
    
    // 3.1: Add platform fee ON TOP
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, amount);
    const totalAmount = amount + platformFee.fee;

    const order = await createPaymentOrder(totalAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    }, { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      church_name: dashboard.church?.name || null,
      donation_amount: amount,
      base_amount: amount,
      platform_fee: platformFee.fee,
      platform_fee_percentage: platformFee.percentage,
      total_amount: totalAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create donation order") });
  }
});

router.post("/donation/verify", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    const { data: existingDonation } = await db
      .from("payments")
      .select("id")
      .eq("transaction_id", razorpay_payment_id)
      .maybeSingle();
    if (existingDonation) {
      return res.status(200).json({ status: "already_processed", payment_id: existingDonation.id });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const isValid = await verifyPayment(
      razorpay_signature,
      razorpay_order_id,
      razorpay_payment_id,
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      }
    );
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Use Razorpay order amount as the source of truth
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });
    const verifiedAmount = razorpayOrder.amount;
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return res.status(400).json({ error: "Could not verify donation amount with Razorpay" });
    }

    const fund = typeof req.body?.fund === "string" ? req.body.fund.trim().slice(0, 200) : "";

    const payment = await storePayment({
      member_id: dashboard.member.id,
      subscription_id: null,
      church_id: req.user?.church_id || req.registeredProfile?.church_id || null,
      amount: verifiedAmount,
      payment_method: "donation",
      transaction_id: razorpay_payment_id,
      payment_status: "success",
      payment_date: new Date().toISOString(),
      fund_name: fund || null,
    });

    // 3.1: Record platform fee for donation — use fee stored at order time
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    if (churchId) {
      const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
      const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);
      if (storedFee > 0) {
        const baseAmount = verifiedAmount - storedFee;
        const { error: feeErr } = await db.from("platform_fee_collections").insert({
          church_id: churchId,
          payment_id: payment.id,
          member_id: dashboard.member.id,
          base_amount: baseAmount,
          fee_percentage: storedPct,
          fee_amount: storedFee,
          collected_at: new Date().toISOString(),
        });
        if (feeErr) {
          logger.error({ err: feeErr, paymentId: payment.id }, "platform_fee_collections insert FAILED for donation");
        }
      }
    }

    return res.json({ success: true, payment });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify donation") });
  }
});

router.post("/subscription/order", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    // Enforce member_subscription_enabled SaaS setting
    if (req.user.church_id) {
      const saasSettings = await getChurchSaaSSettings(req.user.church_id);
      if (!saasSettings.member_subscription_enabled) {
        return res.status(403).json({ error: "Member subscriptions are disabled for this church" });
      }
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const dueSubscriptions = (dashboard.due_subscriptions || []).slice();
    if (!dueSubscriptions.length) {
      return res.status(400).json({ error: "No due subscription found" });
    }

    const dueSubscriptionById = new Map<string, DueSubscriptionInfo>();
    for (const subscription of dueSubscriptions) {
      dueSubscriptionById.set(subscription.subscription_id, subscription);
    }

    const selectedFromBody = normalizeSelectedSubscriptionIds(req.body?.subscription_ids);
    if (!selectedFromBody.length) {
      return res.status(400).json({ error: "No subscriptions selected for payment" });
    }
    if (selectedFromBody.length > 50) {
      return res.status(400).json({ error: "Cannot process more than 50 subscriptions at once" });
    }
    const selectedIds = selectedFromBody;

    const invalidSelection = selectedIds.find((id) => !dueSubscriptionById.has(id));
    if (invalidSelection) {
      return res.status(400).json({ error: `Selected subscription is not due or invalid: ${invalidSelection}` });
    }

    const selectedDueSubscriptions = selectedIds
      .map((id) => dueSubscriptionById.get(id))
      .filter(Boolean) as DueSubscriptionInfo[];

    const totalAmount = selectedDueSubscriptions.reduce((sum, subscription) => {
      return sum + Number(subscription.amount);
    }, 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ error: "Selected due amount is invalid" });
    }

    // 3.1: Add platform fee ON TOP of subscription total
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, totalAmount);
    const chargeAmount = totalAmount + platformFee.fee;

    const receipt = `subscription_multi_${Date.now()}`;
    const order = await createPaymentOrder(chargeAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    }, { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      subscription_ids: selectedIds,
      base_amount: totalAmount,
      platform_fee: platformFee.fee,
      platform_fee_percentage: platformFee.percentage,
      total_amount: chargeAmount,
      selected_due_subscriptions: selectedDueSubscriptions,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create subscription payment order") });
  }
});

router.post("/subscription/verify", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      subscription_ids,
      subscription_id,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing verification fields" });
    }

    const { data: existingBatch } = await db
      .from("payments")
      .select("id")
      .eq("transaction_id", razorpay_payment_id)
      .maybeSingle();
    if (existingBatch) {
      return res.status(200).json({ status: "already_processed", payment_id: existingBatch.id });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const selectedIds = normalizeSelectedSubscriptionIds(subscription_ids);
    const normalizedSubscriptionIds = selectedIds.length
      ? selectedIds
      : typeof subscription_id === "string" && subscription_id.trim()
        ? [subscription_id.trim()]
        : [];

    if (!normalizedSubscriptionIds.length) {
      return res.status(400).json({ error: "No subscriptions selected for payment" });
    }

    const subscriptionById = new Map<string, DashboardSubscription>();
    for (const subscription of dashboard.subscriptions || []) {
      subscriptionById.set(subscription.id, subscription);
    }

    const missingSubscription = normalizedSubscriptionIds.find((id) => !subscriptionById.has(id));
    if (missingSubscription) {
      return res.status(403).json({ error: `Subscription does not belong to current member: ${missingSubscription}` });
    }

    // PRE-VALIDATE: Check all subscription amounts BEFORE any DB writes
    const subscriptionAmounts: Array<{ id: string; amount: number; subscription: DashboardSubscription }> = [];
    for (const selectedId of normalizedSubscriptionIds) {
      const ownedSubscription = subscriptionById.get(selectedId)!;
      const numericAmount = Number(ownedSubscription.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: `Invalid subscription amount for ${selectedId}` });
      }
      subscriptionAmounts.push({ id: selectedId, amount: numericAmount, subscription: ownedSubscription });
    }

    const isValid = await verifyPayment(
      razorpay_signature,
      razorpay_order_id,
      razorpay_payment_id,
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      }
    );
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Verify amount from Razorpay order matches the sum of subscription amounts + platform fee (from order notes)
    const expectedTotal = subscriptionAmounts.reduce((sum, entry) => sum + entry.amount, 0);
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });
    const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
    const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);
    const expectedCharge = expectedTotal + storedFee;
    if (Math.abs(razorpayOrder.amount - expectedCharge) > 1) {
      return res.status(400).json({
        error: `Payment amount mismatch: Razorpay charged ₹${razorpayOrder.amount} but expected ₹${expectedCharge}`,
      });
    }

    // Build batch items for the atomic RPC call
    const paymentDate = new Date().toISOString();
    const batchItems = subscriptionAmounts.map(({ id: selectedId, amount: numericAmount, subscription: ownedSubscription }) => {
      const nextDue = computeNextDueDate(ownedSubscription.next_payment_date, ownedSubscription.billing_cycle);
      const isAdjustment = (ownedSubscription.plan_name || "").includes("Adjustment");
      const newStatus = isAdjustment ? "completed" : "active";
      const newNextDate = isAdjustment ? ownedSubscription.next_payment_date : nextDue;

      return {
        subscription_id: selectedId,
        amount: numericAmount,
        receipt_number: createReceiptNumber({
          member_id: dashboard.member.id,
          payment_date: paymentDate,
          transaction_id: razorpay_payment_id,
        }),
        new_status: newStatus,
        new_next_payment_date: newNextDate,
        old_status: ownedSubscription.status,
        is_adjustment: isAdjustment,
      };
    });

    // Atomic: all payments + subscription updates + events in one DB transaction
    const { data: rpcResult, error: rpcError } = await db.rpc(
      "process_subscription_payments_batch",
      {
        p_member_id: dashboard.member.id,
        p_transaction_id: razorpay_payment_id,
        p_payment_date: paymentDate,
        p_items: batchItems,
      }
    );

    if (rpcError) {
      logger.error({ rpcError, memberId: dashboard.member.id, txnId: razorpay_payment_id }, "process_subscription_payments_batch RPC failed");
      return res.status(500).json({ error: safeErrorMessage(rpcError, "Failed to process subscription payments") });
    }

    const batchResult = rpcResult as {
      success: boolean;
      payment_count: number;
      results: Array<{
        payment_id: string;
        receipt_number: string | null;
        subscription_id: string;
        already_existed: boolean;
        next_payment_date: string;
      }>;
    };

    const payments = batchResult.results.map((r) => ({ id: r.payment_id, receipt_number: r.receipt_number }));
    const updatedSubscriptions = batchResult.results
      .filter((r) => !r.already_existed)
      .map((r) => ({ subscription_id: r.subscription_id, next_payment_date: r.next_payment_date }));

    // 3.1: Record platform fee for subscription payments — use fee stored at order time
    if (churchId && storedFee > 0 && payments.length > 0) {
      const baseAmount = expectedTotal;
      const { error: feeErr } = await db.from("platform_fee_collections").insert({
        church_id: churchId,
        payment_id: payments[0].id,
        member_id: dashboard.member.id,
        base_amount: baseAmount,
        fee_percentage: storedPct,
        fee_amount: storedFee,
        collected_at: new Date().toISOString(),
      });
      if (feeErr) {
        logger.error({ err: feeErr, paymentId: payments[0].id }, "platform_fee_collections insert FAILED for subscription");
      }
    }

    return res.json({
      success: true,
      payment_count: batchResult.payment_count,
      payments,
      updated_subscriptions: updatedSubscriptions,
    });
  } catch (err: any) {
    logger.error({ err, stack: err?.stack }, "subscription/verify failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify subscription payment") });
  }
});

router.get("/:paymentId/receipt", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const paymentId = typeof req.params.paymentId === "string" ? req.params.paymentId.trim() : "";
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID format" });
    }

    // Fetch payment first (no member filter yet)
    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select(
        "id, member_id, subscription_id, church_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, receipt_generated_at"
      )
      .eq("id", paymentId)
      .maybeSingle<PaymentReceiptRow & { church_id: string }>();

    if (paymentError) {
      return res.status(500).json({ error: "Failed to load payment" });
    }
    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
    }

    // Authorization: allow (1) the member themselves, (2) church admin, (3) super admin, (4) family head
    const isSuper = isSuperAdminEmail(req.user.email, req.user.phone);
    const isChurchAdmin = req.user.role === "admin" && payment.church_id === req.user.church_id;

    let authorized = isSuper || isChurchAdmin;

    if (!authorized) {
      // Check if the requesting user is the payment's member
      const dashboard = await getCurrentMemberDashboard(req);
      if (dashboard.member.id === payment.member_id) {
        authorized = true;
      } else {
        // Check if the payment's member is a family member linked to the requesting user
        const { data: familyLink } = await db
          .from("family_members")
          .select("id")
          .eq("member_id", dashboard.member.id)
          .eq("linked_to_member_id", payment.member_id)
          .maybeSingle();
        if (familyLink) authorized = true;

        // Also check if the payment is linked to a subscription owned by the requesting user (family head)
        if (!authorized && payment.subscription_id) {
          const { data: ownedSub } = await db
            .from("subscriptions")
            .select("id")
            .eq("id", payment.subscription_id)
            .eq("member_id", dashboard.member.id)
            .maybeSingle();
          if (ownedSub) authorized = true;
        }
      }
    }

    if (!authorized) {
      return res.status(403).json({ error: "You do not have permission to download this receipt" });
    }

    const status = (payment.payment_status || "").toLowerCase();
    if (status !== "success") {
      return res.status(400).json({ error: "Receipt is available only for successful payments" });
    }

    const receiptNumber =
      payment.receipt_number ||
      createReceiptNumber({
        member_id: payment.member_id,
        payment_date: payment.payment_date,
        transaction_id: payment.transaction_id,
      });

    if (!payment.receipt_number) {
      await db
        .from("payments")
        .update({
          receipt_number: receiptNumber,
          receipt_generated_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
    }

    const paymentAmount = Number(payment.amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    // Fetch member + church info for the receipt
    const { data: paymentMember } = await db
      .from("members")
      .select("full_name, email")
      .eq("id", payment.member_id)
      .maybeSingle<{ full_name: string | null; email: string | null }>();

    const { data: church } = await db
      .from("churches")
      .select("name")
      .eq("id", payment.church_id)
      .maybeSingle<{ name: string }>();

    let subscriptionName: string | null = null;
    if (payment.subscription_id) {
      const { data: sub } = await db
        .from("subscriptions")
        .select("plan_name")
        .eq("id", payment.subscription_id)
        .maybeSingle<{ plan_name: string }>();
      subscriptionName = sub?.plan_name || null;
    }

    const memberName = paymentMember?.full_name || paymentMember?.email || req.user.email || "Church Member";

    const pdfBuffer = await generateReceiptPdfBuffer({
      receipt_number: receiptNumber,
      payment_id: payment.id,
      payment_date: payment.payment_date,
      amount: paymentAmount,
      payment_method: payment.payment_method || "manual",
      payment_status: payment.payment_status || "success",
      transaction_id: payment.transaction_id,
      member_name: memberName,
      member_email: paymentMember?.email || req.user.email,
      church_name: church?.name || null,
      subscription_id: payment.subscription_id,
      subscription_name: subscriptionName,
    });

    const safeFileName = `receipt-${receiptNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(pdfBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to download receipt") });
  }
});

// ═══════════════════════════════════════════════════
// PUBLIC DONATION ENDPOINTS (no auth required)
// ═══════════════════════════════════════════════════

router.get("/public/config", async (_req, res) => {
  try {
    const paymentConfig = await getEffectivePaymentConfig(null);
    return res.json({
      payments_enabled: paymentConfig.payments_enabled,
      key_id: paymentConfig.payments_enabled ? paymentConfig.key_id : "",
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load payment configuration") });
  }
});

// BE-3: Rate-limit public donation endpoints (10 requests per minute per IP)
const publicDonationLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

router.post("/public/donation/order", publicDonationLimiter, async (req, res) => {
  try {
    const paymentConfig = await getEffectivePaymentConfig(null);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: "Payments are currently disabled" });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    // Cap public donation at reasonable limit (₹500,000)
    if (amount > 500000) {
      return res.status(400).json({ error: "Donation amount exceeds the maximum allowed" });
    }

    const donorName = typeof req.body?.donor_name === "string" ? req.body.donor_name.trim().slice(0, 200) : "";
    const donorEmail = typeof req.body?.donor_email === "string" ? req.body.donor_email.trim().slice(0, 254) : "";
    const fund = typeof req.body?.fund === "string" ? req.body.fund.trim().slice(0, 200) : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";

    const receipt = `pub_donation_${Date.now()}`;
    const order = await createPaymentOrder(amount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      donor_name: donorName,
      donor_email: donorEmail,
      fund,
      message,
      donation_amount: amount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create donation order") });
  }
});

router.post("/public/donation/verify", publicDonationLimiter, async (req, res) => {
  try {
    const paymentConfig = await getEffectivePaymentConfig(null);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: "Payments are currently disabled" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    const { data: existingPublic } = await db
      .from("payments")
      .select("id")
      .eq("transaction_id", razorpay_payment_id)
      .maybeSingle();
    if (existingPublic) {
      return res.status(200).json({ status: "already_processed", payment_id: existingPublic.id });
    }

    const isValid = await verifyPayment(
      razorpay_signature,
      razorpay_order_id,
      razorpay_payment_id,
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      }
    );
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Use Razorpay order amount as source of truth
    const razorpayOrder = await fetchRazorpayOrder(razorpay_order_id, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });
    const verifiedAmount = razorpayOrder.amount;
    if (!Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return res.status(400).json({ error: "Could not verify donation amount with Razorpay" });
    }

    const donorName = typeof req.body?.donor_name === "string" ? req.body.donor_name.trim().slice(0, 200) : "";
    const donorEmail = typeof req.body?.donor_email === "string" ? req.body.donor_email.trim().slice(0, 254) : "";
    const fund = typeof req.body?.fund === "string" ? req.body.fund.trim().slice(0, 200) : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";

    // Store public donation with member_id = null
    const { data, error } = await db
      .from("payments")
      .insert([{
        member_id: null,
        subscription_id: null,
        amount: verifiedAmount,
        payment_method: "public_donation",
        transaction_id: razorpay_payment_id,
        payment_status: "success",
        payment_date: new Date().toISOString(),
        fund_name: fund || null,
      }])
      .select("id")
      .single<{ id: string }>();

    if (error) throw error;

    // Store donor details in a notes-style metadata approach via a separate insert
    // (We log donor info so admins can see who donated)
    if (donorName || donorEmail || fund || message) {
      try {
        await db
          .from("subscription_events")
          .insert([{
            member_id: null as any,
            subscription_id: null,
            church_id: null,
            event_type: "public_donation",
            status_after: "success",
            amount: verifiedAmount,
            source: "public_donation_page",
            metadata: {
              payment_id: data?.id,
              donor_name: donorName,
              donor_email: donorEmail,
              fund,
              message,
              transaction_id: razorpay_payment_id,
            },
          }]);
      } catch {
        // Non-critical: don't fail the donation if event logging fails
      }
    }

    return res.json({ success: true, payment_id: data?.id });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify donation") });
  }
});

export default router;
