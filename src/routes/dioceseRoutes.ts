import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import {
  DIOCESE_ROLES,
  listDioceses,
  createDiocese,
  updateDiocese,
  deleteDiocese,
  updateDioceseMedia,
  addDioceseLogo,
  removeDioceseLogo,
  getDioceseByChurchId,
  listDioceseChurches,
  addChurchesToDiocese,
  removeChurchFromDiocese,
  listDioceseLeaders,
  createDioceseLeader,
  updateDioceseLeader,
  deleteDioceseLeader,
} from "../services/dioceseService";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All diocese routes are SuperAdmin only */
function requireSuperAdmin(req: AuthRequest): boolean {
  return Boolean(req.user && isSuperAdminEmail(req.user.email, req.user.phone));
}

// Get available diocese roles (must be before /:id routes)
router.get("/roles", requireAuth, requireRegisteredUser, async (_req: AuthRequest, res) => {
  return res.json(DIOCESE_ROLES);
});

// Get diocese info for a church (any authenticated user)
router.get("/by-church/:churchId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "").trim();
    if (!UUID_REGEX.test(churchId)) return res.status(400).json({ error: "Invalid church ID" });
    const diocese = await getDioceseByChurchId(churchId);
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get diocese") });
  }
});

// ══════════════════════════════════════════════════════════════════════
// Diocese CRUD
// ══════════════════════════════════════════════════════════════════════

// List all dioceses
router.get("/", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });
    const dioceses = await listDioceses();
    return res.json(dioceses);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list dioceses") });
  }
});

// Create diocese
router.post("/", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Diocese name is required" });
    }

    const diocese = await createDiocese(name, req.registeredProfile?.id);
    persistAuditLog(req, "diocese.create", "diocese", diocese.id, { name: name.trim() });
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create diocese") });
  }
});

// Update diocese
router.patch("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { name } = req.body;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Diocese name is required" });
    }

    const diocese = await updateDiocese(id, name);
    persistAuditLog(req, "diocese.update", "diocese", id, { name: name.trim() });
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update diocese") });
  }
});

// Delete diocese
router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const result = await deleteDiocese(id);
    persistAuditLog(req, "diocese.delete", "diocese", id, {});
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete diocese") });
  }
});

// Update diocese media (logo/banner)
router.patch("/:id/media", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { logo_url, banner_url } = req.body;
    const diocese = await updateDioceseMedia(id, {
      logo_url: logo_url !== undefined ? (typeof logo_url === "string" ? logo_url : null) : undefined,
      banner_url: banner_url !== undefined ? (typeof banner_url === "string" ? banner_url : null) : undefined,
    });
    persistAuditLog(req, "diocese.update_media", "diocese", id, {});
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update diocese media") });
  }
});

// Add a logo to diocese (max 3)
router.post("/:id/logos", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { logo_url } = req.body;
    if (typeof logo_url !== "string" || !logo_url.trim()) {
      return res.status(400).json({ error: "logo_url is required" });
    }

    const diocese = await addDioceseLogo(id, logo_url.trim());
    persistAuditLog(req, "diocese.add_logo", "diocese", id, {});
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to add diocese logo") });
  }
});

// Remove a logo from diocese
router.delete("/:id/logos", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { logo_url } = req.body;
    if (typeof logo_url !== "string" || !logo_url.trim()) {
      return res.status(400).json({ error: "logo_url is required" });
    }

    const diocese = await removeDioceseLogo(id, logo_url.trim());
    persistAuditLog(req, "diocese.remove_logo", "diocese", id, {});
    return res.json(diocese);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to remove diocese logo") });
  }
});

// ══════════════════════════════════════════════════════════════════════
// Diocese ↔ Church mapping
// ══════════════════════════════════════════════════════════════════════

// List churches in a diocese
router.get("/:id/churches", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const churches = await listDioceseChurches(id);
    return res.json(churches);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list diocese churches") });
  }
});

