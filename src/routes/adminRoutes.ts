import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth, invalidateRoleCache } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { validate, adminUpdateMemberSchema, preRegisterMemberSchema, adminGrantSchema, adminRevokeSchema } from "../utils/zodSchemas";
import {
  grantAdminAccess,
  getAdminById,
  listAdmins,
  preRegisterMember,
  removeAdminById,
  revokeAdminAccess,
  searchAdmins,
  updateAdminById,
} from "../services/adminService";
import { getChurchIncomeSummary, getChurchGrowthMetrics, getChurchIncomeDetail, generatePaymentReport } from "../services/analyticsService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";

const router = Router();

router.get(
  "/list",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
  try {
    const churchId = (req.query.church_id as string) || req.user?.church_id || "";
    const isSuperAdmin = isSuperAdminEmail(req.user?.email || "", req.user?.phone);
    if (!churchId && !isSuperAdmin) {
      return res.status(400).json({ error: "church_id is required" });
    }
    const admins = await listAdmins(churchId, isSuperAdmin);
    return res.json(admins);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch admins") });
  }
  }
);

router.get(
  "/search",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const churchId = typeof req.query.church_id === "string" ? req.query.church_id : (req.user?.church_id || "");
      const isSuperAdmin = isSuperAdminEmail(req.user?.email || "", req.user?.phone);
      if (!churchId && !isSuperAdmin) {
        return res.status(400).json({ error: "church_id is required" });
      }
      const query = typeof req.query.query === "string" ? req.query.query : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const rows = await searchAdmins({ churchId, query, limit, allChurches: isSuperAdmin && !churchId });
      return res.json(rows);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to search admins") });
    }
  }
);

router.get(
  "/id/:id",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const adminId = String(req.params.id || "").trim();
      if (!adminId || !UUID_REGEX.test(adminId)) {
        return res.status(400).json({ error: "Invalid admin ID format" });
      }
      const admin = await getAdminById(adminId);
      if (!admin) {
        return res.status(404).json({ error: "Admin not found" });
      }
      return res.json(admin);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch admin") });
    }
  }
);

router.patch(
  "/id/:id",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  validate(adminUpdateMemberSchema),
  async (req: AuthRequest, res) => {
    try {
      const adminId = String(req.params.id || "").trim();
      if (!adminId || !UUID_REGEX.test(adminId)) {
        return res.status(400).json({ error: "Invalid admin ID format" });
      }
      const updated = await updateAdminById(adminId, {
        full_name: req.body?.full_name,
        church_id: req.body?.church_id,
      });

      logSuperAdminAudit(req, "admin.update", {
        admin_id: adminId,
        church_id: req.body?.church_id,
      });
      await persistAuditLog(req, "admin.update", "admin", adminId, { church_id: req.body?.church_id });

      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to update admin") });
    }
  }
);

router.delete(
  "/id/:id",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const adminId = String(req.params.id || "").trim();
      if (!adminId || !UUID_REGEX.test(adminId)) {
        return res.status(400).json({ error: "Invalid admin ID format" });
      }

      // BE-2: Prevent self-deletion
      if (req.user && adminId === req.user.id) {
        return res.status(400).json({ error: "Cannot remove your own admin access" });
      }

      // BE-2: Warn if deleting the last admin of a church
      const targetAdmin = await getAdminById(adminId);
      if (targetAdmin?.church_id) {
        const churchAdmins = await listAdmins(targetAdmin.church_id);
        if (churchAdmins.length <= 1) {
          return res.status(400).json({ error: "Cannot remove the last admin of a church. Assign another admin first." });
        }
      }

      const result = await removeAdminById(adminId);
      logSuperAdminAudit(req, "admin.role.remove", {
        admin_id: adminId,
      });
      await persistAuditLog(req, "admin.delete", "admin", adminId);
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to remove admin") });
    }
  }
);

