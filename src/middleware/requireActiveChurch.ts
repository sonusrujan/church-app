import { Response, NextFunction } from "express";
import { AuthRequest } from "./requireAuth";
import { isSuperAdminEmail } from "./requireSuperAdmin";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";

/**
 * Middleware that checks if the user's church has an active trial or
 * subscription. Returns 402 if expired.
 *
 * Skips the check for:
 *  - Super admins
 *  - Users with no church_id (not yet onboarded)
 *  - GET /me, /sync-profile, /member-dashboard (basic access)
 */
export async function requireActiveChurch(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user?.church_id) return next();
    if (isSuperAdminEmail(req.user.email, req.user.phone)) return next();

    const { data: church } = await db
      .from("churches")
      .select("id, service_enabled, trial_ends_at, deleted_at")
      .eq("id", req.user.church_id)
      .maybeSingle();

    if (!church) {
      return res.status(403).json({ error: "Church not found" });
    }

    if (church.deleted_at) {
      return res.status(403).json({ error: "This church has been deactivated" });
    }

    if (!church.service_enabled) {
      return res.status(402).json({
        error: "Church service is inactive. Please contact support to reactivate.",
        code: "CHURCH_INACTIVE",
      });
    }

    // Check trial expiry
    if (church.trial_ends_at && new Date(church.trial_ends_at) < new Date()) {
      // Trial expired — check if there's an active church subscription
      const { data: activeSub } = await db
        .from("church_subscriptions")
        .select("id")
        .eq("church_id", req.user.church_id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (!activeSub) {
        return res.status(402).json({
          error: "Your church's trial has expired. Please subscribe to continue using the platform.",
          code: "TRIAL_EXPIRED",
        });
      }
    }

    return next();
  } catch (err: any) {
    logger.error({ err: err?.message }, "requireActiveChurch DB check failed");
    return res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
}
