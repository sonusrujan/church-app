import { db, getClient } from "./dbClient";
import { logger } from "../utils/logger";
import { createReceiptNumber } from "./receiptService";
import { recordSubscriptionEvent } from "./subscriptionTrackingService";
import { computeNextDueDate } from "../utils/subscriptionHelpers";
import { allocateOldestPendingMonthsAtomic, reversePaymentAllocations } from "./subscriptionMonthlyDuesService";

// ── Manual Payment Recording ──

export interface ManualPaymentInput {
  member_id: string;
  subscription_id?: string | null;
  amount: number;
  payment_method: string; // cash, bank_transfer, upi_manual, cheque, other
  payment_date: string;
  payment_category?: string; // subscription, donation, other
  note?: string;
  recorded_by: string; // admin user_id
  church_id: string; // required for tenant isolation
}

const ALLOWED_MANUAL_METHODS = ["cash", "bank_transfer", "upi_manual", "cheque", "other"];

// Maximum manual payment amount (₹500,000) — prevents unbounded fraud
const MAX_MANUAL_PAYMENT_AMOUNT = 500_000;

export async function recordManualPayment(input: ManualPaymentInput) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  if (input.amount > MAX_MANUAL_PAYMENT_AMOUNT) {
    throw new Error(`Manual payment amount cannot exceed ₹${MAX_MANUAL_PAYMENT_AMOUNT.toLocaleString("en-IN")}`);
  }
  if (!ALLOWED_MANUAL_METHODS.includes(input.payment_method)) {
    throw new Error(`payment_method must be one of: ${ALLOWED_MANUAL_METHODS.join(", ")}`);
  }
  if (!input.church_id) {
    throw new Error("church_id is required");
  }

  // Verify member exists and belongs to the caller's church
  const { data: member, error: memberErr } = await db
    .from("members")
    .select("id, church_id, verification_status")
    .eq("id", input.member_id)
    .eq("church_id", input.church_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member) throw new Error("Member not found or does not belong to your church");

  // Prevent payments for rejected or suspended members
  if (member.verification_status === "rejected" || member.verification_status === "suspended") {
    throw new Error(`Cannot record payment for a ${member.verification_status} member. Update their status first.`);
  }

  // Enforce church minimum subscription amount if linked to a subscription
  if (input.subscription_id && member.church_id) {
    const { data: church } = await db
      .from("churches")
      .select("subscription_minimum")
      .eq("id", member.church_id)
      .maybeSingle();

    const minAmount = Number(church?.subscription_minimum || 0);
    if (minAmount > 0 && input.amount < minAmount) {
      throw new Error(`Amount must be at least ₹${minAmount.toFixed(2)} (church minimum)`);
    }
  }

  let subscriptionMonthlyAmount = 0;
  let subscriptionPersonName = "Member";

  // If subscription_id provided, verify it belongs to the member (directly or via family link)
  if (input.subscription_id) {
    const { data: sub } = await db
      .from("subscriptions")
      .select("id, member_id, family_member_id, amount, status")
      .eq("id", input.subscription_id)
      .maybeSingle<{ id: string; member_id: string; family_member_id: string | null; amount: number | string; status: string }>();
    if (!sub) throw new Error("Subscription not found");

    // H5: Reject payments on cancelled/expired subscriptions
    if (sub.status === "cancelled" || sub.status === "expired") {
      throw new Error(`Cannot record payment for a ${sub.status} subscription. Reactivate it first.`);
    }

    subscriptionMonthlyAmount = Number(sub.amount || 0);
    if (!Number.isFinite(subscriptionMonthlyAmount) || subscriptionMonthlyAmount <= 0) {
      throw new Error("Subscription has invalid monthly amount");
    }

    // Allow if subscription belongs directly to this member
    let subscriptionOk = sub.member_id === input.member_id;

    // Also allow if the member is the linked family member for this subscription
    if (!subscriptionOk && sub.family_member_id) {
      const { data: famLink } = await db
        .from("family_members")
        .select("id")
        .eq("id", sub.family_member_id)
        .eq("linked_to_member_id", input.member_id)
        .maybeSingle();
      if (famLink) subscriptionOk = true;
    }

    if (!subscriptionOk) throw new Error("Subscription not found or does not belong to this member");

    if (sub.member_id === input.member_id) {
      const { data: memberNameRow } = await db.from("members").select("full_name").eq("id", input.member_id).maybeSingle();
      subscriptionPersonName = memberNameRow?.full_name || "Member";
    } else if (sub.family_member_id) {
      const { data: familyRow } = await db.from("family_members").select("full_name").eq("id", sub.family_member_id).maybeSingle();
      subscriptionPersonName = familyRow?.full_name || "Family Member";
    }

    const isSubscriptionPayment = (input.payment_category || "") === "subscription" || !input.payment_category;
    if (isSubscriptionPayment) {
      const multiple = input.amount / subscriptionMonthlyAmount;
      if (!Number.isInteger(multiple) || multiple <= 0) {
        throw new Error(`Subscription payment amount must be an exact multiple of monthly amount ₹${subscriptionMonthlyAmount}`);
      }
    }
  }

  // Auto-match: if no subscription_id provided but category is "subscription", try to find a matching one
  // Business rule: each member has at most ONE active/pending subscription (enforced at creation).
  // So auto-match should find exactly 0 or 1. If multiple exist (legacy data), require explicit selection.
  if (!input.subscription_id && (input.payment_category === "subscription" || !input.payment_category)) {
    const candidates: Array<{ id: string; member_id: string; family_member_id: string | null; amount: string | number; status: string }> = [];

    // First check family-linked subscriptions (prioritized, since family members' payments
    // should go against the family subscription managed by the head)
    const { data: familyLink } = await db
      .from("family_members")
      .select("id, member_id")
      .eq("linked_to_member_id", input.member_id)
      .maybeSingle<{ id: string; member_id: string }>();

    if (familyLink) {
      const { data: familySubs } = await db
        .from("subscriptions")
        .select("id, member_id, family_member_id, amount, status")
        .eq("family_member_id", familyLink.id)
        .in("status", ["pending_first_payment", "overdue", "active"]);

      for (const s of familySubs || []) {
        if (Number((s as any).amount) === input.amount) candidates.push(s as any);
      }
    }

    // Fall back to the member's own direct subscriptions (only if no family match)
    if (!candidates.length) {
      const { data: candidateSubs } = await db
        .from("subscriptions")
        .select("id, member_id, family_member_id, amount, status")
        .eq("member_id", input.member_id)
        .in("status", ["pending_first_payment", "overdue", "active"])
        .order("start_date", { ascending: false });

      for (const s of candidateSubs || []) {
        if (Number((s as any).amount) === input.amount) candidates.push(s as any);
      }
    }

    if (candidates.length === 1) {
      const matched = candidates[0];
      input.subscription_id = matched.id;
      if (!input.payment_category) input.payment_category = "subscription";
      logger.info({ memberId: input.member_id, subscriptionId: matched.id }, "Auto-matched manual payment to subscription");
    } else if (candidates.length > 1) {
      logger.warn({ memberId: input.member_id, candidateCount: candidates.length, amount: input.amount }, "Multiple subscriptions match amount – explicit subscription_id required");
      throw new Error(`Ambiguous: ${candidates.length} subscriptions match ₹${input.amount}. Please select the specific subscription to record this payment against.`);
    }
  }

  // Idempotency: prevent duplicate manual payments for same member/amount/date/method
  {
    const { data: existing } = await db
      .from("payments")
      .select("id, receipt_number, subscription_id")
      .eq("member_id", input.member_id)
      .eq("amount", input.amount)
      .eq("payment_date", input.payment_date)
      .eq("payment_method", `manual_${input.payment_method}`)
      .eq("payment_status", "success")
      .maybeSingle<{ id: string; receipt_number: string | null; subscription_id: string | null }>();

    if (existing) {
      // If the existing payment has no subscription linked but we now have one from auto-match, backfill it
      if (!existing.subscription_id && input.subscription_id) {
        await db
          .from("payments")
          .update({ subscription_id: input.subscription_id, payment_category: "subscription" })
          .eq("id", existing.id);

        // Also activate the subscription
        const { data: sub } = await db
          .from("subscriptions")
          .select("billing_cycle, next_payment_date, status")
          .eq("id", input.subscription_id)
          .single<{ billing_cycle: string; next_payment_date: string; status: string }>();

        if (sub) {
          const nextDue = computeNextDueDate(sub.next_payment_date, sub.billing_cycle);
          await db
            .from("subscriptions")
            .update({ status: "active", next_payment_date: nextDue })
            .eq("id", input.subscription_id);
          logger.info({ paymentId: existing.id, subscriptionId: input.subscription_id, nextDue }, "Backfilled subscription link on existing duplicate payment");
        }
      } else {
        logger.info({ memberId: input.member_id, paymentId: existing.id }, "Duplicate manual payment detected, returning existing");
      }
      return { id: existing.id, receipt_number: existing.receipt_number || "" };
    }
  }

  // Generate deterministic transaction_id for manual payments to prevent concurrent duplicates via DB constraint
  const manualTxnId = `manual_${input.member_id}_${input.amount}_${input.payment_date}_${input.payment_method}`;

  const receiptNumber = createReceiptNumber({
    member_id: input.member_id,
    payment_date: input.payment_date,
    transaction_id: manualTxnId,
  });

  const payload: Record<string, unknown> = {
    member_id: input.member_id,
    subscription_id: input.subscription_id || null,
    church_id: input.church_id,
    amount: input.amount,
    payment_method: `manual_${input.payment_method}`,
    transaction_id: manualTxnId,
    payment_status: "success",
    payment_date: input.payment_date,
    payment_category: input.payment_category || "other",
    receipt_number: receiptNumber,
    receipt_generated_at: new Date().toISOString(),
  };

  // Wrap payment insert + subscription update in a transaction for atomicity
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // Insert payment
    const cols = Object.keys(payload);
    const vals = Object.values(payload);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    const colNames = cols.map((c) => `"${c}"`).join(", ");
    const insertResult = await client.query(
      `INSERT INTO "payments" (${colNames}) VALUES (${placeholders}) RETURNING "id", "receipt_number"`,
      vals,
    );
    const data = insertResult.rows[0] as { id: string; receipt_number: string };

    // Allocate months within the SAME transaction (no early COMMIT)
    if (input.subscription_id) {
      const monthsToAllocate = Math.max(1, Math.floor(input.amount / subscriptionMonthlyAmount));
      await allocateOldestPendingMonthsAtomic({
        payment_id: data.id,
        subscription_id: input.subscription_id,
        member_id: input.member_id,
        church_id: input.church_id,
        monthly_amount: subscriptionMonthlyAmount,
        months_to_allocate: monthsToAllocate,
        person_name: subscriptionPersonName,
        existingClient: client,
      });

      try {
        await recordSubscriptionEvent({
          member_id: input.member_id,
          subscription_id: input.subscription_id,
          church_id: input.church_id,
          event_type: "payment_recorded",
          status_before: null,
          status_after: "active",
          amount: input.amount,
          source: "admin_manual",
          metadata: {
            payment_method: `manual_${input.payment_method}`,
            recorded_by: input.recorded_by,
            note: input.note || null,
            receipt_number: data.receipt_number,
            months_allocated: monthsToAllocate,
          },
        });
      } catch (e) {
        logger.warn({ err: e, subscriptionId: input.subscription_id }, "recordSubscriptionEvent failed for manual payment");
      }
    }

    // COMMIT only after both payment + allocation succeed
    await client.query("COMMIT");

    return { payment_id: data.id, receipt_number: data.receipt_number, church_id: member.church_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if ((err as any).code === "23505") {
      // Unique constraint violation — duplicate manual payment
      const { data: existing } = await db
        .from("payments")
        .select("id, receipt_number")
        .eq("transaction_id", manualTxnId)
        .eq("member_id", input.member_id)
        .maybeSingle<{ id: string; receipt_number: string | null }>();
      if (existing) return { id: existing.id, receipt_number: existing.receipt_number || "" };
    }
    logger.error({ err }, "recordManualPayment failed");
    throw err;
  } finally {
    client.release();
  }
}

