import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { createPaymentOrder, verifyPayment, storePayment } from "../services/paymentService";
import { getMemberDashboardByEmail } from "../services/userService";
import { supabaseAdmin } from "../services/supabaseClient";
import { recordSubscriptionEvent } from "../services/subscriptionTrackingService";
import { getEffectivePaymentConfig } from "../services/churchPaymentService";
import { createReceiptNumber, generateReceiptPdfBuffer } from "../services/receiptService";

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

function isMissingReceiptMetadataColumnError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  const normalized = message.toLowerCase();
  return (
    (normalized.includes("receipt_number") && normalized.includes("does not exist")) ||
    (normalized.includes("receipt_generated_at") && normalized.includes("does not exist"))
  );
}

function normalizeDate(value: string) {
  return new Date(value);
}

function isDueSubscription(subscription: DashboardSubscription, now = new Date()) {
  const status = (subscription.status || "").toLowerCase();
  if (status === "cancelled" || status === "paused") {
    return false;
  }

  if (status === "overdue") {
    return true;
  }

  const nextDue = normalizeDate(subscription.next_payment_date);
  if (Number.isNaN(nextDue.getTime())) {
    return false;
  }

  return nextDue.getTime() <= now.getTime();
}

function computeNextDueDate(previousDueDate: string, billingCycle: string) {
  const base = new Date(previousDueDate);
  if (Number.isNaN(base.getTime())) {
    // Fallback: next month's 5th
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 5).toISOString().slice(0, 10);
  }

  const normalizedCycle = (billingCycle || "monthly").toLowerCase();
  if (normalizedCycle === "yearly") {
    return new Date(base.getFullYear() + 1, base.getMonth(), 5).toISOString().slice(0, 10);
  }
  // Monthly: always the 5th of next month from the base date
  return new Date(base.getFullYear(), base.getMonth() + 1, 5).toISOString().slice(0, 10);
}

function normalizeSelectedSubscriptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

async function getCurrentMemberDashboard(req: AuthRequest): Promise<CurrentMemberDashboard> {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const dashboard = await getMemberDashboardByEmail(req.user.email);
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
    return res.status(400).json({ error: err.message || "Failed to load payment configuration" });
  }
});

