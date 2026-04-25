import { Router } from "express";
import multer from "multer";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { uploadToS3, deleteFromS3, validateMediaUpload } from "../services/uploadService";
import { logger } from "../utils/logger";
import { persistAuditLog } from "../utils/auditLog";

const router = Router();

/**
 * Check if a URL belongs to the given church or is a legacy upload (pre-scoping).
 * New format: uploads/{churchId}/avatars/file.jpg — must match churchId.
 * Legacy format: uploads/avatars/file.jpg — allowed (no church prefix exists).
 */
function isOwnedUpload(url: string, churchId: string): boolean {
  try {
    const pathname = new URL(url).pathname; // e.g. /uploads/avatars/x.jpg or /uploads/{id}/avatars/x.jpg
    const segments = pathname.split("/").filter(Boolean); // ["uploads", ...rest]
    if (segments.length < 3 || segments[0] !== "uploads") return false;
    // New format: ["uploads", churchId, subfolder, file] — 4 segments
    if (segments.length >= 4 && ["avatars", "leaders", "logos", "banners", "events", "notifications"].includes(segments[2])) {
      return segments[1] === churchId;
    }
    // Legacy format: ["uploads", subfolder, file] — 3 segments, no church prefix.
    // Deny ownership — we cannot verify which church this file belongs to.
    // These files persist in S3; admins must manage them via AWS Console if removal is needed.
    if (segments.length === 3 && ["avatars", "leaders", "logos", "banners", "events", "notifications"].includes(segments[1])) {
      logger.warn({ url, churchId }, "Denied operation on legacy upload path — no church prefix to verify ownership");
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB for video/media
});

router.post(
  "/image",
  requireAuth,
  requireRegisteredUser,
  upload.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided." });
      }

      // Only admins and super admins can upload files
      const role = req.user?.role;
      const isAdmin = role === "admin" || role === "super_admin" || isSuperAdminEmail(req.user?.email, req.user?.phone);
      if (!isAdmin) {
        return res.status(403).json({ error: "Only admins can upload files." });
      }

      // Church-scoped folder: uploads are namespaced by church_id
      // SuperAdmin may not have a church_id — allow specifying target_church_id
      let churchId = req.user?.church_id;
      if (!churchId && isSuperAdminEmail(req.user?.email, req.user?.phone)) {
        churchId = typeof req.body.target_church_id === "string" ? req.body.target_church_id.trim() : "";
      }
      if (!churchId) {
        return res.status(403).json({ error: "You must belong to a church to upload files." });
      }

      const subfolder = typeof req.body.folder === "string" && ["avatars", "leaders", "logos", "banners", "events", "notifications"].includes(req.body.folder)
        ? req.body.folder
        : "avatars";
      const folder = `${churchId}/${subfolder}`;

      const url = await uploadToS3(file, folder);

      // If replacing an old image, validate it belongs to the same church before deleting
      const oldUrl = typeof req.body.old_url === "string" ? req.body.old_url : "";
      if (oldUrl && isOwnedUpload(oldUrl, churchId)) {
        deleteFromS3(oldUrl).catch((e) =>
          logger.warn({ err: e }, "Failed to delete old upload")
        );
      }

      persistAuditLog(req, "upload.image", "file", undefined, { subfolder, church_id: churchId, replaced: !!oldUrl }).catch((e) => logger.warn({ err: e }, "Audit log failed for upload.image"));

      return res.json({ url });
    } catch (err: any) {
      const message = err?.message || "Upload failed.";
      return res.status(400).json({ error: message });
    }
  }
);

// ── Media upload (video/image/gif, up to 20 MB) for banners ──
router.post(
  "/media",
  requireAuth,
  requireRegisteredUser,
  uploadMedia.single("file"),
  async (req: AuthRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file provided." });
      }

      // Only admins and super admins can upload media
      const role = req.user?.role;
      const isAdmin = role === "admin" || role === "super_admin" || isSuperAdminEmail(req.user?.email, req.user?.phone);
      if (!isAdmin) {
        return res.status(403).json({ error: "Only admins can upload files." });
      }

      let churchId = req.user?.church_id;
      if (!churchId && isSuperAdminEmail(req.user?.email, req.user?.phone)) {
        churchId = typeof req.body.target_church_id === "string" ? req.body.target_church_id.trim() : "";
      }
      if (!churchId) {
        return res.status(403).json({ error: "You must belong to a church to upload files." });
      }

      const subfolder = typeof req.body.folder === "string" && ["banners", "events", "notifications"].includes(req.body.folder)
        ? req.body.folder
        : "banners";
      const folder = `${churchId}/${subfolder}`;

      const url = await uploadToS3(file, folder, validateMediaUpload);

      const oldUrl = typeof req.body.old_url === "string" ? req.body.old_url : "";
      if (oldUrl && isOwnedUpload(oldUrl, churchId)) {
        deleteFromS3(oldUrl).catch((e) =>
          logger.warn({ err: e }, "Failed to delete old upload")
        );
      }

      persistAuditLog(req, "upload.media", "file", undefined, { subfolder, church_id: churchId, replaced: !!oldUrl }).catch((e) => logger.warn({ err: e }, "Audit log failed for upload.media"));

      return res.json({ url });
    } catch (err: any) {
      const message = err?.message || "Upload failed.";
      return res.status(400).json({ error: message });
    }
  }
);

router.delete(
  "/image",
  requireAuth,
  requireRegisteredUser,
  async (req: AuthRequest, res) => {
    try {
      // Only admins and super admins can delete uploads
      const role = req.user?.role;
      const isAdmin = role === "admin" || role === "super_admin" || isSuperAdminEmail(req.user?.email, req.user?.phone);
      if (!isAdmin) {
        return res.status(403).json({ error: "Only admins can delete files." });
      }

      const url = typeof req.body.url === "string" ? req.body.url : "";
      if (!url) {
        return res.status(400).json({ error: "No URL provided." });
      }

      // Validate the URL belongs to the user's church (SuperAdmin can delete any owned upload)
      let churchId = req.user?.church_id;
      if (!churchId && isSuperAdminEmail(req.user?.email, req.user?.phone)) {
        // SuperAdmin: extract church_id from the URL path
        try {
          const segments = new URL(url).pathname.split("/").filter(Boolean);
          if (segments.length >= 4 && segments[0] === "uploads") churchId = segments[1];
        } catch { /* ignore */ }
      }
      if (!churchId || !isOwnedUpload(url, churchId)) {
        return res.status(403).json({ error: "You can only delete files belonging to your church." });
      }

      await deleteFromS3(url);

      persistAuditLog(req, "upload.delete", "file", undefined, { url, church_id: churchId }).catch((e) => logger.warn({ err: e }, "Audit log failed for upload.delete"));

      return res.json({ ok: true });
    } catch (err: any) {
      logger.warn({ err }, "Failed to delete image");
      return res.status(400).json({ error: "Failed to delete image." });
    }
  }
);

export default router;
