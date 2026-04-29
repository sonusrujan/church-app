import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin, isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { requireAdminOrSuper } from "../middleware/requireAdminOrSuper";
import { safeErrorMessage } from "../utils/safeError";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { logger } from "../utils/logger";
import { toCsvRow } from "../utils/csv";
import { db, pool } from "../services/dbClient";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import { normalizeIndianPhone } from "../utils/phone";
import { MIN_PAYMENT_DATE } from "../config";

const adminWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const bulkImportLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many bulk import requests, please try again later" },
});

import {
  recordManualPayment,
  recordRefund,
  getMemberPaymentHistory,
  updateSubscription,
  editManualPayment,
  voidManualPayment,
} from "../services/paymentAdminService";
import { listMonthlyHistoryForMember, toggleDueStatus } from "../services/subscriptionMonthlyDuesService";
import { validate, manualPaymentSchema, updateSubscriptionSchema, refundSchema, updateAnnouncementSchema, updateChurchCodeSchema, bulkImportMembersSchema, relinkAuthSchema, createRefundRequestSchema, reviewRefundRequestSchema } from "../utils/zodSchemas";

import {
  updateAnnouncement,
  deleteAnnouncement,
  clearAllAnnouncements,
} from "../services/announcementService";

import {
  deleteChurchEvent,
  deleteChurchNotification,
  deletePrayerRequest,
} from "../services/engagementService";

import { restoreChurch, updateChurch } from "../services/churchService";
import { restoreMember, listDeletedMembers } from "../services/memberService";
import {
  createRefundRequest,
  listRefundRequests,
  forwardRefundRequest,
  reviewRefundRequest,
  getMemberRefundRequests,
} from "../services/refundRequestService";

const router = Router();

function resolveChurchId(req: AuthRequest, bodyOrQueryChurchId?: string): string {
  if (isSuperAdminEmail(req.user?.email || "", req.user?.phone)) {
    const resolved = bodyOrQueryChurchId?.trim() || req.user?.church_id || "";
    if (!resolved) throw new Error("church_id is required for super admin operations");
    // MED-005: Validate UUID format
    if (!UUID_REGEX.test(resolved)) throw new Error("Invalid church_id format");
    return resolved;
  }
  return req.user?.church_id || "";
}

// ═══ Manual Payment Recording ═══

