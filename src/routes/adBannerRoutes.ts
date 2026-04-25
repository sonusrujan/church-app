import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import {
  listAdBanners,
  createAdBanner,
  updateAdBanner,
  deleteAdBanner,
} from "../services/adBannerService";
import { validate, createAdBannerSchema } from "../utils/zodSchemas";

const router = Router();

// BNR-001: Validate URLs are HTTP(S) to prevent javascript:/data: XSS
function isValidHttpUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isSuperAdmin(req: AuthRequest): boolean {
  return Boolean(req.user && isSuperAdminEmail(req.user.email, req.user.phone));
}

// List banners for a scope (public for display, auth-only)
router.get("/", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const scope = String(req.query.scope || "").trim();
    const scopeId = String(req.query.scope_id || "").trim();
    if (!["diocese", "church"].includes(scope) || !UUID_REGEX.test(scopeId)) {
      return res.status(400).json({ error: "scope (diocese|church) and scope_id are required" });
    }

    // BNR-002: Non-super-admins can only view banners for their own church
    if (!isSuperAdmin(req)) {
      if (scope === "church" && scopeId !== req.user?.church_id) {
        return res.status(403).json({ error: "Cannot view banners for other churches" });
      }
    }

    const banners = await listAdBanners(scope as "diocese" | "church", scopeId);
    return res.json(banners);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list banners") });
  }
});

// Create banner (SuperAdmin only)
router.post("/", requireAuth, requireRegisteredUser, validate(createAdBannerSchema), async (req: AuthRequest, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const { scope, scope_id, image_url, link_url, sort_order, media_type, position, start_date, end_date } = req.body;
    if (!["diocese", "church"].includes(scope)) return res.status(400).json({ error: "scope must be diocese or church" });
    if (!UUID_REGEX.test(scope_id)) return res.status(400).json({ error: "Invalid scope_id" });
    if (typeof image_url !== "string" || !image_url.trim()) return res.status(400).json({ error: "image_url is required" });

    // BNR-001: Validate URL protocols
    if (!isValidHttpUrl(image_url.trim())) {
      return res.status(400).json({ error: "image_url must be a valid HTTP(S) URL" });
    }
    if (typeof link_url === "string" && link_url.trim() && !isValidHttpUrl(link_url.trim())) {
      return res.status(400).json({ error: "link_url must be a valid HTTP(S) URL" });
    }

    const banner = await createAdBanner({
      scope,
      scope_id,
      image_url: image_url.trim(),
      media_type: ["image", "video", "gif"].includes(media_type) ? media_type : "image",
      position: ["top", "bottom"].includes(position) ? position : "bottom",
      link_url: typeof link_url === "string" ? link_url.trim() : undefined,
      sort_order: typeof sort_order === "number" ? sort_order : undefined,
      created_by: req.registeredProfile?.id,
      start_date: typeof start_date === "string" ? start_date : undefined,
      end_date: typeof end_date === "string" ? end_date : undefined,
    });
    persistAuditLog(req, "ad_banner.create", "ad_banners", banner.id, { scope, scope_id });
    return res.json(banner);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create banner") });
  }
});

// Update banner
router.patch("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid banner ID" });

    const { image_url, link_url, sort_order, is_active, media_type, position, start_date, end_date } = req.body;

    // BNR-001: Validate URL protocols on update too
    if (typeof image_url === "string" && image_url.trim() && !isValidHttpUrl(image_url.trim())) {
      return res.status(400).json({ error: "image_url must be a valid HTTP(S) URL" });
    }
    if (typeof link_url === "string" && link_url.trim() && !isValidHttpUrl(link_url.trim())) {
      return res.status(400).json({ error: "link_url must be a valid HTTP(S) URL" });
    }

    const banner = await updateAdBanner(id, {
      image_url: typeof image_url === "string" ? image_url : undefined,
      media_type: ["image", "video", "gif"].includes(media_type) ? media_type : undefined,
      position: ["top", "bottom"].includes(position) ? position : undefined,
      link_url: link_url !== undefined ? (typeof link_url === "string" ? link_url : null) : undefined,
      sort_order: typeof sort_order === "number" ? sort_order : undefined,
      is_active: typeof is_active === "boolean" ? is_active : undefined,
      start_date: start_date !== undefined ? (typeof start_date === "string" ? start_date : null) : undefined,
      end_date: end_date !== undefined ? (typeof end_date === "string" ? end_date : null) : undefined,
    });
    persistAuditLog(req, "ad_banner.update", "ad_banners", id, {});
    return res.json(banner);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update banner") });
  }
});

// Delete banner
router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!isSuperAdmin(req)) return res.status(403).json({ error: "SuperAdmin access required" });

    const id = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(id)) return res.status(400).json({ error: "Invalid banner ID" });

    const result = await deleteAdBanner(id);
    persistAuditLog(req, "ad_banner.delete", "ad_banners", id, {});
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete banner") });
  }
});

export default router;
