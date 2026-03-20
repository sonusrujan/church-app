import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import {
  createChurchEvent,
  createChurchNotification,
  createPrayerRequest,
  listChurchEvents,
  listChurchNotifications,
  listPrayerRequests,
} from "../services/engagementService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";

const router = Router();

function resolveChurchScope(req: AuthRequest, providedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requested = typeof providedChurchId === "string" ? providedChurchId.trim() : "";
  if (isSuperAdminEmail(req.user.email)) {
    return requested || req.user.church_id;
  }

  return req.user.church_id;
}

router.get("/events", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = resolveChurchScope(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const events = await listChurchEvents(churchId);
    return res.json(events);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to list events" });
  }
});

router.post("/events", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can post events" });
    }

    const churchId = resolveChurchScope(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const created = await createChurchEvent({
      church_id: churchId,
      title: req.body?.title,
      message: req.body?.message,
      event_date: req.body?.event_date,
      created_by: req.user.id,
    });

    logSuperAdminAudit(req, "engagement.event.create", {
      church_id: churchId,
      event_id: created.id,
      title: created.title,
    });

    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to post event" });
  }
});

router.get("/notifications", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = resolveChurchScope(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const notifications = await listChurchNotifications(churchId);
    return res.json(notifications);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to list notifications" });
  }
});

router.post("/notifications", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can post notifications" });
    }

    const churchId = resolveChurchScope(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const created = await createChurchNotification({
      church_id: churchId,
      title: req.body?.title,
      message: req.body?.message,
      created_by: req.user.id,
    });

    logSuperAdminAudit(req, "engagement.notification.create", {
      church_id: churchId,
      notification_id: created.id,
      title: created.title,
    });

    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to post notification" });
  }
});

router.post("/prayer-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const churchId = resolveChurchScope(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const created = await createPrayerRequest({
      church_id: churchId,
      member_email: req.user.email,
      pastor_ids: req.body?.pastor_ids,
      details: req.body?.details,
    });

    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to send prayer request" });
  }
});

router.get("/prayer-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const churchId = resolveChurchScope(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const asAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email);
    const memberEmail = asAdmin ? undefined : req.user.email;
    const rows = await listPrayerRequests(churchId, memberEmail);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to list prayer requests" });
  }
});

export default router;
