import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { requireSuperAdmin, isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import {
  createMembershipRequest,
  listMembershipRequests,
  reviewMembershipRequest,
} from "../services/membershipRequestService";
import {
  createCancellationRequest,
  listCancellationRequests,
  reviewCancellationRequest,
} from "../services/cancellationRequestService";
import {
  submitFamilyMemberCreateRequest,
  listFamilyMemberCreateRequests,
  listMyFamilyMemberCreateRequests,
  reviewFamilyMemberCreateRequest,
} from "../services/familyMemberCreateService";
import {
  createAccountDeletionRequest,
  listAccountDeletionRequests,
  reviewAccountDeletionRequest,
} from "../services/accountDeletionRequestService";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { queueNotification } from "../services/notificationService";
import { validate, membershipRequestSchema, reviewDecisionSchema, cancellationRequestSchema, familyCreateRequestSchema, accountDeletionRequestSchema, batchReviewSchema } from "../utils/zodSchemas";
import { logger } from "../utils/logger";

const router = Router();

async function runBatchReview(
  requestIds: string[],
  handler: (requestId: string) => Promise<unknown>,
) {
  const results: Array<{ request_id: string; success: boolean; error?: string }> = [];

  for (const requestId of requestIds) {
    try {
      await handler(requestId);
      results.push({ request_id: requestId, success: true });
    } catch (err: any) {
      results.push({ request_id: requestId, success: false, error: safeErrorMessage(err, "Request review failed") });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results,
  };
}

// ═══ Membership Requests ═══

// BE-4: Rate-limit membership requests (5 per minute per user)
const membershipRequestLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).user?.id || req.ip || "unknown",
  validate: { keyGeneratorIpFallback: false },
  message: { error: "Too many requests, please try again later" },
});

// Public-ish: requires auth (Google login) but NOT requireRegisteredUser
// This is the self-registration endpoint
router.post("/membership-requests", requireAuth, membershipRequestLimiter, validate(membershipRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { church_code, full_name, phone_number, address, membership_id, message } = req.body;

    if (!church_code || typeof church_code !== "string" || !church_code.trim()) {
      return res.status(400).json({ error: "Church code is required." });
    }
    if (!/^\d{8}$/.test(church_code.trim())) {
      return res.status(400).json({ error: "Church code must be exactly 8 digits." });
    }
    if (!full_name || typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({ error: "Full name is required." });
    }

    const email = req.user?.email || "";
    const phone = req.user?.phone || (typeof phone_number === "string" ? phone_number.trim() : "");

    if (!email && !phone) {
      return res.status(401).json({ error: "Email or phone not available from auth." });
    }

    const result = await createMembershipRequest({
      church_code: church_code.trim(),
      email: email || undefined,
      full_name: full_name.trim(),
      phone_number: phone || undefined,
      address: typeof address === "string" ? address : undefined,
      membership_id: typeof membership_id === "string" ? membership_id : undefined,
      message: typeof message === "string" ? message : undefined,
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to submit request.") });
  }
});

// Admin: list membership requests for their church
router.get("/membership-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    // Non-super-admins MUST use their own church_id (prevent cross-church access)
    const churchId = isSuperAdmin
      ? ((req.query.church_id as string) || req.user?.church_id)
      : req.user?.church_id;
    if (!churchId) {
      return res.status(400).json({ error: "Church ID required." });
    }

    const status = req.query.status as string | undefined;
    const requests = await listMembershipRequests(churchId, status);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load requests.") });
  }
});

