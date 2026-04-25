import { Response, NextFunction } from "express";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";
import type { AuthRequest } from "./requireAuth";

/**
 * Auto-audit middleware: logs all mutation requests (POST, PUT, PATCH, DELETE)
 * to the admin_audit_log table automatically. This is a systemic fix that
 * eliminates the "forgot to call persistAuditLog()" class of bugs.
 *
 * Mount AFTER requireAuth so req.user is populated.
 * Manual persistAuditLog() calls still work and provide richer entity-level details.
 * This middleware provides a baseline safety net.
 */
export function autoAudit(req: AuthRequest, res: Response, next: NextFunction) {
  // Only audit mutations
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  // Skip noisy/internal endpoints
  const skipPaths = ["/api/otp", "/api/webhooks", "/api/auth/refresh"];
  if (skipPaths.some((p) => req.originalUrl.startsWith(p))) {
    return next();
  }

  // Capture the original res.json to log after the response is sent
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    // Fire-and-forget audit log after response
    const statusCode = res.statusCode;
    if (req.user?.id && statusCode >= 200 && statusCode < 300) {
      const ip = req.headers["x-forwarded-for"]
        ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
        : req.socket?.remoteAddress || null;

      // Derive action from method + route path
      const routePath = req.route?.path || req.path || req.originalUrl;
      const action = `auto:${req.method.toLowerCase()}:${req.baseUrl || ""}${routePath}`;

      db.from("admin_audit_log")
        .insert([
          {
            actor_user_id: req.user.id,
            actor_email: req.user.email || "unknown",
            actor_role: req.user.role || null,
            church_id: req.user.church_id || null,
            action,
            entity_type: null,
            entity_id: null,
            ip_address: ip,
            details: {
              method: req.method,
              path: req.originalUrl,
              status: statusCode,
              auto: true,
            },
          },
        ])
        .then(() => {})
        .catch((err: unknown) => {
          logger.warn({ err, action }, "autoAudit insert failed (non-blocking)");
        });
    }
    return originalJson(body);
  } as typeof res.json;

  return next();
}
