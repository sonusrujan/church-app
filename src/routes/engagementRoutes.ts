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
  updatePrayerRequest,
  deleteOwnPrayerRequest,
  updateChurchEvent,
  deleteChurchEvent,
  updateChurchNotification,
  deleteChurchNotification,
  listAllEvents,
  listAllNotifications,
  getAdminPendingCounts,
  toggleEventRsvp,
  getEventRsvpSummaries,
  markNotificationsRead,
  getReadNotificationIds,
  getNotificationPreferences,
  updateNotificationPreference,
} from "../services/engagementService";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";
import { notifyChurchMembers } from "../services/notificationService";
import { logger } from "../utils/logger";
import { validate, createEventSchema, createNotificationSchema } from "../utils/zodSchemas";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveChurchScope(req: AuthRequest, providedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requested = typeof providedChurchId === "string" ? providedChurchId.trim() : "";
  if (isSuperAdminEmail(req.user.email, req.user.phone)) {
    const resolved = requested || req.user.church_id;
    // MED-005: Validate UUID format
    if (resolved && !UUID_RE.test(resolved)) throw new Error("Invalid church_id format");
    return resolved;
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

router.post("/events", requireAuth, requireRegisteredUser, validate(createEventSchema), async (req: AuthRequest, res) => {
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
      end_time: req.body?.end_time,
      location: req.body?.location,
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

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const offset = Number(req.query.offset) || 0;
    const notifications = await listChurchNotifications(churchId, limit, offset);
    return res.json(notifications);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list notifications") });
  }
});

router.post("/notifications", requireAuth, requireRegisteredUser, validate(createNotificationSchema), async (req: AuthRequest, res) => {
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
      idempotency_key: typeof req.body?.idempotency_key === "string" ? req.body.idempotency_key : undefined,
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
      end_time: req.body?.end_time,
      location: req.body?.location,
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
      is_anonymous: !!req.body?.is_anonymous,
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

router.patch("/prayer-requests/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const requestId = String(req.params.id);
    if (!UUID_RE.test(requestId)) return res.status(400).json({ error: "Invalid prayer request ID" });

    const churchId = resolveChurchScope(req, req.body?.church_id || String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const updated = await updatePrayerRequest(
      requestId,
      churchId,
      { email: req.user.email, phone: req.user.phone, user_id: req.user.id },
      req.body?.details,
    );

    persistAuditLog(req, "engagement.prayer_request.update", "prayer_request", requestId, { church_id: churchId });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update prayer request") });
  }
});

router.delete("/prayer-requests/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const requestId = String(req.params.id);
    if (!UUID_RE.test(requestId)) return res.status(400).json({ error: "Invalid prayer request ID" });

    const churchId = resolveChurchScope(req, String(req.query.church_id || req.body?.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const deleted = await deleteOwnPrayerRequest(
      requestId,
      churchId,
      { email: req.user.email, phone: req.user.phone, user_id: req.user.id },
    );

    persistAuditLog(req, "engagement.prayer_request.delete", "prayer_request", requestId, { church_id: churchId });
    return res.json(deleted);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete prayer request") });
  }
});

// ── RSVP ──────────────────────────────────────────────────────

// Toggle RSVP for an event
router.post("/events/:id/rsvp", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const eventId = String(req.params.id);
    if (!UUID_RE.test(eventId)) return res.status(400).json({ error: "Invalid event ID" });
    const status = req.body?.status === "interested" ? "interested" : "going";
    const result = await toggleEventRsvp(eventId, req.user!.id, status);
    return res.json({ rsvp: result });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update RSVP") });
  }
});

// Get RSVP summaries for a batch of events (used by frontend)
router.post("/events/rsvp-summaries", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const eventIds = req.body?.event_ids;
    if (!Array.isArray(eventIds) || eventIds.length === 0) return res.json({});
    // Limit to 200 IDs
    const safeIds = eventIds.slice(0, 200).filter((id: string) => UUID_RE.test(id));
    const summaries = await getEventRsvpSummaries(safeIds, req.user!.id);
    return res.json(summaries);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get RSVP summaries") });
  }
});

// ── Notification read tracking ────────────────────────────────

// Get read notification IDs for current user
router.get("/notifications/read-ids", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const ids = await getReadNotificationIds(req.user!.id);
    return res.json(ids);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get read IDs") });
  }
});

// Mark notifications as read
router.post("/notifications/mark-read", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const ids = req.body?.notification_ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ ok: true });
    await markNotificationsRead(req.user!.id, ids);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to mark notifications read") });
  }
});

// ── Notification Preferences ──────────────────────────────────

router.get("/notification-preferences", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const prefs = await getNotificationPreferences(req.user!.id);
    return res.json(prefs);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get preferences") });
  }
});

router.put("/notification-preferences", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const { category, enabled } = req.body || {};
    if (!category || typeof enabled !== "boolean") {
      return res.status(400).json({ error: "category (string) and enabled (boolean) are required" });
    }
    await updateNotificationPreference(req.user!.id, category, enabled);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update preference") });
  }
});

export default router;
