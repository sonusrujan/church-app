import { NextFunction, Response } from "express";
import { AuthRequest } from "./requireAuth";
import { getRegisteredUserContext } from "../services/userService";
import { rlsStorage } from "./rlsContext";

export async function requireRegisteredUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const profile = await getRegisteredUserContext(req.user.id, req.user.email, req.user.phone);
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
