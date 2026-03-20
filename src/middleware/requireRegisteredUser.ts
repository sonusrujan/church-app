import { NextFunction, Response } from "express";
import { AuthRequest } from "./requireAuth";
import { getRegisteredUserContext } from "../services/userService";

export async function requireRegisteredUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const profile = await getRegisteredUserContext(req.user.id, req.user.email);
    if (!profile) {
      return res.status(403).json({ error: "This email is not registered" });
    }

    req.registeredProfile = profile;
    req.user.role = profile.role || req.user.role;
    req.user.church_id = profile.church_id || req.user.church_id || "";

    return next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to validate registered user" });
  }
}