router.get(
  "/income",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }

      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admin can view income summary" });
      }

      const requestedChurchId =
        typeof req.query.church_id === "string" && req.query.church_id.trim()
          ? req.query.church_id.trim()
          : "";

      const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
        ? requestedChurchId || req.user.church_id
        : req.user.church_id;

      if (!churchId) {
        return res.status(400).json({ error: "church_id is required" });
      }

      const summary = await getChurchIncomeSummary(churchId);
      return res.json({ church_id: churchId, ...summary });
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to load income summary") });
    }
  }
);

router.get(
  "/growth",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }

      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admin can view growth metrics" });
      }

      const requestedChurchId =
        typeof req.query.church_id === "string" && req.query.church_id.trim()
          ? req.query.church_id.trim()
          : "";

      const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
        ? requestedChurchId || req.user.church_id
        : req.user.church_id;

      if (!churchId) {
        return res.status(400).json({ error: "church_id is required" });
      }

      const metrics = await getChurchGrowthMetrics(churchId);
      return res.json({ church_id: churchId, ...metrics });
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to load growth metrics") });
    }
  }
);

router.get(
  "/income-detail",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }
      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admin can view income detail" });
      }
      const requestedChurchId =
        typeof req.query.church_id === "string" && req.query.church_id.trim()
          ? req.query.church_id.trim()
          : "";
      const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
        ? requestedChurchId || req.user.church_id
        : req.user.church_id;
      if (!churchId) {
        return res.status(400).json({ error: "church_id is required" });
      }
      const detail = await getChurchIncomeDetail(churchId);
      return res.json({ church_id: churchId, ...detail });
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to load income detail") });
    }
  }
);

router.get(
  "/payment-report",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }
      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admin can download reports" });
      }
      const requestedChurchId =
        typeof req.query.church_id === "string" && req.query.church_id.trim()
          ? req.query.church_id.trim()
          : "";
      const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
        ? requestedChurchId || req.user.church_id
        : req.user.church_id;
      if (!churchId) {
        return res.status(400).json({ error: "church_id is required" });
      }

      const period = (req.query.period as string) || "monthly";
      if (!["daily", "monthly", "yearly", "custom"].includes(period)) {
        return res.status(400).json({ error: "period must be daily, monthly, yearly, or custom" });
      }
      const year = req.query.year ? Number(req.query.year) : undefined;
      const month = req.query.month ? Number(req.query.month) : undefined;
      const startDate = req.query.start_date as string | undefined;
      const endDate = req.query.end_date as string | undefined;

      const report = await generatePaymentReport(
        churchId,
        period as "daily" | "monthly" | "yearly" | "custom",
        year,
        month,
        startDate,
        endDate,
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      const safeFilename = report.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
      return res.send(report.csv);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to generate report") });
    }
  }
);