router.post("/payments/manual", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, validate(manualPaymentSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const { member_id, subscription_id, amount, payment_method, payment_date, payment_category, note } = req.body;

    // Validate payment_date is a valid date and within a reasonable range
    const parsedPaymentDate = new Date(payment_date);
    if (isNaN(parsedPaymentDate.getTime())) {
      return res.status(400).json({ error: "payment_date must be a valid date" });
    }
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysDiff = (now.getTime() - parsedPaymentDate.getTime()) / msPerDay;
    if (daysDiff < -1) {
      return res.status(400).json({ error: "payment_date cannot be in the future" });
    }
    const minAllowed = new Date(`${MIN_PAYMENT_DATE}T00:00:00.000Z`);
    if (parsedPaymentDate.getTime() < minAllowed.getTime()) {
      return res.status(400).json({ error: `payment_date cannot be before ${MIN_PAYMENT_DATE}` });
    }

    const ALLOWED_METHODS = ["cash", "cheque", "bank_transfer", "upi_manual", "other"];
    if (!ALLOWED_METHODS.includes(payment_method)) {
      return res.status(400).json({ error: `Invalid payment_method. Allowed: ${ALLOWED_METHODS.join(", ")}` });
    }

    // Church-scoping for non-super admins
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: member } = await db
        .from("members")
        .select("id, church_id")
        .eq("id", member_id)
        .maybeSingle();
      if (!member || member.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Member does not belong to your church" });
      }
    }

    const churchId = resolveChurchId(req, req.body?.church_id);

    // M-4: Idempotency — prevent duplicate manual payments within 60s window
    const { rows: dupes } = await pool.query(
      `SELECT id FROM payments
       WHERE member_id = $1
         AND amount = $2
         AND payment_method = $3
         AND DATE(payment_date) = DATE($4::timestamp)
         AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [member_id, Number(amount), payment_method, payment_date],
    );
    if (dupes.length > 0) {
      return res.status(409).json({ error: "Duplicate payment detected. This payment was already recorded." });
    }

    // Enforce member_subscription_enabled when manual payment is linked to a subscription
    if (subscription_id) {
      const cid = churchId || req.user.church_id;
      if (cid) {
        const saasSettings = await getChurchSaaSSettings(cid);
        if (!saasSettings.member_subscription_enabled) {
          return res.status(403).json({ error: "Member subscriptions are disabled for this church" });
        }
      }
    }

    const result = await recordManualPayment({
      member_id,
      subscription_id: subscription_id || null,
      amount: Number(amount),
      payment_method,
      payment_date,
      payment_category: payment_category || "other",
      note: note || undefined,
      recorded_by: req.user.id,
      church_id: churchId || req.user.church_id,
    });

    logSuperAdminAudit(req, "payment.manual.record", {
      member_id,
      payment_id: result.payment_id,
      amount,
      payment_method,
    });
    persistAuditLog(req, "payment.manual.record", "payment", result.payment_id, {
      member_id, amount, payment_method,
    });

    // Notify member about manual payment
    try {
      const { data: memberRow } = await db.from("members").select("user_id, church_id").eq("id", member_id).maybeSingle();
      if (memberRow?.user_id && memberRow?.church_id) {
        const { queueNotification } = await import("../services/notificationService");
        queueNotification({
          church_id: memberRow.church_id,
          recipient_user_id: memberRow.user_id,
          channel: "push",
          notification_type: "payment_success",
          subject: "Payment Recorded",
          body: `Your ${payment_method} payment of ₹${Number(amount)} has been recorded successfully.`,
          metadata: { url: "/history" },
        }).catch((err) => { logger.warn({ err }, "Failed to send manual payment notification"); });
      }
    } catch (_) {}

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to record manual payment") });
  }
});

// ═══ Refund Recording ═══

router.post("/payments/:paymentId/refund", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, validate(refundSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    // LOW-006: Remove dead Array.isArray guard on Express params
    const paymentId = String(req.params.paymentId || "").trim();
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const { refund_amount, refund_reason, refund_method: incomingMethod } = req.body;

    // Validate refund amount does not exceed original payment
    const { data: origPayment } = await db
      .from("payments")
      .select("id, amount, payment_method")
      .eq("id", paymentId)
      .maybeSingle();
    if (!origPayment) return res.status(404).json({ error: "Payment not found" });

    // Resolve "original_method" to the payment's actual original method.
    // This is what the admin UI sends when it wants to mirror the original route.
    let refund_method = incomingMethod;
    if (refund_method === "original_method") {
      const origMethod = String(origPayment.payment_method || "").toLowerCase();
      if (origMethod === "razorpay") {
        refund_method = "razorpay";
      } else if (origMethod.startsWith("manual_cash") || origMethod === "cash") {
        refund_method = "cash";
      } else if (origMethod.includes("bank")) {
        refund_method = "bank_transfer";
      } else if (origMethod.includes("upi")) {
        refund_method = "upi";
      } else {
        refund_method = "other";
      }
    }

    // MED-002: Cumulative refund check — prevent double-spend via multiple partial refunds
    const { rows: prevRefunds } = await pool.query(
      `SELECT COALESCE(SUM(refund_amount), 0) AS total_refunded FROM payment_refunds WHERE payment_id = $1`,
      [paymentId]
    );
    const totalRefunded = Number(prevRefunds[0]?.total_refunded || 0);
    const requestedRefund = Number(refund_amount);
    if (totalRefunded + requestedRefund > Number(origPayment.amount)) {
      return res.status(400).json({
        error: `Total refunds would exceed original payment amount (₹${origPayment.amount})`,
      });
    }

    // Church-scoping for non-super admins: verify payment belongs to their church
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: payment } = await db
        .from("payments")
        .select("id, member_id")
        .eq("id", paymentId)
        .maybeSingle();
      if (!payment) return res.status(404).json({ error: "Payment not found" });
      const { data: member } = await db
        .from("members")
        .select("id, church_id")
        .eq("id", payment.member_id)
        .maybeSingle();
      if (!member || member.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Payment does not belong to your church" });
      }
    }

    const result = await recordRefund({
      payment_id: paymentId,
      refund_amount: Number(refund_amount),
      refund_reason: refund_reason || undefined,
      refund_method,
      recorded_by: req.user.id,
      church_id: req.user.church_id || undefined,
    });

    logSuperAdminAudit(req, "payment.refund.record", {
      payment_id: paymentId,
      refund_amount,
      refund_method,
    });
    persistAuditLog(req, "payment.refund.record", "payment", paymentId, {
      refund_amount, refund_method,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to record refund") });
  }
});

// ═══ Per-Member Payment History ═══

router.get("/payments/member/:memberId", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const memberId = String(req.params.memberId || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    // Resolve church_id: super admins look it up from the member record
    let churchId = req.user.church_id || "";
    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", memberId)
      .maybeSingle();

    if (!member) return res.status(404).json({ error: "Member not found" });

    if (isSuperAdminEmail(req.user.email, req.user.phone)) {
      churchId = member.church_id;
    } else if (member.church_id !== req.user.church_id) {
      return res.status(403).json({ error: "Member does not belong to your church" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = Number(req.query.offset) || 0;
    const payments = await getMemberPaymentHistory(memberId, churchId, limit, offset);
    return res.json(payments);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load payment history") });
  }
});

router.get("/payments/member/:memberId/monthly-history", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const memberId = String(req.params.memberId || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", memberId)
      .maybeSingle();

    if (!member) return res.status(404).json({ error: "Member not found" });

    if (!isSuperAdminEmail(req.user.email, req.user.phone) && member.church_id !== req.user.church_id) {
      return res.status(403).json({ error: "Member does not belong to your church" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const personName = typeof req.query.person_name === "string" ? req.query.person_name.trim() : "";

    const rows = await listMonthlyHistoryForMember({
      member_id: memberId,
      person_name: personName || undefined,
      limit,
      offset,
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load monthly payment history") });
  }
});

// ═══ Subscription Edit ═══

router.patch("/subscriptions/:subId", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, validate(updateSubscriptionSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const subId = String(req.params.subId || "").trim();
    if (!subId || !UUID_REGEX.test(subId)) {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    // Validate status enum if provided
    const ALLOWED_SUB_STATUSES = ["active", "paused", "cancelled", "overdue", "pending_first_payment"];
    if (req.body.status && !ALLOWED_SUB_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_SUB_STATUSES.join(", ")}` });
    }

    // Prevent admin from directly setting subscription to "active" — must go through payment flow
    if (req.body.status === "active") {
      return res.status(403).json({ error: "Cannot directly set subscription to active. Status is updated automatically when payment is recorded." });
    }

    // Church-scoping for non-super admins
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: sub } = await db
        .from("subscriptions")
        .select("id, member_id")
        .eq("id", subId)
        .maybeSingle();
      if (!sub) return res.status(404).json({ error: "Subscription not found" });

      const { data: member } = await db
        .from("members")
        .select("id, church_id")
        .eq("id", sub.member_id)
        .maybeSingle();
      if (!member || member.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Subscription does not belong to your church" });
      }
    }

    const updated = await updateSubscription(subId, {
      amount: req.body.amount != null ? Number(req.body.amount) : undefined,
      billing_cycle: req.body.billing_cycle || undefined,
      next_payment_date: req.body.next_payment_date || undefined,
      status: req.body.status || undefined,
      plan_name: req.body.plan_name,
    }, req.user.church_id || undefined);

    logSuperAdminAudit(req, "subscription.update", { subscription_id: subId });
    persistAuditLog(req, "subscription.update", "subscription", subId, req.body);

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update subscription") });
  }
});

// ═══ Announcement Edit & Delete ═══

router.patch("/announcements/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, validate(updateAnnouncementSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id || "").trim();
    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: "Invalid announcement ID format" });
    }
    const churchId = resolveChurchId(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const updated = await updateAnnouncement(id, churchId, req.body?.title, req.body?.message);
    logSuperAdminAudit(req, "announcement.update", { announcement_id: id });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update announcement") });
  }
});

router.delete("/announcements/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id || "").trim();
    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: "Invalid announcement ID format" });
    }
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteAnnouncement(id, churchId);
    logSuperAdminAudit(req, "announcement.delete", { announcement_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete announcement") });
  }
});

router.delete("/announcements", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = resolveChurchId(req, req.query.church_id as string);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await clearAllAnnouncements(churchId);
    logSuperAdminAudit(req, "announcement.clear_all", { church_id: churchId });
    persistAuditLog(req, "announcement.clear_all", "announcement", undefined, { church_id: churchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to clear announcements") });
  }
});

// ═══ Event, Notification, Prayer Request Delete ═══

router.delete("/events/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id || "").trim();
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteChurchEvent(id, churchId);
    logSuperAdminAudit(req, "event.delete", { event_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete event") });
  }
});

router.delete("/notifications/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id || "").trim();
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteChurchNotification(id, churchId);
    logSuperAdminAudit(req, "notification.delete", { notification_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete notification") });
  }
});

router.delete("/prayer-requests/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id || "").trim();
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deletePrayerRequest(id, churchId);
    logSuperAdminAudit(req, "prayer_request.delete", { prayer_request_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete prayer request") });
  }
});

// ═══ Church Code Edit ═══

