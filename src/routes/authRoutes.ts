import { UUID_REGEX } from "../utils/validation";
import {
  validate,
  syncProfileSchema,
  updateProfileSchema,
  joinChurchSchema,
  addFamilyMemberSchema,
  updateFamilyMemberSchema,
  createFamilyRequestSchema,
  batchReviewSchema,
  reviewDecisionSchema,
} from "../utils/zodSchemas";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { db } from "../services/dbClient";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { JWT_SECRET } from "../config";
import { logger } from "../utils/logger";
import { normalizeIndianPhone } from "../utils/phone";
import { rotateRefreshToken, revokeRefreshToken, revokeAllRefreshTokens } from "../services/refreshTokenService";
import {
  refreshCookieOptions,
  clearRefreshCookieOptions,
  clearLegacyRefreshCookieOptions,
} from "../utils/refreshCookie";
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

router.post("/sync-profile", requireAuth, requireRegisteredUser, validate(syncProfileSchema), async (req: AuthRequest, res) => {
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
    if (profile.id !== req.user.id && profile.auth_user_id !== req.user.id) {
      logger.error(
        { tokenUserId: req.user.id, profileId: profile.id },
        "Auth identity mismatch: /me resolved a different profile than JWT subject"
      );
      await revokeAllRefreshTokens(req.user.id).catch(() => {});
      res.clearCookie("refresh_token", clearRefreshCookieOptions());
      return res.status(401).json({ error: "Session identity mismatch. Please sign in again." });
    }

    // Block login for members who are added as someone's family dependent
    if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
      // Find if this user's member record is linked_to_member_id in family_members
      // SH-003: Scope member lookup to user's church to prevent cross-tenant false positives
      let memberRow: { id: string } | null = null;
      const { data: byUserId } = await db
        .from("members")
        .select("id")
        .eq("user_id", profile.id)
        .eq("church_id", profile.church_id || req.user.church_id)
        .limit(1)
        .maybeSingle();
      memberRow = byUserId;
      if (!memberRow && profile.phone_number && (profile.church_id || req.user.church_id)) {
        const { data: byPhone } = await db
          .from("members")
          .select("id")
          .eq("phone_number", profile.phone_number)
          .eq("church_id", profile.church_id || req.user.church_id)
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

    const dashboard = await getMemberDashboardByEmail(req.user.email, req.user.phone, req.user.id, req.user.church_id);
    if (!dashboard) {
      return res.status(403).json({ error: "This account is not registered" });
    }

    return res.json(dashboard);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load member dashboard") });
  }
});

router.post("/update-profile", requireAuth, requireRegisteredUser, validate(updateProfileSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { full_name, avatar_url, address, phone_number, alt_phone_number, preferred_language, dark_mode, gender, dob, phone_change_token, occupation, confirmation_taken, age } = req.body;

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
      occupation: typeof occupation === "string" ? occupation : undefined,
      confirmation_taken: typeof confirmation_taken === "boolean" ? confirmation_taken : undefined,
      age: typeof age === "number" ? age : undefined,
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

router.post("/family-members", requireAuth, requireRegisteredUser, validate(addFamilyMemberSchema), async (req: AuthRequest, res) => {
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
      phone: req.user.phone,
      authUserId: req.user.id,
      churchId: req.user.church_id,
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
        }).catch((err) => { logger.warn({ err }, "Failed to send family_member_added notification"); });
      } catch (_) {}
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to add family member") });
  }
});

