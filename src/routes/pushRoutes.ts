import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin, isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { savePushSubscription, removePushSubscription, queueNotification, sendSmsNow } from "../services/notificationService";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";
import { safeErrorMessage } from "../utils/safeError";
import { VAPID_PUBLIC_KEY } from "../config";
import { persistAuditLog } from "../utils/auditLog";
import { enqueueJob } from "../services/jobQueueService";

const router = Router();

// ── GET /vapid-public-key — return VAPID public key for the frontend ──
router.get("/vapid-public-key", (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: "Push notifications not configured" });
  }
  return res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── POST /subscribe — save push subscription ──
router.post("/subscribe", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid push subscription payload" });
    }

    await savePushSubscription(userId, endpoint, keys.p256dh, keys.auth);
    return res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "push subscribe failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to save subscription") });
  }
});

// ── POST /unsubscribe — remove push subscription ──
router.post("/unsubscribe", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthenticated" });

    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: "Endpoint required" });

    await removePushSubscription(userId, endpoint);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to unsubscribe") });
  }
});

// ── POST /resubscribe — called by service worker when push subscription rotates ──
// No auth required (service worker can't attach auth tokens).
// Matches old endpoint to find the user, then replaces with new endpoint.
router.post("/resubscribe", async (req, res) => {
  try {
    const { oldEndpoint, newEndpoint, keys } = req.body;
    if (!newEndpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Invalid resubscribe payload" });
    }

    if (oldEndpoint && typeof oldEndpoint === "string") {
      // Find the user who owns the old endpoint
      const { data: existing } = await db
        .from("push_subscriptions")
        .select("user_id")
        .eq("endpoint", oldEndpoint)
        .maybeSingle();

      if (existing?.user_id) {
        // Remove old subscription and save new one
        await removePushSubscription(existing.user_id, oldEndpoint);
        await savePushSubscription(existing.user_id, newEndpoint, keys.p256dh, keys.auth);
        logger.info({ userId: existing.user_id }, "Push subscription rotated successfully");
        return res.json({ success: true });
      }
    }

    // Old endpoint not found — can't determine user without auth
    return res.json({ success: false, reason: "old_endpoint_not_found" });
  } catch (err: any) {
    logger.error({ err }, "push resubscribe failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to resubscribe") });
  }
});

// ══════════════════════════════════════════════════════════════════
// Super Admin: Send Custom Push / SMS Notification Tool
// POST /send-notification
// Filters: diocese_id, church_id, member_id (cascading)
// Channel: "push" | "sms"
// ══════════════════════════════════════════════════════════════════