// ── Refund Tracking ──

export interface RecordRefundInput {
  payment_id: string;
  refund_amount: number;
  refund_reason?: string;
  refund_method: string; // razorpay, cash, bank_transfer, other
  recorded_by: string;
  church_id?: string; // required for admin-initiated refunds
}

export async function recordRefund(input: RecordRefundInput) {
  if (!Number.isFinite(input.refund_amount) || input.refund_amount <= 0) {
    throw new Error("refund_amount must be a positive number");
  }

  const { data: payment, error: payErr } = await db
    .from("payments")
    .select("id, member_id, amount, payment_status, subscription_id, transaction_id, payment_method")
    .eq("id", input.payment_id)
    .maybeSingle<{
      id: string;
      member_id: string;
      amount: number;
      payment_status: string;
      subscription_id: string | null;
      transaction_id: string | null;
      payment_method: string | null;
    }>();

  if (payErr) throw payErr;
  if (!payment) throw new Error("Payment not found");

  // Verify the payment's member belongs to the caller's church
  if (input.church_id) {
    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", payment.member_id)
      .maybeSingle();
    if (!member || member.church_id !== input.church_id) {
      throw new Error("Payment does not belong to your church");
    }
  }

  // PAY-11: Platform fee is non-refundable — cap refundable amount at (total - platform_fee - prior_refunds)
  let platformFee = 0;
  const { data: feeRow } = await db
    .from("platform_fee_collections")
    .select("fee_amount")
    .eq("payment_id", input.payment_id)
    .maybeSingle<{ fee_amount: number }>();
  if (feeRow) platformFee = Number(feeRow.fee_amount) || 0;

  // Deduct already-issued refunds to prevent refund replay
  const { data: priorRefunds } = await db
    .from("payment_refunds")
    .select("refund_amount")
    .eq("payment_id", input.payment_id);
  const totalPriorRefunds = (priorRefunds || []).reduce(
    (sum: number, r: { refund_amount: number }) => sum + (Number(r.refund_amount) || 0), 0
  );

  const maxRefundable = Number(payment.amount) - platformFee - totalPriorRefunds;
  if (input.refund_amount > maxRefundable) {
    throw new Error(
      platformFee > 0
        ? `Refund cannot exceed ₹${maxRefundable.toFixed(2)} (platform fee of ₹${platformFee.toFixed(2)} is non-refundable)`
        : "Refund amount cannot exceed original payment amount"
    );
  }

  const normalizedPaymentMethod = String(payment.payment_method || "").toLowerCase();
  const isRazorpayPayment = normalizedPaymentMethod === "razorpay";

  if (isRazorpayPayment && input.refund_method !== "razorpay") {
    throw new Error("Razorpay payments must be refunded through Razorpay to keep records in sync");
  }

  let gatewayRefundId: string | null = null;
  if (isRazorpayPayment) {
    if (!payment.transaction_id) {
      throw new Error("Cannot refund Razorpay payment because the gateway payment ID is missing");
    }

    const Razorpay = (await import("razorpay")).default;
    const { getEffectivePaymentConfig } = await import("./churchPaymentService");
    const gatewayConfig = await getEffectivePaymentConfig(input.church_id || null);
    if (!gatewayConfig.payments_enabled || !gatewayConfig.key_id || !gatewayConfig.key_secret) {
      throw new Error("Razorpay credentials are not configured for refunds");
    }

    const client = new Razorpay({
      key_id: gatewayConfig.key_id,
      key_secret: gatewayConfig.key_secret,
    });

    try {
      const refund = await (client.payments as any).refund(payment.transaction_id, {
        amount: Math.round(input.refund_amount * 100),
        notes: {
          payment_id: input.payment_id,
          member_id: payment.member_id,
          refund_reason: input.refund_reason || "",
        },
      });
      gatewayRefundId = String(refund?.id || "") || null;
    } catch (err: any) {
      logger.error({ err, paymentId: input.payment_id, transactionId: payment.transaction_id }, "Razorpay refund failed");
      throw new Error(err?.error?.description || err?.message || "Razorpay refund failed");
    }
  }

  // Update payment status and insert refund record atomically
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const newStatus = input.refund_amount >= maxRefundable ? "refunded" : "partially_refunded";
    const updateResult = await client.query(
      `UPDATE "payments" SET "payment_status" = $1 WHERE "id" = $2`,
      [newStatus, input.payment_id],
    );

    if (updateResult.rowCount === 0) {
      throw new Error("Failed to update payment status");
    }

    const refundResult = await client.query(
      `INSERT INTO "payment_refunds" ("payment_id", "member_id", "refund_amount", "refund_reason", "refund_method", "recorded_by")
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING "id"`,
      [
        input.payment_id,
        payment.member_id,
        input.refund_amount,
        gatewayRefundId
          ? [input.refund_reason || null, `Razorpay refund ID: ${gatewayRefundId}`].filter(Boolean).join(" | ")
          : input.refund_reason || null,
        isRazorpayPayment ? "razorpay" : input.refund_method,
        input.recorded_by,
      ],
    );

    await client.query("COMMIT");

    const refundId = refundResult.rows[0]?.id;

    // Issue #7: Reverse monthly dues allocations on full refund
    if (newStatus === "refunded") {
      try {
        const reversed = await reversePaymentAllocations(input.payment_id);
        logger.info({ paymentId: input.payment_id, reversed }, "Reversed payment allocations on full refund");
      } catch (revErr) {
        logger.warn({ err: revErr, paymentId: input.payment_id }, "Failed to reverse allocations on refund");
      }
    }

    try {
      await recordSubscriptionEvent({
        member_id: payment.member_id,
        subscription_id: payment.subscription_id,
        event_type: "refund_recorded",
        status_after: "refunded",
        amount: input.refund_amount,
        source: "admin_manual",
        metadata: {
          payment_id: input.payment_id,
          refund_method: input.refund_method,
          refund_reason: input.refund_reason || null,
          recorded_by: input.recorded_by,
        },
      });
    } catch (e) {
      logger.warn({ err: e }, "refund event insert failed");
    }

    return { refund_id: refundId, payment_id: input.payment_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "recordRefund transaction failed");
    throw err;
  } finally {
    client.release();
  }
}

