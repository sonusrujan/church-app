import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import type { PoolClient } from "pg";
import { JWT_SECRET } from "../config";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { createPaymentOrder, verifyPayment, storePayment, fetchRazorpayOrder } from "../services/paymentService";
import { getMemberDashboardByEmail } from "../services/userService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { logger } from "../utils/logger";
import { validate, paymentOrderSchema, paymentVerifySchema, donationOrderSchema, donationVerifySchema, subscriptionOrderSchema, subscriptionVerifySchema, publicDonationOrderSchema, publicDonationVerifySchema } from "../utils/zodSchemas";
import { db, rawQuery, getClient } from "../services/dbClient";
import { getEffectivePaymentConfig } from "../services/churchPaymentService";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import { createReceiptNumber, generateReceiptPdfBuffer } from "../services/receiptService";
import {
  computeNextDueDate,
  isDueSubscription,
  normalizeSelectedSubscriptionIds,
} from "../utils/subscriptionHelpers";
import { getPublicDonationFeePercent } from "../services/platformConfigService";
import {
  allocateOldestPendingMonthsAtomic,
  ensurePendingMonthsForPaymentAtomic,
  listMonthlyHistoryForMember,
} from "../services/subscriptionMonthlyDuesService";
import { buildOrderTransfers } from "../services/razorpayRoutesService";
import { persistAuditLog } from "../utils/auditLog";

const router = Router();

// PAY-001: Rate limiter for authenticated payment mutation routes
const paymentWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests, please try again later" },
});

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
  monthly_amount?: number;
  billing_cycle: string;
  next_payment_date: string;
  status: string;
  pending_month_count?: number;
  pending_months?: string[];
  pending_month_labels?: string[];
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
  member_id: string | null;
  subscription_id: string | null;
  amount: number | string;
  payment_method: string | null;
  payment_category?: string | null;
  transaction_id: string | null;
  payment_status: string | null;
  payment_date: string;
  receipt_number: string | null;
  receipt_generated_at: string | null;
};

type PaymentReceiptWithChurch = PaymentReceiptRow & { church_id: string };

function isDonationReceiptPayment(payment: PaymentReceiptRow) {
  const method = String(payment.payment_method || "").toLowerCase();
  const category = String(payment.payment_category || "").toLowerCase();
  return !payment.subscription_id && (method === "donation" || method === "public_donation" || category === "donation");
}

async function getChurchFacingPaymentAmount(payment: PaymentReceiptRow) {
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid payment amount");
  }

  if (!isDonationReceiptPayment(payment)) {
    return amount;
  }

  const { rows } = await rawQuery<{ fee_amount: string }>(
    `SELECT COALESCE(SUM(fee_amount), 0)::text AS fee_amount
     FROM platform_fee_collections
     WHERE payment_id = $1`,
    [payment.id],
  );
  const feeAmount = Number(rows[0]?.fee_amount || 0);
  return Math.max(0, amount - (Number.isFinite(feeAmount) ? feeAmount : 0));
}

async function generateReceiptForPayment(payment: PaymentReceiptWithChurch, receiptNumber: string, fallbackContact = "") {
  const paymentAmount = await getChurchFacingPaymentAmount(payment);

  const { data: paymentMember } = payment.member_id
    ? await db
      .from("members")
      .select("full_name, email")
      .eq("id", payment.member_id)
      .maybeSingle<{ full_name: string | null; email: string | null }>()
    : { data: null };

  const { data: church } = await db
    .from("churches")
    .select("name, legal_name, registered_address, pan_number, gstin, tax_80g_registration_number, receipt_signatory_name, receipt_signatory_title")
    .eq("id", payment.church_id)
    .maybeSingle<{
      name: string;
      legal_name: string | null;
      registered_address: string | null;
      pan_number: string | null;
      gstin: string | null;
      tax_80g_registration_number: string | null;
      receipt_signatory_name: string | null;
      receipt_signatory_title: string | null;
    }>();

  let subscriptionName: string | null = null;
  if (payment.subscription_id) {
    const { data: sub } = await db
      .from("subscriptions")
      .select("plan_name")
      .eq("id", payment.subscription_id)
      .maybeSingle<{ plan_name: string }>();
    subscriptionName = sub?.plan_name || null;
  }

  let monthsCovered: string | null = null;
  try {
    const { rows: monthRows } = await rawQuery<{ months: string }>(
      `SELECT string_agg(to_char(smd.due_month, 'Mon YYYY'), ', ' ORDER BY smd.due_month) AS months
       FROM payment_month_allocations pma
       JOIN subscription_monthly_dues smd ON smd.id = pma.due_id
       WHERE pma.payment_id = $1`,
      [payment.id],
    );
    if (monthRows.length > 0 && monthRows[0].months) {
      monthsCovered = monthRows[0].months;
    }
  } catch (monthErr) {
    logger.warn({ err: monthErr, paymentId: payment.id }, "Failed to fetch months covered for receipt, continuing without");
  }

  const memberName = paymentMember?.full_name || paymentMember?.email || fallbackContact || "Public donor";

  return generateReceiptPdfBuffer({
    receipt_number: receiptNumber,
    payment_id: payment.id,
    payment_date: payment.payment_date,
    amount: paymentAmount,
    payment_method: payment.payment_method || "manual",
    payment_status: payment.payment_status || "success",
    transaction_id: payment.transaction_id,
    member_name: memberName,
    member_email: paymentMember?.email || fallbackContact || "",
    church_name: church?.name || null,
    subscription_id: payment.subscription_id,
    subscription_name: subscriptionName,
    months_covered: monthsCovered,
    church_legal_name: church?.legal_name || null,
    church_registered_address: church?.registered_address || null,
    church_pan_number: church?.pan_number || null,
    church_gstin: church?.gstin || null,
    church_tax_80g_number: church?.tax_80g_registration_number || null,
    receipt_signatory_name: church?.receipt_signatory_name || null,
    receipt_signatory_title: church?.receipt_signatory_title || null,
  });
}

