import { NextFunction, Response } from "express";
import { AuthRequest } from "./requireAuth";
import { isSuperAdminEmail } from "./requireSuperAdmin";

export function requireAdminOrSuper(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthenticated" });
  }
  if (req.user.role !== "admin" && !isSuperAdminEmail(req.user.email, req.user.phone)) {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }
  return next();
}
