import { Router } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { db } from "../services/dbClient";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { JWT_SECRET } from "../config";
import { logger } from "../utils/logger";
import { rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens } from "../services/refreshTokenService";
import { getChurchSaaSSettings } from "../services/churchSubscriptionService";
import {
  addFamilyMemberForCurrentUser,
  deleteFamilyMember,
  getMemberDashboardByEmail,
  getRegisteredUserByPhone,
  getRegisteredUserContext,
  joinChurchByCode,
  syncUserProfile,
  updateCurrentUserProfile,
  updateFamilyMember,
} from "../services/userService";
import {
  searchChurchMembers,
  createFamilyMemberRequest,
  listFamilyMemberRequests,
  listMyFamilyMemberRequests,
  reviewFamilyMemberRequest,
} from "../services/familyRequestService";

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

    if (normalizedChurchId) {
      const { data: churchExists } = await db
        .from("churches")
        .select("id")
        .eq("id", normalizedChurchId)
        .maybeSingle();
      if (!churchExists) {
        return res.status(400).json({ error: "Church not found" });
      }
    }

    // Prevent church switching: if user already has a church, reject change to a different one
    const existingChurchId = req.registeredProfile?.church_id || req.user.church_id;
    if (normalizedChurchId && existingChurchId && normalizedChurchId !== existingChurchId) {
      return res.status(403).json({ error: "Cannot switch churches. Contact your administrator." });
    }

    const role = isSuperAdminEmail(req.user.email, req.user.phone) ? "admin" : "member";

    const profile = await syncUserProfile({
      id: req.user.id,
      email: req.user.email,
      phone_number: req.user.phone,
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
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to sync user profile") });
  }
});

router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const profile = await getRegisteredUserContext(req.user.id, req.user.email, req.user.phone);
    if (!profile) {
      return res.status(403).json({ error: "This account is not registered" });
    }

    // Block login for members who are added as someone's family dependent
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      // Find if this user's member record is linked_to_member_id in family_members
      // Use two separate queries instead of .or() to avoid PostgREST filter escaping issues
      let memberRow: { id: string } | null = null;
      const { data: byUserId } = await db
        .from("members")
        .select("id")
        .eq("user_id", profile.id)
        .limit(1)
        .maybeSingle();
      memberRow = byUserId;
      if (!memberRow && profile.email) {
        const { data: byEmail } = await db
          .from("members")
          .select("id")
          .ilike("email", profile.email)
          .limit(1)
          .maybeSingle();
        memberRow = byEmail;
      }
      if (!memberRow && profile.phone_number) {
        const { data: byPhone } = await db
          .from("members")
          .select("id")
          .eq("phone_number", profile.phone_number)
          .limit(1)
          .maybeSingle();
        memberRow = byPhone;
      }

      if (memberRow) {
        const { data: familyLink } = await db
          .from("family_members")
          .select("id, member_id")
          .eq("linked_to_member_id", memberRow.id)
          .limit(1)
          .maybeSingle();

        if (familyLink) {
          let familyHeadName = "your family head";
          const { data: headMember } = await db
            .from("members")
            .select("full_name")
            .eq("id", familyLink.member_id)
            .maybeSingle();
          if (headMember?.full_name) familyHeadName = headMember.full_name;

          return res.status(403).json({
            error: `family_dependent:${familyHeadName}`,
            message: `Your account is registered as a family member under ${familyHeadName}. Please ask them to remove you from their family list to proceed independently.`,
          });
        }
      }
    }

    req.user.role = profile.role;
    req.user.church_id = profile.church_id || "";

    return res.json({
      auth: req.user,
      profile,
      is_super_admin: isSuperAdminEmail(req.user.email, req.user.phone),
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to get user profile") });
  }
});

router.get("/member-dashboard", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const dashboard = await getMemberDashboardByEmail(req.user.email, req.user.phone);
    if (!dashboard) {
      return res.status(403).json({ error: "This account is not registered" });
    }

    return res.json(dashboard);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load member dashboard") });
  }
});