router.patch("/churches/:id/code", requireAuth, requireRegisteredUser, requireSuperAdmin, validate(updateChurchCodeSchema), async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const { church_code } = req.body;
    if (!church_code) return res.status(400).json({ error: "church_code is required" });

    const updated = await updateChurch(churchId, { church_code });
    logSuperAdminAudit(req, "church.code.update", { church_id: churchId, church_code });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update church code") });
  }
});

// ═══ Bulk Member Import ═══

router.post("/members/bulk-import", requireAuth, requireRegisteredUser, requireAdminOrSuper, bulkImportLimiter, validate(bulkImportMembersSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = resolveChurchId(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const members: Array<{
      full_name: string;
      email: string;
      phone_number?: string;
      address?: string;
      membership_id?: string;
      subscription_amount?: number;
    }> = req.body?.members;

    if (!Array.isArray(members) || !members.length) {
      return res.status(400).json({ error: "members array is required and must not be empty" });
    }
    if (members.length > 500) {
      return res.status(400).json({ error: "Maximum 500 members per import" });
    }

    const results: Array<{ row: number; status: string; error?: string; id?: string }> = [];
    const emails = new Set<string>();
    const phones = new Set<string>();

    // ── Phase 1: validate rows client-side, collect valid entries ──
    interface ValidRow {
      index: number;
      full_name: string;
      email: string;
      phone_number: string | null;
      address: string | null;
      membership_id: string | null;
      subscription_amount: number;
    }
    const validRows: ValidRow[] = [];

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const name = String(m.full_name || "").trim();
      const email = String(m.email || "").trim().toLowerCase();
      const phone = m.phone_number?.trim() ? normalizeIndianPhone(m.phone_number) : null;

      if (!name) {
        results.push({ row: i + 1, status: "skipped", error: "Missing full_name" });
        continue;
      }
      const hasEmail = email && email.includes("@");
      const hasPhone = phone && /^\+91[6-9]\d{9}$/.test(phone);
      if (!hasEmail && !hasPhone) {
        results.push({ row: i + 1, status: "skipped", error: "Missing valid email or phone number" });
        continue;
      }
      if (hasEmail && emails.has(email)) {
        results.push({ row: i + 1, status: "skipped", error: "Duplicate email in batch" });
        continue;
      }
      if (hasPhone && phones.has(phone)) {
        results.push({ row: i + 1, status: "skipped", error: "Duplicate phone in batch" });
        continue;
      }
      if (hasEmail) emails.add(email);
      if (hasPhone) phones.add(phone);
      const subAmt = Number(m.subscription_amount) || 0;
      if (subAmt !== 0 && subAmt < 200) {
        results.push({ row: i + 1, status: "skipped", error: "subscription_amount must be at least 200 (or 0 to skip)" });
        continue;
      }
      validRows.push({
        index: i,
        full_name: name,
        email: hasEmail ? email : "",
        phone_number: phone,
        address: m.address?.trim() || null,
        membership_id: m.membership_id?.trim() || null,
        subscription_amount: subAmt,
      });
    }

    if (!validRows.length) {
      return res.json({ total: members.length, created: 0, skipped: results.length, failed: 0, results });
    }

    // MED-015: Wrap Phase 2+3 in a transaction to prevent race-condition duplicates
    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");

    // ── Phase 2: batch-check which emails/phones already exist ──
    const validEmails = validRows.filter((r) => r.email).map((r) => r.email);
    const validPhones = validRows.filter((r) => r.phone_number).map((r) => r.phone_number as string);

    const existingEmailsSet = new Set<string>();
    const existingPhonesSet = new Set<string>();

    if (validEmails.length) {
      const existingRes = await txClient.query<{ email: string }>(
        `SELECT LOWER(email) AS email FROM members
         WHERE LOWER(email) = ANY($1) AND church_id = $2 AND deleted_at IS NULL`,
        [validEmails, churchId],
      );
      existingRes.rows.forEach((r) => existingEmailsSet.add(r.email));
    }
    if (validPhones.length) {
      const existingPhoneRes = await txClient.query<{ phone_number: string }>(
        `SELECT phone_number FROM members
         WHERE phone_number = ANY($1) AND church_id = $2 AND deleted_at IS NULL`,
        [validPhones, churchId],
      );
      existingPhoneRes.rows.forEach((r) => existingPhonesSet.add(r.phone_number));
    }

    // Separate into already-existing (skip) vs. to-insert
    const toInsert: ValidRow[] = [];
    for (const row of validRows) {
      if (row.email && existingEmailsSet.has(row.email)) {
        results.push({ row: row.index + 1, status: "skipped", error: "Member already exists (email)" });
      } else if (row.phone_number && existingPhonesSet.has(row.phone_number)) {
        results.push({ row: row.index + 1, status: "skipped", error: "Member already exists (phone)" });
      } else {
        toInsert.push(row);
      }
    }

    // ── Phase 3: batch INSERT ──
    if (toInsert.length) {
      // Build parameterized VALUES clause
      const values: any[] = [];
      const valuePlaceholders: string[] = [];
      for (let i = 0; i < toInsert.length; i++) {
        const r = toInsert[i];
        const offset = i * 8;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`,
        );
        values.push(
          r.full_name, r.email || null, r.phone_number, r.address,
          r.membership_id, r.subscription_amount, churchId, "pending",
        );
      }

      const insertRes = await txClient.query<{ id: string; email: string; phone_number: string }>(
        `INSERT INTO members (full_name, email, phone_number, address, membership_id, subscription_amount, church_id, verification_status)
         VALUES ${valuePlaceholders.join(", ")}
         ON CONFLICT (phone_number, church_id) WHERE deleted_at IS NULL AND phone_number IS NOT NULL AND phone_number != '' DO NOTHING
         RETURNING id, LOWER(email) AS email, phone_number`,
        values,
      );

      const insertedEmails = new Map(insertRes.rows.filter((r) => r.email).map((r) => [r.email, r.id]));
      const insertedPhones = new Map(insertRes.rows.filter((r) => r.phone_number).map((r) => [r.phone_number, r.id]));
      for (const row of toInsert) {
        const insertedId = (row.email && insertedEmails.get(row.email)) || (row.phone_number && insertedPhones.get(row.phone_number));
        if (insertedId) {
          results.push({ row: row.index + 1, status: "created", id: insertedId });
        } else {
          results.push({ row: row.index + 1, status: "skipped", error: "Member already exists" });
        }
      }
    }

      await txClient.query("COMMIT");
    } catch (txErr) {
      await txClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      txClient.release();
    }

    // Sort results by row number for consistent output
    results.sort((a, b) => a.row - b.row);

    const created = results.filter(r => r.status === "created").length;
    const skipped = results.filter(r => r.status === "skipped").length;
    const failed = results.filter(r => r.status === "failed").length;

    persistAuditLog(req, "members.bulk_import", "church", churchId, {
      total: members.length, created, skipped, failed,
    });
    logSuperAdminAudit(req, "members.bulk_import", {
      church_id: churchId, total: members.length, created, skipped, failed,
    });

    return res.json({ total: members.length, created, skipped, failed, results });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to bulk import members") });
  }
});

// ═══ Restore Soft-Deleted Entities ═══

router.post("/members/:id/restore", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const memberId = String(req.params.id || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }
    const churchId = resolveChurchId(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });
    const result = await restoreMember(memberId, churchId);
    logSuperAdminAudit(req, "member.restore", { member_id: memberId });
    persistAuditLog(req, "member.restore", "member", memberId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to restore member") });
  }
});

router.post("/churches/:id/restore", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const result = await restoreChurch(churchId);
    logSuperAdminAudit(req, "church.restore", { church_id: churchId });
    persistAuditLog(req, "church.restore", "church", churchId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to restore church") });
  }
});

// ═══ Auth Re-Linking ═══

router.post("/members/:id/relink-auth", requireAuth, requireRegisteredUser, requireSuperAdmin, validate(relinkAuthSchema), async (req: AuthRequest, res) => {
  try {
    const memberId = String(req.params.id || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    const { new_email, new_phone } = req.body;

    // Accept either email or phone for re-linking
    const isPhoneLink = !new_email && new_phone && typeof new_phone === "string";
    const isEmailLink = new_email && typeof new_email === "string" && new_email.includes("@");

    if (!isPhoneLink && !isEmailLink) {
      return res.status(400).json({ error: "Valid new_email or new_phone is required" });
    }

    // Verify the member exists
    const { data: memberRow } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", memberId)
      .maybeSingle();
    if (!memberRow) {
      return res.status(404).json({ error: "Member not found" });
    }

    let user: { id: string; email?: string; phone_number?: string; church_id: string | null } | null = null;

    if (isEmailLink) {
      const normalizedEmail = new_email.trim().toLowerCase();
      const { data } = await db
        .from("users")
        .select("id, email, church_id")
        .ilike("email", normalizedEmail)
        .maybeSingle<{ id: string; email: string; church_id: string | null }>();
      user = data;
    } else {
      const normalizedPhone = normalizeIndianPhone(new_phone.trim());
      const { data } = await db
        .from("users")
        .select("id, phone_number, church_id")
        .eq("phone_number", normalizedPhone)
        .maybeSingle<{ id: string; phone_number: string; church_id: string | null }>();
      user = data;
    }

    if (!user) {
      return res.status(404).json({ error: `No user account found with this ${isEmailLink ? "email" : "phone"}. The user must sign in at least once first.` });
    }

    // Verify user and member belong to the same church (also catch null church_id)
    if (user.church_id && memberRow.church_id && user.church_id !== memberRow.church_id) {
      return res.status(400).json({ error: "Cannot link: the user belongs to a different church than the member" });
    }
    if (!user.church_id && memberRow.church_id) {
      // User has no church — safe to link, assign them to member's church
    }

    // Build update payload based on link type
    const memberUpdate: Record<string, unknown> = { user_id: user.id, verification_status: "verified" };
    if (isEmailLink) {
      memberUpdate.email = new_email.trim().toLowerCase();
    } else {
      memberUpdate.phone_number = normalizeIndianPhone(new_phone.trim());
    }

    const { data: updated, error: updateErr } = await db
      .from("members")
      .update(memberUpdate)
      .eq("id", memberId)
      .select("id, full_name, email, phone_number, user_id")
      .single();

    if (updateErr) throw updateErr;

    const identifier = isEmailLink ? new_email.trim().toLowerCase() : normalizeIndianPhone(new_phone.trim());
    logSuperAdminAudit(req, "member.relink_auth", { member_id: memberId, identifier, user_id: user.id });
    persistAuditLog(req, "member.relink_auth", "member", memberId, { identifier });

    return res.json({ success: true, member: updated });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to re-link member auth") });
  }
});

// ═══ Refund Requests ═══

// Member: raise a refund request
router.post("/refund-requests", requireAuth, requireRegisteredUser, validate(createRefundRequestSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const { payment_id, transaction_id, amount, reason } = req.body;
    if (!payment_id || !UUID_REGEX.test(payment_id)) {
      return res.status(400).json({ error: "Valid payment_id is required" });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Amount must be positive" });
    }

    // Verify payment belongs to requester's member record
    const { data: member } = await db
      .from("members")
      .select("id, church_id")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (!member) {
      return res.status(403).json({ error: "You must be a registered member to request a refund" });
    }

    // Verify payment belongs to this member
    const { data: payment } = await db
      .from("payments")
      .select("id, member_id, amount")
      .eq("id", payment_id)
      .maybeSingle();

    if (!payment || payment.member_id !== member.id) {
      return res.status(403).json({ error: "Payment does not belong to you" });
    }

    if (Number(amount) > Number(payment.amount)) {
      return res.status(400).json({ error: "Refund amount cannot exceed payment amount" });
    }

    const result = await createRefundRequest({
      payment_id,
      member_id: member.id,
      church_id: member.church_id,
      transaction_id,
      amount: Number(amount),
      reason,
    });

    // Notify church admin about new refund request
    try {
      const { data: admins } = await db
        .from("members")
        .select("user_id")
        .eq("church_id", member.church_id)
        .eq("role", "admin")
        .is("deleted_at", null);
      if (admins?.length) {
        const { queueNotification } = await import("../services/notificationService");
        const { data: requesterName } = await db.from("members").select("full_name").eq("id", member.id).maybeSingle();
        for (const admin of admins) {
          if (admin.user_id) {
            queueNotification({
              church_id: member.church_id,
              recipient_user_id: admin.user_id,
              channel: "push",
              notification_type: "refund_request_new",
              subject: "New Refund Request",
              body: `${requesterName?.full_name || "A member"} has requested a refund of ₹${Number(amount)}.`,
              metadata: { url: "/admin-tools" },
            }).catch((err) => { logger.warn({ err }, "Failed to send refund_request_new notification"); });
          }
        }
      }
    } catch (_) {}

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create refund request") });
  }
});

// Member: view own refund requests
router.get("/refund-requests/my", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const { data: member } = await db
      .from("members")
      .select("id")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (!member) return res.json([]);

    const requests = await getMemberRefundRequests(member.id);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get refund requests") });
  }
});

// Admin/Super Admin: list refund requests
router.get("/refund-requests", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
      ? (typeof req.query.church_id === "string" ? req.query.church_id.trim() : undefined)
      : req.user.church_id;

    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const requests = await listRefundRequests(churchId, status);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list refund requests") });
  }
});

// Admin: forward refund request to super admin
router.post("/refund-requests/:id/forward", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });

    const requestId = String(req.params.id || "").trim();
    const result = await forwardRefundRequest(requestId, req.user.id, churchId);

    persistAuditLog(req, "refund_request.forward", "refund_request", requestId, { church_id: churchId });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to forward refund request") });
  }
});

// Super Admin: approve/deny refund request
router.post("/refund-requests/:id/review", requireAuth, requireRegisteredUser, requireSuperAdmin, validate(reviewRefundRequestSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const { decision, review_note } = req.body;
    if (!["approved", "denied"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be 'approved' or 'denied'" });
    }

    const reqId = String(req.params.id || "").trim();
    const result = await reviewRefundRequest(reqId, decision, req.user.id, review_note);

    // If approved, process the actual refund
    // LOW-02: Check status is "approved" before processing to prevent double-refund
    if (decision === "approved" && result.status === "approved") {
      try {
        await recordRefund({
          payment_id: result.payment_id,
          refund_amount: result.amount,
          refund_reason: result.reason || "Refund request approved",
          refund_method: "original_method",
          recorded_by: req.user.id,
        });

        // Mark as processed — only if still "approved" (optimistic lock)
        await db
          .from("refund_requests")
          .update({ status: "processed" })
          .eq("id", reqId)
          .eq("status", "approved");
      } catch (refundErr: any) {
        // Log but don't fail - the approval is recorded
        logSuperAdminAudit(req, "refund_request.process_error", { request_id: reqId, error: refundErr.message });
      }
    }

    logSuperAdminAudit(req, `refund_request.${decision}`, { request_id: reqId });
    persistAuditLog(req, `refund_request.${decision}`, "refund_request", reqId, { decision, review_note });

    // Notify member about refund decision
    try {
      const { data: memberRow } = await db.from("members").select("user_id, church_id, phone_number").eq("id", result.member_id).maybeSingle();
      if (memberRow?.church_id) {
        const { queueNotification } = await import("../services/notificationService");
        const refundAmt = Number(result.amount) || 0;
        const bodyText = decision === "approved"
          ? `Your refund of ₹${refundAmt} has been approved and will be processed shortly.`
          : `Your refund request of ₹${refundAmt} has been denied.${review_note ? ` Reason: ${review_note}` : ""}`;
        if (memberRow.user_id) {
          queueNotification({
            church_id: memberRow.church_id,
            recipient_user_id: memberRow.user_id,
            channel: "push",
            notification_type: "refund_decision",
            subject: decision === "approved" ? "Refund Approved" : "Refund Denied",
            body: bodyText,
            metadata: { url: "/history" },
          }).catch((err) => { logger.warn({ err }, "Failed to send refund_decision push notification"); });
        }
        if (memberRow.phone_number) {
          queueNotification({
            church_id: memberRow.church_id,
            recipient_phone: memberRow.phone_number,
            channel: "sms",
            notification_type: "refund_decision",
            body: bodyText,
          }).catch((err) => { logger.warn({ err }, "Failed to send refund_decision SMS notification"); });
        }
      }
    } catch (_) {}

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review refund request") });
  }
});

// ═══ Toggle Monthly Due Status (Issue #1: Admin correction) ═══

router.patch("/monthly-dues/:dueId", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const dueId = String(req.params.dueId || "").trim();
    if (!dueId || !UUID_REGEX.test(dueId)) {
      return res.status(400).json({ error: "Invalid due ID" });
    }

    const { status } = req.body;
    const VALID = ["pending", "paid", "imported_paid", "waived"];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID.join(", ")}` });
    }

    const churchId = resolveChurchId(req, req.body?.church_id);
    const result = await toggleDueStatus({ due_id: dueId, new_status: status, church_id: churchId });

    persistAuditLog(req, "monthly_due.toggle", "subscription_monthly_dues", dueId, { new_status: status });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update due status") });
  }
});

