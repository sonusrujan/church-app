import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { postAnnouncement, getAnnouncements } from "../services/announcementService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { notifyChurchMembers } from "../services/notificationService";
import { validate, postAnnouncementSchema } from "../utils/zodSchemas";
import { logger } from "../utils/logger";

const router = Router();

router.post("/post", requireAuth, requireRegisteredUser, validate(postAnnouncementSchema), async (req: AuthRequest, res) => {
  try {
    const { title, message } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (typeof title === "string" && title.length > 200) {
      return res.status(400).json({ error: "Title must be 200 characters or less" });
    }
    if (typeof message === "string" && message.length > 2000) {
      return res.status(400).json({ error: "Message must be 2000 characters or less" });
    }
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can post announcements" });
    }
    if (!req.user.church_id) {
      return res.status(400).json({ error: "No church associated with your account" });
    }
    const announcement = await postAnnouncement(req.user.church_id, title, message, req.user.id);
    await persistAuditLog(req, "announcement.create", "announcement", announcement?.id, { title });
    // Fire-and-forget push to all church members
    notifyChurchMembers({
      church_id: req.user.church_id,
      notification_type: "announcement",
      subject: title || "New Announcement",
      body: message || "",
      channels: ["push"],
    }).catch((err: unknown) => { logger.warn({ err }, "Failed to queue announcement notification"); });
    return res.json(announcement);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to post announcement") });
  }
});

router.get("/list", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const announcements = await getAnnouncements(req.user.church_id, limit, offset);
    return res.json(announcements);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to get announcements") });
  }
});

export default router;
