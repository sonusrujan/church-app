import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { safeErrorMessage } from "../utils/safeError";
import {
  createMember,
  deleteMember,
  getMemberById,
  getMemberDeleteImpact,
  linkUserToMember,
  listMembers,
  searchMembers,
  updateMember,
} from "../services/memberService";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { logSuperAdminAudit } from "../utils/superAdminAudit";
import { persistAuditLog } from "../utils/auditLog";

const router = Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const memberWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email, req.user.phone);
  const normalizedRequested = typeof requestedChurchId === "string" ? requestedChurchId.trim() : "";

  if (requesterIsSuperAdmin) {
    return normalizedRequested || req.user.church_id;
  }

  return req.user.church_id;
}

router.get("/list", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can view members list" });
    }

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));

    const limit = Number(req.query.limit) || 100;
    const offset = Number(req.query.offset) || 0;
    const result = await listMembers(churchId || undefined, limit, offset);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to list members") });
  }
});

router.post("/create", requireAuth, requireRegisteredUser, memberWriteLimiter, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email, req.user.phone);

    if (req.user.role !== "admin" && !requesterIsSuperAdmin) {
      return res.status(403).json({ error: "Only admin can create members" });
    }

    const { full_name, email, address, membership_id, subscription_amount, church_id } = req.body;

    const targetChurchId = requesterIsSuperAdmin
      ? (typeof church_id === "string" && church_id.trim()) || req.user.church_id
      : req.user.church_id;

    if (!targetChurchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const member = await createMember({
      full_name,
      email,
      address,
      membership_id,
      subscription_amount,
      church_id: targetChurchId,
    });
    logSuperAdminAudit(req, "member.create", {
      church_id: targetChurchId,
      email: typeof email === "string" ? email : undefined,
    });
    persistAuditLog(req, "member.create", "member", undefined, {
      church_id: targetChurchId,
      email: typeof email === "string" ? email : undefined,
    });
    return res.json(member);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create member") });
  }
});

router.post("/link", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const { email } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    if (!req.user.church_id) return res.status(400).json({ error: "No church associated with your account" });

    // 1.3: Only allow linking to own email — prevents account takeover
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const callerEmail = (req.user.email || "").trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail !== callerEmail) {
      return res.status(403).json({ error: "You can only link to your own email address" });
    }

    const record = await linkUserToMember(req.user.id, normalizedEmail, req.user.church_id);
    return res.json(record);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to link member") });
  }
});

router.get("/search", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can search members" });
    }

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    const query = typeof req.query.query === "string" ? req.query.query : "";
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

    const rows = await searchMembers({
      churchId: churchId || undefined,
      query,
      limit,
    });

    return res.json(rows);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to search members") });
  }
});

router.get("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can fetch member details" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID format" });
    }
    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }
    const member = await getMemberById(memberId, churchId);
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    return res.json(member);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to fetch member details") });
  }
});

router.get("/:id/delete-impact", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can inspect member delete impact" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID format" });
    }
    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const impact = await getMemberDeleteImpact(memberId, churchId);
    return res.json(impact);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to inspect delete impact") });
  }
});

router.patch("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can update members" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID format" });
    }
    const churchId = resolveScopedChurchId(req, req.body?.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const updated = await updateMember(memberId, churchId, {
      full_name: req.body?.full_name,
      email: req.body?.email,
      address: req.body?.address,
      membership_id: req.body?.membership_id,
      phone_number: req.body?.phone_number,
      alt_phone_number: req.body?.alt_phone_number,
      verification_status: req.body?.verification_status,
      subscription_amount:
        typeof req.body?.subscription_amount === "number"
          ? req.body.subscription_amount
          : undefined,
    });

    logSuperAdminAudit(req, "member.update", {
      member_id: memberId,
      church_id: churchId,
    });
    persistAuditLog(req, "member.update", "member", memberId, { church_id: churchId });

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to update member") });
  }
});

router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
      return res.status(403).json({ error: "Only admin can delete members" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!memberId || !UUID_REGEX.test(memberId)) {
      return res.status(400).json({ error: "Invalid member ID format" });
    }
    const churchId = resolveScopedChurchId(req, req.body?.church_id || req.query.church_id);
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const confirmed =
      req.body?.confirm === true ||
      String(req.query.confirm || "").toLowerCase() === "true";

    if (!confirmed) {
      const impact = await getMemberDeleteImpact(memberId, churchId);
      return res.status(409).json({
        error: "Delete requires confirm=true",
        impact,
      });
    }

    const result = await deleteMember(memberId, churchId);
    logSuperAdminAudit(req, "member.delete", {
      member_id: memberId,
      church_id: churchId,
    });
    persistAuditLog(req, "member.delete", "member", memberId, { church_id: churchId });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to delete member") });
  }
});

export default router;
