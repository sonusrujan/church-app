/**
 * Church payment configuration service — Razorpay Routes model.
 * All payments go through the platform (global) Razorpay credentials.
 * Per-church API keys have been removed (see migration 028).
 */
import { PAYMENTS_ENABLED, RAZORPAY_KEY_ID } from "../config";
import { logger } from "../utils/logger";
import { db } from "./dbClient";

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

export type EffectivePaymentConfig = {
  payments_enabled: boolean;
  key_id: string;
  key_secret: string;
  source: "global" | "disabled";
  reason: string;
};

/**
 * Returns the effective payment config for any church.
 * In the Razorpay Routes model, all churches share the platform credentials.
 * The churchId parameter is accepted for API compatibility but not used for key lookup.
 */
export async function getEffectivePaymentConfig(_churchId?: string | null): Promise<EffectivePaymentConfig> {
  if (!PAYMENTS_ENABLED) {
    return { payments_enabled: false, key_id: "", key_secret: "", source: "disabled", reason: "Payments disabled by server" };
  }
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return { payments_enabled: false, key_id: "", key_secret: "", source: "disabled", reason: "Razorpay platform credentials not configured" };
  }
  return {
    payments_enabled: true,
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
    source: "global",
    reason: "Platform Razorpay credentials (Razorpay Routes model)",
  };
}

export async function getChurchPaymentSettings(churchId: string) {
  const { data, error } = await db
    .from("churches")
    .select("id, payments_enabled, routes_enabled")
    .eq("id", churchId)
    .maybeSingle<{ id: string; payments_enabled: boolean | null; routes_enabled: boolean | null }>();

  if (error) {
    logger.error({ err: error, churchId }, "getChurchPaymentSettings failed");
    throw error;
  }
  if (!data) throw new Error("Church not found");

  return {
    church_id: churchId,
    payments_enabled: Boolean(data.payments_enabled),
    routes_enabled: Boolean(data.routes_enabled),
    // key_id / has_key_secret retained for API shape compat; always empty (Routes model)
    key_id: "",
    has_key_secret: false,
    schema_ready: true,
  };
}

export async function updateChurchPaymentSettings(input: {
  church_id: string;
  payments_enabled?: boolean;
  key_id?: string;       // accepted but ignored — per-church keys removed
  key_secret?: string;   // accepted but ignored — per-church keys removed
}) {
  if (input.key_id !== undefined || input.key_secret !== undefined) {
    logger.warn({ churchId: input.church_id }, "updateChurchPaymentSettings: key_id/key_secret fields are ignored in Razorpay Routes model");
  }

  const patch: Record<string, unknown> = {};
  if (typeof input.payments_enabled === "boolean") {
    patch.payments_enabled = input.payments_enabled;
  }

  if (Object.keys(patch).length === 0) {
    return getChurchPaymentSettings(input.church_id);
  }

  const { data, error } = await db
    .from("churches")
    .update(patch)
    .eq("id", input.church_id)
    .select("id, payments_enabled, routes_enabled")
    .single<{ id: string; payments_enabled: boolean | null; routes_enabled: boolean | null }>();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "updateChurchPaymentSettings failed");
    throw error;
  }

  return {
    church_id: data.id,
    payments_enabled: Boolean(data.payments_enabled),
    routes_enabled: Boolean(data.routes_enabled),
    key_id: "",
    has_key_secret: false,
    schema_ready: true,
  };
}
