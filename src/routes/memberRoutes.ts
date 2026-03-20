import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
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

const router = Router();

function resolveScopedChurchId(req: AuthRequest, requestedChurchId?: string) {
  if (!req.user) {
    throw new Error("Unauthenticated");
  }

  const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email);
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

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can view members list" });
    }

    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));

    const rows = await listMembers(churchId || undefined);
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to list members" });
  }
});

router.post("/create", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    const requesterIsSuperAdmin = isSuperAdminEmail(req.user.email);

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
    return res.json(member);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to create member" });
  }
});

router.post("/link", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const { email } = req.body;
    if (!req.user) return res.status(401).json({ error: "Unauthenticated" });
    const record = await linkUserToMember(req.user.id, email);
    return res.json(record);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to link member" });
  }
});

router.get("/search", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
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
    return res.status(400).json({ error: err.message || "Failed to search members" });
  }
});

router.get("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can fetch member details" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    const member = await getMemberById(memberId, churchId || undefined);
    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    return res.json(member);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to fetch member details" });
  }
});

router.get("/:id/delete-impact", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can inspect member delete impact" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const churchId = resolveScopedChurchId(req, String(req.query.church_id || ""));
    if (!churchId) {
      return res.status(400).json({ error: "church_id is required" });
    }

    const impact = await getMemberDeleteImpact(memberId, churchId);
    return res.json(impact);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to inspect delete impact" });
  }
});

router.patch("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can update members" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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

    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to update member" });
  }
});

router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email)) {
      return res.status(403).json({ error: "Only admin can delete members" });
    }

    const memberId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
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
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || "Failed to delete member" });
  }
});

export default router;
