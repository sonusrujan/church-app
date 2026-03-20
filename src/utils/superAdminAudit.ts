import { AuthRequest } from "../middleware/requireAuth";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { logger } from "./logger";

type AuditDetails = Record<string, unknown>;

function compactDetails(details: AuditDetails) {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  );
}

export function logSuperAdminAudit(req: AuthRequest, action: string, details: AuditDetails = {}) {
  if (!req.user || !isSuperAdminEmail(req.user.email)) {
    return;
  }

  logger.info(
    {
      type: "super_admin_audit",
      action,
      actor_user_id: req.user.id,
      actor_email: req.user.email,
      actor_church_id: req.user.church_id || null,
      method: req.method,
      path: req.originalUrl,
      details: compactDetails(details),
      at: new Date().toISOString(),
    },
    "super-admin operation executed"
  );
}
