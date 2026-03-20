import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import {
  addFamilyMemberForCurrentUser,
  getMemberDashboardByEmail,
  getRegisteredUserContext,
  syncUserProfile,
  updateCurrentUserProfile,
} from "../services/userService";

const router = Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/sync-profile", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { full_name, church_id } = req.body;
    const normalizedChurchId =
      typeof church_id === "string" && church_id.trim() ? church_id.trim() : undefined;
    if (normalizedChurchId && !UUID_REGEX.test(normalizedChurchId)) {
      return res.status(400).json({ error: "church_id must be a valid UUID" });
    }

    const role = isSuperAdminEmail(req.user.email) ? "admin" : "member";

    const profile = await syncUserProfile({
      id: req.user.id,
      email: req.user.email,
      full_name,
      church_id:
        normalizedChurchId ||
        req.registeredProfile?.church_id ||
        req.user.church_id ||
        undefined,
      role,
    });

    return res.json(profile);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to sync user profile" });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const profile = await getRegisteredUserContext(req.user.id, req.user.email);
    if (!profile) {
      return res.status(403).json({ error: "This email is not registered" });
    }

    req.user.role = profile.role;
    req.user.church_id = profile.church_id || "";

    return res.json({
      auth: req.user,
      profile,
      is_super_admin: isSuperAdminEmail(req.user.email),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to get user profile" });
  }
});

router.get("/member-dashboard", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const dashboard = await getMemberDashboardByEmail(req.user.email);
    if (!dashboard) {
      return res.status(403).json({ error: "This email is not registered" });
    }

    return res.json(dashboard);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to load member dashboard" });
  }
});

router.post("/update-profile", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { full_name, avatar_url, address, phone_number, alt_phone_number, subscription_amount } = req.body;

    let normalizedSubscriptionAmount: number | undefined;
    if (
      subscription_amount !== undefined &&
      subscription_amount !== null &&
      `${subscription_amount}`.trim() !== ""
    ) {
      normalizedSubscriptionAmount = Number(subscription_amount);
      if (!Number.isFinite(normalizedSubscriptionAmount)) {
        return res.status(400).json({ error: "subscription_amount must be a number" });
      }
      if (normalizedSubscriptionAmount < 200) {
        return res.status(400).json({ error: "Minimum monthly subscription is 200" });
      }
    }

    const result = await updateCurrentUserProfile({
      id: req.user.id,
      email: req.user.email,
      full_name: typeof full_name === "string" ? full_name : undefined,
      avatar_url: typeof avatar_url === "string" ? avatar_url : undefined,
      address: typeof address === "string" ? address : undefined,
      phone_number: typeof phone_number === "string" ? phone_number : undefined,
      alt_phone_number: typeof alt_phone_number === "string" ? alt_phone_number : undefined,
      subscription_amount: normalizedSubscriptionAmount,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to update profile" });
  }
});

router.post("/family-members", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const {
      full_name,
      gender,
      relation,
      age,
      dob,
      add_subscription,
      subscription_amount,
      billing_cycle,
    } = req.body;

    if (typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "full_name is required" });
    }

    const normalizedAge =
      age !== undefined && age !== null && `${age}`.trim() !== ""
        ? Number(age)
        : undefined;
    if (normalizedAge !== undefined && (!Number.isFinite(normalizedAge) || normalizedAge < 0)) {
      return res.status(400).json({ error: "age must be a non-negative number" });
    }

    const normalizedSubscriptionAmount =
      subscription_amount !== undefined && subscription_amount !== null && `${subscription_amount}`.trim() !== ""
        ? Number(subscription_amount)
        : undefined;
    if (
      normalizedSubscriptionAmount !== undefined &&
      (!Number.isFinite(normalizedSubscriptionAmount) || normalizedSubscriptionAmount <= 0)
    ) {
      return res.status(400).json({ error: "subscription_amount must be greater than 0" });
    }

    const result = await addFamilyMemberForCurrentUser({
      email: req.user.email,
      full_name,
      gender: typeof gender === "string" ? gender : undefined,
      relation: typeof relation === "string" ? relation : undefined,
      age: normalizedAge,
      dob: typeof dob === "string" ? dob : undefined,
      add_subscription: Boolean(add_subscription),
      subscription_amount: normalizedSubscriptionAmount,
      billing_cycle: billing_cycle === "yearly" ? "yearly" : "monthly",
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to add family member" });
  }
});

export default router;