// ── Edit Manual Payment (within 48h, manual-only) ──

export interface EditManualPaymentInput {
  payment_id: string;
  amount?: number;
  payment_method?: string;
  payment_date?: string;
  note?: string;
  church_id: string;
  edited_by: string;
}

export async function editManualPayment(input: EditManualPaymentInput) {
  const { payment_id, church_id, edited_by } = input;

  // Fetch the payment
  const { data: payment, error: fetchErr } = await db
    .from("payments")
    .select("id, member_id, amount, payment_method, payment_date, payment_status, payment_category, created_at, note")
    .eq("id", payment_id)
    .maybeSingle();

  if (fetchErr || !payment) throw new Error("Payment not found");

  // Only manual payments can be edited
  const manualMethods = ["manual_cash", "manual_bank_transfer", "manual_upi_manual", "manual_cheque", "manual_other"];
  if (!manualMethods.includes(payment.payment_method)) {
    throw new Error("Only manual payments can be edited. Use refund for online payments.");
  }

  // Only successful payments
  if (payment.payment_status !== "success") {
    throw new Error("Only successful payments can be edited");
  }

  // Verify member belongs to church
  const { data: member } = await db
    .from("members")
    .select("id, church_id")
    .eq("id", payment.member_id)
    .maybeSingle();
  if (!member || member.church_id !== church_id) {
    throw new Error("Payment does not belong to your church");
  }

  // Only within 48 hours of recording
  const createdAt = new Date(payment.created_at);
  const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreation > 48) {
    throw new Error("Manual payments can only be edited within 48 hours of recording. Use refund instead.");
  }

  // Check no refunds have been issued
  const { data: refunds } = await db
    .from("payment_refunds")
    .select("id")
    .eq("payment_id", payment_id)
    .limit(1);
  if (refunds && refunds.length > 0) {
    throw new Error("Cannot edit a payment that has refunds. Void the refund first.");
  }

  // Build update
  const patch: Record<string, unknown> = {};
  if (typeof input.amount === "number") {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("amount must be a positive number");
    if (input.amount > 500_000) throw new Error("amount cannot exceed ₹5,00,000");
    patch.amount = input.amount;
  }
  if (input.payment_method) {
    const allowed = ["cash", "bank_transfer", "upi_manual", "cheque", "other"];
    if (!allowed.includes(input.payment_method)) throw new Error("Invalid payment method");
    patch.payment_method = `manual_${input.payment_method}`;
  }
  if (input.payment_date) {
    const d = new Date(input.payment_date);
    if (isNaN(d.getTime())) throw new Error("Invalid payment_date");
    patch.payment_date = d.toISOString().slice(0, 10);
  }
  if (typeof input.note === "string") {
    patch.note = input.note.trim().slice(0, 1000);
  }

  if (!Object.keys(patch).length) throw new Error("No fields to update");

  const { data: updated, error: updateErr } = await db
    .from("payments")
    .update(patch)
    .eq("id", payment_id)
    .select("id, amount, payment_method, payment_date, note")
    .single();

  if (updateErr) {
    logger.error({ err: updateErr, payment_id }, "editManualPayment failed");
    throw updateErr;
  }

  logger.info({ payment_id, edited_by, changes: patch }, "Manual payment edited");
  return updated;
}

