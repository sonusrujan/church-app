import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
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

const router = Router();

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const normalizedRequested = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";
  if (isSuperAdminEmail(req.user.email)) {
    return normalizedRequested || req.user.church_id;
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

    if (isSuperAdminEmail(req.user.email)) {
      const churches = await listChurches(requestedChurchId);
      return res.json(churches);
    }

    if (!req.user.church_id) {
      return res.json([]);
    }

    const churches = await listChurches(req.user.church_id);
    return res.json(churches);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch churches" });
  }
});

router.get("/summary", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const requestedChurchId =
      typeof req.query.church_id === "string" && req.query.church_id.trim()
        ? req.query.church_id.trim()
        : undefined;

    const churchId = isSuperAdminEmail(req.user.email)
      ? requestedChurchId
      : req.user.church_id || undefined;

    const rows = await listChurchesWithStats(churchId);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch church summary" });
  }
});

router.get("/search", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const rows = await searchChurches(query, limit || 50);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to search churches" });
  }
});

router.get("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const church = await getChurchById(churchId);
    if (!church) {
      return res.status(404).json({ error: "Church not found" });
    }
    return res.json(church);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to fetch church" });
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
        admin_emails: Array.isArray(req.body?.admin_emails) ? req.body.admin_emails : undefined,
      });

      logSuperAdminAudit(req, "church.create", {
        church_id: created.church.id,
        name: created.church.name,
      });

      return res.json(created);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Failed to create church" });
    }
  }
);

router.patch("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await updateChurch(churchId, {
      name: req.body?.name,
      address: req.body?.address,
      location: req.body?.location,
      contact_phone: req.body?.contact_phone,
    });

    logSuperAdminAudit(req, "church.update", {
      church_id: churchId,
    });

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to update church" });
  }
});

router.get("/id/:id/delete-impact", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const impact = await getChurchDeleteImpact(churchId);
    return res.json(impact);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to inspect delete impact" });
  }
});

router.delete("/id/:id", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const churchId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to delete church" });
  }
});

router.get("/payment-config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can access church payment config" });
    }

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const config = await getChurchPaymentSettings(churchId);
    return res.json(config);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to get church payment config" });
  }
});

router.post("/payment-config", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
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
    return res.status(400).json({ error: err.message || "Failed to update church payment config" });
  }
});

export default router;
