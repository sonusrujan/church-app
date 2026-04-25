import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { createSubscription, getMemberSubscriptions } from "../services/subscriptionService";
import { reconcileOverdueSubscriptions, listChurchActivityEvents } from "../services/subscriptionTrackingService";
import { safeErrorMessage } from "../utils/safeError";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { db } from "../services/dbClient";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import { persistAuditLog } from "../utils/auditLog";
import { validate, createSubscriptionSchema } from "../utils/zodSchemas";

const router = Router();

const subscriptionWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

router.post("/create", requireAuth, requireRegisteredUser, subscriptionWriteLimiter, validate(createSubscriptionSchema), async (req: AuthRequest, res) => {
  try {
    const { member_id, plan_name, amount, billing_cycle } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can create subscriptions" });
    }

    // Enforce member_subscription_enabled SaaS setting
    const scopedChurchId = req.user.church_id;
    if (scopedChurchId) {
      const saasSettings = await getChurchSaaSSettings(scopedChurchId);
      if (!saasSettings.member_subscription_enabled) {
        return res.status(403).json({ error: "Member subscriptions are disabled for this church" });
      }
    }

    // Verify the member belongs to the admin's church (prevent cross-tenant creation)
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      const { data: targetMember } = await db
        .from("members")
        .select("id, church_id, verification_status")
        .eq("id", member_id)
        .maybeSingle();
      if (!targetMember || targetMember.church_id !== req.user.church_id) {
        return res.status(403).json({ error: "Member does not belong to your church" });
      }
      if (targetMember.verification_status === "rejected" || targetMember.verification_status === "suspended") {
        return res.status(400).json({ error: `Cannot create subscription for a ${targetMember.verification_status} member. Update their status first.` });
      }
    }

    // Church subscriptions always start on the 5th of the month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startDate = now.getDate() <= 5
      ? new Date(year, month, 5)
      : new Date(year, month + 1, 5);
    const cycle = billing_cycle || "monthly";
    if (!["monthly", "yearly"].includes(cycle)) {
      return res.status(400).json({ error: "billing_cycle must be 'monthly' or 'yearly'" });
    }
    const nextPaymentDate = cycle === "yearly"
      ? new Date(startDate.getFullYear() + 1, startDate.getMonth(), 5)
      : new Date(startDate.getFullYear(), startDate.getMonth() + 1, 5);

    // MED-3: Idempotency guard — prevent duplicate active subscriptions for the same member+plan
    const { data: existingActive } = await db
      .from("subscriptions")
      .select("id")
      .eq("member_id", member_id)
      .eq("plan_name", plan_name)
      .in("status", ["active", "overdue"])
      .limit(1)
      .maybeSingle();
    if (existingActive) {
      return res.status(409).json({ error: `Member already has an active subscription for plan "${plan_name}".` });
    }

    const result = await createSubscription({
      member_id,
      plan_name,
      amount,
      billing_cycle: cycle,
      start_date: startDate.toISOString().slice(0, 10),
      next_payment_date: nextPaymentDate.toISOString().slice(0, 10),
    });
    await persistAuditLog(req, "subscription.create", "subscription", result?.id, { member_id, plan_name, amount });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create subscription") });
  }
});

router.get("/my", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const member_id = (req.query.member_id as string) || "";
    if (!member_id) return res.status(400).json({ error: "member_id is required" });

    // Verify the member belongs to the requesting user or their church (for admins)
    const { data: targetMember } = await db
      .from("members")
      .select("id, user_id, church_id")
      .eq("id", member_id)
      .maybeSingle();
    if (!targetMember) {
      return res.status(404).json({ error: "Member not found" });
    }
    const isOwner = targetMember.user_id === req.user.id;
    const isChurchAdmin = req.user.role === "admin" && targetMember.church_id === req.user.church_id;
    const isSuper = isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isOwner && !isChurchAdmin && !isSuper) {
      return res.status(403).json({ error: "You do not have access to this member's subscriptions" });
    }

    const subscriptions = await getMemberSubscriptions(member_id, targetMember.church_id);
    return res.json(subscriptions);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to get subscriptions") });
  }
});

router.post("/reconcile-overdue", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can reconcile subscriptions" });
    }

    const requestedScope = String(req.body?.scope || req.query.scope || "").trim().toLowerCase();
    const canUseGlobalScope = isSuperAdminEmail(req.user.email, req.user.phone) && requestedScope === "all";

    const result = await reconcileOverdueSubscriptions(
      canUseGlobalScope ? undefined : req.user.church_id || undefined
    );
    await persistAuditLog(req, "subscription.reconcile", "subscription", undefined, { scope: canUseGlobalScope ? "all" : "church" });
    return res.json({
      success: true,
      scope: canUseGlobalScope ? "all" : "church",
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to reconcile subscriptions") });
  }
});

router.get("/activity", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admins can view activity logs" });
    }

    const isSuper = isSuperAdminEmail(req.user.email, req.user.phone);
    const churchId = isSuper
      ? (typeof req.query.church_id === "string" ? req.query.church_id.trim() : null)
      : (req.user.church_id || null);

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const events = await listChurchActivityEvents(
      isSuper && !churchId ? null : churchId,
      limit,
      offset,
    );
    return res.json(events);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load activity log") });
  }
});

export default router;
