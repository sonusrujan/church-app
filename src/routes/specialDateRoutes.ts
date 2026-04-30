import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { safeErrorMessage } from "../utils/safeError";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { persistAuditLog } from "../utils/auditLog";
import { logger } from "../utils/logger";
import { buildExcelHtmlReport, excelFilename, EXCEL_HTML_MIME } from "../utils/excelReport";
import { validate, createSpecialDateSchema, updateSpecialDateSchema } from "../utils/zodSchemas";
import {
  createSpecialDate,
  listSpecialDates,
  updateSpecialDate,
  deleteSpecialDate,
  checkDobDuplicate,
  listSpecialDatesForExport,
} from "../services/specialDateService";

const router = Router();

function qs(val: unknown): string {
  if (Array.isArray(val)) return String(val[0] ?? "");
  return typeof val === "string" ? val : "";
}

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) throw new Error("Unauthenticated");
  const isSuper = isSuperAdminEmail(req.user.email, req.user.phone);
  const normalized = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";
  return isSuper ? (normalized || req.user.church_id) : req.user.church_id;
}

// ── List member's special dates ──
router.get("/list", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    const requestedMemberId = qs(req.query.member_id);
    const ownMemberId = req.registeredProfile?.id || "";
    const memberId = isAdmin ? (requestedMemberId || ownMemberId) : ownMemberId;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Valid member_id required" });
    }
    const churchId = resolveScopedChurchId(req, qs(req.query.church_id));
    const dates = await listSpecialDates(memberId, churchId);
    return res.json({ data: dates });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to list special dates") });
  }
});

// ── Check DOB conflict ──
router.get("/check-dob", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const memberId = qs(req.query.member_id) || req.registeredProfile?.id || "";
    const occasionDate = qs(req.query.occasion_date);
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Valid member_id required" });
    }
    if (!occasionDate) {
      return res.status(400).json({ error: "occasion_date required" });
    }
    const result = await checkDobDuplicate(memberId, occasionDate);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to check DOB conflict") });
  }
});

// ── Add special date ──
router.post("/", requireAuth, requireRegisteredUser, writeLimiter, validate(createSpecialDateSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = resolveScopedChurchId(req, req.body.church_id);
    const { occasion_type, occasion_date, person_name, spouse_name, notes } = req.body;

    if (!occasion_type || !["birthday", "anniversary"].includes(occasion_type)) {
      return res.status(400).json({ error: "occasion_type must be 'birthday' or 'anniversary'" });
    }
    if (!occasion_date) return res.status(400).json({ error: "occasion_date required" });
    if (!person_name?.trim()) return res.status(400).json({ error: "person_name required" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    const requestedMemberId = req.body.member_id;
    const ownMemberId = req.registeredProfile?.id || "";
    const memberId = isAdmin ? (requestedMemberId || ownMemberId) : ownMemberId;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Valid member_id required" });
    }

    const row = await createSpecialDate({
      member_id: memberId,
      church_id: churchId,
      occasion_type,
      occasion_date,
      person_name: person_name.trim(),
      spouse_name: occasion_type === "anniversary" ? spouse_name : undefined,
      notes,
    });

    persistAuditLog(req, "special_date.create", "member_special_dates", row.id, { occasion_type, occasion_date }).catch((err) => { logger.warn({ err }, "Audit log failed for special_date.create"); });

    return res.status(201).json({ data: row });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create special date") });
  }
});

// ── Update special date ──
router.put("/:id", requireAuth, requireRegisteredUser, writeLimiter, validate(updateSpecialDateSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id);
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid id" });
    const churchId = resolveScopedChurchId(req, qs(req.query.church_id));

    // Ownership check: only the owning member or an admin can update
    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      const { data: existing } = await (await import("../services/dbClient")).db
        .from("member_special_dates").select("member_id").eq("id", id).maybeSingle();
      if (!existing || existing.member_id !== req.registeredProfile?.id) {
        return res.status(403).json({ error: "You can only update your own special dates" });
      }
    }

    const { occasion_type, occasion_date, person_name, spouse_name, notes } = req.body;
    const row = await updateSpecialDate(id, churchId, { occasion_type, occasion_date, person_name, spouse_name, notes });

    persistAuditLog(req, "special_date.update", "member_special_dates", id, { occasion_type, occasion_date }).catch((err) => { logger.warn({ err }, "Audit log failed for special_date.update"); });

    return res.json({ data: row });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to update special date") });
  }
});

