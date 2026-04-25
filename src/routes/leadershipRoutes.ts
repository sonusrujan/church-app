import { UUID_REGEX } from "../utils/validation";
import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { validate, assignLeadershipSchema, updateLeadershipSchema } from "../utils/zodSchemas";
import { logger } from "../utils/logger";
import { db } from "../services/dbClient";
import {
  listLeadershipRoles,
  listChurchLeadership,
  createLeadershipAssignment,
  updateLeadershipAssignment,
  deleteLeadershipAssignment,
  listPastoralLeaders,
} from "../services/leadershipService";

const router = Router();

// ── List all predefined leadership roles ──
router.get("/roles", requireAuth, requireRegisteredUser, async (_req: AuthRequest, res) => {
  try {
    const roles = await listLeadershipRoles();
    return res.json(roles);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load roles") });
  }
});

// ── List leadership for a church ──
router.get("/church/:churchId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "").trim();
    if (!UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }

    // Non-super-admins can only view their own church's leadership
    if (!isSuperAdminEmail(req.user?.email, req.user?.phone) && req.user?.church_id !== churchId) {
      return res.status(403).json({ error: "You can only view leadership for your own church" });
    }

    const activeOnly = req.query.active_only !== "false";
    const leaders = await listChurchLeadership(churchId, activeOnly);
    return res.json(leaders);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load leadership") });
  }
});

// ── List pastoral leaders for prayer requests (DC, Presbyter, Pastor) ──
router.get("/pastoral/:churchId", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "").trim();
    if (!UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }

    // Non-super-admins can only view their own church's pastoral leaders
    if (!isSuperAdminEmail(req.user?.email, req.user?.phone) && req.user?.church_id !== churchId) {
      return res.status(403).json({ error: "You can only view pastoral leaders for your own church" });
    }

    const leaders = await listPastoralLeaders(churchId);
    return res.json(leaders);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load pastoral leaders") });
  }
});

// ── Create leadership assignment (admin / super admin) ──
router.post("/assign", requireAuth, requireRegisteredUser, validate(assignLeadershipSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can assign leadership roles" });
    }

    const { church_id, role_id, member_id, full_name, phone_number, email, photo_url, bio, custom_role_name, custom_hierarchy_level } = req.body;

    // Determine target church
    const targetChurchId = isSuperAdminEmail(req.user.email, req.user.phone)
      ? (typeof church_id === "string" && UUID_REGEX.test(church_id) ? church_id : null)
      : req.user.church_id;

    if (!targetChurchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    if (typeof role_id !== "string" || !UUID_REGEX.test(role_id)) {
      return res.status(400).json({ error: "role_id is required and must be a valid UUID" });
    }

    if (typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "full_name is required" });
    }

    // Validate member_id belongs to the target church (if provided)
    const validMemberId = typeof member_id === "string" && UUID_REGEX.test(member_id) ? member_id : undefined;
    if (validMemberId) {
      const { data: memberRow } = await db
        .from("members")
        .select("id, church_id")
        .eq("id", validMemberId)
        .maybeSingle();
      if (!memberRow || memberRow.church_id !== targetChurchId) {
        return res.status(400).json({ error: "Member does not belong to the target church" });
      }
    }

    const result = await createLeadershipAssignment({
      church_id: targetChurchId,
      role_id,
      member_id: validMemberId,
      full_name: full_name.trim(),
      phone_number: typeof phone_number === "string" ? phone_number.trim() : undefined,
      email: typeof email === "string" ? email.trim() : undefined,
      photo_url: typeof photo_url === "string" ? photo_url.trim() : undefined,
      bio: typeof bio === "string" ? bio.trim() : undefined,
      assigned_by: req.registeredProfile?.id,
      custom_role_name: typeof custom_role_name === "string" ? custom_role_name.trim() : undefined,
      custom_hierarchy_level: typeof custom_hierarchy_level === "number" ? custom_hierarchy_level : undefined,
    });

    persistAuditLog(req, "leadership.assign", "leadership", result.id, { church_id: targetChurchId, role_id, full_name: full_name.trim() });

    // Notify the assigned person if they have a member account
    if (result.member_id) {
      try {
        const { data: assignedMember } = await db.from("members").select("user_id").eq("id", result.member_id).maybeSingle();
        if (assignedMember?.user_id) {
          const { data: roleRow } = await db.from("leadership_roles").select("name").eq("id", role_id).maybeSingle();
          const roleName = (typeof custom_role_name === "string" && custom_role_name.trim()) || roleRow?.name || "a leadership role";
          const { queueNotification } = await import("../services/notificationService");
          queueNotification({
            church_id: targetChurchId,
            recipient_user_id: assignedMember.user_id,
            channel: "push",
            notification_type: "leadership_assignment",
            subject: "Leadership Role Assigned",
            body: `You have been assigned the role of ${roleName}. Thank you for your service!`,
            metadata: { url: "/dashboard" },
          }).catch((err) => { logger.warn({ err }, "Failed to send leadership assignment notification"); });
        }
      } catch (_) {}
    }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to assign leadership role") });
  }
});

