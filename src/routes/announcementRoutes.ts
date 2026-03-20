import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { sendAnnouncement, getAnnouncements } from "../services/announcementService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";

const router = Router();

router.post("/send", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const { title, message } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can post announcements" });
    }
    const announcement = await sendAnnouncement(req.user.church_id, title, message, req.user.id);
    return res.json(announcement);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to send announcement" });
  }
});

router.get("/list", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const announcements = await getAnnouncements(req.user.church_id);
    return res.json(announcements);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to get announcements" });
  }
});

export default router;
