import { db } from "./dbClient";
import { logger } from "../utils/logger";

// Per-phone: 5 sends per rolling hour.
const PHONE_MAX_PER_HOUR = 5;
const PHONE_WINDOW_MS = 60 * 60 * 1000;

// Per-IP (app-side fallback beyond express-rate-limit memory window):
// 20 sends per hour (covers multiple household phones on shared NAT).
const IP_MAX_PER_HOUR = 20;
const IP_WINDOW_MS = 60 * 60 * 1000;

type CheckResult = { allowed: true } | { allowed: false; retryAfterSec: number };

/**
 * Atomically check-and-increment a rate-limit counter for the given key.
 * Uses the otp_rate_limits table (key TEXT PRIMARY KEY, window_start, request_count).
 * Rolls the window when the window_start is older than windowMs.
 */
async function checkAndIncrement(key: string, max: number, windowMs: number): Promise<CheckResult> {
  const now = Date.now();
  const windowStartThreshold = new Date(now - windowMs);

  try {
    const { data: existing } = await db
      .from("otp_rate_limits")
      .select("window_start, request_count")
      .eq("key", key)
      .maybeSingle();

    if (!existing) {
      await db.from("otp_rate_limits").insert({
        key,
        window_start: new Date(now).toISOString(),
        request_count: 1,
        last_request_at: new Date(now).toISOString(),
      });
      return { allowed: true };
    }

    const windowStart = new Date(existing.window_start).getTime();
    const withinWindow = windowStart >= windowStartThreshold.getTime();

    if (!withinWindow) {
      // Roll window
      await db
        .from("otp_rate_limits")
        .update({
          window_start: new Date(now).toISOString(),
          request_count: 1,
          last_request_at: new Date(now).toISOString(),
        })
        .eq("key", key);
      return { allowed: true };
    }

    if (existing.request_count >= max) {
      const retryAfterSec = Math.ceil((windowStart + windowMs - now) / 1000);
      return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }

    await db
      .from("otp_rate_limits")
      .update({
        request_count: existing.request_count + 1,
        last_request_at: new Date(now).toISOString(),
      })
      .eq("key", key);
    return { allowed: true };
  } catch (err) {
    logger.warn({ err, key }, "otp rate-limit check failed — allowing (fail-open)");
    return { allowed: true };
  }
}

/** Check whether an OTP send is allowed for this phone + IP. */
export async function checkOtpSendAllowed(phone: string, ip: string | undefined): Promise<CheckResult> {
  const phoneResult = await checkAndIncrement(`phone:${phone}`, PHONE_MAX_PER_HOUR, PHONE_WINDOW_MS);
  if (!phoneResult.allowed) return phoneResult;

  if (ip) {
    const ipResult = await checkAndIncrement(`ip:${ip}`, IP_MAX_PER_HOUR, IP_WINDOW_MS);
    if (!ipResult.allowed) return ipResult;
  }
  return { allowed: true };
}