// ── Update leadership assignment ──
router.patch("/:id", requireAuth, requireRegisteredUser, validate(updateLeadershipSchema), async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can update leadership assignments" });
    }

    const leadershipId = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(leadershipId)) {
      return res.status(400).json({ error: "Invalid leadership assignment ID" });
    }

    const targetChurchId = isSuperAdminEmail(req.user.email, req.user.phone)
      ? (typeof req.body.church_id === "string" && UUID_REGEX.test(req.body.church_id) ? req.body.church_id : req.user.church_id)
      : req.user.church_id;

    if (!targetChurchId) {
      return res.status(400).json({ error: "church_id context required" });
    }

    const { full_name, phone_number, email, photo_url, bio, is_active, role_id, custom_role_name, custom_hierarchy_level } = req.body;

    const result = await updateLeadershipAssignment(targetChurchId, leadershipId, {
      full_name: typeof full_name === "string" ? full_name : undefined,
      phone_number: typeof phone_number === "string" ? phone_number : undefined,
      email: typeof email === "string" ? email : undefined,
      photo_url: typeof photo_url === "string" ? photo_url : undefined,
      bio: typeof bio === "string" ? bio : undefined,
      is_active: typeof is_active === "boolean" ? is_active : undefined,
      role_id: typeof role_id === "string" && UUID_REGEX.test(role_id) ? role_id : undefined,
      custom_role_name: typeof custom_role_name === "string" ? custom_role_name : undefined,
      custom_hierarchy_level: typeof custom_hierarchy_level === "number" ? custom_hierarchy_level : undefined,
    });

    persistAuditLog(req, "leadership.update", "leadership", leadershipId, { church_id: targetChurchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update leadership") });
  }
});

// ── Delete (deactivate) leadership assignment ──
router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });

    const isAdmin = req.user.role === "admin" || isSuperAdminEmail(req.user.email, req.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ error: "Only admins can remove leadership assignments" });
    }

    const leadershipId = String(req.params.id || "").trim();
    if (!UUID_REGEX.test(leadershipId)) {
      return res.status(400).json({ error: "Invalid leadership assignment ID" });
    }

    const targetChurchId = isSuperAdminEmail(req.user.email, req.user.phone)
      ? (typeof req.body?.church_id === "string" && UUID_REGEX.test(req.body.church_id) ? req.body.church_id
        : typeof req.query.church_id === "string" && UUID_REGEX.test(req.query.church_id) ? req.query.church_id
        : req.user.church_id)
      : req.user.church_id;

    if (!targetChurchId) {
      return res.status(400).json({ error: "church_id context required" });
    }

    const result = await deleteLeadershipAssignment(targetChurchId, leadershipId);
    persistAuditLog(req, "leadership.delete", "leadership", leadershipId, { church_id: targetChurchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to remove leadership") });
  }
});

export default router;