router.post("/order", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: paymentConfig.reason || "Payments are currently disabled" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const { amount, currency, receipt, subscription_id } = req.body;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    if (subscription_id) {
      const ownedSubscription = (dashboard.subscriptions || []).find(
        (subscription) => subscription.id === subscription_id
      );
      if (!ownedSubscription) {
        return res.status(403).json({ error: "Subscription does not belong to current member" });
      }
    }

    const order = await createPaymentOrder(
      numericAmount,
      currency || "INR",
      receipt || "church_receipt",
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      }
    );
    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create order" });
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
      amount,
      payment_method,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
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

    const payment = await storePayment({
      member_id: dashboard.member.id,
      subscription_id: subscription_id || null,
      amount: numericAmount,
      payment_method,
      transaction_id: razorpay_payment_id,
      payment_status: "success",
      payment_date: new Date().toISOString(),
    });
    return res.json({ success: true, payment });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to verify payment" });
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
    const order = await createPaymentOrder(amount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      church_name: dashboard.church?.name || null,
      donation_amount: amount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create donation order" });
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

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
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

    const payment = await storePayment({
      member_id: dashboard.member.id,
      subscription_id: null,
      amount,
      payment_method: "donation",
      transaction_id: razorpay_payment_id,
      payment_status: "success",
      payment_date: new Date().toISOString(),
    });

    return res.json({ success: true, payment });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to verify donation" });
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
    const selectedIds = selectedFromBody.length
      ? selectedFromBody
      : [dueSubscriptions[0].subscription_id];

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

    const receipt = `subscription_multi_${Date.now()}`;
    const order = await createPaymentOrder(totalAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      subscription_ids: selectedIds,
      total_amount: totalAmount,
      selected_due_subscriptions: selectedDueSubscriptions,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create subscription payment order" });
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

    const payments: Array<{ id: string }> = [];
    const updatedSubscriptions: Array<{ subscription_id: string; next_payment_date: string }> = [];

    for (const selectedId of normalizedSubscriptionIds) {
      const ownedSubscription = subscriptionById.get(selectedId)!;
      const numericAmount = Number(ownedSubscription.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: `Invalid subscription amount for ${selectedId}` });
      }

      const payment = await storePayment({
        member_id: dashboard.member.id,
        subscription_id: selectedId,
        amount: numericAmount,
        payment_method: "subscription_paynow",
        transaction_id: razorpay_payment_id,
        payment_status: "success",
        payment_date: new Date().toISOString(),
      });
      payments.push(payment);

      const nextDue = computeNextDueDate(
        ownedSubscription.next_payment_date,
        ownedSubscription.billing_cycle
      );

      // One-time adjustment subscriptions get cancelled after payment
      const isAdjustment = (ownedSubscription.plan_name || "").includes("Adjustment");
      const newStatus = isAdjustment ? "cancelled" : "active";
      const newNextDate = isAdjustment ? ownedSubscription.next_payment_date : nextDue;

      const { error: updateSubscriptionError } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: newStatus,
          next_payment_date: newNextDate,
        })
        .eq("id", selectedId)
        .eq("member_id", dashboard.member.id);

      if (updateSubscriptionError) {
        return res.status(500).json({ error: `Payment saved but failed to update subscription due date for ${selectedId}` });
      }

      updatedSubscriptions.push({
        subscription_id: selectedId,
        next_payment_date: newNextDate,
      });

      try {
        await recordSubscriptionEvent({
          member_id: dashboard.member.id,
          subscription_id: selectedId,
          event_type: "subscription_due_paid",
          status_before: ownedSubscription.status,
          status_after: newStatus,
          amount: numericAmount,
          source: "payment_gateway",
          metadata: {
            paid_via: "pay_now",
            next_payment_date: newNextDate,
            transaction_id: razorpay_payment_id,
            is_adjustment: isAdjustment,
          },
        });
      } catch {
        // Non-blocking event failure.
      }
    }

    return res.json({
      success: true,
      payment_count: payments.length,
      payments,
      updated_subscriptions: updatedSubscriptions,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to verify subscription payment" });
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

    const dashboard = await getCurrentMemberDashboard(req);

    const withReceiptColumns = await supabaseAdmin
      .from("payments")
      .select(
        "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, receipt_generated_at"
      )
      .eq("id", paymentId)
      .eq("member_id", dashboard.member.id)
      .maybeSingle<PaymentReceiptRow>();

    let payment: PaymentReceiptRow | null = null;

    if (withReceiptColumns.error && isMissingReceiptMetadataColumnError(withReceiptColumns.error)) {
      const legacyPayment = await supabaseAdmin
        .from("payments")
        .select(
          "id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date"
        )
        .eq("id", paymentId)
        .eq("member_id", dashboard.member.id)
        .maybeSingle<
          Omit<PaymentReceiptRow, "receipt_number" | "receipt_generated_at">
        >();

      if (legacyPayment.error) {
        return res.status(500).json({ error: "Failed to load payment" });
      }

      payment = legacyPayment.data
        ? {
            ...legacyPayment.data,
            receipt_number: null,
            receipt_generated_at: null,
          }
        : null;
    } else if (withReceiptColumns.error) {
      return res.status(500).json({ error: "Failed to load payment" });
    } else {
      payment = withReceiptColumns.data || null;
    }

    if (!payment) {
      return res.status(404).json({ error: "Payment not found" });
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
      const { error: updateError } = await supabaseAdmin
        .from("payments")
        .update({
          receipt_number: receiptNumber,
          receipt_generated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("member_id", payment.member_id);

      if (updateError && !isMissingReceiptMetadataColumnError(updateError)) {
        return res.status(500).json({ error: "Failed to link receipt with payment" });
      }
    }

    const paymentAmount = Number(payment.amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ error: "Invalid payment amount" });
    }

    const subscription = payment.subscription_id
      ? dashboard.subscriptions.find((row) => row.id === payment.subscription_id)
      : null;
    const memberName =
      req.registeredProfile?.full_name || req.user.email || "Church Member";

    const pdfBuffer = await generateReceiptPdfBuffer({
      receipt_number: receiptNumber,
      payment_id: payment.id,
      payment_date: payment.payment_date,
      amount: paymentAmount,
      payment_method: payment.payment_method || "razorpay",
      payment_status: payment.payment_status || "success",
      transaction_id: payment.transaction_id,
      member_name: memberName,
      member_email: req.user.email,
      church_name: dashboard.church?.name || null,
      subscription_id: payment.subscription_id,
      subscription_name: subscription?.plan_name || null,
    });

    const safeFileName = `receipt-${receiptNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(pdfBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to download receipt" });
  }
});

export default router;