router.patch("/family-members/:id", requireAuth, requireRegisteredUser, validate(updateFamilyMemberSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const familyMemberId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!familyMemberId || !UUID_REGEX.test(familyMemberId)) {
      return res.status(400).json({ error: "Invalid family member ID" });
    }

    const { full_name, gender, relation, age, dob, address, phone_number, alt_phone_number, occupation, confirmation_taken, phone_change_token } = req.body;

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

    // If phone_number is being changed for a linked family member, require OTP verification
    if (typeof phone_number === "string" && phone_number.trim()) {
      let normalizedNew = phone_number.replace(/[\s\-()]/g, "");
      if (normalizedNew.startsWith("+91")) normalizedNew = "+91" + normalizedNew.slice(3).replace(/\D/g, "");
      else normalizedNew = "+91" + normalizedNew.replace(/\D/g, "");

      // Fetch the family member's current linked phone to detect real change
      const { data: fmData } = await db
        .from("family_members")
        .select("linked_to_member_id")
        .eq("id", familyMemberId)
        .single();

      if (fmData?.linked_to_member_id) {
        const { data: linkedMember } = await db
          .from("members")
          .select("phone_number")
          .eq("id", fmData.linked_to_member_id)
          .single();

        const currentPhone = linkedMember?.phone_number || "";
        if (normalizedNew !== currentPhone) {
          if (!phone_change_token || typeof phone_change_token !== "string") {
            return res.status(400).json({ error: "OTP verification required to change family member phone number" });
          }
          try {
            const decoded = jwt.verify(phone_change_token, JWT_SECRET) as { sub: string; verified_phone: string; purpose: string };
            if (decoded.purpose !== "phone_change" || decoded.sub !== req.user!.id || decoded.verified_phone !== normalizedNew) {
              return res.status(403).json({ error: "Phone change token is invalid or does not match" });
            }
          } catch {
            return res.status(403).json({ error: "Phone change token expired or invalid" });
          }
        }
      }
    }

    const updated = await updateFamilyMember({
      email: req.user.email,
      phone: req.user.phone,
      authUserId: req.user.id,
      churchId: req.user.church_id,
      family_member_id: familyMemberId,
      full_name: typeof full_name === "string" ? full_name : undefined,
      gender: typeof gender === "string" ? gender : undefined,
      relation: typeof relation === "string" ? relation : undefined,
      age: normalizedAge,
      dob: typeof dob === "string" ? dob : undefined,
      address: typeof address === "string" ? address : undefined,
      phone_number: typeof phone_number === "string" ? phone_number : undefined,
      alt_phone_number: typeof alt_phone_number === "string" ? alt_phone_number : undefined,
      occupation: typeof occupation === "string" ? occupation : undefined,
      confirmation_taken: typeof confirmation_taken === "boolean" ? confirmation_taken : undefined,
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

    const result = await deleteFamilyMember(req.user.email, familyMemberId, req.user.id, req.user.phone, req.user.church_id);
    persistAuditLog(req, "family_member.delete", "family_member", familyMemberId, {});
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete family member") });
  }
});

// ── Get family member profile (expanded details from linked members table) ──

router.get("/family-members/:id/profile", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const familyMemberId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!familyMemberId || !UUID_REGEX.test(familyMemberId)) {
      return res.status(400).json({ error: "Invalid family member ID" });
    }

    const dashboard = await getMemberDashboardByEmail(req.user.email, req.user.phone, req.user.id, req.user.church_id);
    if (!dashboard?.member) {
      return res.status(400).json({ error: "Member profile not found" });
    }

    // Verify ownership: the family member must belong to this head
    const { data: fm, error: fmErr } = await db
      .from("family_members")
      .select("id, member_id, full_name, gender, relation, age, dob, has_subscription, linked_to_member_id, created_at")
      .eq("id", familyMemberId)
      .eq("member_id", dashboard.member.id)
      .maybeSingle();

    if (fmErr || !fm) {
      return res.status(404).json({ error: "Family member not found" });
    }

    // If linked to a real member, fetch their full profile from members table
    let linkedProfile: Record<string, unknown> | null = null;
    if (fm.linked_to_member_id) {
      const { data: member } = await db
        .from("members")
        .select("id, full_name, email, phone_number, alt_phone_number, address, membership_id, verification_status, subscription_amount, gender, dob, occupation, confirmation_taken, age, created_at")
        .eq("id", fm.linked_to_member_id)
        .maybeSingle();
      linkedProfile = member || null;
    }

    return res.json({
      family_member: fm,
      linked_profile: linkedProfile,
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load family member profile") });
  }
});