// ── Void Manual Payment (within 48h, manual-only) ──

export async function voidManualPayment(paymentId: string, churchId: string, voidedBy: string) {
  // Fetch the payment
  const { data: payment, error: fetchErr } = await db
    .from("payments")
    .select("id, member_id, amount, payment_method, payment_status, created_at")
    .eq("id", paymentId)
    .maybeSingle();

  if (fetchErr || !payment) throw new Error("Payment not found");

  const manualMethods = ["manual_cash", "manual_bank_transfer", "manual_upi_manual", "manual_cheque", "manual_other"];
  if (!manualMethods.includes(payment.payment_method)) {
    throw new Error("Only manual payments can be voided");
  }
  if (payment.payment_status !== "success") {
    throw new Error("Only successful payments can be voided");
  }

  // Verify member belongs to church
  const { data: member } = await db
    .from("members")
    .select("id, church_id")
    .eq("id", payment.member_id)
    .maybeSingle();
  if (!member || member.church_id !== churchId) {
    throw new Error("Payment does not belong to your church");
  }

  // Only within 48 hours
  const createdAt = new Date(payment.created_at);
  const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceCreation > 48) {
    throw new Error("Manual payments can only be voided within 48 hours. Use refund instead.");
  }

  // Mark as voided
  const { error: updateErr } = await db
    .from("payments")
    .update({ payment_status: "voided" })
    .eq("id", paymentId);

  if (updateErr) {
    logger.error({ err: updateErr, paymentId }, "voidManualPayment failed");
    throw updateErr;
  }

  // Reverse any monthly dues allocations
  try {
    await reversePaymentAllocations(paymentId);
  } catch (e) {
    logger.warn({ err: e, paymentId }, "voidManualPayment: reversePaymentAllocations failed (non-fatal)");
  }

  logger.info({ paymentId, voidedBy }, "Manual payment voided");
  return { voided: true, id: paymentId };
}

