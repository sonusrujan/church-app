import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import {
  createChurch,
  deleteChurch,
  getChurchById,
  getChurchDeleteImpact,
  listChurches,
  listChurchesWithStats,
  searchChurches,
  updateChurch,
} from "../services/churchService";
import {
  getChurchPaymentSettings,
  updateChurchPaymentSettings,
} from "../services/churchPaymentService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { pool } from "../services/dbClient";

import rateLimit from "express-rate-limit";

const router = Router();

// MED-012: Dedicated rate limit for unauthenticated public search
const publicSearchLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many search requests, please try again later" },
});

// ── Public: search churches (no auth required, limited fields) ──
router.get("/public-search", publicSearchLimiter, async (req, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query || query.length < 2) {
      return res.json([]);
    }
    const rows = await searchChurches(query, 20);
    // Get member counts for all matched churches
    const churchIds = rows.map((r: any) => r.id);
    const countMap: Record<string, number> = {};
    if (churchIds.length) {
      const { rows: countRows } = await pool.query(
        `SELECT church_id, COUNT(*)::int AS cnt FROM members WHERE church_id = ANY($1) AND deleted_at IS NULL GROUP BY church_id`,
        [churchIds],
      );
      for (const c of countRows) countMap[c.church_id] = c.cnt;
    }
    const publicRows = rows.map((r: any) => ({
      name: r.name,
      church_code: r.church_code || null,
      address: r.address || null,
      location: r.location || null,
      member_count: countMap[r.id] || 0,
    }));
    return res.json(publicRows);
  } catch (err: any) {
    return res.status(500).json({ error: "Search failed" });
  }
});

router.get("/public-info", publicSearchLimiter, async (req, res) => {
  try {
    const churchId = typeof req.query.church_id === "string" ? req.query.church_id.trim() : "";
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "church_id query parameter is required" });
    }

    const church = await getChurchById(churchId);
    if (!church) {
      return res.status(404).json({ error: "Church not found" });
    }

    return res.json({
      id: church.id,
      name: church.name,
      location: church.location || null,
      logo_url: church.logo_url || null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch church") });
  }
});

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const normalizedRequested = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";
  if (isSuperAdminEmail(req.user.email, req.user.phone)) {
    const resolved = normalizedRequested || req.user.church_id;
    if (!resolved) throw new Error("church_id is required for super admin operations");
    return resolved;
  }

  return req.user.church_id;
}

router.get("/list", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const requestedChurchId =
      typeof req.query.church_id === "string" && req.query.church_id.trim()
        ? req.query.church_id.trim()
        : undefined;

    if (isSuperAdminEmail(req.user.email, req.user.phone)) {
      const churches = await listChurches(requestedChurchId);
      return res.json(churches);
    }

    if (!req.user.church_id) {
      return res.json([]);
    }

    const churches = await listChurches(req.user.church_id);
    return res.json(churches);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch churches") });
  }
});

router.get("/summary", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    // Only admins and super admins can view church summary/stats
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can view church summary" });
    }

    const requestedChurchId =
      typeof req.query.church_id === "string" && req.query.church_id.trim()
        ? req.query.church_id.trim()
        : undefined;

    const churchId = isSuperAdminEmail(req.user.email, req.user.phone)
      ? requestedChurchId
      : req.user.church_id || undefined;

    const rows = await listChurchesWithStats(churchId);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch church summary") });
  }
});

router.get("/search", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const rows = await searchChurches(query, limit || 50);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to search churches") });
  }
});

router.get("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID format" });
    }
    const church = await getChurchById(churchId);
    if (!church) {
      return res.status(404).json({ error: "Church not found" });
    }
    return res.json(church);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch church") });
  }
});

