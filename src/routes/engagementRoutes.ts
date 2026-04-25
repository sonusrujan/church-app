import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import {
  createChurchEvent,
  createChurchNotification,
  createPrayerRequest,
  listChurchEvents,
  listChurchNotifications,
  listPrayerRequests,
  updateChurchEvent,
  deleteChurchEvent,
  updateChurchNotification,
  deleteChurchNotification,
  listAllEvents,
  listAllNotifications,
  getAdminPendingCounts,
} from "../services/engagementService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { notifyChurchMembers } from "../services/notificationService";
import { logger } from "../utils/logger";

const router = Router();

function resolveChurchScope(req: AuthRequest, providedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requested = typeof providedChurchId === "string" ? providedChurchId.trim() : "";
  if (isSuperAdminEmail(req.user.email, req.user.phone)) {
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
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list events") });
  }
});

// ── Admin pending counts (for navbar badges) ──
router.get("/admin-counts", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const churchId = resolveChurchScope(req, String(req.query.church_id || ""));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });

    const counts = await getAdminPendingCounts(churchId);
    return res.json(counts);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch admin counts") });
  }
});

router.post("/events", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
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
      image_url: req.body?.image_url,
      created_by: req.user.id,
    });

    logSuperAdminAudit(req, "engagement.event.create", {
      church_id: churchId,
      event_id: created.id,
      title: created.title,
    });

    persistAuditLog(req, "engagement.event.create", "event", created.id, { church_id: churchId, title: created.title });
    // Push notify church members about new event
    notifyChurchMembers({
      church_id: churchId,
      notification_type: "church_event",
      subject: created.title || "New Church Event",
      body: created.message || created.title || "",
      channels: ["push"],
      url: "/events",
    }).then((r) => {
      logger.info({ churchId, queued: r.queued }, "Event push notifications queued");
    }).catch((err) => {
      logger.error({ err, churchId }, "Event push notifications failed");
    });
    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to post event") });
  }
});

router.get("/notifications", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = resolveChurchScope(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const notifications = await listChurchNotifications(churchId, limit, offset);
    return res.json(notifications);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list notifications") });
  }
});

router.post("/notifications", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
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
      image_url: req.body?.image_url,
      created_by: req.user.id,
    });

    logSuperAdminAudit(req, "engagement.notification.create", {
      church_id: churchId,
      notification_id: created.id,
      title: created.title,
    });

    persistAuditLog(req, "engagement.notification.create", "notification", created.id, { church_id: churchId, title: created.title });
    // Push notify church members about new notification
    notifyChurchMembers({
      church_id: churchId,
      notification_type: "church_notification",
      subject: created.title || "New Notification",
      body: created.message || created.title || "",
      channels: ["push"],
      url: "/home",
    }).then((r) => {
      logger.info({ churchId, queued: r.queued }, "Notification push notifications queued");
    }).catch((err) => {
      logger.error({ err, churchId }, "Notification push notifications failed");
    });
    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to post notification") });
  }
});

function paramStr(val: string | string[] | undefined): string {
  return Array.isArray(val) ? val[0] : val || "";
}

// ═══ Update event ═══
router.put("/events/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can update events" });
    }
    const churchId = resolveChurchScope(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });
    const id = paramStr(req.params.id);

    const updated = await updateChurchEvent(id, churchId, {
      title: req.body?.title,
      message: req.body?.message,
      event_date: req.body?.event_date,
      image_url: req.body?.image_url,
    });

    logSuperAdminAudit(req, "engagement.event.update", { church_id: churchId, event_id: id });
    persistAuditLog(req, "engagement.event.update", "event", id, { church_id: churchId });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update event") });
  }
});

// ═══ Delete event ═══
router.delete("/events/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete events" });
    }
    const churchId = resolveChurchScope(req, req.body?.church_id || String(req.query.church_id || ""));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });
    const id = paramStr(req.params.id);

    await deleteChurchEvent(id, churchId);

    logSuperAdminAudit(req, "engagement.event.delete", { church_id: churchId, event_id: id });
    persistAuditLog(req, "engagement.event.delete", "event", id, { church_id: churchId });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete event") });
  }
});

// ═══ Update notification ═══
router.put("/notifications/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can update notifications" });
    }
    const churchId = resolveChurchScope(req, req.body?.church_id);
    if (!churchId) return res.status(400).json({ error: "church_id is required" });
    const id = paramStr(req.params.id);

    const updated = await updateChurchNotification(id, churchId, {
      title: req.body?.title,
      message: req.body?.message,
      image_url: req.body?.image_url,
    });

    logSuperAdminAudit(req, "engagement.notification.update", { church_id: churchId, notification_id: id });
    persistAuditLog(req, "engagement.notification.update", "notification", id, { church_id: churchId });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update notification") });
  }
});

// ═══ Delete notification ═══
router.delete("/notifications/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete notifications" });
    }
    const churchId = resolveChurchScope(req, req.body?.church_id || String(req.query.church_id || ""));
    if (!churchId) return res.status(400).json({ error: "church_id is required" });
    const id = paramStr(req.params.id);

    await deleteChurchNotification(id, churchId);

    logSuperAdminAudit(req, "engagement.notification.delete", { church_id: churchId, notification_id: id });
    persistAuditLog(req, "engagement.notification.delete", "notification", id, { church_id: churchId });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete notification") });
  }
});

// ═══ Super admin: list all events/notifications across churches ═══
router.get("/all-events", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Super admin only" });
    }
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const events = await listAllEvents(limit, offset);
    return res.json(events);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list all events") });
  }
});

router.get("/all-notifications", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Super admin only" });
    }
    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const notifications = await listAllNotifications(limit, offset);
    return res.json(notifications);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list all notifications") });
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
      member_phone: req.user.phone,
      member_user_id: req.user.id,
      leader_ids: req.body?.leader_ids,
      details: req.body?.details,
    });

    persistAuditLog(req, "engagement.prayer_request.create", "prayer_request", created.prayer_request?.id, { church_id: churchId });
    return res.json(created);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to send prayer request") });
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

    const asAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    const memberIdentifier = asAdmin ? undefined : { email: req.user.email, phone: req.user.phone, user_id: req.user.id };
    const rows = await listPrayerRequests(churchId, memberIdentifier);
    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list prayer requests") });
  }
});

export default router;
