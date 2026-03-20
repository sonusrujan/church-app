import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { createSubscription, getMemberSubscriptions } from "../services/subscriptionService";
import { reconcileOverdueSubscriptions } from "../services/subscriptionTrackingService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";

const router = Router();

router.post("/create", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const { member_id, plan_name, amount, billing_cycle, start_date, next_payment_date } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can create subscriptions" });
    }

    const result = await createSubscription({
      member_id,
      plan_name,
      amount,
      billing_cycle,
      start_date,
      next_payment_date,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create subscription" });
  }
});

router.get("/my", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const member_id = (req.query.member_id as string) || "";
    if (!member_id) return res.status(400).json({ error: "member_id is required" });

    const subscriptions = await getMemberSubscriptions(member_id);
    return res.json(subscriptions);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to get subscriptions" });
  }
});

router.post("/reconcile-overdue", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can reconcile subscriptions" });
    }

    const requestedScope = String(req.body?.scope || req.query.scope || "").trim().toLowerCase();
    const canUseGlobalScope = isSuperAdminEmail(req.user.email) && requestedScope === "all";

    const result = await reconcileOverdueSubscriptions(
      canUseGlobalScope ? undefined : req.user.church_id || undefined
    );
    return res.json({
      success: true,
      scope: canUseGlobalScope ? "all" : "church",
      ...result,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to reconcile subscriptions" });
  }
});

export default router;