router.post("/update-profile", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { full_name, avatar_url, address, phone_number, alt_phone_number, preferred_language, dark_mode, gender, dob, phone_change_token } = req.body;

    // If phone_number is being changed, require OTP verification proof
    if (typeof phone_number === "string" && phone_number.trim()) {
      // Normalize for comparison
      let normalizedNew = phone_number.replace(/[\s\-()]/g, "");
      if (normalizedNew.startsWith("+91")) normalizedNew = "+91" + normalizedNew.slice(3).replace(/\D/g, "");
      else normalizedNew = "+91" + normalizedNew.replace(/\D/g, "");

      const currentPhone = req.user.phone || "";
      if (normalizedNew !== currentPhone) {
        if (!phone_change_token || typeof phone_change_token !== "string") {
          return res.status(400).json({ error: "OTP verification required to change phone number" });
        }
        try {
          const decoded = jwt.verify(phone_change_token, JWT_SECRET) as { sub: string; verified_phone: string; purpose: string };
          if (decoded.purpose !== "phone_change" || decoded.sub !== req.user.id || decoded.verified_phone !== normalizedNew) {
            return res.status(403).json({ error: "Phone change token is invalid or does not match" });
          }
        } catch {
          return res.status(403).json({ error: "Phone change token expired or invalid" });
        }
      }
    }

    // 1.4: subscription_amount removed from self-service — admin-only field

    const result = await updateCurrentUserProfile({
      id: req.user.id,
      email: req.user.email,
      auth_phone: req.user.phone,
      full_name: typeof full_name === "string" ? full_name : undefined,
      avatar_url: typeof avatar_url === "string" ? avatar_url : undefined,
      address: typeof address === "string" ? address : undefined,
      phone_number: typeof phone_number === "string" ? phone_number : undefined,
      alt_phone_number: typeof alt_phone_number === "string" ? alt_phone_number : undefined,
      preferred_language: typeof preferred_language === "string" && ["en","hi","ta","te","ml","kn"].includes(preferred_language) ? preferred_language : undefined,
      dark_mode: typeof dark_mode === "boolean" ? dark_mode : undefined,
      gender: typeof gender === "string" ? gender : undefined,
      dob: typeof dob === "string" ? dob : undefined,
    });

    // AUTH-13: Invalidate all sessions when sensitive fields change (phone)
    if (typeof phone_number === "string" && phone_number !== req.user.phone) {
      revokeAllRefreshTokens(req.user.id).catch((e) =>
        logger.warn({ err: e, userId: req.user!.id }, "Failed to revoke tokens on phone change")
      );
    }

    persistAuditLog(req, "user.update_profile", "user", req.user.id, {});
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update profile") });
  }
});

