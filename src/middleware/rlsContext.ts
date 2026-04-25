import { AsyncLocalStorage } from "node:async_hooks";

/** Per-request context for Row-Level Security. */
export interface RlsContext {
  churchId: string | null; // null = super-admin / no tenant scope
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>();

/**
 * Returns the current church_id to be used for the SET LOCAL
 * `app.current_church_id` PostgreSQL GUC.
 *
 * - If no context is set (cron jobs, startup queries), returns "__NONE__"
 *   which matches no church, preventing permissive access.
 * - If context is set but churchId is null (super-admin), returns "".
 * - Otherwise returns the tenanted church_id.
 */
export function getCurrentChurchId(): string {
  const ctx = rlsStorage.getStore();
  if (!ctx) return "__NONE__"; // no request context – deny by default
  return ctx.churchId || "";
}