router.post("/send-notification", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { diocese_id, church_id, member_id, channel, title, message, url } = req.body;

    if (!channel || !["push", "sms"].includes(channel)) {
      return res.status(400).json({ error: "channel must be 'push' or 'sms'" });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    if (channel === "push" && (!title || typeof title !== "string" || !title.trim())) {
      return res.status(400).json({ error: "title is required for push notifications" });
    }

    // ── Resolve recipient members ──
    let members: Array<{ id: string; user_id: string | null; email: string | null; phone_number: string | null; church_id: string }>;

    if (member_id) {
      // Single member
      const { data, error } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id")
        .eq("id", member_id)
        .is("deleted_at", null)
        .limit(1);
      if (error) throw error;
      members = data || [];
    } else if (church_id) {
      // All members of a specific church
      const { data, error } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id")
        .eq("church_id", church_id)
        .is("deleted_at", null);
      if (error) throw error;
      members = data || [];
    } else if (diocese_id) {
      // All members of all churches in a diocese (via junction table)
      const { data: links, error: cErr } = await db
        .from("diocese_churches")
        .select("church_id")
        .eq("diocese_id", diocese_id);
      if (cErr) throw cErr;
      const churchIds = (links || []).map((c: any) => c.church_id);
      if (!churchIds.length) return res.json({ queued: 0, message: "No churches in diocese" });

      const { data, error } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id")
        .in("church_id", churchIds)
        .is("deleted_at", null);
      if (error) throw error;
      members = data || [];
    } else {
      // All members globally
      const { data, error } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id")
        .is("deleted_at", null);
      if (error) throw error;
      members = data || [];
    }

    if (!members.length) {
      return res.json({ queued: 0, message: "No matching recipients" });
    }

    // For push channel, exclude family dependents — their user_id points to the
    // family head, so sending push to them would notify the head instead.
    if (channel === "push") {
      const memberIds = members.map((m) => m.id);
      const { data: depLinks } = await db
        .from("family_members")
        .select("linked_to_member_id")
        .in("linked_to_member_id", memberIds);
      if (depLinks && depLinks.length) {
        const depSet = new Set(depLinks.map((l: any) => l.linked_to_member_id));
        members = members.filter((m) => !depSet.has(m.id));
      }
    }

    if (!members.length) {
      return res.json({ queued: 0, message: "No matching recipients (family dependents excluded for push)" });
    }

    // ── Build job entries ──
    let queued = 0;
    const BATCH = 500;
    const deliveryRows: Record<string, unknown>[] = [];
    const jobRows: Array<{ job_type: string; payload: Record<string, unknown> }> = [];

    const scope = member_id ? "member" : church_id ? "church" : diocese_id ? "diocese" : "global";
    const scopeId = member_id || church_id || diocese_id || null;

    // Create a batch record for tracking
    const { data: batchRow, error: batchErr } = await db
      .from("notification_batches")
      .insert({
        channel,
        scope,
        scope_id: scopeId,
        title: channel === "push" ? title : null,
        body: message,
        total_count: 0,
        status: "sending",
        created_by: req.user?.id || null,
      })
      .select("id")
      .single();

    if (batchErr || !batchRow) {
      logger.error({ err: batchErr }, "Failed to create notification batch");
      return res.status(500).json({ error: "Failed to create notification batch" });
    }
    const batchId = (batchRow as any).id;

    for (const m of members) {
      if (channel === "push" && m.user_id) {
        deliveryRows.push({
          batch_id: batchId,
          church_id: m.church_id,
          recipient_user_id: m.user_id,
          channel: "push",
          notification_type: "super_admin_custom",
          subject: title,
          body: message,
          status: "pending",
          metadata: {},
        });
        jobRows.push({
          job_type: "send_push",
          payload: { channel: "push", recipient_user_id: m.user_id, subject: title, body: message, url: url || "/" },
        });
      }

      if (channel === "sms" && m.phone_number) {
        deliveryRows.push({
          batch_id: batchId,
          church_id: m.church_id,
          recipient_user_id: m.user_id || null,
          recipient_phone: m.phone_number,
          channel: "sms",
          notification_type: "super_admin_custom",
          body: message,
          status: "pending",
          metadata: {},
        });
        jobRows.push({
          job_type: "send_sms",
          payload: { channel: "sms", to: m.phone_number, body: message },
        });
      }
    }

    if (!deliveryRows.length) {
      return res.json({ queued: 0, message: "No recipients have the required contact info for this channel" });
    }

    for (let i = 0; i < deliveryRows.length; i += BATCH) {
      const batch = deliveryRows.slice(i, i + BATCH);
      const jobBatch = jobRows.slice(i, i + BATCH);

      const { data: inserted } = await db
        .from("notification_deliveries")
        .insert(batch)
        .select("id");

      if (inserted && inserted.length > 0) {
        const jobInserts = inserted.map((row: any, idx: number) => ({
          job_type: jobBatch[idx]?.job_type || "send_push",
          payload: { ...jobBatch[idx]?.payload, delivery_id: row.id },
          status: "pending",
        }));
        await db.from("job_queue").insert(jobInserts);
        queued += inserted.length;
      }
    }

    // Update batch total_count
    await db.from("notification_batches").update({ total_count: queued }).eq("id", batchId);

    await persistAuditLog(req, "super_admin.send_notification", "notification", undefined, {
      channel, scope, diocese_id, church_id, member_id, queued, batch_id: batchId,
    });

    logger.info({ channel, scope, queued, batchId, userId: req.user?.id }, "Super admin sent custom notification");
    return res.json({ queued, batch_id: batchId, message: `${queued} ${channel} notification(s) queued` });
  } catch (err: any) {
    logger.error({ err }, "send-notification failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to send notifications") });
  }
});