// ── Delete special date ──
router.delete("/:id", requireAuth, requireRegisteredUser, writeLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id);
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid id" });
    const churchId = resolveScopedChurchId(req, qs(req.query.church_id));

    // Ownership check: only the owning member or an admin can delete
    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      const { data: existing } = await (await import("../services/dbClient")).db
        .from("member_special_dates").select("member_id").eq("id", id).maybeSingle();
      if (!existing || existing.member_id !== req.registeredProfile?.id) {
        return res.status(403).json({ error: "You can only delete your own special dates" });
      }
    }

    await deleteSpecialDate(id, churchId);

    persistAuditLog(req, "special_date.delete", "member_special_dates", id).catch((err) => { logger.warn({ err }, "Audit log failed for special_date.delete"); });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to delete special date") });
  }
});

// ── Admin: Export special dates (CSV/Excel) ──
router.get("/export", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const churchId = resolveScopedChurchId(req, qs(req.query.church_id));
    const range = (qs(req.query.range) || "monthly") as "weekly" | "monthly" | "yearly";
    if (!["weekly", "monthly", "yearly"].includes(range)) {
      return res.status(400).json({ error: "range must be weekly, monthly, or yearly" });
    }

    if (!churchId) {
      return res.status(400).json({ error: "church_id is required for super admins — pass ?church_id=UUID" });
    }

    const rows = await listSpecialDatesForExport(churchId, range);

    const reportRows = rows.map((r) => ({
      member_name: r.member_name,
      email: r.member_email,
      phone: r.member_phone || "",
      occasion: r.occasion_type,
      date: r.occasion_date,
      person_name: r.person_name,
      spouse_name: r.spouse_name || "",
      notes: r.notes || "",
      source: r.is_from_profile ? "Profile DOB" : "Manual special date",
    }));

    const content = buildExcelHtmlReport({
      title: "Special Dates Report",
      subtitle: "Birthdays, anniversaries, and profile DOB dates for church greetings.",
      periodLabel: range,
      kpis: [
        { label: "Total Dates", value: reportRows.length },
        { label: "Birthdays", value: reportRows.filter((r) => String(r.occasion).toLowerCase() === "birthday").length },
        { label: "Anniversaries", value: reportRows.filter((r) => String(r.occasion).toLowerCase() === "anniversary").length },
      ],
      notes: [
        "Use the Date column to plan greetings and reminders.",
        "Profile DOB rows are included automatically so members do not need to add them twice.",
      ],
      sections: [{
        title: "Special Dates",
        columns: [
          { key: "date", header: "Date", type: "date", width: 135 },
          { key: "occasion", header: "Occasion", type: "text", width: 120 },
          { key: "person_name", header: "Person Name", type: "text", width: 170 },
          { key: "member_name", header: "Member", type: "text", width: 190 },
          { key: "phone", header: "Phone", type: "text", width: 120 },
          { key: "spouse_name", header: "Spouse Name", type: "text", width: 170 },
          { key: "source", header: "Source", type: "text", width: 140 },
          { key: "notes", header: "Notes", type: "text", width: 240 },
          { key: "email", header: "Email", type: "text", width: 190 },
        ],
        rows: reportRows,
      }],
    });

    res.setHeader("Content-Type", EXCEL_HTML_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${excelFilename(`special-dates-${range}.xls`)}"`);
    return res.send(content);
  } catch (err: any) {
    logger.error({ err }, "Special dates export failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to export special dates") });
  }
});


// ── Super-admin: Manually trigger special-date greetings (for testing) ──
router.post("/trigger-reminders", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Super admin access required" });
    }
    const { processSpecialDateReminders } = await import("../services/specialDateReminderService");
    const result = await processSpecialDateReminders();
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to trigger reminders") });
  }
});

export default router;
