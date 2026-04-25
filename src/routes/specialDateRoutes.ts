import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { safeErrorMessage } from "../utils/safeError";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { persistAuditLog } from "../utils/auditLog";
import { logger } from "../utils/logger";
import {
  createSpecialDate,
  listSpecialDates,
  updateSpecialDate,
  deleteSpecialDate,
  checkDobDuplicate,
  listSpecialDatesForExport,
} from "../services/specialDateService";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const memberId = qs(req.query.member_id) || req.registeredProfile?.id || "";
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
router.post("/", requireAuth, requireRegisteredUser, writeLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const churchId = resolveScopedChurchId(req, req.body.church_id);
    const { occasion_type, occasion_date, person_name, spouse_name, notes } = req.body;

    if (!occasion_type || !["birthday", "anniversary"].includes(occasion_type)) {
      return res.status(400).json({ error: "occasion_type must be 'birthday' or 'anniversary'" });
    }
    if (!occasion_date) return res.status(400).json({ error: "occasion_date required" });
    if (!person_name?.trim()) return res.status(400).json({ error: "person_name required" });

    const memberId = req.body.member_id || req.registeredProfile?.id || "";
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

    persistAuditLog(req, "special_date.create", "member_special_dates", row.id, { occasion_type, occasion_date }).catch(() => {});

    return res.status(201).json({ data: row });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create special date") });
  }
});

// ── Update special date ──
router.put("/:id", requireAuth, requireRegisteredUser, writeLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const id = String(req.params.id);
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid id" });
    const churchId = resolveScopedChurchId(req, qs(req.query.church_id));
    const { occasion_type, occasion_date, person_name, spouse_name, notes } = req.body;
    const row = await updateSpecialDate(id, churchId, { occasion_type, occasion_date, person_name, spouse_name, notes });
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
    await deleteSpecialDate(id, churchId);

    persistAuditLog(req, "special_date.delete", "member_special_dates", id).catch(() => {});

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

    // Build CSV
    const header = "Member Name,Email,Phone,Occasion,Date,Person Name,Spouse Name,Notes,From Profile";
    const csvLines = rows.map((r) => {
      const fields = [
        r.member_name,
        r.member_email,
        r.member_phone || "",
        r.occasion_type,
        r.occasion_date,
        r.person_name,
        r.spouse_name || "",
        r.notes || "",
        r.is_from_profile ? "Yes" : "No",
      ];
      return fields.map(escapeCsvField).join(",");
    });

    const csv = [header, ...csvLines].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=special_dates_${range}.csv`);
    return res.send(csv);
  } catch (err: any) {
    logger.error({ err }, "Special dates export failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to export special dates") });
  }
});

function escapeCsvField(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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