async function getCurrentMemberDashboard(req: AuthRequest): Promise<CurrentMemberDashboard> {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const dashboard = await getMemberDashboardByEmail(req.user.email, req.user.phone, req.user.id, req.user.church_id);
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

async function withPaymentTransaction<T>(
  churchId: string | null | undefined,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_church_id', $1, true)", [churchId || ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertPlatformFeeCollectionTx(
  client: PoolClient,
  input: {
    church_id: string;
    payment_id: string;
    member_id: string;
    base_amount: number;
    fee_percentage: number;
    fee_amount: number;
  },
) {
  if (!Number.isFinite(input.fee_amount) || input.fee_amount <= 0) return;
  await client.query(
    `INSERT INTO platform_fee_collections
       (church_id, payment_id, member_id, base_amount, fee_percentage, fee_amount, collected_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [
      input.church_id,
      input.payment_id,
      input.member_id,
      input.base_amount,
      input.fee_percentage,
      input.fee_amount,
    ],
  );
}

async function recordPaymentTransferTx(
  client: PoolClient,
  input: {
    payment_id: string;
    church_id: string;
    transfer_amount: number;
    platform_fee_amount: number;
    razorpay_order_id: string;
  },
) {
  const churchRes = await client.query<{ routes_enabled: boolean; razorpay_linked_account_id: string | null }>(
    `SELECT routes_enabled, razorpay_linked_account_id FROM churches WHERE id = $1`,
    [input.church_id],
  );
  const church = churchRes.rows[0];
  if (!church?.routes_enabled || !church.razorpay_linked_account_id) return;

  await client.query(
    `INSERT INTO payment_transfers
       (payment_id, church_id, linked_account_id, transfer_amount, platform_fee_amount,
        razorpay_order_id, transfer_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'created')`,
    [
      input.payment_id,
      input.church_id,
      church.razorpay_linked_account_id,
      input.transfer_amount,
      input.platform_fee_amount,
      input.razorpay_order_id,
    ],
  );
  await client.query(`UPDATE payments SET transfer_status = 'created' WHERE id = $1`, [input.payment_id]);
}

function normalizeSubscriptionMonthCounts(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!UUID_REGEX.test(key)) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const rounded = Math.floor(n);
    if (rounded > 0) out[key] = rounded;
  }
  return out;
}

router.get("/my-monthly-history", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const dashboard = await getCurrentMemberDashboard(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const personName = typeof req.query.person_name === "string" ? req.query.person_name : undefined;
    const personKey = typeof req.query.person_key === "string" ? req.query.person_key : undefined;
    const fromDate = typeof req.query.from_date === "string" ? req.query.from_date : undefined;

    const rows = await listMonthlyHistoryForMember({
      member_id: dashboard.member.id,
      person_key: personKey,
      person_name: personName,
      from_date: fromDate,
      limit,
      offset,
    });
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load monthly history") });
  }
});

// 3.1: Calculate platform fee to add ON TOP of payment amount
async function calculatePlatformFee(churchId: string | null | undefined, baseAmount: number): Promise<{ fee: number; percentage: number; enabled: boolean }> {
  if (!churchId) return { fee: 0, percentage: 0, enabled: false };
  try {
    const settings = await getChurchSaaSSettings(churchId);
    if (!settings.platform_fee_enabled || settings.platform_fee_percentage <= 0) {
      return { fee: 0, percentage: settings.platform_fee_percentage, enabled: false };
    }
    // LOW-012: Cap at 10% to prevent accidental overcharging
    const fee = Math.round(baseAmount * Math.max(0, Math.min(settings.platform_fee_percentage, 10))) / 100;
    return { fee, percentage: settings.platform_fee_percentage, enabled: true };
  } catch {
    return { fee: 0, percentage: 0, enabled: false };
  }
}

router.get("/config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const paymentConfig = await resolvePaymentConfig(req);
    const churchId = req.user?.church_id || req.registeredProfile?.church_id || "";
    const platformFee = await calculatePlatformFee(churchId || null, 100);
    return res.json({
      payments_enabled: paymentConfig.payments_enabled,
      key_id: paymentConfig.payments_enabled ? paymentConfig.key_id : "",
      source: paymentConfig.source,
      reason: paymentConfig.reason,
      platform_fee_enabled: platformFee.enabled,
      platform_fee_percentage: platformFee.percentage,
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load payment configuration") });
  }
});

router.post("/order", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(paymentOrderSchema), async (req: AuthRequest, res) => {
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
      // PAY-002: Cap maximum single payment amount
      if (numericAmount > 10_000_000) {
        return res.status(400).json({ error: "Payment amount cannot exceed \u20B91,00,00,000" });
      }
    }

    // 3.1: Add platform fee ON TOP of the base amount
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, numericAmount);
    const totalAmount = numericAmount + platformFee.fee;

    // Razorpay Routes: build transfer instructions for auto-split
    let transfers: Array<{ account: string; amount: number; currency: string; notes?: Record<string, string> }> | undefined;
    if (churchId) {
      const routeTransfers = await buildOrderTransfers(churchId, numericAmount, platformFee.fee);
      if (routeTransfers) transfers = routeTransfers.transfers;
    }

    // PAY-005: Validate currency — only INR is accepted
    const validatedCurrency = "INR";

    const order = await createPaymentOrder(
      totalAmount,
      validatedCurrency,
      receipt || "church_receipt",
      {
        key_id: paymentConfig.key_id,
        key_secret: paymentConfig.key_secret,
      },
      { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) },
      transfers,
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

router.post("/verify", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(paymentVerifySchema), async (req: AuthRequest, res) => {
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

    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
    const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);

    const payment = await withPaymentTransaction(churchId || null, async (client) => {
      const storedPayment = await storePayment({
        member_id: dashboard.member.id,
        subscription_id: subscription_id || null,
        church_id: churchId || null,
        amount: verifiedAmount,
        payment_method,
        transaction_id: razorpay_payment_id,
        payment_status: "success",
        payment_date: new Date().toISOString(),
      }, client);

      if (churchId && storedFee > 0) {
        const baseAmount = verifiedAmount - storedFee;
        await insertPlatformFeeCollectionTx(client, {
          church_id: churchId,
          payment_id: storedPayment.id,
          member_id: dashboard.member.id,
          base_amount: baseAmount,
          fee_percentage: storedPct,
          fee_amount: storedFee,
        });
      }

      if (churchId) {
        await recordPaymentTransferTx(client, {
          payment_id: storedPayment.id,
          church_id: churchId,
          transfer_amount: verifiedAmount - storedFee,
          platform_fee_amount: storedFee,
          razorpay_order_id,
        });
      }

      return storedPayment;
    });

    persistAuditLog(req, "payment.verified", "payment", payment.id, {
      transaction_id: razorpay_payment_id,
      amount: verifiedAmount,
      subscription_id: subscription_id || null,
    }).catch((e) => logger.warn({ err: e }, "Audit log failed for payment.verified"));

    return res.json({ success: true, payment });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify payment") });
  }
});

router.post("/donation/order", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(donationOrderSchema), async (req: AuthRequest, res) => {
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
    if (amount > 1_00_00_000) {
      return res.status(400).json({ error: "Donation amount exceeds the maximum allowed (₹1 Crore)" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const memberToken = dashboard.member.id.replace(/-/g, "").slice(0, 8);
    const receipt = `donation_${memberToken}_${Date.now()}`;
    
    // 3.1: Add platform fee ON TOP
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, amount);
    const totalAmount = amount + platformFee.fee;

    // Razorpay Routes: build transfer instructions for auto-split
    let donationTransfers: Array<{ account: string; amount: number; currency: string; notes?: Record<string, string> }> | undefined;
    if (churchId) {
      const routeTransfers = await buildOrderTransfers(churchId, amount, platformFee.fee);
      if (routeTransfers) donationTransfers = routeTransfers.transfers;
    }

    const order = await createPaymentOrder(totalAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    }, { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) }, donationTransfers);

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

router.post("/donation/verify", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(donationVerifySchema), async (req: AuthRequest, res) => {
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

    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
    const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);

    const payment = await withPaymentTransaction(churchId || null, async (client) => {
      const storedPayment = await storePayment({
        member_id: dashboard.member.id,
        subscription_id: null,
        church_id: churchId || null,
        amount: verifiedAmount,
        payment_method: "donation",
        transaction_id: razorpay_payment_id,
        payment_status: "success",
        payment_date: new Date().toISOString(),
        fund_name: fund || null,
      }, client);

      if (churchId && storedFee > 0) {
        const baseAmount = verifiedAmount - storedFee;
        await insertPlatformFeeCollectionTx(client, {
          church_id: churchId,
          payment_id: storedPayment.id,
          member_id: dashboard.member.id,
          base_amount: baseAmount,
          fee_percentage: storedPct,
          fee_amount: storedFee,
        });
      }

      if (churchId) {
        await recordPaymentTransferTx(client, {
          payment_id: storedPayment.id,
          church_id: churchId,
          transfer_amount: verifiedAmount - storedFee,
          platform_fee_amount: storedFee,
          razorpay_order_id,
        });
      }

      return storedPayment;
    });

    persistAuditLog(req, "donation.verified", "payment", payment.id, {
      transaction_id: razorpay_payment_id,
      amount: verifiedAmount,
      fund: fund || null,
    }).catch((e) => logger.warn({ err: e }, "Audit log failed for donation.verified"));

    return res.json({ success: true, payment });
  } catch (err: any) {
    logger.error({ err, stack: err?.stack }, "donation/verify failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify donation") });
  }
});

router.post("/subscription/order", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(subscriptionOrderSchema), async (req: AuthRequest, res) => {
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
    const selectedMonthCounts = normalizeSubscriptionMonthCounts(req.body?.subscription_month_counts);
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

    const enrichedSelection = selectedDueSubscriptions.map((subscription) => {
      const pendingCount = Number(subscription.pending_month_count || subscription.pending_months?.length || 0);
      const monthlyAmount = Number(subscription.monthly_amount || subscription.amount || 0);
      const requestedMonths = selectedMonthCounts[subscription.subscription_id] || 1;
      if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
        throw new Error(`Invalid monthly amount for ${subscription.subscription_id}`);
      }
      if (pendingCount > 0 && requestedMonths > pendingCount) {
        throw new Error(`Cannot select ${requestedMonths} months for ${subscription.person_name}; only ${pendingCount} pending`);
      }
      const selectedMonths = (subscription.pending_months || []).slice(0, requestedMonths);
      return {
        ...subscription,
        selected_month_count: requestedMonths,
        selected_months: selectedMonths,
        line_amount: monthlyAmount * requestedMonths,
      };
    });

    const totalAmount = enrichedSelection.reduce((sum, row) => sum + Number(row.line_amount || 0), 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      return res.status(400).json({ error: "Selected due amount is invalid" });
    }

    // 3.1: Add platform fee ON TOP of subscription total
    const churchId = req.user?.church_id || req.registeredProfile?.church_id;
    const platformFee = await calculatePlatformFee(churchId, totalAmount);
    const chargeAmount = totalAmount + platformFee.fee;

    // Razorpay Routes: build transfer instructions for auto-split
    let subTransfers: Array<{ account: string; amount: number; currency: string; notes?: Record<string, string> }> | undefined;
    if (churchId) {
      const routeTransfers = await buildOrderTransfers(churchId, totalAmount, platformFee.fee);
      if (routeTransfers) subTransfers = routeTransfers.transfers;
    }

    const receipt = `subscription_multi_${Date.now()}`;
    const order = await createPaymentOrder(chargeAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    }, { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) }, subTransfers);

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      member_id: dashboard.member.id,
      subscription_ids: selectedIds,
      subscription_month_counts: selectedMonthCounts,
      base_amount: totalAmount,
      platform_fee: platformFee.fee,
      platform_fee_percentage: platformFee.percentage,
      total_amount: chargeAmount,
      selected_due_subscriptions: enrichedSelection,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create subscription payment order") });
  }
});

router.post("/subscription/verify", requireAuth, requireRegisteredUser, paymentWriteLimiter, validate(subscriptionVerifySchema), async (req: AuthRequest, res) => {
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
      subscription_month_counts,
      subscription_id,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing verification fields" });
    }

    const dashboard = await getCurrentMemberDashboard(req);

    const selectedIds = normalizeSelectedSubscriptionIds(subscription_ids);
    const selectedMonthCounts = normalizeSubscriptionMonthCounts(subscription_month_counts);
    const normalizedSubscriptionIds = selectedIds.length
      ? selectedIds
      : typeof subscription_id === "string" && subscription_id.trim()
        ? [subscription_id.trim()]
        : [];

    if (!normalizedSubscriptionIds.length) {
      return res.status(400).json({ error: "No subscriptions selected for payment" });
    }

    // Idempotency: only short-circuit if EVERY requested subscription already has
    // a successful payment row for this transaction_id. Prior verify attempts that
    // left `failed` rows (allocation failures) must not block retries.
    const { data: existingBatchRows } = await db
      .from("payments")
      .select("id, subscription_id, payment_status")
      .eq("transaction_id", razorpay_payment_id);
    const successfulSubIds = new Set(
      (existingBatchRows || [])
        .filter((row: any) => row.payment_status === "success" && row.subscription_id)
        .map((row: any) => row.subscription_id as string)
    );
    if (
      normalizedSubscriptionIds.length > 0 &&
      normalizedSubscriptionIds.every((id) => successfulSubIds.has(id))
    ) {
      const successRow = (existingBatchRows || []).find((row: any) => row.payment_status === "success");
      return res.status(200).json({ status: "already_processed", payment_id: successRow?.id });
    }

    const subscriptionById = new Map<string, DashboardSubscription>();
    for (const subscription of dashboard.subscriptions || []) {
      subscriptionById.set(subscription.id, subscription);
    }

    const missingSubscription = normalizedSubscriptionIds.find((id) => !subscriptionById.has(id));
    if (missingSubscription) {
      return res.status(403).json({ error: `Subscription does not belong to current member: ${missingSubscription}` });
    }

    // PRE-VALIDATE: Check all subscription amounts/months BEFORE any DB writes
    const subscriptionAmounts: Array<{ id: string; amount: number; subscription: DashboardSubscription; selectedMonths: number }> = [];
    for (const selectedId of normalizedSubscriptionIds) {
      const ownedSubscription = subscriptionById.get(selectedId)!;
      const numericAmount = Number(ownedSubscription.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: `Invalid subscription amount for ${selectedId}` });
      }
      const selectedMonths = selectedMonthCounts[selectedId] || 1;
      if (!Number.isInteger(selectedMonths) || selectedMonths <= 0) {
        return res.status(400).json({ error: `Invalid selected months for ${selectedId}` });
      }
      subscriptionAmounts.push({ id: selectedId, amount: numericAmount, subscription: ownedSubscription, selectedMonths });
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
    const expectedTotal = subscriptionAmounts.reduce((sum, entry) => sum + entry.amount * entry.selectedMonths, 0);
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

    const paymentDate = new Date().toISOString();
    let payments: Array<{ id: string; receipt_number: string | null }> = [];
    let updatedSubscriptions: Array<{ subscription_id: string; next_payment_date: string | null }> = [];

    try {
      const txResult = await withPaymentTransaction(churchId || null, async (client) => {
        const txPayments: Array<{ id: string; receipt_number: string | null }> = [];
        const txUpdatedSubscriptions: Array<{ subscription_id: string; next_payment_date: string | null }> = [];

        for (const { id: selectedId, amount: numericAmount, subscription, selectedMonths } of subscriptionAmounts) {
        const payment = await storePayment({
          member_id: dashboard.member.id,
          subscription_id: selectedId,
          church_id: churchId || null,
          amount: numericAmount * selectedMonths,
          payment_method: "subscription_paynow",
          transaction_id: razorpay_payment_id,
          payment_status: "success",
          payment_date: paymentDate,
        }, client);

        const receiptNumber = createReceiptNumber({
          member_id: dashboard.member.id,
          payment_date: paymentDate,
          transaction_id: `${razorpay_payment_id}_${selectedId}`,
        });
        await client.query(
          `UPDATE payments
           SET receipt_number = $1, receipt_generated_at = $2
           WHERE id = $3`,
          [receiptNumber, new Date().toISOString(), payment.id],
        );

        // Skip allocation if this payment already has month allocations (idempotent retry)
        const existingAllocs = await client.query<{ covered_month: string }>(
          `SELECT covered_month FROM payment_month_allocations WHERE payment_id = $1`,
          [payment.id],
        );
        let allocatedMonths: string[];
        if (existingAllocs.rows.length > 0) {
          allocatedMonths = existingAllocs.rows
            .map((row) => row.covered_month)
            .sort();
          logger.info({ paymentId: payment.id, count: allocatedMonths.length }, "Skipping allocation; existing allocations found");
        } else {
          await ensurePendingMonthsForPaymentAtomic({
            subscription_id: selectedId,
            member_id: dashboard.member.id,
            church_id: churchId || "",
            start_month: subscription.next_payment_date,
            months_to_ensure: selectedMonths,
            existingClient: client,
          });
          allocatedMonths = await allocateOldestPendingMonthsAtomic({
            payment_id: payment.id,
            subscription_id: selectedId,
            member_id: dashboard.member.id,
            church_id: churchId || "",
            monthly_amount: numericAmount,
            months_to_allocate: selectedMonths,
            person_name: subscription.person_name || "Member",
            existingClient: client,
          });
        }

          txPayments.push({ id: payment.id, receipt_number: receiptNumber });
          txUpdatedSubscriptions.push({
          subscription_id: selectedId,
          next_payment_date: allocatedMonths.length ? computeNextDueDate(allocatedMonths[allocatedMonths.length - 1], subscription.billing_cycle) : null,
        });
        }

        if (churchId && storedFee > 0 && txPayments.length > 0) {
          await insertPlatformFeeCollectionTx(client, {
            church_id: churchId,
            payment_id: txPayments[0].id,
            member_id: dashboard.member.id,
            base_amount: expectedTotal,
            fee_percentage: storedPct,
            fee_amount: storedFee,
          });
        }

        if (churchId && txPayments.length > 0) {
          await recordPaymentTransferTx(client, {
            payment_id: txPayments[0].id,
            church_id: churchId,
            transfer_amount: expectedTotal,
            platform_fee_amount: storedFee,
            razorpay_order_id,
          });
        }

        return { payments: txPayments, updatedSubscriptions: txUpdatedSubscriptions };
      });
      payments = txResult.payments;
      updatedSubscriptions = txResult.updatedSubscriptions;
    } catch (txErr: any) {
      logger.error({ err: txErr, subscriptionIds: normalizedSubscriptionIds }, "Atomic subscription verify transaction failed");

      try {
        await db.from("payment_reconciliation_queue").insert({
          razorpay_order_id,
          razorpay_payment_id,
          church_id: churchId || null,
          member_id: dashboard.member.id,
          subscription_ids: normalizedSubscriptionIds,
          expected_amount: expectedTotal,
          status: "pending",
          error_message: txErr instanceof Error ? txErr.message : "Unknown error",
        });
      } catch (reconErr) {
        logger.error({ err: reconErr }, "Failed to queue reconciliation for failed atomic subscription payment");
      }

      return res.status(202).json({
        success: false,
        reconciliation_queued: true,
        payment_count: 0,
        payments: [],
        updated_subscriptions: [],
        error: "Payment was captured, but local allocation failed before any local payment rows were committed. Reconciliation has been queued.",
      });
    }

    persistAuditLog(req, "subscription_payment.verified", "payment", payments[0]?.id, {
      transaction_id: razorpay_payment_id,
      payment_count: payments.length,
      subscription_ids: normalizedSubscriptionIds,
      total_amount: expectedTotal,
    }).catch((e) => logger.warn({ err: e }, "Audit log failed for subscription_payment.verified"));

    return res.json({
      success: true,
      payment_count: payments.length,
      payments,
      updated_subscriptions: updatedSubscriptions,
    });
  } catch (err: any) {
    logger.error({ err, stack: err?.stack }, "subscription/verify failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify subscription payment") });
  }
});

router.get("/public/:paymentId/receipt", async (req, res) => {
  try {
    const paymentId = typeof req.params.paymentId === "string" ? req.params.paymentId.trim() : "";
    const receiptNumber = typeof req.query.receipt_number === "string" ? req.query.receipt_number.trim() : "";
    if (!paymentId || !UUID_REGEX.test(paymentId) || !receiptNumber) {
      return res.status(400).json({ error: "Invalid receipt request" });
    }

    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select(
        "id, member_id, subscription_id, church_id, amount, payment_method, payment_category, transaction_id, payment_status, payment_date, receipt_number, receipt_generated_at"
      )
      .eq("id", paymentId)
      .maybeSingle<PaymentReceiptWithChurch>();

    if (paymentError) {
      return res.status(500).json({ error: "Failed to load payment" });
    }
    if (
      !payment ||
      payment.receipt_number !== receiptNumber ||
      String(payment.payment_method || "").toLowerCase() !== "public_donation" ||
      payment.member_id
    ) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    if ((payment.payment_status || "").toLowerCase() !== "success") {
      return res.status(400).json({ error: "Receipt is available only for successful payments" });
    }

    const pdfBuffer = await generateReceiptForPayment(payment, receiptNumber, "Public donor");
    const safeFileName = `receipt-${receiptNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(pdfBuffer);
  } catch (err: any) {
    logger.error({ err, paymentId: req.params.paymentId }, "Public receipt download failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to download receipt") });
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
        "id, member_id, subscription_id, church_id, amount, payment_method, payment_category, transaction_id, payment_status, payment_date, receipt_number, receipt_generated_at"
      )
      .eq("id", paymentId)
      .maybeSingle<PaymentReceiptWithChurch>();

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
        member_id: payment.member_id || "PUBLIC",
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

    const pdfBuffer = await generateReceiptForPayment(payment, receiptNumber, req.user.email || req.user.phone || "");

    const safeFileName = `receipt-${receiptNumber}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(pdfBuffer);
  } catch (err: any) {
    logger.error({ err, paymentId: req.params.paymentId }, "Receipt download failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to download receipt") });
  }
});

// ═══════════════════════════════════════════════════
// PUBLIC DONATION ENDPOINTS (no auth required)
// ═══════════════════════════════════════════════════

router.get("/public/config", async (req, res) => {
  try {
    const churchId = typeof req.query.church_id === "string" ? req.query.church_id.trim() : "";
    const paymentConfig = await getEffectivePaymentConfig(churchId || null);
    const publicDonationFeePercent = await getPublicDonationFeePercent();
    return res.json({
      payments_enabled: paymentConfig.payments_enabled,
      key_id: paymentConfig.payments_enabled ? paymentConfig.key_id : "",
      public_donation_fee_percent: publicDonationFeePercent,
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

router.post("/public/donation/order", publicDonationLimiter, validate(publicDonationOrderSchema), async (req, res) => {
  try {
    // church_id is required so we charge from the correct Razorpay account
    const churchId = typeof req.body?.church_id === "string" ? req.body.church_id.trim() : "";
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const paymentConfig = await getEffectivePaymentConfig(churchId);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: "Payments are currently disabled for this church" });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be greater than 0" });
    }

    // Cap public donation at reasonable limit (₹1 Crore)
    if (amount > 1_00_00_000) {
      return res.status(400).json({ error: "Donation amount exceeds the maximum allowed (₹1 Crore)" });
    }

    // All donor fields are mandatory for public donations
    const donorName = typeof req.body?.donor_name === "string" ? req.body.donor_name.trim().slice(0, 200) : "";
    const donorEmail = typeof req.body?.donor_email === "string" ? req.body.donor_email.trim().slice(0, 200) : "";
    const donorPhone = typeof req.body?.donor_phone === "string" ? req.body.donor_phone.trim().slice(0, 20) : "";
    if (!donorName || !donorEmail || !donorPhone) {
      return res.status(400).json({ error: "donor_name, donor_email, and donor_phone are required" });
    }

    const fund = typeof req.body?.fund === "string" ? req.body.fund.trim().slice(0, 200) : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";

    // Public donations use the superadmin-configured platform fee percentage.
    // Authenticated member donations use the church's configured fee instead.
    const PUBLIC_DONATION_FEE_PERCENT = await getPublicDonationFeePercent();
    const platformFee = {
      fee: Math.round(amount * PUBLIC_DONATION_FEE_PERCENT) / 100,
      percentage: PUBLIC_DONATION_FEE_PERCENT,
      enabled: true,
    };
    const totalAmount = amount + platformFee.fee;

    const receipt = `pub_donation_${Date.now()}`;
    const order = await createPaymentOrder(totalAmount, "INR", receipt, {
      key_id: paymentConfig.key_id,
      key_secret: paymentConfig.key_secret,
    }, { platform_fee: String(platformFee.fee), platform_fee_pct: String(platformFee.percentage) });

    return res.json({
      order,
      key_id: paymentConfig.key_id,
      church_id: churchId,
      donor_name: donorName,
      donor_email: donorEmail,
      donor_phone: donorPhone,
      fund,
      message,
      donation_amount: amount,
      platform_fee: platformFee.fee,
      total_amount: totalAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create donation order") });
  }
});

router.post("/public/donation/verify", publicDonationLimiter, validate(publicDonationVerifySchema), async (req, res) => {
  try {
    const churchId = typeof req.body?.church_id === "string" ? req.body.church_id.trim() : "";
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const paymentConfig = await getEffectivePaymentConfig(churchId);
    if (!paymentConfig.payments_enabled) {
      return res.status(503).json({ error: "Payments are currently disabled" });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing Razorpay verification fields" });
    }

    const { data: existingPublic } = await db
      .from("payments")
      .select("id, receipt_number")
      .eq("transaction_id", razorpay_payment_id)
      .maybeSingle<{ id: string; receipt_number: string | null }>();
    if (existingPublic) {
      return res.status(200).json({
        success: true,
        status: "already_processed",
        payment_id: existingPublic.id,
        receipt_number: existingPublic.receipt_number,
      });
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
    const donorPhone = typeof req.body?.donor_phone === "string" ? req.body.donor_phone.trim().slice(0, 20) : "";
    const fund = typeof req.body?.fund === "string" ? req.body.fund.trim().slice(0, 200) : "";
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";

    // Opportunistic auth: if a logged-in member is donating to their own
    // church, link this payment to their member_id so it appears in their
    // dashboard / history. Anonymous donors continue to work unchanged.
    let linkedMemberId: string | null = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        if (token && token.split(".").length === 3) {
          const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string; email?: string; phone?: string; church_id?: string };
          if (decoded?.sub && decoded?.church_id === churchId) {
            const memberDashboard = await getMemberDashboardByEmail(
              decoded.email || "",
              decoded.phone || "",
              decoded.sub,
              decoded.church_id,
            );
            if (memberDashboard?.member?.id) {
              linkedMemberId = memberDashboard.member.id;
            }
          }
        }
      }
    } catch {
      // Token invalid/expired — fall back to anonymous public donation.
    }

    // Generate receipt number for the public donation
    const receiptNumber = createReceiptNumber({
      member_id: linkedMemberId || "PUBLIC",
      payment_date: new Date().toISOString(),
      transaction_id: razorpay_payment_id,
    });

    // Store public donation WITH church_id
    const { data, error } = await db
      .from("payments")
      .insert([{
        member_id: linkedMemberId,
        subscription_id: null,
        church_id: churchId,
        amount: verifiedAmount,
        payment_method: linkedMemberId ? "donation" : "public_donation",
        transaction_id: razorpay_payment_id,
        payment_status: "success",
        payment_date: new Date().toISOString(),
        fund_name: fund || null,
        receipt_number: receiptNumber,
      }])
      .select("id")
      .single<{ id: string }>();

    if (error) {
      if (error.code === "23505") {
        const { data: existingAfterConflict } = await db
          .from("payments")
          .select("id, receipt_number")
          .eq("transaction_id", razorpay_payment_id)
          .maybeSingle<{ id: string; receipt_number: string | null }>();

        if (existingAfterConflict) {
          return res.status(200).json({
            success: true,
            status: "already_processed",
            payment_id: existingAfterConflict.id,
            receipt_number: existingAfterConflict.receipt_number,
          });
        }
      }
      throw error;
    }

    const storedFee = Number(razorpayOrder.notes?.platform_fee || 0);
    const storedPct = Number(razorpayOrder.notes?.platform_fee_pct || 0);
    if (data?.id && storedFee > 0) {
      try {
        await db
          .from("platform_fee_collections")
          .insert([{
            church_id: churchId,
            payment_id: data.id,
            member_id: linkedMemberId,
            base_amount: verifiedAmount - storedFee,
            fee_percentage: storedPct,
            fee_amount: storedFee,
          }]);
      } catch (feeErr) {
        logger.warn({ err: feeErr, paymentId: data.id }, "Public donation platform fee recording failed");
      }
    }

    // Store donor details in subscription_events for admin visibility
    try {
      await db
        .from("subscription_events")
        .insert([{
          member_id: null as any,
          subscription_id: null,
          church_id: churchId,
          event_type: "public_donation",
          status_after: "success",
          amount: verifiedAmount,
          source: "public_donation_page",
          metadata: {
            payment_id: data?.id,
            donor_name: donorName,
            donor_email: donorEmail,
            donor_phone: donorPhone,
            fund,
            message,
            receipt_number: receiptNumber,
            transaction_id: razorpay_payment_id,
          },
        }]);
    } catch {
      // Non-critical: don't fail the donation if event logging fails
    }

    return res.json({ success: true, payment_id: data?.id, receipt_number: receiptNumber });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to verify donation") });
  }
});

export default router;