// ═══ Leave Church (Issue #4: Member self-service) ═══

router.post("/leave-church", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const userId = req.user.id;
    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "You are not a member of any church" });

    // Remove junction table entry
    await pool.query(
      `DELETE FROM user_church_memberships WHERE user_id = $1 AND church_id = $2`,
      [userId, churchId],
    );

    // Clear church_id from user
    await pool.query(
      `UPDATE users SET church_id = NULL WHERE id = $1`,
      [userId],
    );

    // Soft-delete the member record
    await pool.query(
      `UPDATE members SET deleted_at = NOW() WHERE user_id = $1 AND church_id = $2 AND deleted_at IS NULL`,
      [userId, churchId],
    );

    // Cancel active subscriptions
    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled'
       WHERE member_id IN (SELECT id FROM members WHERE user_id = $1 AND church_id = $2)
         AND status IN ('active','overdue','pending_first_payment','paused')`,
      [userId, churchId],
    );

    persistAuditLog(req, "member.leave_church", "user", userId, { church_id: churchId });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to leave church") });
  }
});

// ═══ Member Church Transfer (Issue #17) ═══

router.post("/members/:memberId/transfer", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const memberId = String(req.params.memberId || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    const { target_church_id } = req.body;
    if (!target_church_id || !UUID_REGEX.test(target_church_id)) {
      return res.status(400).json({ error: "Valid target_church_id is required" });
    }

    // Verify target church exists
    const { rows: churches } = await pool.query(`SELECT id FROM churches WHERE id = $1 AND deleted_at IS NULL`, [target_church_id]);
    if (!churches.length) return res.status(404).json({ error: "Target church not found" });

    // Get current member info
    const { rows: memberRows } = await pool.query(`SELECT id, user_id, church_id FROM members WHERE id = $1 AND deleted_at IS NULL`, [memberId]);
    if (!memberRows.length) return res.status(404).json({ error: "Member not found" });
    const member = memberRows[0];

    if (member.church_id === target_church_id) {
      return res.status(400).json({ error: "Member is already in the target church" });
    }

    // Cancel active subscriptions in old church
    await pool.query(
      `UPDATE subscriptions SET status = 'cancelled'
       WHERE member_id = $1 AND status IN ('active','overdue','pending_first_payment','paused')`,
      [memberId],
    );

    // Update member's church
    await pool.query(`UPDATE members SET church_id = $1 WHERE id = $2`, [target_church_id, memberId]);

    // Update user's church + junction table
    if (member.user_id) {
      await pool.query(`UPDATE users SET church_id = $1 WHERE id = $2`, [target_church_id, member.user_id]);
      await pool.query(`DELETE FROM user_church_memberships WHERE user_id = $1`, [member.user_id]);
      await pool.query(
        `INSERT INTO user_church_memberships (user_id, church_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [member.user_id, target_church_id],
      );
    }

    persistAuditLog(req, "member.transfer", "member", memberId, {
      from_church: member.church_id,
      to_church: target_church_id,
    });

    return res.json({ success: true, member_id: memberId, new_church_id: target_church_id });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to transfer member") });
  }
});

