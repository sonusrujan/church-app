import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin, isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { db, pool } from "../services/dbClient";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import { normalizeIndianPhone } from "../utils/phone";

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
} from "../services/paymentAdminService";

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
import { restoreMember } from "../services/memberService";
import {
  createRefundRequest,
  listRefundRequests,
  forwardRefundRequest,
  reviewRefundRequest,
  getMemberRefundRequests,
} from "../services/refundRequestService";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveChurchId(req: AuthRequest, bodyOrQueryChurchId?: string): string {
  if (isSuperAdminEmail(req.user?.email || "", req.user?.phone)) {
    const resolved = bodyOrQueryChurchId?.trim() || req.user?.church_id || "";
    if (!resolved) throw new Error("church_id is required for super admin operations");
    return resolved;
  }
  return req.user?.church_id || "";
}

// ═══ Manual Payment Recording ═══

router.post("/payments/manual", requireAuth, requireRegisteredUser, adminWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can record manual payments" });
    }

    const { member_id, subscription_id, amount, payment_method, payment_date, payment_category, note } = req.body;
    if (!member_id || !UUID_REGEX.test(member_id)) {
      return res.status(400).json({ error: "Valid member_id is required" });
    }
    if (!amount || !payment_method || !payment_date) {
      return res.status(400).json({ error: "amount, payment_method, and payment_date are required" });
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
        }).catch(() => {});
      }
    } catch (_) {}

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to record manual payment") });
  }
});

// ═══ Refund Recording ═══

router.post("/payments/:paymentId/refund", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can record refunds" });
    }

    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }

    const { refund_amount, refund_reason, refund_method } = req.body;
    if (!refund_amount || !refund_method) {
      return res.status(400).json({ error: "refund_amount and refund_method are required" });
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

router.get("/payments/member/:memberId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can view member payment history" });
    }

    const memberId = Array.isArray(req.params.memberId) ? req.params.memberId[0] : req.params.memberId;
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

    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const payments = await getMemberPaymentHistory(memberId, churchId, limit, offset);
    return res.json(payments);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load payment history") });
  }
});

// ═══ Subscription Edit ═══

router.patch("/subscriptions/:subId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can edit subscriptions" });
    }

    const subId = Array.isArray(req.params.subId) ? req.params.subId[0] : req.params.subId;
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

router.patch("/announcements/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can edit announcements" });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    const churchId = resolveChurchId(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const updated = await updateAnnouncement(id, churchId, req.body?.title, req.body?.message);
    logSuperAdminAudit(req, "announcement.update", { announcement_id: id });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update announcement") });
  }
});

router.delete("/announcements/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete announcements" });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteAnnouncement(id, churchId);
    logSuperAdminAudit(req, "announcement.delete", { announcement_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete announcement") });
  }
});

router.delete("/announcements", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can clear announcements" });
    }
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

router.delete("/events/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete events" });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteChurchEvent(id, churchId);
    logSuperAdminAudit(req, "event.delete", { event_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete event") });
  }
});

router.delete("/notifications/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete notifications" });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    const churchId = resolveChurchId(req, req.body?.church_id || (req.query.church_id as string));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const result = await deleteChurchNotification(id, churchId);
    logSuperAdminAudit(req, "notification.delete", { notification_id: id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete notification") });
  }
});

router.delete("/prayer-requests/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete prayer requests" });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
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