// Admin: approve/reject membership request
router.post("/membership-requests/:id/review", requireAuth, requireRegisteredUser, validate(reviewDecisionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { decision, review_note } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }

    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const result = await reviewMembershipRequest(
      req.params.id as string,
      decision,
      req.user!.id,
      typeof review_note === "string" ? review_note : undefined,
      callerChurchId
    );

    await persistAuditLog(req, `membership_request.${decision}`, "membership_request", req.params.id as string, {
      decision,
      review_note,
    });

    // Push notification to the requester about their membership request decision
    try {
      const { db } = await import("../services/dbClient");
      const { data: mReq } = await db.from("membership_requests").select("email, church_id").eq("id", req.params.id).maybeSingle();
      if (mReq?.email && mReq?.church_id) {
        const { data: usr } = await db.from("users").select("id").ilike("email", mReq.email).maybeSingle();
        if (usr?.id) {
          queueNotification({
            church_id: mReq.church_id,
            recipient_user_id: usr.id,
            channel: "push",
            notification_type: "membership_request_review",
            subject: `Membership Request ${decision === "approved" ? "Approved" : "Rejected"}`,
            body: decision === "approved"
              ? "Your membership request has been approved! Welcome to the church."
              : `Your membership request has been rejected.${review_note ? ` Note: ${review_note}` : ""}`,
          }).catch((err) => { logger.warn({ err }, "Failed to send membership_request_review notification"); });
        }
      }
    } catch { /* non-critical */ }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review request.") });
  }
});

router.post("/membership-requests/batch-review", requireAuth, requireRegisteredUser, validate(batchReviewSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { request_ids, decision, review_note } = req.body;
    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const summary = await runBatchReview(request_ids, async (requestId) => {
      await reviewMembershipRequest(requestId, decision, req.user!.id, review_note, callerChurchId);
      await persistAuditLog(req, `membership_request.${decision}`, "membership_request", requestId, {
        decision,
        review_note,
        batch: true,
      });
    });

    return res.json(summary);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review membership requests.") });
  }
});

// ═══ Cancellation Requests ═══

// Member: request subscription cancellation
router.post("/cancellation-requests", requireAuth, requireRegisteredUser, validate(cancellationRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { subscription_id, reason } = req.body;

    if (!subscription_id || typeof subscription_id !== "string") {
      return res.status(400).json({ error: "Subscription ID is required." });
    }

    // Get member from dashboard
    const { getMemberDashboardByEmail } = require("../services/userService");
    const dashboard = await getMemberDashboardByEmail(req.user!.email, req.user!.phone, req.user!.id, req.user!.church_id);

    if (!dashboard?.member) {
      return res.status(400).json({ error: "Member profile not found." });
    }

    if (!dashboard.member.church_id) {
      return res.status(400).json({ error: "No church associated." });
    }

    const result = await createCancellationRequest(
      subscription_id,
      dashboard.member.id,
      dashboard.member.church_id,
      typeof reason === "string" ? reason : undefined
    );

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to submit request.") });
  }
});

// Admin: list cancellation requests
router.get("/cancellation-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    // Non-super-admins MUST use their own church_id (prevent cross-church access)
    const churchId = isSuperAdmin
      ? ((req.query.church_id as string) || req.user?.church_id)
      : req.user?.church_id;
    if (!churchId) {
      return res.status(400).json({ error: "Church ID required." });
    }

    const status = req.query.status as string | undefined;
    const requests = await listCancellationRequests(churchId, status);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load requests.") });
  }
});

// Admin: approve/reject cancellation request
router.post("/cancellation-requests/:id/review", requireAuth, requireRegisteredUser, validate(reviewDecisionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { decision, review_note } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }

    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const result = await reviewCancellationRequest(
      req.params.id as string,
      decision,
      req.user!.id,
      typeof review_note === "string" ? review_note : undefined,
      callerChurchId
    );

    await persistAuditLog(req, `cancellation_request.${decision}`, "cancellation_request", req.params.id as string, {
      decision,
      review_note,
    });

    // Push notification to the member about cancellation decision
    try {
      const { db } = await import("../services/dbClient");
      const { data: cReq } = await db.from("cancellation_requests").select("member_id").eq("id", req.params.id).maybeSingle();
      if (cReq?.member_id) {
        const { data: member } = await db.from("members").select("user_id, church_id").eq("id", cReq.member_id).maybeSingle();
        if (member?.user_id && member?.church_id) {
          queueNotification({
            church_id: member.church_id,
            recipient_user_id: member.user_id,
            channel: "push",
            notification_type: "cancellation_request_review",
            subject: `Cancellation ${decision === "approved" ? "Approved" : "Rejected"}`,
            body: decision === "approved"
              ? "Your subscription cancellation request has been approved."
              : "Your subscription cancellation request has been rejected.",
          }).catch((err) => { logger.warn({ err }, "Failed to send cancellation_request_review notification"); });
        }
      }
    } catch { /* non-critical */ }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review request.") });
  }
});