// ── GET /dioceses — list dioceses for filter dropdown ──
router.get("/dioceses", requireAuth, requireRegisteredUser, requireSuperAdmin, async (_req, res) => {
  try {
    const { data, error } = await db
      .from("dioceses")
      .select("id, name")
      .order("name");
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch dioceses") });
  }
});

// ── GET /churches — list churches, optionally filtered by diocese ──
router.get("/churches", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req, res) => {
  try {
    const dioceseId = req.query.diocese_id as string;
    if (dioceseId) {
      // Get church IDs belonging to this diocese via junction table
      const { data: links, error: linkErr } = await db
        .from("diocese_churches")
        .select("church_id")
        .eq("diocese_id", dioceseId);
      if (linkErr) throw linkErr;
      const churchIds = (links || []).map((l: any) => l.church_id);
      if (!churchIds.length) return res.json([]);
      const { data, error } = await db
        .from("churches")
        .select("id, name")
        .in("id", churchIds)
        .order("name");
      if (error) throw error;
      return res.json((data || []).map((c: any) => ({ ...c, diocese_id: dioceseId })));
    } else {
      const { data, error } = await db.from("churches").select("id, name").order("name");
      if (error) throw error;
      return res.json((data || []).map((c: any) => ({ ...c, diocese_id: null })));
    }
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch churches") });
  }
});

// ── GET /members — list members, optionally filtered by church ──
router.get("/members", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req, res) => {
  try {
    let query = db.from("members").select("id, full_name, email, church_id").is("deleted_at", null).order("full_name").limit(200);
    const churchId = req.query.church_id as string;
    if (churchId) query = query.eq("church_id", churchId);
    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch members") });
  }
});

// ══════════════════════════════════════════════════════════════════
// Notification Batch Tracking
// ══════════════════════════════════════════════════════════════════

// ── GET /notification-batches — list recent notification batches ──
router.get("/notification-batches", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const { data, error } = await db
      .from("notification_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json(data || []);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch notification batches") });
  }
});

// ── GET /notification-batches/:batchId — batch detail with live status counts ──
router.get("/notification-batches/:batchId", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req, res) => {
  try {
    const { batchId } = req.params;

    // Get the batch record
    const { data: batch, error: batchErr } = await db
      .from("notification_batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();
    if (batchErr) throw batchErr;
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    // Get live delivery status counts
    const { data: deliveries, error: delErr } = await db
      .from("notification_deliveries")
      .select("id, status, recipient_user_id, recipient_phone, sent_at, error_message")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: true });
    if (delErr) throw delErr;

    const items = deliveries || [];
    const counts = {
      total: items.length,
      pending: items.filter((d: any) => d.status === "pending").length,
      sent: items.filter((d: any) => d.status === "sent").length,
      delivered: items.filter((d: any) => d.status === "delivered").length,
      failed: items.filter((d: any) => d.status === "failed").length,
      cancelled: items.filter((d: any) => d.status === "cancelled").length,
    };

    // Update batch status based on live counts
    let batchStatus = (batch as any).status;
    if (counts.pending === 0 && counts.total > 0) {
      if (counts.cancelled === counts.total) batchStatus = "cancelled";
      else if (counts.failed > 0 && counts.sent === 0 && counts.delivered === 0) batchStatus = "partially_failed";
      else batchStatus = "completed";

      if (batchStatus !== (batch as any).status) {
        await db.from("notification_batches").update({
          status: batchStatus,
          sent_count: counts.sent + counts.delivered,
          failed_count: counts.failed,
          cancelled_count: counts.cancelled,
          completed_at: new Date().toISOString(),
        }).eq("id", batchId);
      }
    }

    return res.json({
      ...(batch as any),
      status: batchStatus,
      counts,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to fetch batch details") });
  }
});