// ═══ Edit Manual Payment (within 48h) ═══

router.patch("/payments/:paymentId", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const paymentId = String(req.params.paymentId || "").trim();
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const churchId = resolveChurchId(req, req.body?.church_id);
    const result = await editManualPayment({
      payment_id: paymentId,
      amount: req.body.amount != null ? Number(req.body.amount) : undefined,
      payment_method: req.body.payment_method || undefined,
      payment_date: req.body.payment_date || undefined,
      note: typeof req.body.note === "string" ? req.body.note : undefined,
      church_id: churchId,
      edited_by: req.user.id,
    });

    persistAuditLog(req, "payment.edit", "payment", paymentId, {
      amount: req.body.amount, payment_method: req.body.payment_method,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to edit payment") });
  }
});

// ═══ Void Manual Payment (within 48h) ═══

router.post("/payments/:paymentId/void", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const paymentId = String(req.params.paymentId || "").trim();
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const churchId = resolveChurchId(req, req.body?.church_id);
    const result = await voidManualPayment(paymentId, churchId, req.user.id);

    persistAuditLog(req, "payment.void", "payment", paymentId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to void payment") });
  }
});

// ═══ List Deleted Members ═══

router.get("/members/deleted", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = resolveChurchId(req, typeof req.query.church_id === "string" ? req.query.church_id : undefined);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const members = await listDeletedMembers(churchId, limit);
    return res.json(members);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list deleted members") });
  }
});