router.post("/cancellation-requests/batch-review", requireAuth, requireRegisteredUser, validate(batchReviewSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { request_ids, decision, review_note } = req.body;
    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const summary = await runBatchReview(request_ids, async (requestId) => {
      await reviewCancellationRequest(requestId, decision, req.user!.id, review_note, callerChurchId);
      await persistAuditLog(req, `cancellation_request.${decision}`, "cancellation_request", requestId, {
        decision,
        review_note,
        batch: true,
      });
    });

    return res.json(summary);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review cancellation requests.") });
  }
});

// ═══ Family Member Create Requests ═══

// Member: submit a request to create a new family member
router.post("/family-create-requests", requireAuth, requireRegisteredUser, validate(familyCreateRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { getMemberDashboardByEmail } = require("../services/userService");
    const dashboard = await getMemberDashboardByEmail(req.user!.email, req.user!.phone, req.user!.id, req.user!.church_id);
    if (!dashboard?.member) {
      return res.status(400).json({ error: "Member profile not found." });
    }

    const { full_name, phone_number, email, date_of_birth, relation, address, notes } = req.body;
    if (!full_name || !relation) {
      return res.status(400).json({ error: "full_name and relation are required." });
    }

    const result = await submitFamilyMemberCreateRequest({
      requester_member_id: dashboard.member.id,
      church_id: dashboard.member.church_id || req.user!.church_id,
      full_name,
      phone_number,
      email,
      date_of_birth,
      relation,
      address,
      notes,
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to submit request.") });
  }
});

// Member: list my own family create requests
router.get("/family-create-requests/mine", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const { getMemberDashboardByEmail } = require("../services/userService");
    const dashboard = await getMemberDashboardByEmail(req.user!.email, req.user!.phone, req.user!.id, req.user!.church_id);
    if (!dashboard?.member) {
      return res.status(400).json({ error: "Member profile not found." });
    }

    const requests = await listMyFamilyMemberCreateRequests(dashboard.member.id);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load requests.") });
  }
});

// Admin: list family create requests for the church
router.get("/family-create-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    // Non-super-admins MUST use their own church_id (prevent cross-church access)
    const churchId = isSuperAdmin
      ? ((req.query.church_id as string) || req.user?.church_id)
      : req.user?.church_id;
    if (!churchId) return res.status(400).json({ error: "Church ID required." });

    const status = req.query.status as string | undefined;
    const requests = await listFamilyMemberCreateRequests(churchId, status);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load requests.") });
  }
});

// Admin: approve/reject family create request
router.post("/family-create-requests/:id/review", requireAuth, requireRegisteredUser, validate(reviewDecisionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { decision, review_notes } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }

    const result = await reviewFamilyMemberCreateRequest(
      req.params.id as string,
      decision,
      req.user!.id,
      typeof review_notes === "string" ? review_notes : undefined,
      isSuperAdmin ? undefined : req.user!.church_id
    );

    await persistAuditLog(req, `family_create_request.${decision}`, "family_create_request", req.params.id as string, {
      decision,
      review_notes,
    });

    // Push notification to the requester about family create request decision
    try {
      const { db } = await import("../services/dbClient");
      const { data: fReq } = await db.from("family_member_create_requests").select("requester_member_id").eq("id", req.params.id).maybeSingle();
      if (fReq?.requester_member_id) {
        const { data: member } = await db.from("members").select("user_id, church_id").eq("id", fReq.requester_member_id).maybeSingle();
        if (member?.user_id && member?.church_id) {
          queueNotification({
            church_id: member.church_id,
            recipient_user_id: member.user_id,
            channel: "push",
            notification_type: "family_request_review",
            subject: `Family Member Request ${decision === "approved" ? "Approved" : "Rejected"}`,
            body: decision === "approved"
              ? "Your family member request has been approved."
              : "Your family member request has been rejected.",
          }).catch((err) => { logger.warn({ err }, "Failed to send family_request_review notification"); });
        }
      }
    } catch { /* non-critical */ }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review request.") });
  }
});