// ── POST /notification-batches/:batchId/cancel — cancel pending deliveries in a batch ──
router.post("/notification-batches/:batchId/cancel", requireAuth, requireRegisteredUser, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { batchId } = req.params;

    // Verify batch exists
    const { data: batch, error: batchErr } = await db
      .from("notification_batches")
      .select("id, status")
      .eq("id", batchId)
      .maybeSingle();
    if (batchErr) throw batchErr;
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    // Cancel all pending deliveries in this batch
    const { data: cancelled, error: cancelErr } = await db
      .from("notification_deliveries")
      .update({ status: "cancelled" })
      .eq("batch_id", batchId)
      .eq("status", "pending")
      .select("id");
    if (cancelErr) throw cancelErr;

    const cancelledCount = cancelled?.length || 0;

    // Also cancel the corresponding pending jobs
    if (cancelledCount > 0) {
      const cancelledIds = (cancelled || []).map((d: any) => d.id);
      // Get job IDs linked to these deliveries and cancel them
      const { data: jobs } = await db
        .from("job_queue")
        .select("id, payload")
        .in("status", ["pending", "retry"]);

      if (jobs && jobs.length > 0) {
        const cancelledSet = new Set(cancelledIds);
        const jobIdsToCancel = jobs
          .filter((j: any) => j.payload?.delivery_id && cancelledSet.has(j.payload.delivery_id))
          .map((j: any) => j.id);

        if (jobIdsToCancel.length > 0) {
          await db
            .from("job_queue")
            .update({ status: "failed", error_message: "Cancelled by super admin" })
            .in("id", jobIdsToCancel);
        }
      }
    }

    // Update batch
    await db.from("notification_batches").update({
      status: "cancelled",
      cancelled_count: cancelledCount,
      completed_at: new Date().toISOString(),
    }).eq("id", batchId);

    await persistAuditLog(req, "super_admin.cancel_notification_batch", "notification", batchId as string, {
      cancelled_count: cancelledCount,
    });

    logger.info({ batchId, cancelledCount, userId: req.user?.id }, "Super admin cancelled notification batch");
    return res.json({ cancelled: cancelledCount, message: `${cancelledCount} pending notification(s) cancelled` });
  } catch (err: any) {
    logger.error({ err }, "cancel-notification-batch failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to cancel notifications") });
  }
});

// ── GET /push-diagnostics — test outbound push connectivity (super admin only) ──
router.get("/push-diagnostics", requireAuth, requireRegisteredUser, requireSuperAdmin, async (_req, res) => {
  try {
    // 1. Count subscriptions
    const { data: subStats, error: subErr } = await db
      .from("push_subscriptions")
      .select("id, endpoint, user_id");
    if (subErr) throw subErr;

    const subs = subStats || [];
    const endpoints = subs.map((s: any) => {
      try {
        const url = new URL(s.endpoint);
        return url.hostname;
      } catch { return "invalid"; }
    });
    const hostCounts: Record<string, number> = {};
    for (const h of endpoints) hostCounts[h] = (hostCounts[h] || 0) + 1;

    // 2. Test outbound connectivity to known push services
    const https = await import("https");
    const testHosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
    const connTests: Record<string, string> = {};

    for (const host of testHosts) {
      try {
        await new Promise<void>((resolve, reject) => {
          const req = https.request({ hostname: host, port: 443, path: "/", method: "HEAD", timeout: 5000 }, (resp: any) => {
            connTests[host] = `OK (${resp.statusCode})`;
            resp.resume();
            resolve();
          });
          req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
          req.on("error", (err: any) => reject(err));
          req.end();
        });
      } catch (err: any) {
        connTests[host] = `FAIL: ${err.message || err.code || String(err)}`;
      }
    }

    // 3. Check recent job_queue push failures
    const { data: recentJobs } = await db
      .from("job_queue")
      .select("id, status, error_message, completed_at, payload")
      .eq("job_type", "send_push")
      .order("created_at", { ascending: false })
      .limit(10);

    return res.json({
      subscriptions: { total: subs.length, endpointHosts: hostCounts },
      connectivity: connTests,
      recentPushJobs: (recentJobs || []).map((j: any) => ({
        id: j.id, status: j.status, error: j.error_message,
        userId: j.payload?.recipient_user_id,
      })),
    });
  } catch (err: any) {
    logger.error({ err }, "push-diagnostics failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Diagnostics failed") });
  }
});

export default router;
