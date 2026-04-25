import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { validate, createPastorSchema, updatePastorSchema, transferPastorSchema } from "../utils/zodSchemas";
import {
  createPastor,
  deletePastor,
  getPastorById,
  listPastors,
  transferPastor,
  updatePastor,
} from "../services/pastorService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";

const router = Router();

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email, req.user.phone);
  const normalizedRequested = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";

  if (requesterIsSuperAdmin) {
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

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const activeOnly =
      req.user.role === "member"
        ? true
        : String(req.query.active_only || "").toLowerCase() !== "false";

    const pastors = await listPastors(churchId, activeOnly);
    return res.json(pastors);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list pastors") });
  }
});

router.post("/create", requireAuth, requireRegisteredUser, validate(createPastorSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can add pastors" });
    }

    const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email, req.user.phone);
    const requestedChurchId = typeof req.body?.church_id === "string" ? req.body.church_id.trim() : "";
    if (requesterIsSuperAdmin && !requestedChurchId) {
      return res.status(400).json({ error: "church_id is required to create pastor" });
    }

    const churchId = resolveScopedChurchId(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const pastor = await createPastor({
      church_id: churchId,
      full_name: String(req.body?.full_name || ""),
      phone_number: String(req.body?.phone_number || ""),
      email: typeof req.body?.email === "string" ? req.body.email : undefined,
      details: typeof req.body?.details === "string" ? req.body.details : undefined,
      created_by: req.user.id,
    });

    logSuperAdminAudit(req, "pastor.create", {
      pastor_id: pastor.id,
      church_id: churchId,
      full_name: pastor.full_name,
    });
    await persistAuditLog(req, "pastor.create", "pastor", pastor.id, { church_id: churchId });

    return res.json(pastor);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create pastor") });
  }
});

router.patch("/:id", requireAuth, requireRegisteredUser, validate(updatePastorSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can update pastors" });
    }

    const churchId = resolveScopedChurchId(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const pastorId = String(req.params.id || "").trim();
    if (!pastorId || !UUID_REGEX.test(pastorId)) {
      return res.status(400).json({ error: "Invalid pastor ID format" });
    }
    const pastor = await updatePastor(churchId, pastorId, {
      full_name: req.body?.full_name,
      phone_number: req.body?.phone_number,
      email: req.body?.email,
      details: req.body?.details,
      is_active: typeof req.body?.is_active === "boolean" ? req.body.is_active : undefined,
    });

    logSuperAdminAudit(req, "pastor.update", {
      pastor_id: pastorId,
      church_id: churchId,
    });
    await persistAuditLog(req, "pastor.update", "pastor", pastorId, { church_id: churchId });

    return res.json(pastor);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update pastor") });
  }
});

router.get("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can fetch pastor details" });
    }

    const pastorId = String(req.params.id || "").trim();
    if (!pastorId || !UUID_REGEX.test(pastorId)) {
      return res.status(400).json({ error: "Invalid pastor ID format" });
    }
    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const pastor = await getPastorById(churchId, pastorId);
    if (!pastor) {
      return res.status(404).json({ error: "Pastor not found" });
    }

    return res.json(pastor);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch pastor") });
  }
});

router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete pastors" });
    }

    const pastorId = String(req.params.id || "").trim();
    if (!pastorId || !UUID_REGEX.test(pastorId)) {
      return res.status(400).json({ error: "Invalid pastor ID format" });
    }
    const churchId = resolveScopedChurchId(req, req.body?.church_id || req.query.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const result = await deletePastor(churchId, pastorId);
    logSuperAdminAudit(req, "pastor.delete", {
      pastor_id: pastorId,
      church_id: churchId,
    });
    await persistAuditLog(req, "pastor.delete", "pastor", pastorId, { church_id: churchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete pastor") });
  }
});

router.post("/:id/transfer", requireAuth, requireRegisteredUser, validate(transferPastorSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only super admin can transfer pastors across churches" });
    }

    const pastorId = String(req.params.id || "").trim();
    if (!pastorId || !UUID_REGEX.test(pastorId)) {
      return res.status(400).json({ error: "Invalid pastor ID format" });
    }

    // Super admins must explicitly provide from_church_id (no defaulting to own church)
    const explicitFromChurchId = typeof req.body?.from_church_id === "string" ? req.body.from_church_id.trim() : "";
    if (!explicitFromChurchId) {
      return res.status(400).json({ error: "from_church_id is required for pastor transfers" });
    }
    const fromChurchId = explicitFromChurchId;
    const toChurchId = typeof req.body?.to_church_id === "string" ? req.body.to_church_id.trim() : "";

    if (!fromChurchId || !toChurchId) {
      return res.status(400).json({ error: "from_church_id and to_church_id are required" });
    }

    const transferred = await transferPastor({
      pastor_id: pastorId,
      from_church_id: fromChurchId,
      to_church_id: toChurchId,
    });

    logSuperAdminAudit(req, "pastor.transfer", {
      pastor_id: pastorId,
      from_church_id: fromChurchId,
      to_church_id: toChurchId,
    });
    await persistAuditLog(req, "pastor.transfer", "pastor", pastorId, { from_church_id: fromChurchId, to_church_id: toChurchId });

    return res.json(transferred);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to transfer pastor") });
  }
});

export default router;