// ═══ Account Deletion Requests ═══

// Member: request account deletion
router.post("/account-deletion-requests", requireAuth, requireRegisteredUser, validate(accountDeletionRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body;

    const { getMemberDashboardByEmail } = require("../services/userService");
    const dashboard = await getMemberDashboardByEmail(req.user!.email, req.user!.phone, req.user!.id, req.user!.church_id);

    if (!dashboard?.member) {
      return res.status(400).json({ error: "Member profile not found." });
    }

    if (!dashboard.member.church_id) {
      return res.status(400).json({ error: "No church associated." });
    }

    const result = await createAccountDeletionRequest(
      dashboard.member.id,
      req.user!.id,
      dashboard.member.church_id,
      typeof reason === "string" ? reason : undefined
    );

    await persistAuditLog(req, "account_deletion_request.created", "account_deletion_request", result.id, {
      member_id: dashboard.member.id,
    });

    return res.status(201).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to submit deletion request.") });
  }
});

// Admin: list account deletion requests
router.get("/account-deletion-requests", requireAuth, requireRegisteredUser, async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const churchId = isSuperAdmin
      ? ((req.query.church_id as string) || req.user?.church_id)
      : req.user?.church_id;
    if (!churchId) {
      return res.status(400).json({ error: "Church ID required." });
    }

    const status = req.query.status as string | undefined;
    const requests = await listAccountDeletionRequests(churchId, status);
    return res.json(requests);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to load deletion requests.") });
  }
});

// Admin: approve/reject account deletion request
router.post("/account-deletion-requests/:id/review", requireAuth, requireRegisteredUser, validate(reviewDecisionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { decision, review_note } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ error: "Decision must be 'approved' or 'rejected'." });
    }

    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const result = await reviewAccountDeletionRequest(
      req.params.id as string,
      decision,
      req.user!.id,
      typeof review_note === "string" ? review_note : undefined,
      callerChurchId
    );

    await persistAuditLog(req, `account_deletion_request.${decision}`, "account_deletion_request", req.params.id as string, {
      decision,
      review_note,
    });

    // Push notification to the member about deletion decision
    try {
      const { db } = await import("../services/dbClient");
      const { data: delReq } = await db.from("account_deletion_requests").select("user_id, church_id").eq("id", req.params.id).maybeSingle();
      if (delReq?.user_id && delReq?.church_id) {
        queueNotification({
          church_id: delReq.church_id,
          recipient_user_id: delReq.user_id,
          channel: "push",
          notification_type: "account_deletion_review",
          subject: `Account Deletion ${decision === "approved" ? "Approved" : "Rejected"}`,
          body: decision === "approved"
            ? "Your account deletion request has been approved. Your account has been removed."
            : `Your account deletion request has been rejected.${review_note ? ` Note: ${review_note}` : ""}`,
        }).catch((err) => { logger.warn({ err }, "Failed to send account_deletion_review notification"); });
      }
    } catch { /* non-critical */ }

    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review deletion request.") });
  }
});

router.post("/account-deletion-requests/batch-review", requireAuth, requireRegisteredUser, validate(batchReviewSchema), async (req: AuthRequest, res: Response) => {
  try {
    const role = req.user?.role;
    const isSuperAdmin = isSuperAdminEmail(req.user?.email, req.user?.phone);

    if (role !== "admin" && !isSuperAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }

    const { request_ids, decision, review_note } = req.body;
    const callerChurchId = isSuperAdmin ? undefined : req.user?.church_id;
    const summary = await runBatchReview(request_ids, async (requestId) => {
      await reviewAccountDeletionRequest(requestId, decision, req.user!.id, review_note, callerChurchId);
      await persistAuditLog(req, `account_deletion_request.${decision}`, "account_deletion_request", requestId, {
        decision,
        review_note,
        batch: true,
      });
    });

    return res.json(summary);
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to review account deletion requests.") });
  }
});

export default router;