// ═══ Edit Membership Request (before approval) ═══

router.patch("/membership-requests/:id", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const requestId = String(req.params.id || "").trim();
    if (!requestId || !UUID_REGEX.test(requestId)) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    // Only edit pending requests
    const { data: request, error: fetchErr } = await db
      .from("membership_requests")
      .select("id, status, church_id")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "pending") return res.status(400).json({ error: "Only pending requests can be edited" });

    // Church-scoping
    if (!isSuperAdminEmail(req.user.email, req.user.phone) && request.church_id !== req.user.church_id) {
      return res.status(403).json({ error: "Request does not belong to your church" });
    }

    const patch: Record<string, unknown> = {};
    if (req.body.full_name?.trim()) patch.full_name = req.body.full_name.trim().slice(0, 200);
    if (req.body.phone_number?.trim()) {
      patch.phone_number = normalizeIndianPhone(req.body.phone_number.trim());
    }
    if (typeof req.body.email === "string") patch.email = req.body.email.trim().toLowerCase().slice(0, 320);
    if (typeof req.body.address === "string") patch.address = req.body.address.trim().slice(0, 500);
    if (typeof req.body.membership_id === "string") patch.membership_id = req.body.membership_id.trim().slice(0, 50);

    if (!Object.keys(patch).length) return res.status(400).json({ error: "No fields to update" });

    const { data: updated, error: updateErr } = await db
      .from("membership_requests")
      .update(patch)
      .eq("id", requestId)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    persistAuditLog(req, "membership_request.edit", "membership_request", requestId, patch);
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to edit membership request") });
  }
});

// ═══ Reopen Rejected Membership Request ═══

router.post("/membership-requests/:id/reopen", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const requestId = String(req.params.id || "").trim();
    if (!requestId || !UUID_REGEX.test(requestId)) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    const { data: request, error: fetchErr } = await db
      .from("membership_requests")
      .select("id, status, church_id, reviewed_at")
      .eq("id", requestId)
      .maybeSingle();

    if (fetchErr || !request) return res.status(404).json({ error: "Request not found" });
    if (request.status !== "rejected") return res.status(400).json({ error: "Only rejected requests can be reopened" });

    // Church-scoping
    if (!isSuperAdminEmail(req.user.email, req.user.phone) && request.church_id !== req.user.church_id) {
      return res.status(403).json({ error: "Request does not belong to your church" });
    }

    const { data: updated, error: updateErr } = await db
      .from("membership_requests")
      .update({ status: "pending", reviewed_by: null, reviewed_at: null, review_note: null })
      .eq("id", requestId)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    persistAuditLog(req, "membership_request.reopen", "membership_request", requestId);
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to reopen request") });
  }
});

// ═══ Reactivate Cancelled Subscription ═══

router.post("/subscriptions/:subId/reactivate", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const subId = String(req.params.subId || "").trim();
    if (!subId || !UUID_REGEX.test(subId)) {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    const { data: sub, error: fetchErr } = await db
      .from("subscriptions")
      .select("id, member_id, status, billing_cycle")
      .eq("id", subId)
      .maybeSingle();

    if (fetchErr || !sub) return res.status(404).json({ error: "Subscription not found" });
    if (!["cancelled", "paused"].includes(sub.status)) {
      return res.status(400).json({ error: "Only cancelled or paused subscriptions can be reactivated" });
    }

    // Church-scoping
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: member } = await db.from("members").select("id, church_id").eq("id", sub.member_id).maybeSingle();
      if (!member || member.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Subscription does not belong to your church" });
      }
    }

    // Set next_payment_date to 5th of current or next month
    const now = new Date();
    let nextDate: Date;
    if (now.getDate() <= 5) {
      nextDate = new Date(now.getFullYear(), now.getMonth(), 5);
    } else {
      nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 5);
    }

    const { data: updated, error: updateErr } = await db
      .from("subscriptions")
      .update({ status: "active", next_payment_date: nextDate.toISOString().slice(0, 10) })
      .eq("id", subId)
      .select("id, status, next_payment_date")
      .single();

    if (updateErr) throw updateErr;

    persistAuditLog(req, "subscription.reactivate", "subscription", subId);

    try {
      const { recordSubscriptionEvent } = await import("../services/subscriptionTrackingService");
      await recordSubscriptionEvent({
        subscription_id: subId, event_type: "status_change",
        member_id: sub.member_id,
        status_before: sub.status, status_after: "active",
        source: "admin_reactivate",
      });
    } catch (_) {}

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to reactivate subscription") });
  }
});

// ═══ Edit Family Member Relation ═══

router.patch("/family-members/:id/relation", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const familyMemberId = String(req.params.id || "").trim();
    if (!familyMemberId || !UUID_REGEX.test(familyMemberId)) {
      return res.status(400).json({ error: "Invalid family member ID" });
    }

    const { relation } = req.body;
    const VALID_RELATIONS = ["spouse", "child", "parent", "sibling", "other"];
    if (!relation || !VALID_RELATIONS.includes(relation)) {
      return res.status(400).json({ error: `relation must be one of: ${VALID_RELATIONS.join(", ")}` });
    }

    // Verify family member exists and belongs to admin's church
    const { data: fm, error: fmErr } = await db
      .from("family_members")
      .select("id, member_id")
      .eq("id", familyMemberId)
      .maybeSingle();

    if (fmErr || !fm) return res.status(404).json({ error: "Family member not found" });

    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: member } = await db.from("members").select("church_id").eq("id", fm.member_id).maybeSingle();
      if (!member || member.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Family member does not belong to your church" });
      }
    }

    const { data: updated, error: updateErr } = await db
      .from("family_members")
      .update({ relation })
      .eq("id", familyMemberId)
      .select("id, relation, full_name")
      .single();

    if (updateErr) throw updateErr;

    persistAuditLog(req, "family_member.edit_relation", "family_member", familyMemberId, { relation });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to edit family relation") });
  }
});