router.post(
  "/create",
  requireAuth,
  requireRegisteredUser,
  requireSuperAdmin,
  async (req: AuthRequest, res) => {
    try {
      const created = await createChurch({
        name: req.body?.name,
        address: typeof req.body?.address === "string" ? req.body.address : undefined,
        location: typeof req.body?.location === "string" ? req.body.location : undefined,
        contact_phone:
          typeof req.body?.contact_phone === "string" ? req.body.contact_phone : undefined,
        logo_url: typeof req.body?.logo_url === "string" ? req.body.logo_url : undefined,
        admin_phones: Array.isArray(req.body?.admin_phones) ? req.body.admin_phones : undefined,
        member_subscription_enabled: typeof req.body?.member_subscription_enabled === "boolean" ? req.body.member_subscription_enabled : undefined,
        church_subscription_enabled: typeof req.body?.church_subscription_enabled === "boolean" ? req.body.church_subscription_enabled : undefined,
        church_subscription_amount: typeof req.body?.church_subscription_amount === "number" ? req.body.church_subscription_amount : undefined,
        platform_fee_enabled: typeof req.body?.platform_fee_enabled === "boolean" ? req.body.platform_fee_enabled : undefined,
        platform_fee_percentage: typeof req.body?.platform_fee_percentage === "number" ? req.body.platform_fee_percentage : undefined,
        service_enabled: typeof req.body?.service_enabled === "boolean" ? req.body.service_enabled : undefined,
      });

      logSuperAdminAudit(req, "church.create", {
        church_id: created.church.id,
        name: created.church.name,
      });
      persistAuditLog(req, "church.create", "church", created.church.id, { name: created.church.name });

      return res.json(created);
    } catch (err: any) {
      return res.status(400).json({ error: safeErrorMessage(err, "Failed to create church") });
    }
  }
);

router.patch("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID format" });
    }
    const updated = await updateChurch(churchId, {
      name: req.body?.name,
      address: req.body?.address,
      location: req.body?.location,
      contact_phone: req.body?.contact_phone,
      church_code: req.body?.church_code,
      logo_url: req.body?.logo_url,
    });

    logSuperAdminAudit(req, "church.update", {
      church_id: churchId,
    });
    persistAuditLog(req, "church.update", "church", churchId);

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update church") });
  }
});

router.get("/id/:id/delete-impact", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID format" });
    }
    const impact = await getChurchDeleteImpact(churchId);
    return res.json(impact);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to inspect delete impact") });
  }
});

router.delete("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.id || "").trim();
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID format" });
    }
    const force =
      req.body?.force === true ||
      String(req.query.force || "").toLowerCase() === "true";

    if (!force) {
      const impact = await getChurchDeleteImpact(churchId);
      return res.status(409).json({
        error: "Delete requires force=true",
        impact,
      });
    }

    const result = await deleteChurch(churchId);
    logSuperAdminAudit(req, "church.delete", {
      church_id: churchId,
    });
    persistAuditLog(req, "church.delete", "church", churchId);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete church") });
  }
});

router.get("/payment-config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can access church payment config" });
    }

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const config = await getChurchPaymentSettings(churchId);
    return res.json(config);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get church payment config") });
  }
});

router.post("/payment-config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can update church payment config" });
    }

    const churchId = resolveScopedChurchId(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const updated = await updateChurchPaymentSettings({
      church_id: churchId,
      payments_enabled:
        typeof req.body?.payments_enabled === "boolean" ? req.body.payments_enabled : undefined,
      key_id: typeof req.body?.key_id === "string" ? req.body.key_id : undefined,
      key_secret: typeof req.body?.key_secret === "string" ? req.body.key_secret : undefined,
    });

    logSuperAdminAudit(req, "church.payment_config.update", {
      church_id: churchId,
      payments_enabled:
        typeof req.body?.payments_enabled === "boolean" ? req.body.payments_enabled : undefined,
      key_id_set: Boolean(typeof req.body?.key_id === "string" && req.body.key_id.trim()),
      key_secret_rotated: Boolean(
        typeof req.body?.key_secret === "string" && req.body.key_secret.trim()
      ),
    });

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update church payment config") });
  }
});

// ── Admin self-service: update own church logo ──
router.patch("/my-logo", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can update church logo" });
    const churchId = req.user.church_id;
    if (!churchId) return res.status(400).json({ error: "No church association" });
    const logoUrl = typeof req.body?.logo_url === "string" ? req.body.logo_url : null;
    const updated = await updateChurch(churchId, { logo_url: logoUrl || "" });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update church logo") });
  }
});

export default router;