// ── Helper: resolve current user's member_id (with phone fallback + auto-link) ──
async function resolveCurrentMemberId(userId: string, phone?: string, churchId?: string): Promise<string | null> {
  // Primary: lookup by user_id
  const { data } = await db
    .from("members")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id;

  // Fallback: phone lookup (mirrors dashboard auto-link logic)
  if (phone) {
    const normalized = normalizeIndianPhone(phone);
    if (normalized) {
      let q = db.from("members").select("id, user_id").eq("phone_number", normalized);
      if (churchId) q = q.eq("church_id", churchId);
      const { data: byPhone } = await q.maybeSingle();
      if (byPhone) {
        // Auto-link if not yet linked
        if (!byPhone.user_id) {
          await db.from("members").update({ user_id: userId }).eq("id", byPhone.id).is("user_id", null);
        }
        return byPhone.id;
      }
    }
  }

  return null;
}

// ── Family member search (search within same church) ──

router.get("/family-search", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const query = typeof req.query.q === "string" ? req.query.q : "";
    if (!query.trim() || query.trim().length < 2) {
      return res.json([]);
    }

    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id, req.user.phone, req.user.church_id);
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

router.post("/family-requests", requireAuth, requireRegisteredUser, validate(createFamilyRequestSchema), async (req: AuthRequest, res) => {
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

    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id, req.user.phone, req.user.church_id);
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
    const memberId = await resolveCurrentMemberId(req.registeredProfile!.id, req.user.phone, req.user.church_id);
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

router.post("/family-requests/:id/review", requireAuth, requireRegisteredUser, validate(reviewDecisionSchema), async (req: AuthRequest, res) => {
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

router.post("/family-requests/batch-review", requireAuth, requireRegisteredUser, validate(batchReviewSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can review family requests" });
    }

    const { request_ids, decision, review_note } = req.body;
    const results: Array<{ request_id: string; success: boolean; error?: string }> = [];

    for (const requestId of request_ids as string[]) {
      try {
        await reviewFamilyMemberRequest(
          requestId,
          decision,
          req.registeredProfile!.id,
          review_note,
          isSuperAdminEmail(req.user.email, req.user.phone) ? undefined : req.user.church_id,
        );
        await persistAuditLog(req, "family_request.review", "family_request", requestId, { decision, batch: true });
        results.push({ request_id: requestId, success: true });
      } catch (err: any) {
        results.push({ request_id: requestId, success: false, error: safeErrorMessage(err, "Failed to review family request") });
      }
    }

    return res.json({
      processed: results.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review family requests") });
  }
});

// ═══ Refresh Token ═══
router.post("/refresh", async (req: AuthRequest, res) => {
  try {
    // CSRF: require custom header to prove this is a same-origin XHR, not a form POST
    if (!req.headers["x-requested-with"]) {
      return res.status(403).json({ error: "Missing X-Requested-With header" });
    }

    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(401).json({ error: "No refresh token" });
    }

    // Clean up stale cookies that may exist at the wrong path from a prior deploy
    res.clearCookie("refresh_token", clearLegacyRefreshCookieOptions());

    const result = await rotateRefreshToken(refreshToken);
    if (!result) {
      // Clear the invalid cookie
      res.clearCookie("refresh_token", clearRefreshCookieOptions());
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
        res.clearCookie("refresh_token", clearRefreshCookieOptions());
        return res.status(403).json({ error: "Your church account has been deactivated" });
      }
    }

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email || "",
        phone: user.phone_number || "",
        role: user.role || "member",
        // SH-008: Use refresh token's stored church_id to prevent session tenant drift
        church_id: result.churchId || user.church_id || "",
        aud: "authenticated",
        iss: "shalom-app",
      },
      JWT_SECRET,
      { expiresIn: "30m" },
    );

    res.cookie("refresh_token", result.newToken, refreshCookieOptions({ expires: result.expiresAt }));

    return res.json({ access_token: accessToken });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to refresh token") });
  }
});

// ═══ Join church by code — auto-link pre-registered member ═══
router.post("/join-church", requireAuth, validate(joinChurchSchema), async (req: AuthRequest, res) => {
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
    if (!req.headers["x-requested-with"]) {
      return res.status(403).json({ error: "Missing X-Requested-With header" });
    }
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }
    res.clearCookie("refresh_token", clearRefreshCookieOptions());
    // Also clear any stale cookie at the old path
    res.clearCookie("refresh_token", clearLegacyRefreshCookieOptions());
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Logout failed") });
  }
});