router.post("/family-members", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (req.user.role !== "member" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only members and admins can manage family members" });
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
    if (normalizedAge !== undefined && (!Number.isFinite(normalizedAge) || normalizedAge < 0 || normalizedAge > 150)) {
      return res.status(400).json({ error: "age must be between 0 and 150" });
    }
    if (typeof dob === "string" && dob.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) {
        return res.status(400).json({ error: "dob must be in YYYY-MM-DD format" });
      }
      if (new Date(dob.trim()) > new Date()) {
        return res.status(400).json({ error: "dob cannot be in the future" });
      }
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
    if (normalizedSubscriptionAmount !== undefined && normalizedSubscriptionAmount < 200) {
      return res.status(400).json({ error: "subscription_amount must be at least 200" });
    }

    // Enforce member_subscription_enabled SaaS setting
    if (add_subscription && req.user.church_id) {
      const saasSettings = await getChurchSaaSSettings(req.user.church_id);
      if (!saasSettings.member_subscription_enabled) {
        return res.status(403).json({ error: "Member subscriptions are disabled for this church" });
      }
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

    persistAuditLog(req, "family_member.add", "family_member", result.family_member?.id, { full_name });

    // Push confirmation to family head
    if (req.user.id && req.user.church_id) {
      try {
        const { queueNotification } = await import("../services/notificationService");
        queueNotification({
          church_id: req.user.church_id,
          recipient_user_id: req.user.id,
          channel: "push",
          notification_type: "family_member_added",
          subject: "Family Member Added",
          body: `${full_name.trim()}${relation ? ` (${relation})` : ""} has been added to your family.`,
          metadata: { url: "/profile" },
        }).catch(() => {});
      } catch (_) {}
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to add family member") });
  }
});

router.patch("/family-members/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const familyMemberId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!familyMemberId || !UUID_REGEX.test(familyMemberId)) {
      return res.status(400).json({ error: "Invalid family member ID" });
    }

    const { full_name, gender, relation, age, dob } = req.body;

    const normalizedAge =
      age !== undefined && age !== null && `${age}`.trim() !== ""
        ? Number(age)
        : undefined;

    if (normalizedAge !== undefined && (!Number.isFinite(normalizedAge) || normalizedAge < 0 || normalizedAge > 150)) {
      return res.status(400).json({ error: "age must be between 0 and 150" });
    }

    if (typeof dob === "string" && dob.trim()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) {
        return res.status(400).json({ error: "dob must be in YYYY-MM-DD format" });
      }
      if (new Date(dob.trim()) > new Date()) {
        return res.status(400).json({ error: "dob cannot be in the future" });
      }
    }

    const updated = await updateFamilyMember({
      email: req.user.email,
      family_member_id: familyMemberId,
      full_name: typeof full_name === "string" ? full_name : undefined,
      gender: typeof gender === "string" ? gender : undefined,
      relation: typeof relation === "string" ? relation : undefined,
      age: normalizedAge,
      dob: typeof dob === "string" ? dob : undefined,
    });

    persistAuditLog(req, "family_member.update", "family_member", familyMemberId, {});
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update family member") });
  }
});

router.delete("/family-members/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const familyMemberId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!familyMemberId || !UUID_REGEX.test(familyMemberId)) {
      return res.status(400).json({ error: "Invalid family member ID" });
    }

    const result = await deleteFamilyMember(req.user.email, familyMemberId);
    persistAuditLog(req, "family_member.delete", "family_member", familyMemberId, {});
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete family member") });
  }
});

// ── Helper: resolve current user's member_id ──
async function resolveCurrentMemberId(userId: string): Promise<string | null> {
  const { data } = await db
    .from("members")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

// ── Family member search (search within same church) ──

router.get("/family-search", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim() || query.trim().length < 2) {
      return res.json([]);
    }

    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id);
    if (!memberId || !req.user.church_id) {
      return res.status(400).json({ error: "You must be a registered church member to search" });
    }

    const results = await searchChurchMembers(req.user.church_id, query, memberId);
    return res.json(results);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Search failed") });
  }
});

// ── Create family member request ──

router.post("/family-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (req.user.role !== "member" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only members and admins can request to add family members" });
    }

    const { target_member_id, relation } = req.body;
    if (typeof target_member_id !== "string" || !UUID_REGEX.test(target_member_id)) {
      return res.status(400).json({ error: "target_member_id is required and must be a valid UUID" });
    }
    if (typeof relation !== "string" || !relation.trim()) {
      return res.status(400).json({ error: "relation is required" });
    }

    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id);
    if (!memberId || !req.user.church_id) {
      return res.status(400).json({ error: "You must be a registered church member" });
    }

    const result = await createFamilyMemberRequest({
      churchId: req.user.church_id,
      requesterMemberId: memberId,
      targetMemberId: target_member_id,
      relation: relation.trim(),
    });

    persistAuditLog(req, "family_request.create", "family_request", result.id, { target_member_id });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create family request") });
  }
});

