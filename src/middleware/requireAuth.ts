import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import { db } from "../services/dbClient";
import { rlsStorage } from "./rlsContext";
import { logger } from "../utils/logger";

// Simple in-memory TTL cache for role lookups (15s for security)
const roleCache = new Map<string, { role: string; church_id: string; ts: number }>();
const ROLE_CACHE_TTL = 15_000;

/** AUTH-1: Invalidate cached role for a specific user (call after role/church changes) */
export function invalidateRoleCache(userId: string): void {
  roleCache.delete(userId);
}

export interface RegisteredUserProfile {
  id: string;
  auth_user_id: string | null;
  email: string;
  phone_number: string | null;
  full_name: string | null;
  role: string;
  church_id: string | null;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    phone: string;
    role: string;
    church_id: string;
  };
  registeredProfile?: RegisteredUserProfile;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.warn({ ip: req.ip, path: req.path }, "Auth: missing or invalid authorization header");
      return res.status(401).json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.split(" ")[1];
    if (!token || token.split(".").length !== 3) {
      logger.warn({ ip: req.ip, path: req.path }, "Auth: invalid token format");
      return res.status(401).json({ error: "Invalid auth token format" });
    }

    // Verify custom JWT (issued by OTP verify or Google OAuth callback)
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as {
        sub: string;
        phone?: string;
        email?: string;
        role?: string;
        church_id?: string;
      };

      if (!decoded.sub) {
        logger.warn({ ip: req.ip }, "Auth: invalid token — missing sub claim");
        return res.status(401).json({ error: "Invalid auth token" });
      }

      // Always verify role and church_id from DB (with 15s TTL cache)
      let role = "";
      let church_id = "";
      const cached = roleCache.get(decoded.sub);
      if (cached && Date.now() - cached.ts < ROLE_CACHE_TTL) {
        role = cached.role;
        church_id = cached.church_id;
      } else {
        // Look up from users table by auth_user_id or id
        const { data: userRow } = await db
          .from("users")
          .select("role, church_id")
          .or(`auth_user_id.eq.${decoded.sub},id.eq.${decoded.sub}`)
          .limit(1)
          .maybeSingle();

        if (userRow) {
          role = userRow.role || "member";
          church_id = userRow.church_id || "";
        } else {
          // AUTH-2: User not found in DB — reject instead of falling back to JWT claims
          logger.warn({ userId: decoded.sub }, "Auth: user not found in DB, rejecting");
          return res.status(401).json({ error: "User account not found. Please sign in again." });
        }

        // EDGE-6: Verify the user's church is still active (not deleted/disabled)
        if (church_id) {
          const { data: churchRow } = await db
            .from("churches")
            .select("deleted_at, service_enabled")
            .eq("id", church_id)
            .maybeSingle();
          if (churchRow && (churchRow.deleted_at || churchRow.service_enabled === false)) {
            logger.warn({ userId: decoded.sub, churchId: church_id }, "Auth: user's church is deactivated");
            return res.status(403).json({ error: "Your church account has been deactivated" });
          }
        }

        roleCache.set(decoded.sub, { role, church_id, ts: Date.now() });
      }

      req.user = {
        id: decoded.sub,
        email: decoded.email || "",
        phone: decoded.phone || "",
        role,
        church_id,
      };

      // 1.1: Update RLS context with the authenticated user's church_id
      const store = rlsStorage.getStore();
      if (store) store.churchId = church_id || null;

      return next();
    } catch (jwtErr: any) {
      const isExpired = jwtErr?.name === "TokenExpiredError";
      logger.warn({ ip: req.ip, reason: isExpired ? "token_expired" : "invalid_token" }, "Auth: JWT verification failed");
      return res.status(401).json({
        error: isExpired ? "Session expired. Please sign in again." : "Invalid auth token",
      });
    }
  } catch (err: any) {
    logger.error({ err: err?.message }, "requireAuth error");
    return res.status(500).json({ error: "Authentication service unavailable. Please try again." });
  }
}