// ═══ Native → Web Handoff ═══
// Mint a short-lived, single-use token the native app embeds in a deep link
// to the website. The website exchanges it (POST /web-handoff/exchange) for
// a real session cookie. Replay is prevented by the DB row's consumed_at flag.

const WEB_HANDOFF_TTL_SECONDS = 120;
const WEB_HANDOFF_AUD = "web-handoff";
const WEB_HANDOFF_PURPOSES = new Set(["manage_subscription"]);

router.post("/web-handoff/mint", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const purpose = typeof req.body?.purpose === "string" ? req.body.purpose : "";
    if (!WEB_HANDOFF_PURPOSES.has(purpose)) {
      return res.status(400).json({ error: "Invalid handoff purpose" });
    }

    // Admin-only guard for SaaS subscription management
    if (purpose === "manage_subscription") {
      if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
        return res.status(403).json({ error: "Only admins can manage subscription" });
      }
    }

    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + WEB_HANDOFF_TTL_SECONDS * 1000);

    const { error: insertErr } = await db.from("web_handoff_tokens").insert({
      jti,
      user_id: req.user.id,
      church_id: req.user.church_id || null,
      purpose,
      expires_at: expiresAt.toISOString(),
    });
    if (insertErr) {
      logger.error({ err: insertErr }, "Failed to persist web_handoff token");
      return res.status(500).json({ error: "Failed to mint handoff token" });
    }

    const token = jwt.sign(
      {
        sub: req.user.id,
        church_id: req.user.church_id || "",
        purpose,
        jti,
        aud: WEB_HANDOFF_AUD,
        iss: "shalom-app",
      },
      JWT_SECRET,
      { expiresIn: WEB_HANDOFF_TTL_SECONDS },
    );

    return res.json({ token, expires_at: expiresAt.toISOString(), purpose });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to mint handoff token") });
  }
});

router.post("/web-handoff/exchange", async (req: AuthRequest, res) => {
  try {
    if (!req.headers["x-requested-with"]) {
      return res.status(403).json({ error: "Missing X-Requested-With header" });
    }
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) return res.status(400).json({ error: "Missing handoff token" });

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET, {
        audience: WEB_HANDOFF_AUD,
        issuer: "shalom-app",
      });
    } catch {
      return res.status(401).json({ error: "Invalid or expired handoff token" });
    }

    const jti = typeof decoded?.jti === "string" ? decoded.jti : "";
    const userId = typeof decoded?.sub === "string" ? decoded.sub : "";
    const purpose = typeof decoded?.purpose === "string" ? decoded.purpose : "";
    if (!jti || !userId || !WEB_HANDOFF_PURPOSES.has(purpose)) {
      return res.status(400).json({ error: "Malformed handoff token" });
    }

    // Single-use guard: flip consumed_at atomically; abort if already consumed or expired.
    const nowIso = new Date().toISOString();
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "";
    const { data: consumed, error: consumeErr } = await db
      .from("web_handoff_tokens")
      .update({ consumed_at: nowIso, consumed_ip: ip })
      .eq("jti", jti)
      .is("consumed_at", null)
      .gt("expires_at", nowIso)
      .select("user_id, church_id, purpose")
      .maybeSingle();

    if (consumeErr || !consumed) {
      return res.status(401).json({ error: "Handoff token already used or expired" });
    }
    if (consumed.user_id !== userId) {
      return res.status(401).json({ error: "Handoff token user mismatch" });
    }

    // Load the user so we can mint a standard access+refresh pair.
    const { data: user } = await db
      .from("users")
      .select("id, email, phone_number, role, church_id")
      .eq("id", userId)
      .maybeSingle();
    if (!user) return res.status(401).json({ error: "User not found" });

    const churchId = consumed.church_id || user.church_id || "";
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email || "",
        phone: user.phone_number || "",
        role: user.role || "member",
        church_id: churchId,
        aud: "authenticated",
        iss: "shalom-app",
      },
      JWT_SECRET,
      { expiresIn: "30m" },
    );

    const { createRefreshToken } = await import("../services/refreshTokenService");
    const { token: refreshToken, expiresAt } = await createRefreshToken(user.id, churchId || undefined);
    res.cookie("refresh_token", refreshToken, refreshCookieOptions({ expires: expiresAt }));

    return res.json({
      access_token: accessToken,
      purpose: consumed.purpose,
      church_id: churchId,
      user: { id: user.id, email: user.email, phone: user.phone_number, role: user.role },
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to exchange handoff token") });
  }
});

