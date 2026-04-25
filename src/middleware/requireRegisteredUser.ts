import { NextFunction, Response } from "express";
import { AuthRequest, RegisteredUserProfile } from "./requireAuth";
import { getRegisteredUserContext } from "../services/userService";
import { rlsStorage } from "./rlsContext";

// Cache registered user profile lookups (30s TTL) to avoid repeated DB hits
const profileCache = new Map<string, { profile: RegisteredUserProfile; ts: number }>();
const PROFILE_CACHE_TTL = 30_000;

export function invalidateProfileCache(userId: string): void {
  profileCache.delete(userId);
}

export async function requireRegisteredUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    // Check cache first (keyed by user.id from requireAuth)
    const cached = profileCache.get(req.user.id);
    let profile: RegisteredUserProfile | null = null;
    if (cached && Date.now() - cached.ts < PROFILE_CACHE_TTL) {
      profile = cached.profile;
    } else {
      profile = await getRegisteredUserContext(req.user.id, req.user.email, req.user.phone) as RegisteredUserProfile | null;
      if (profile) {
        profileCache.set(req.user.id, { profile, ts: Date.now() });
      }
    }

    if (!profile) {
      return res.status(403).json({ error: "This account is not registered" });
    }

    req.registeredProfile = profile;
    // Backfill email/phone from DB profile so downstream code has identity
    if (!req.user.email && profile.email) req.user.email = profile.email;
    if (!req.user.phone && profile.phone_number) req.user.phone = profile.phone_number;
    req.user.role = profile.role || req.user.role;
    req.user.church_id = profile.church_id || req.user.church_id || "";

    // 1.1: Update RLS context with the resolved church_id
    const store = rlsStorage.getStore();
    if (store && req.user.church_id) store.churchId = req.user.church_id;

    return next();
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to validate registered user" });
  }
}
