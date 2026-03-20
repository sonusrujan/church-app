import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import {
  createPastor,
  deletePastor,
  getPastorById,
  listPastors,
  transferPastor,
  updatePastor,
} from "../services/pastorService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";

const router = Router();

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email);
  const normalizedRequested = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";

  if (requesterIsSuperAdmin) {
    return normalizedRequested || req.user.church_id;
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
    return res.status(400).json({ error: err.message || "Failed to list pastors" });
  }
});

router.post("/create", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can add pastors" });
    }

    const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email);
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

    return res.json(pastor);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to create pastor" });
  }
});

router.patch("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can update pastors" });
    }

    const churchId = resolveScopedChurchId(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const pastorId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

    return res.json(pastor);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to update pastor" });
  }
});

router.get("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can fetch pastor details" });
    }

    const pastorId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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
    return res.status(400).json({ error: err.message || "Failed to fetch pastor" });
  }
});

router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can delete pastors" });
    }

    const pastorId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const churchId = resolveScopedChurchId(req, req.body?.church_id || req.query.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const result = await deletePastor(churchId, pastorId);
    logSuperAdminAudit(req, "pastor.delete", {
      pastor_id: pastorId,
      church_id: churchId,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to delete pastor" });
  }
});

router.post("/:id/transfer", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only super admin can transfer pastors across churches" });
    }

    const pastorId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const fromChurchId = resolveScopedChurchId(req, req.body?.from_church_id || req.body?.church_id);
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

    return res.json(transferred);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to transfer pastor" });
  }
});

export default router;
