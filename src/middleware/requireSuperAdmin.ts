import { NextFunction, Response } from "express";
import { SUPER_ADMIN_EMAILS } from "../config";
import { AuthRequest } from "./requireAuth";

const superAdminSet = new Set(SUPER_ADMIN_EMAILS.map((email) => email.toLowerCase()));

export function isSuperAdminEmail(email: string) {
  return superAdminSet.has(email.trim().toLowerCase());
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  if (!isSuperAdminEmail(req.user.email)) {
    return res.status(403).json({ error: "Only super admin can manage admins" });
  }

  return next();
}