// Add churches to a diocese
router.post("/:id/churches", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { church_ids } = req.body;
    if (!Array.isArray(church_ids) || !church_ids.length) {
      return res.status(400).json({ error: "church_ids array is required" });
    }

    const validIds = church_ids.filter((cid: unknown) => typeof cid === "string" && UUID_REGEX.test(cid));
    if (!validIds.length) return res.status(400).json({ error: "No valid church IDs provided" });

    const result = await addChurchesToDiocese(id, validIds);
    persistAuditLog(req, "diocese.add_churches", "diocese", id, { church_ids: validIds });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to add churches to diocese") });
  }
});

// Remove a church from a diocese
router.delete("/:id/churches/:churchId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    const churchId = String(req.params.churchId || "").trim();
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const result = await removeChurchFromDiocese(id, churchId);
    persistAuditLog(req, "diocese.remove_church", "diocese", id, { church_id: churchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to remove church from diocese") });
  }
});

// ══════════════════════════════════════════════════════════════════════
// Diocese Leadership
// ══════════════════════════════════════════════════════════════════════

// List leaders for a diocese (any authenticated member can view)
router.get("/:id/leaders", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid diocese ID" });

    const leaders = await listDioceseLeaders(id);
    return res.json(leaders);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list diocese leaders") });
  }
});

// Assign a diocese leader
router.post("/:id/leaders", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const dioceseId = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(dioceseId)) return res.status(400).json({ error: "Invalid diocese ID" });

    const { role, full_name, phone_number, email, bio, photo_url } = req.body;

    if (typeof role !== "string" || !role.trim()) {
      return res.status(400).json({ error: "role is required" });
    }
    if (typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "full_name is required" });
    }

    const leader = await createDioceseLeader({
      diocese_id: dioceseId,
      role: role.trim(),
      full_name: full_name.trim(),
      phone_number: typeof phone_number === "string" ? phone_number.trim() : undefined,
      email: typeof email === "string" ? email.trim() : undefined,
      bio: typeof bio === "string" ? bio.trim() : undefined,
      photo_url: typeof photo_url === "string" ? photo_url.trim() : undefined,
      assigned_by: req.registeredProfile?.id,
    });

    persistAuditLog(req, "diocese_leader.assign", "diocese_leadership", leader.id, { diocese_id: dioceseId, role, full_name: full_name.trim() });
    return res.json(leader);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to assign diocese leader") });
  }
});

// Update a diocese leader
router.patch("/:id/leaders/:leaderId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const dioceseId = String(req.params.id || "").trim();
    const leaderId = String(req.params.leaderId || "").trim();
    if (!UUID_REGEX.test(dioceseId) || !UUID_REGEX.test(leaderId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const { full_name, phone_number, email, bio, photo_url, role, is_active } = req.body;

    const leader = await updateDioceseLeader(dioceseId, leaderId, {
      full_name: typeof full_name === "string" ? full_name : undefined,
      phone_number: typeof phone_number === "string" ? phone_number : undefined,
      email: typeof email === "string" ? email : undefined,
      bio: typeof bio === "string" ? bio : undefined,
      photo_url: typeof photo_url === "string" ? photo_url : undefined,
      role: typeof role === "string" ? role : undefined,
      is_active: typeof is_active === "boolean" ? is_active : undefined,
    });

    persistAuditLog(req, "diocese_leader.update", "diocese_leadership", leaderId, { diocese_id: dioceseId });
    return res.json(leader);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update diocese leader") });
  }
});

// Remove (deactivate) a diocese leader
router.delete("/:id/leaders/:leaderId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!requireSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const dioceseId = String(req.params.id || "").trim();
    const leaderId = String(req.params.leaderId || "").trim();
    if (!UUID_REGEX.test(dioceseId) || !UUID_REGEX.test(leaderId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const result = await deleteDioceseLeader(dioceseId, leaderId);
    persistAuditLog(req, "diocese_leader.remove", "diocese_leadership", leaderId, { diocese_id: dioceseId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to remove diocese leader") });
  }
});

export default router;
