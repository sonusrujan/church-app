import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { grantFreeTrial, revokeFreeTrial, getChurchTrialStatus } from "../services/trialService";
import { exportMembersCsv, exportPaymentsCsv, exportDonationSummaryCsv } from "../services/exportService";
import { listAuditLogs } from "../utils/auditLog";
import { persistAuditLog } from "../utils/auditLog";
import { safeErrorMessage } from "../utils/safeError";
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES } from "../config";
import {
  createScheduledReport,
  listScheduledReports,
  deleteScheduledReport,
  toggleScheduledReport,
} from "../services/scheduledReportService";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSuperAdmin(email?: string, phone?: string): boolean {
  if (email && SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase())) return true;
  if (phone && SUPER_ADMIN_PHONES.includes(phone.trim())) return true;
  return false;
}

function resolveChurchId(req: AuthRequest): string | undefined {
  if (isSuperAdmin(req.user?.email, req.user?.phone)) {
    const resolved = (req.query.church_id as string)?.trim() || req.user?.church_id;
    if (!resolved) throw new Error("church_id is required for super admin operations");
    return resolved;
  }
  return req.user?.church_id || undefined;
}

// ═══ Trial Management (Super Admin Only) ═══

router.get("/trial", requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const churchId = req.query.church_id as string;
    if (!churchId) return res.status(400).json({ error: "church_id required." });

    const status = await getChurchTrialStatus(churchId);
    return res.json(status);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get trial status.") });
  }
});

router.post("/trial/grant", requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { church_id, months } = req.body;
    if (!church_id || typeof church_id !== "string") {
      return res.status(400).json({ error: "church_id required." });
    }
    const monthsNum = Number(months);
    if (!Number.isInteger(monthsNum) || monthsNum < 1 || monthsNum > 24) {
      return res.status(400).json({ error: "months must be 1–24." });
    }

    const result = await grantFreeTrial(church_id, monthsNum, req.user!.id);

    await persistAuditLog(req, "trial.granted", "church", church_id, { months: monthsNum });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to grant trial.") });
  }
});

router.post("/trial/revoke", requireAuth, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { church_id } = req.body;
    if (!church_id || typeof church_id !== "string") {
      return res.status(400).json({ error: "church_id required." });
    }

    const result = await revokeFreeTrial(church_id);

    await persistAuditLog(req, "trial.revoked", "church", church_id);

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to revoke trial.") });
  }
});

// ═══ Data Export (Super Admin Only) ═══

router.get("/export/members", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const churchId = resolveChurchId(req);
    if (!churchId) return res.status(400).json({ error: "Church ID required." });

    const csv = await exportMembersCsv(churchId);

    await persistAuditLog(req, "export.members", "church", churchId);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="members.csv"');
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Export failed.") });
  }
});

router.get("/export/payments", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const churchId = resolveChurchId(req);
    if (!churchId) return res.status(400).json({ error: "Church ID required." });

    const csv = await exportPaymentsCsv(churchId);

    await persistAuditLog(req, "export.payments", "church", churchId);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Export failed.") });
  }
});

router.get("/export/donations", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const churchId = resolveChurchId(req);
    if (!churchId) return res.status(400).json({ error: "Church ID required." });

    const csv = await exportDonationSummaryCsv(churchId);

    await persistAuditLog(req, "export.donations", "church", churchId);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="donation_summary.csv"');
    return res.send(csv);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Export failed.") });
  }
});

// ═══ Audit Log (Admin + Super Admin) ═══

router.get("/audit-log", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    if (role !== "admin" && !isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const churchId = resolveChurchId(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const logs = await listAuditLogs(churchId, limit, offset, isSuperAdmin(req.user?.email, req.user?.phone));
    return res.json({ logs });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load audit log.") });
  }
});

// ═══ Scheduled Reports (Super Admin Only) ═══

router.get("/scheduled-reports", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const churchId = resolveChurchId(req);
    const reports = await listScheduledReports(churchId);
    return res.json(reports);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load scheduled reports.") });
  }
});

router.post("/scheduled-reports", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const churchId = resolveChurchId(req);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const report = await createScheduledReport({
      church_id: churchId,
      report_type: req.body?.report_type,
      frequency: req.body?.frequency,
      recipient_emails: req.body?.recipient_emails || [],
    });

    persistAuditLog(req, "scheduled_report.create", "scheduled_report", report.id, {
      report_type: req.body?.report_type, frequency: req.body?.frequency,
    });

    return res.json(report);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create scheduled report.") });
  }
});

router.delete("/scheduled-reports/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: "Invalid report ID" });
    }
    const churchId = resolveChurchId(req);
    const result = await deleteScheduledReport(id, churchId);
    persistAuditLog(req, "scheduled_report.delete", "scheduled_report", id);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete scheduled report.") });
  }
});

router.patch("/scheduled-reports/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    if (!isSuperAdmin(req.user?.email, req.user?.phone)) {
      return res.status(403).json({ error: "Super Admin access required." });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id as string;
    if (!id || !UUID_REGEX.test(id)) {
      return res.status(400).json({ error: "Invalid report ID" });
    }
    const churchId = resolveChurchId(req);
    const result = await toggleScheduledReport(id, Boolean(req.body?.enabled), churchId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update scheduled report.") });
  }
});

export default router;