// ═══ Admin Add Family Member Directly ═══

router.post("/members/:memberId/family", requireAuth, requireRegisteredUser, requireAdminOrSuper, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const memberId = String(req.params.memberId || "").trim();
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    const { full_name, relation, phone_number, email } = req.body;
    if (!full_name?.trim()) return res.status(400).json({ error: "full_name is required" });
    const VALID_RELATIONS = ["spouse", "child", "parent", "sibling", "other"];
    if (!relation || !VALID_RELATIONS.includes(relation)) {
      return res.status(400).json({ error: `relation must be one of: ${VALID_RELATIONS.join(", ")}` });
    }

    // Verify member belongs to admin's church
    const { data: member, error: memErr } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", memberId)
      .is("deleted_at", null)
      .maybeSingle();

    if (memErr || !member) return res.status(404).json({ error: "Member not found" });

    if (!isSuperAdminEmail(req.user.email, req.user.phone) && member.church_id !== req.user.church_id) {
      return res.status(403).json({ error: "Member does not belong to your church" });
    }

    // Check for duplicate family member by name
    const { data: existing } = await db
      .from("family_members")
      .select("id")
      .eq("member_id", memberId)
      .ilike("full_name", full_name.trim())
      .maybeSingle();

    if (existing) return res.status(409).json({ error: "A family member with this name already exists" });

    const insertData: Record<string, unknown> = {
      member_id: memberId,
      full_name: full_name.trim().slice(0, 200),
      relation,
    };
    if (phone_number?.trim()) insertData.phone_number = normalizeIndianPhone(phone_number.trim());
    if (email?.trim()) insertData.email = email.trim().toLowerCase().slice(0, 320);

    const { data: created, error: insertErr } = await db
      .from("family_members")
      .insert([insertData])
      .select("id, full_name, relation, phone_number, email")
      .single();

    if (insertErr) throw insertErr;

    persistAuditLog(req, "family_member.admin_add", "family_member", created.id, { member_id: memberId });
    return res.status(201).json(created);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to add family member") });
  }
});

// ═══ Subscription Change History ═══

router.get("/subscriptions/:subId/history", requireAuth, requireRegisteredUser, requireAdminOrSuper, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const subId = String(req.params.subId || "").trim();
    if (!subId || !UUID_REGEX.test(subId)) {
      return res.status(400).json({ error: "Invalid subscription ID" });
    }

    // Fetch from subscription_events (tracking table)
    const { data: events, error } = await db
      .from("subscription_events")
      .select("id, event_type, status_before, status_after, amount, source, event_at")
      .eq("subscription_id", subId)
      .order("event_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Also fetch audit log entries for this subscription
    const auditResult = await pool.query(
      `SELECT id, action, changes, performed_at FROM audit_logs WHERE entity_type = 'subscription' AND entity_id = $1 ORDER BY performed_at DESC LIMIT 50`,
      [subId],
    );

    return res.json({ events: events || [], audit: auditResult.rows });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch subscription history") });
  }
});

// ── H2: Global cross-church member search (Super Admin only) ──
router.get("/global-member-search", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q || q.length < 2) {
      return res.status(400).json({ error: "Search query must be at least 2 characters" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const escaped = q.replace(/%/g, "\\%").replace(/_/g, "\\_");

    const { rows } = await pool.query(
      `SELECT m.id, m.full_name, m.email, m.phone_number, m.church_id,
              c.name AS church_name, m.verification_status, m.membership_id
       FROM members m
       LEFT JOIN churches c ON c.id = m.church_id
       WHERE m.deleted_at IS NULL
         AND (
           m.full_name ILIKE $1 OR
           m.email ILIKE $1 OR
           m.phone_number ILIKE $1 OR
           m.membership_id ILIKE $1
         )
       ORDER BY m.full_name
       LIMIT $2`,
      [`%${escaped}%`, limit]
    );

    logSuperAdminAudit(req, "global_member_search", { query: q, results: rows.length });
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Global member search failed") });
  }
});

// ── H3: Identity collision report (Super Admin only) ──
router.get("/identity-duplicates", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.query.church_id || "").trim();
    if (churchId && !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church_id format" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
    const params: Array<string | number> = [];
    let userChurchClause = "";
    let memberChurchClause = "";

    if (churchId) {
      params.push(churchId);
      userChurchClause = `AND u.church_id = $${params.length}`;
      memberChurchClause = `AND m.church_id = $${params.length}`;
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    const { rows } = await pool.query(
      `WITH user_rows AS (
         SELECT
           u.id,
           u.auth_user_id,
           NULLIF(u.email, '') AS email,
           BTRIM(u.phone_number) AS phone_number,
           NULLIF(u.full_name, '') AS full_name,
           u.role,
           u.church_id,
           u.created_at,
           c.name AS church_name
         FROM users u
         LEFT JOIN churches c ON c.id = u.church_id
         WHERE NULLIF(BTRIM(u.phone_number), '') IS NOT NULL
           ${userChurchClause}
       ),
       member_rows AS (
         SELECT
           m.id,
           m.user_id,
           NULLIF(m.full_name, '') AS full_name,
           NULLIF(m.email, '') AS email,
           BTRIM(m.phone_number) AS phone_number,
           NULLIF(m.membership_id, '') AS membership_id,
           m.verification_status,
           m.church_id,
           m.created_at,
           c.name AS church_name
         FROM members m
         LEFT JOIN churches c ON c.id = m.church_id
         WHERE m.deleted_at IS NULL
           AND NULLIF(BTRIM(m.phone_number), '') IS NOT NULL
           ${memberChurchClause}
       ),
       phones AS (
         SELECT phone_number FROM user_rows
         UNION
         SELECT phone_number FROM member_rows
       ),
       summary AS (
         SELECT
           p.phone_number,
           (SELECT COUNT(*)::int FROM user_rows u WHERE u.phone_number = p.phone_number) AS user_count,
           (SELECT COUNT(*)::int FROM member_rows m WHERE m.phone_number = p.phone_number) AS member_count,
           (SELECT COUNT(DISTINCT m.church_id)::int FROM member_rows m WHERE m.phone_number = p.phone_number AND m.church_id IS NOT NULL) AS church_count,
           (
             SELECT COUNT(*)::int
             FROM member_rows m
             WHERE m.phone_number = p.phone_number
               AND m.user_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                 FROM user_rows u
                 WHERE u.id = m.user_id
                   AND u.phone_number = m.phone_number
               )
           ) AS linked_mismatch_count,
           (
             SELECT COUNT(*)::int
             FROM member_rows m
             WHERE m.phone_number = p.phone_number
               AND m.user_id IS NULL
           ) AS unlinked_member_count
         FROM phones p
       ),
       risky AS (
         SELECT
           s.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN s.user_count > 1 THEN 'duplicate_users' END,
             CASE WHEN s.member_count > 1 THEN 'duplicate_members' END,
             CASE WHEN s.church_count > 1 THEN 'cross_church_members' END,
             CASE WHEN s.linked_mismatch_count > 0 THEN 'member_link_mismatch' END,
             CASE WHEN s.user_count > 0 AND s.unlinked_member_count > 0 THEN 'unlinked_member_same_phone' END
           ], NULL) AS risk_flags,
           CASE
             WHEN s.user_count > 1 THEN 100
             WHEN s.linked_mismatch_count > 0 THEN 90
             WHEN s.member_count > 1 AND s.church_count > 1 THEN 85
             WHEN s.member_count > 1 THEN 75
             WHEN s.user_count > 0 AND s.unlinked_member_count > 0 THEN 55
             ELSE 0
           END AS risk_score
         FROM summary s
         WHERE s.user_count > 1
            OR s.member_count > 1
            OR s.church_count > 1
            OR s.linked_mismatch_count > 0
            OR (s.user_count > 0 AND s.unlinked_member_count > 0)
       )
       SELECT
         r.phone_number,
         r.user_count,
         r.member_count,
         r.church_count,
         r.linked_mismatch_count,
         r.unlinked_member_count,
         r.risk_flags,
         r.risk_score,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', u.id,
               'auth_user_id', u.auth_user_id,
               'email', u.email,
               'phone_number', u.phone_number,
               'full_name', u.full_name,
               'role', u.role,
               'church_id', u.church_id,
               'church_name', u.church_name,
               'created_at', u.created_at,
               'has_auth_link', u.auth_user_id IS NOT NULL
             )
             ORDER BY u.created_at NULLS LAST
           )
           FROM user_rows u
           WHERE u.phone_number = r.phone_number
         ), '[]'::jsonb) AS users,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', m.id,
               'user_id', m.user_id,
               'full_name', m.full_name,
               'email', m.email,
               'phone_number', m.phone_number,
               'membership_id', m.membership_id,
               'verification_status', m.verification_status,
               'church_id', m.church_id,
               'church_name', m.church_name,
               'created_at', m.created_at
             )
             ORDER BY m.created_at NULLS LAST
           )
           FROM member_rows m
           WHERE m.phone_number = r.phone_number
         ), '[]'::jsonb) AS members
       FROM risky r
       ORDER BY r.risk_score DESC, r.member_count DESC, r.user_count DESC, r.phone_number
       LIMIT ${limitParam}`,
      params,
    );

    logSuperAdminAudit(req, "identity_duplicates_report", { church_id: churchId || "all", results: rows.length });
    return res.json(rows);
  } catch (err: any) {
    logger.error({ err }, "Identity duplicate report failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Identity duplicate report failed") });
  }
});

