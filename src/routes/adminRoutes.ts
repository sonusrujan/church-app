import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
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
import { getChurchIncomeSummary } from "../services/analyticsService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";

const router = Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get(
  "/list",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
  try {
    const churchId = (req.query.church_id as string) || req.user?.church_id || undefined;
    const admins = await listAdmins(churchId);
    return res.json(admins);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch admins" });
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
      const churchId = typeof req.query.church_id === "string" ? req.query.church_id : undefined;
      const query = typeof req.query.query === "string" ? req.query.query : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const rows = await searchAdmins({ churchId, query, limit });
      return res.json(rows);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to search admins" });
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
      const adminId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!adminId || !UUID_REGEX.test(adminId)) {
        return res.status(400).json({ error: "Invalid admin ID format" });
      }
      const admin = await getAdminById(adminId);
      if (!admin) {
        return res.status(404).json({ error: "Admin not found" });
      }
      return res.json(admin);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to fetch admin" });
    }
  }
);

router.patch(
  "/id/:id",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const adminId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to update admin" });
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
      const adminId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!adminId || !UUID_REGEX.test(adminId)) {
        return res.status(400).json({ error: "Invalid admin ID format" });
      }
      const result = await removeAdminById(adminId);
      logSuperAdminAudit(req, "admin.role.remove", {
        admin_id: adminId,
      });
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to remove admin" });
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

      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
        return res.status(403).json({ error: "Only admin can view income summary" });
      }

      const requestedChurchId =
        typeof req.query.church_id === "string" && req.query.church_id.trim()
          ? req.query.church_id.trim()
          : "";

      const churchId = isSuperAdminEmail(req.user.email)
        ? requestedChurchId || req.user.church_id
        : req.user.church_id;

      if (!churchId) {
        return res.status(400).json({ error: "church_id is required" });
      }

      const summary = await getChurchIncomeSummary(churchId);
      return res.json({ church_id: churchId, ...summary });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to load income summary" });
    }
  }
);

router.post(
  "/pre-register-member",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
      }

      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
        return res.status(403).json({ error: "Only admin can pre-register members" });
      }

      const { email, full_name, membership_id, address, subscription_amount, church_id } = req.body;
      if (!email || typeof email !== "string" || !email.trim()) {
        return res.status(400).json({ error: "email is required" });
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

      const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email);
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
      }

      const result = await preRegisterMember({
        email: String(email),
        church_id: resolvedChurchId,
        full_name: typeof full_name === "string" ? full_name : undefined,
        membership_id: typeof membership_id === "string" ? membership_id : undefined,
        address: typeof address === "string" ? address : undefined,
        subscription_amount: normalizedSubscriptionAmount,
      });

      logSuperAdminAudit(req, "member.pre_register", {
        church_id: resolvedChurchId,
        email: String(email),
      });

      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to pre-register member" });
    }
  }
);

router.post(
  "/grant",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
  try {
    const { email, church_id } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    const normalizedChurchId =
      typeof church_id === "string" && church_id.trim() ? church_id.trim() : undefined;
    if (normalizedChurchId && !UUID_REGEX.test(normalizedChurchId)) {
      return res.status(400).json({ error: "church_id must be a valid UUID" });
    }

    const updatedUser = await grantAdminAccess(
      String(email),
      normalizedChurchId || req.user?.church_id || undefined
    );

    logSuperAdminAudit(req, "admin.role.grant", {
      email: String(email),
      church_id: normalizedChurchId || req.user?.church_id || undefined,
      user_id: updatedUser.id,
    });

    return res.json(updatedUser);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to grant admin access" });
  }
  }
);

router.post(
  "/revoke",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    if (isSuperAdminEmail(String(email))) {
      return res.status(400).json({ error: "Super admin email cannot be revoked" });
    }

    const updatedUser = await revokeAdminAccess(String(email));
    logSuperAdminAudit(req, "admin.role.revoke", {
      email: String(email),
      user_id: updatedUser.id,
    });
    return res.json(updatedUser);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to revoke admin access" });
  }
  }
);

export default router;
