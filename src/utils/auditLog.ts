import { db } from "../services/dbClient";
import { logger } from "./logger";
import type { AuthRequest } from "../middleware/requireAuth";

export async function persistAuditLog(
  req: AuthRequest,
  action: string,
  targetType?: string,
  targetId?: string,
  details: Record<string, unknown> = {}
) {
  try {
    const ip = req.headers["x-forwarded-for"]
      ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
      : req.socket?.remoteAddress || null;

    await db.from("admin_audit_log").insert([{
      actor_user_id: req.user?.id || null,
      actor_email: req.user?.email || "unknown",
      actor_role: req.user?.role || null,
      church_id: req.user?.church_id || null,
      action,
      entity_type: targetType || null,
      entity_id: targetId || null,
      ip_address: ip,
      details: {
        ...details,
        method: req.method,
        path: req.originalUrl,
      },
    }]);
  } catch (err) {
    logger.warn({ err, action }, "persistAuditLog failed (non-blocking)");
  }
}

export async function listAuditLogs(churchId: string | undefined, limit = 100, offset = 0, isSuperAdmin = false) {
  let query = db
    .from("admin_audit_log")
    .select("id, church_id, actor_user_id, actor_role, action, target_type, target_id, ip_address, details, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (churchId) {
    query = query.eq("church_id", churchId);
  } else if (!isSuperAdmin) {
    // Non-super-admins without a churchId see nothing (safety: prevent cross-church leakage)
    return [];
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ err: error }, "listAuditLogs failed");
    throw error;
  }

  return data || [];
}