// ── M2: Manual job trigger (Super Admin only) ──
router.post("/jobs/:jobName/trigger", requireAuth, requireRegisteredUser, requireSuperAdmin, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    const jobName = String(req.params.jobName || "").trim();

    // Import job functions dynamically to avoid circular deps
    const jobMap: Record<string, () => Promise<unknown>> = {
      overdue_reconciliation: async () => {
        const { reconcileOverdueSubscriptions } = await import("../services/subscriptionTrackingService");
        return reconcileOverdueSubscriptions();
      },
      subscription_reminders: async () => {
        const { processSubscriptionReminders } = await import("../services/subscriptionReminderService");
        return processSubscriptionReminders();
      },
      grace_period_enforcement: async () => {
        const { enforceGracePeriods } = await import("../services/subscriptionReminderService");
        return enforceGracePeriods();
      },
      payment_reconciliation: async () => {
        const { reconcilePendingPayments } = await import("../services/paymentReconciliationService");
        return reconcilePendingPayments();
      },
      expired_event_cleanup: async () => {
        const { cleanupExpiredEvents } = await import("../services/engagementService");
        return cleanupExpiredEvents();
      },
      special_date_reminders: async () => {
        const { processSpecialDateReminders } = await import("../services/specialDateReminderService");
        return processSpecialDateReminders();
      },
      saas_enforcement: async () => {
        const { enforceSaaSSubscriptions } = await import("../services/saasEnforcementService");
        return enforceSaaSSubscriptions();
      },
    };

    if (!jobMap[jobName]) {
      return res.status(400).json({
        error: `Unknown job: ${jobName}`,
        available_jobs: Object.keys(jobMap),
      });
    }

    logger.info({ jobName, triggeredBy: req.user?.id }, "Manual job trigger initiated");
    const result = await jobMap[jobName]();

    await persistAuditLog(req, "job.manual_trigger", "job", jobName, { result });
    logSuperAdminAudit(req, "job.manual_trigger", { jobName, result });

    return res.json({ success: true, job: jobName, result });
  } catch (err: any) {
    logger.error({ err, jobName: req.params.jobName }, "Manual job trigger failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Job trigger failed") });
  }
});

// ── M3: Audit log CSV export (Super Admin only) ──
router.get("/audit-logs/export", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.query.church_id || "").trim() || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 10000);

    let query = `SELECT id, church_id, actor_user_id, actor_email, actor_role, action, entity_type, entity_id, ip_address, created_at
                 FROM admin_audit_log`;
    const params: unknown[] = [];

    if (churchId && UUID_REGEX.test(churchId)) {
      query += ` WHERE church_id = $1`;
      params.push(churchId);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);

    // CSV header
    const header = "id,church_id,actor_user_id,actor_email,actor_role,action,entity_type,entity_id,ip_address,created_at";
    const csvRows = rows.map((r: any) =>
      toCsvRow([r.id, r.church_id, r.actor_user_id, r.actor_email, r.actor_role, r.action, r.entity_type, r.entity_id, r.ip_address, r.created_at])
    );

    const csv = [header, ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${new Date().toISOString().split("T")[0]}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Audit log export failed") });
  }
});

// ── M3: SaaS billing history CSV export (Super Admin only) ──
router.get("/saas-billing/export", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 10000);

    const { rows } = await pool.query(
      `SELECT csp.id, csp.church_id, c.name AS church_name, csp.amount, csp.payment_method,
              csp.transaction_id, csp.payment_status, csp.payment_date, csp.note, csp.created_at
       FROM church_subscription_payments csp
       JOIN churches c ON c.id = csp.church_id
       ORDER BY csp.created_at DESC
       LIMIT $1`,
      [limit]
    );

    const header = "id,church_id,church_name,amount,payment_method,transaction_id,payment_status,payment_date,note,created_at";
    const csvRows = rows.map((r: any) =>
      toCsvRow([r.id, r.church_id, r.church_name, r.amount, r.payment_method, r.transaction_id, r.payment_status, r.payment_date, r.note, r.created_at])
    );

    const csv = [header, ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="saas-billing-${new Date().toISOString().split("T")[0]}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "SaaS billing export failed") });
  }
});

export default router;