// ── GET /auth/my-churches — list all churches the user belongs to ──
router.get("/my-churches", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const isSuperAdmin = req.user!.role === "super_admin";

    if (isSuperAdmin) {
      // Super admins see all churches
      const { data: allChurches, error } = await db
        .from("churches")
        .select("id, name, church_code, logo_url")
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (error) throw error;
      return res.json({
        churches: (allChurches || []).map((c: any) => ({
          church_id: c.id,
          church_name: c.name,
          church_code: c.church_code,
          logo_url: c.logo_url,
          role: "super_admin",
        })),
      });
    }

    // Regular users: query junction table with church info
    const { data: memberships, error } = await db
      .from("user_church_memberships")
      .select("church_id, role, churches(name, church_code, logo_url)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    return res.json({
      churches: (memberships || []).map((m: any) => ({
        church_id: m.church_id,
        church_name: m.churches?.name || "",
        church_code: m.churches?.church_code || "",
        logo_url: m.churches?.logo_url || "",
        role: m.role || "member",
      })),
    });
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.user?.id }, "my-churches error");
    return res.status(500).json({ error: "Failed to load churches" });
  }
});

// ── Personal Data Export (DPDP Act 2023 compliance — right to portability) ──
router.get("/export-my-data", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const userEmail = req.user.email || "";
    const userPhone = req.user.phone || "";
    if (!userEmail && !userPhone) {
      return res.status(403).json({ error: "No email or phone linked to your account." });
    }

    const dashboard = await getMemberDashboardByEmail(userEmail, userPhone, req.user.id, req.user.church_id);
    if (!dashboard) {
      return res.status(403).json({ error: "No member record found for this account." });
    }

    const exportData = {
      exported_at: new Date().toISOString(),
      format_version: "1.0",
      profile: {
        full_name: dashboard.profile?.full_name || null,
        email: dashboard.profile?.email || null,
        phone: dashboard.profile?.phone_number || null,
        role: dashboard.profile?.role || null,
      },
      member: dashboard.member ? {
        membership_id: dashboard.member.membership_id,
        full_name: dashboard.member.full_name,
        email: dashboard.member.email,
        phone_number: dashboard.member.phone_number,
        alt_phone_number: dashboard.member.alt_phone_number,
        address: dashboard.member.address,
        gender: dashboard.member.gender,
        dob: dashboard.member.dob,
        occupation: dashboard.member.occupation,
        verification_status: dashboard.member.verification_status,
        created_at: dashboard.member.created_at,
      } : null,
      church: dashboard.church ? {
        name: dashboard.church.name,
        church_code: (dashboard.church as any).church_code || null,
        address: dashboard.church.address,
        location: (dashboard.church as any).location || null,
      } : null,
      family_members: (dashboard.family_members || []).map((fm: any) => ({
        full_name: fm.full_name,
        relation: fm.relation,
        gender: fm.gender,
        age: fm.age,
        dob: fm.dob,
      })),
      subscriptions: (dashboard.subscriptions || []).map((s: any) => ({
        plan_name: s.plan_name,
        amount: s.amount,
        billing_cycle: s.billing_cycle,
        status: s.status,
        start_date: s.start_date,
        next_payment_date: s.next_payment_date,
        person_name: s.person_name,
      })),
      payments: (dashboard.receipts || []).map((p: any) => ({
        amount: p.amount,
        payment_method: p.payment_method,
        payment_status: p.payment_status,
        payment_date: p.payment_date,
        transaction_id: p.transaction_id,
        receipt_number: p.receipt_number,
        person_name: p.person_name,
      })),
      donations_summary: dashboard.donations || null,
    };

    await persistAuditLog(req, "member.data_export", "member", dashboard.member?.id, {
      format: "json",
    });

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`);
    return res.json(exportData);
  } catch (err: any) {
    logger.error({ err: err?.message, userId: req.user?.id }, "data export failed");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to export data") });
  }
});

export default router;