// ── Per-Member Payment History ──

export async function getMemberPaymentHistory(memberId: string, churchId: string, limit = 100, offset = 0) {
  if (!churchId) throw new Error("churchId is required");

  // Verify member belongs to the church
  const { data: member } = await db
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!member) throw new Error("Member not found or does not belong to your church");

  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeOffset = Math.max(offset, 0);

  const { data, error } = await db
    .from("payments")
    .select("id, member_id, subscription_id, amount, payment_method, transaction_id, payment_status, payment_date, receipt_number, payment_category")
    .eq("member_id", memberId)
    .order("payment_date", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (error) {
    logger.error({ err: error, memberId }, "getMemberPaymentHistory failed");
    throw error;
  }

  return data || [];
}

// ── Subscription Edit ──

export interface UpdateSubscriptionInput {
  amount?: number;
  billing_cycle?: "monthly" | "yearly";
  next_payment_date?: string;
  status?: "active" | "paused" | "cancelled" | "overdue" | "pending_first_payment";
  plan_name?: string;
}

export async function updateSubscription(subscriptionId: string, input: UpdateSubscriptionInput, churchId?: string) {
  // If churchId provided, verify the subscription's member belongs to that church
  if (churchId) {
    const { data: sub } = await db
      .from("subscriptions")
      .select("id, member_id")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (!sub) throw new Error("Subscription not found");

    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", sub.member_id)
      .maybeSingle();
    if (!member || member.church_id !== churchId) {
      throw new Error("Subscription does not belong to your church");
    }
  }

  const patch: Record<string, unknown> = {};

  if (typeof input.amount === "number") {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("amount must be a positive number");
    }
    patch.amount = input.amount;
  }
  if (input.billing_cycle) {
    if (!["monthly", "yearly"].includes(input.billing_cycle)) {
      throw new Error("billing_cycle must be monthly or yearly");
    }
    patch.billing_cycle = input.billing_cycle;
  }
  if (input.next_payment_date) {
    const d = new Date(input.next_payment_date);
    if (isNaN(d.getTime())) throw new Error("Invalid next_payment_date");
    patch.next_payment_date = d.toISOString().slice(0, 10);
  }
  if (input.status) {
    const valid = ["active", "paused", "cancelled", "overdue", "pending_first_payment"];
    if (!valid.includes(input.status)) throw new Error(`status must be one of: ${valid.join(", ")}`);
    patch.status = input.status;
  }
  if (typeof input.plan_name === "string") {
    patch.plan_name = input.plan_name.trim();
  }

  if (!Object.keys(patch).length) {
    throw new Error("No subscription fields provided to update");
  }

  const { data, error } = await db
    .from("subscriptions")
    .update(patch)
    .eq("id", subscriptionId)
    .select("id, member_id, plan_name, amount, billing_cycle, start_date, next_payment_date, status")
    .single();

  if (error) {
    logger.error({ err: error, subscriptionId }, "updateSubscription failed");
    throw error;
  }

  return data;
}
