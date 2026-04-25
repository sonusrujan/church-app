import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import { db, rawQuery } from "../services/dbClient";
import { rlsStorage } from "./rlsContext";
import { logger } from "../utils/logger";

// Simple in-memory TTL cache for role lookups (2s — short enough that revocations are seen quickly)
const roleCache = new Map<string, { role: string; church_id: string; ts: number }>();
const ROLE_CACHE_TTL = 2_000;

// Cache for junction-table validated church contexts: "userId:churchId" → { role, ts }
const churchContextCache = new Map<string, { role: string; ts: number }>();
const CHURCH_CONTEXT_TTL = 2_000;

/** AUTH-1: Invalidate cached role for a specific user (call after role/church changes) */
export function invalidateRoleCache(userId: string): void {
  roleCache.delete(userId);
  // Also invalidate all church context entries for this user
  for (const key of churchContextCache.keys()) {
    if (key.startsWith(`${userId}:`)) churchContextCache.delete(key);
  }
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

/**
 * Validate that a user belongs to the requested church via the junction table.
 * Returns the user's role in that church, or null if not a member.
 */
async function validateChurchMembership(userId: string, churchId: string): Promise<string | null> {
  const cacheKey = `${userId}:${churchId}`;
  const cached = churchContextCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHURCH_CONTEXT_TTL) {
    return cached.role;
  }

  const { rows } = await rawQuery<{ role: string }>(
    `SELECT ucm.role FROM user_church_memberships ucm
     JOIN users u ON u.id = ucm.user_id
     WHERE (u.auth_user_id::text = $1 OR u.id::text = $1)
       AND ucm.church_id = $2::uuid
       AND ucm.is_active = true
     LIMIT 1`,
    [userId, churchId]
  );

  if (rows.length === 0) return null;
  const role = rows[0].role || "member";
  churchContextCache.set(cacheKey, { role, ts: Date.now() });
  return role;
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

    // Verify custom JWT (issued by OTP verify)
    let decoded: {
      sub: string;
      phone?: string;
      email?: string;
      role?: string;
      church_id?: string;
    };
    try {
      decoded = jwt.verify(token, JWT_SECRET) as typeof decoded;
    } catch (jwtErr: any) {
      const isExpired = jwtErr?.name === "TokenExpiredError";
      logger.warn({
        ip: req.ip,
        reason: isExpired ? "token_expired" : "invalid_token",
        jwtError: jwtErr?.message,
        jwtName: jwtErr?.name,
      }, "Auth: JWT verification failed");
      return res.status(401).json({
        error: isExpired ? "Session expired. Please sign in again." : "Invalid auth token",
      });
    }

    if (!decoded.sub) {
      logger.warn({ ip: req.ip }, "Auth: invalid token — missing sub claim");
      return res.status(401).json({ error: "Invalid auth token" });
    }

    // ── Step 1: Look up the user from the users table ──
    let role = "";
    let church_id = "";
    let isSuperAdmin = false;

    const cached = roleCache.get(decoded.sub);
    if (cached && Date.now() - cached.ts < ROLE_CACHE_TTL) {
      role = cached.role;
      church_id = cached.church_id;
    } else {
      const { rows } = await rawQuery<{ role: string; church_id: string }>(
        `SELECT role, church_id FROM users WHERE auth_user_id::text = $1 OR id::text = $1 LIMIT 1`,
        [decoded.sub]
      );
      const userRow = rows[0] || null;

      if (userRow) {
        role = userRow.role || "member";
        church_id = userRow.church_id || "";
      } else {
        logger.warn({ userId: decoded.sub }, "Auth: user not found in DB, rejecting");
        return res.status(401).json({ error: "User account not found. Please sign in again." });
      }

      roleCache.set(decoded.sub, { role, church_id, ts: Date.now() });
    }

    isSuperAdmin = role === "super_admin";

    // ── Step 2: Honor X-Church-Id header (junction-table validated) ──
    const headerChurchId = (req.headers["x-church-id"] as string || "").trim();

    // SH-010: Validate UUID format before any DB query to prevent Postgres cast errors
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (headerChurchId && !UUID_RE.test(headerChurchId)) {
      return res.status(400).json({ error: "Invalid X-Church-Id format" });
    }

    if (headerChurchId && !isSuperAdmin) {
      // Validate via junction table: user must be an active member of this church
      const junctionRole = await validateChurchMembership(decoded.sub, headerChurchId);
      if (!junctionRole) {
        logger.warn({ userId: decoded.sub, requestedChurchId: headerChurchId }, "Auth: X-Church-Id not authorized via junction table");
        return res.status(403).json({ error: "You are not a member of the requested church." });
      }
      // Use the junction table role and the requested church_id
      role = junctionRole;
      church_id = headerChurchId;
    } else if (headerChurchId && isSuperAdmin) {
      // SH-009: Super-admins can switch to any church context — audit-log the switch
      logger.info({ userId: decoded.sub, targetChurchId: headerChurchId, path: req.path }, "Super-admin church context switch via X-Church-Id");
      church_id = headerChurchId;
    }
    // If no X-Church-Id header, fall back to users.church_id (backward compat)

    // ── Step 3: Verify church is active ──
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

    req.user = {
      id: decoded.sub,
      email: decoded.email || "",
      phone: decoded.phone || "",
      role,
      church_id,
    };

    // Update RLS context with the validated church_id
    const store = rlsStorage.getStore();
    if (store) store.churchId = church_id || null;

    return next();
  } catch (err: any) {
    logger.error({ err: err?.message }, "requireAuth error");
    return res.status(500).json({ error: "Authentication service unavailable. Please try again." });
  }
}