router.patch("/churches/:id/code", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
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

router.post("/members/bulk-import", requireAuth, requireRegisteredUser, bulkImportLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can bulk import members" });
    }

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
      validRows.push({
        index: i,
        full_name: name,
        email: hasEmail ? email : "",
        phone_number: phone,
        address: m.address?.trim() || null,
        membership_id: m.membership_id?.trim() || null,
        subscription_amount: Number(m.subscription_amount) || 0,
      });
    }

    if (!validRows.length) {
      return res.json({ total: members.length, created: 0, skipped: results.length, failed: 0, results });
    }

    // ── Phase 2: batch-check which emails/phones already exist ──
    const validEmails = validRows.filter((r) => r.email).map((r) => r.email);
    const validPhones = validRows.filter((r) => r.phone_number).map((r) => r.phone_number as string);

    const existingEmailsSet = new Set<string>();
    const existingPhonesSet = new Set<string>();

    if (validEmails.length) {
      const existingRes = await pool.query<{ email: string }>(
        `SELECT LOWER(email) AS email FROM members
         WHERE LOWER(email) = ANY($1) AND church_id = $2 AND deleted_at IS NULL`,
        [validEmails, churchId],
      );
      existingRes.rows.forEach((r) => existingEmailsSet.add(r.email));
    }
    if (validPhones.length) {
      const existingPhoneRes = await pool.query<{ phone_number: string }>(
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

      const insertRes = await pool.query<{ id: string; email: string; phone_number: string }>(
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
    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
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
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
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

router.post("/members/:id/relink-auth", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID" });
    }

    const { new_email } = req.body;
    if (!new_email || typeof new_email !== "string" || !new_email.includes("@")) {
      return res.status(400).json({ error: "Valid new_email is required" });
    }

    const normalizedEmail = new_email.trim().toLowerCase();

    // Verify the member exists
    const { data: memberRow } = await db
      .from("members")
      .select("id, church_id")
      .eq("id", memberId)
      .maybeSingle();
    if (!memberRow) {
      return res.status(404).json({ error: "Member not found" });
    }

    // Find the user account with this email
    const { data: user } = await db
      .from("users")
      .select("id, email, church_id")
      .ilike("email", normalizedEmail)
      .maybeSingle<{ id: string; email: string; church_id: string | null }>();

    if (!user) {
      return res.status(404).json({ error: "No user account found with this email. The user must sign in at least once first." });
    }

    // BE-1: Verify user and member belong to the same church
    if (user.church_id && memberRow.church_id && user.church_id !== memberRow.church_id) {
      return res.status(400).json({ error: "Cannot link: the user belongs to a different church than the member" });
    }

    // Update member's email and user_id
    const { data: updated, error: updateErr } = await db
      .from("members")
      .update({ user_id: user.id, email: normalizedEmail, verification_status: "verified" })
      .eq("id", memberId)
      .select("id, full_name, email, user_id")
      .single();

    if (updateErr) throw updateErr;

    logSuperAdminAudit(req, "member.relink_auth", { member_id: memberId, new_email: normalizedEmail, user_id: user.id });
    persistAuditLog(req, "member.relink_auth", "member", memberId, { new_email: normalizedEmail });

    return res.json({ success: true, member: updated });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to re-link member auth") });
  }
});

// ═══ Refund Requests ═══

// Member: raise a refund request
router.post("/refund-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
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
            }).catch(() => {});
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
router.get("/refund-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Admin access required" });
    }

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
router.post("/refund-requests/:id/forward", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church associated" });

    const requestId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await forwardRefundRequest(requestId, req.user.id, churchId);

    persistAuditLog(req, "refund_request.forward", "refund_request", requestId, { church_id: churchId });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to forward refund request") });
  }
});

// Super Admin: approve/deny refund request
router.post("/refund-requests/:id/review", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const { decision, review_note } = req.body;
    if (!["approved", "denied"].includes(decision)) {
      return res.status(400).json({ error: "Decision must be 'approved' or 'denied'" });
    }

    const reqId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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
          }).catch(() => {});
        }
        if (memberRow.phone_number) {
          queueNotification({
            church_id: memberRow.church_id,
            recipient_phone: memberRow.phone_number,
            channel: "sms",
            notification_type: "refund_decision",
            body: bodyText,
          }).catch(() => {});
        }
      }
    } catch (_) {}

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review refund request") });
  }
});

export default router;