// ── List family requests (member sees own, admin sees all) ──

router.get("/family-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;

    if (isAdmin && req.user.church_id) {
      const requests = await listFamilyMemberRequests(req.user.church_id, statusFilter);
      return res.json(requests);
    }

    // Member view: own requests only
    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id);
    if (!memberId) {
      return res.json([]);
    }

    const requests = await listMyFamilyMemberRequests(memberId);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to list family requests") });
  }
});

// ── Review (approve/reject) a family request (admin only) ──

router.post("/family-requests/:id/review", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can review family requests" });
    }

    const requestId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!requestId || !UUID_REGEX.test(requestId)) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    const { decision, note } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    }

    const result = await reviewFamilyMemberRequest(
      requestId,
      decision,
      req.registeredProfile!.id,
      typeof note === "string" ? note : undefined,
      isSuperAdminEmail(req.user.email, req.user.phone) ? undefined : req.user.church_id
    );

    persistAuditLog(req, "family_request.review", "family_request", requestId, { decision });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review family request") });
  }
});

// ═══ Refresh Token ═══
router.post("/refresh", async (req: AuthRequest, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(401).json({ error: "No refresh token" });
    }

    // Clean up stale cookies that may exist at the wrong path from a prior deploy
    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("refresh_token", { path: "/api/auth", httpOnly: true, secure: isProduction, sameSite: "lax" });

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      // Clear the invalid cookie
      res.clearCookie("refresh_token", {
        path: "/api/auth/refresh",
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
      });
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    // Look up current user info for the new access token
    const { data: user } = await db
      .from("users")
      .select("id, email, phone_number, role, church_id")
      .eq("id", result.userId)
      .maybeSingle();

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // EDGE-3: Reject refresh if the user's church has been deactivated
    if (user.church_id) {
      const { data: church } = await db
        .from("churches")
        .select("deleted_at, service_enabled")
        .eq("id", user.church_id)
        .maybeSingle();
      if (church?.deleted_at || church?.service_enabled === false) {
        await revokeAllRefreshTokens(user.id);
        res.clearCookie("refresh_token", {
          path: "/api/auth/refresh",
          httpOnly: true,
          secure: isProduction,
          sameSite: "lax",
        });
        return res.status(403).json({ error: "Your church account has been deactivated" });
      }
    }

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email || "",
        phone: user.phone_number || "",
        role: user.role || "member",
        church_id: user.church_id || "",
        aud: "authenticated",
        iss: "shalom-app",
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("refresh_token", result.newToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/api/auth/refresh",
      expires: result.expiresAt,
    });

    return res.json({ access_token: accessToken });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to refresh token") });
  }
});

// ═══ Join church by code — auto-link pre-registered member ═══
router.post("/join-church", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { church_code } = req.body;
    if (!church_code || typeof church_code !== "string" || !/^\d{8}$/.test(church_code.trim())) {
      return res.status(400).json({ error: "Church code must be exactly 8 digits." });
    }

    const result = await joinChurchByCode(
      req.user.id,
      req.user.email,
      req.user.phone,
      church_code.trim(),
    );

    await persistAuditLog(req, "join_church", "church", result.church_id, { church_code: church_code.trim() });

    return res.json(result);
  } catch (err: any) {
    const message = err?.message || "Failed to join church";
    const status = message.includes("not found") || message.includes("No matching") ? 404 : 400;
    return res.status(status).json({ error: message });
  }
});

// ═══ Logout — revoke refresh token ═══
// Mounted at /refresh/revoke so the httpOnly cookie (path=/api/auth/refresh) is sent by the browser
router.post("/refresh/revoke", async (req: AuthRequest, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("refresh_token", {
      path: "/api/auth/refresh",
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    });
    // Also clear any stale cookie at the old path
    res.clearCookie("refresh_token", { path: "/api/auth", httpOnly: true, secure: isProduction, sameSite: "lax" });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Logout failed") });
  }
});

export default router;
