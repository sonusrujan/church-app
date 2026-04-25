import { NextFunction, Response } from "express";
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES } from "../config";
import { AuthRequest } from "./requireAuth";

const superAdminEmailSet = new Set(SUPER_ADMIN_EMAILS.map((email) => email.toLowerCase()));
const superAdminPhoneSet = new Set(SUPER_ADMIN_PHONES);

export function isSuperAdminEmail(email?: string, phone?: string) {
  if (email && superAdminEmailSet.has(email.trim().toLowerCase())) return true;
  if (phone && superAdminPhoneSet.has(phone.trim())) return true;
  return false;
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  if (!isSuperAdminEmail(req.user.email, req.user.phone)) {
    return res.status(403).json({ error: "Only super admin can manage admins" });
  }

  return next();
}