router.post(
  "/pre-register-member",
  requireAuth,
  requireRegisteredUser,
  validate(preRegisterMemberSchema),
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }

      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admin can pre-register members" });
      }

      const {
        email,
        phone_number,
        full_name,
        membership_id,
        address,
        subscription_amount,
        church_id,
        occupation,
        confirmation_taken,
        age,
        pending_months,
        no_pending_payments,
      } = req.body;
      if (!email && !phone_number) {
        return res.status(400).json({ error: "email or phone_number is required" });
      }

      const normalizedChurchId =
        typeof church_id === "string" && church_id.trim() ? church_id.trim() : undefined;
      if (normalizedChurchId && !UUID_REGEX.test(normalizedChurchId)) {
        return res.status(400).json({ error: "church_id must be a valid UUID" });
      }

      const resolvedChurchId = normalizedChurchId || req.user.church_id || "";
      if (!resolvedChurchId) {
        return res.status(400).json({ error: "church_id is required" });
      }

      const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email, req.user.phone);
      if (!requesterIsSuperAdmin && normalizedChurchId && normalizedChurchId !== req.user.church_id) {
        return res
          .status(403)
          .json({ error: "Non-super-admin cannot pre-register members outside own church" });
      }

      let normalizedSubscriptionAmount: number | undefined;
      if (subscription_amount !== undefined && subscription_amount !== null && `${subscription_amount}`.trim()) {
        normalizedSubscriptionAmount = Number(subscription_amount);
        if (!Number.isFinite(normalizedSubscriptionAmount) || normalizedSubscriptionAmount < 0) {
          return res.status(400).json({ error: "subscription_amount must be a non-negative number" });
        }
        if (normalizedSubscriptionAmount !== 0 && normalizedSubscriptionAmount < 200) {
          return res.status(400).json({ error: "subscription_amount must be at least 200 (or 0 to skip)" });
        }
      }

      const result = await preRegisterMember({
        email: email ? String(email) : undefined,
        phone_number: phone_number ? String(phone_number).trim() : undefined,
        church_id: resolvedChurchId,
        full_name: typeof full_name === "string" ? full_name : undefined,
        membership_id: typeof membership_id === "string" ? membership_id : undefined,
        address: typeof address === "string" ? address : undefined,
        subscription_amount: normalizedSubscriptionAmount,
        occupation: typeof occupation === "string" ? occupation : undefined,
        confirmation_taken: typeof confirmation_taken === "boolean" ? confirmation_taken : undefined,
        age: typeof age === "number" ? age : undefined,
        pending_months: Array.isArray(pending_months)
          ? pending_months.filter((m: unknown) => typeof m === "string")
          : undefined,
        no_pending_payments: typeof no_pending_payments === "boolean" ? no_pending_payments : undefined,
      });

      logSuperAdminAudit(req, "member.pre_register", {
        church_id: resolvedChurchId,
        identifier: email || phone_number,
      });
      await persistAuditLog(req, "member.pre_register", "member", result.member?.id || result.user?.id, { church_id: resolvedChurchId });

      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to pre-register member") });
    }
  }
);

router.post(
  "/grant",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  validate(adminGrantSchema),
  async (req: AuthRequest, res) => {
  try {
    const { phone_number, church_id } = req.body;
    if (!phone_number) {
      return res.status(400).json({ error: "phone_number is required" });
    }
    const identifier = String(phone_number);

    const normalizedChurchId =
      typeof church_id === "string" && church_id.trim() ? church_id.trim() : undefined;
    if (normalizedChurchId && !UUID_REGEX.test(normalizedChurchId)) {
      return res.status(400).json({ error: "church_id must be a valid UUID" });
    }

    const updatedUser = await grantAdminAccess(
      String(identifier),
      normalizedChurchId || req.user?.church_id || undefined,
      undefined, // super-admin caller — no church restriction
    );

    logSuperAdminAudit(req, "admin.role.grant", {
      identifier: String(identifier),
      church_id: normalizedChurchId || req.user?.church_id || undefined,
      user_id: updatedUser.id,
    });
    await persistAuditLog(req, "admin.role.grant", "admin", updatedUser.id, { identifier: String(identifier) });

    invalidateRoleCache(updatedUser.id);
    return res.json(updatedUser);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to grant admin access") });
  }
  }
);

router.post(
  "/revoke",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  validate(adminRevokeSchema),
  async (req: AuthRequest, res) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) {
      return res.status(400).json({ error: "phone_number is required" });
    }
    const identifier = String(phone_number);

    if (isSuperAdminEmail(String(identifier), String(identifier))) {
      return res.status(400).json({ error: "Super admin cannot be revoked" });
    }

    const updatedUser = await revokeAdminAccess(String(identifier));
    logSuperAdminAudit(req, "admin.role.revoke", {
      identifier: String(identifier),
      user_id: updatedUser.id,
    });
    await persistAuditLog(req, "admin.role.revoke", "admin", updatedUser.id, { identifier: String(identifier) });
    invalidateRoleCache(updatedUser.id);
    return res.json(updatedUser);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to revoke admin access") });
  }
  }
);

export default router;
