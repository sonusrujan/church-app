import { NextFunction, Response } from "express";
import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_PHONES } from "../config";
import { AuthRequest } from "./requireAuth";

const superAdminEmailSet = new Set(SUPER_ADMIN_EMAILS.map((email) => email.toLowerCase()));
const superAdminPhoneSet = new Set(SUPER_ADMIN_PHONES);

/**
 * Returns true if the given email/phone belongs to a configured super-admin.
 * Used as a bootstrap check and as a secondary guard; the primary control is
 * req.user.role === "super_admin" which is set from the DB by requireAuth.
 */
export function isSuperAdminEmail(email?: string, phone?: string) {
  if (email && superAdminEmailSet.has(email.trim().toLowerCase())) return true;
  if (phone && superAdminPhoneSet.has(phone.trim())) return true;
  return false;
}

export function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthenticated" });
  }

  // Primary: DB-backed role set by requireAuth from users.role column.
  // Secondary: env-var bootstrap sets for the initial super-admin account.
  const isSuper =
    req.user.role === "super_admin" ||
    isSuperAdminEmail(req.user.email, req.user.phone);

  if (!isSuper) {
    return res.status(403).json({ error: "Only super admin can manage admins" });
  }

  return next();
}
