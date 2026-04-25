import { db } from "./dbClient";
import { logger } from "../utils/logger";

// Lifetime cap: a church may accumulate at most 180 days (~6 months) of trial
// across all grants. Prevents admins from re-granting indefinitely.
const LIFETIME_TRIAL_DAYS_CAP = 180;

export async function grantFreeTrial(
  churchId: string,
  months: number,
  grantedByUserId: string,
  opts: { reason?: string; override?: boolean } = {},
) {
  if (months < 1 || months > 24 || !Number.isInteger(months)) {
    throw new Error("Trial months must be between 1 and 24.");
  }

  const requestedDays = months * 30;

  // Sum all prior grants (not expired-reversed) to enforce the lifetime cap.
  const { data: priorGrants } = await db
    .from("trial_grant_history")
    .select("trial_days")
    .eq("church_id", churchId);

  const priorDaysTotal = (priorGrants || []).reduce(
    (sum: number, r: any) => sum + (Number(r.trial_days) || 0),
    0,
  );

  if (!opts.override && priorDaysTotal + requestedDays > LIFETIME_TRIAL_DAYS_CAP) {
    const remaining = Math.max(0, LIFETIME_TRIAL_DAYS_CAP - priorDaysTotal);
    throw new Error(
      `Trial cap exceeded. Church has used ${priorDaysTotal} of ${LIFETIME_TRIAL_DAYS_CAP} lifetime trial days. ${remaining} days remain. Pass override=true to bypass (logged).`,
    );
  }

  // Extend from the greater of now or existing trial_ends_at (don't shorten an active trial).
  const { data: current } = await db
    .from("churches")
    .select("trial_ends_at")
    .eq("id", churchId)
    .is("deleted_at", null)
    .maybeSingle();

  const base = current?.trial_ends_at && new Date(current.trial_ends_at) > new Date()
    ? new Date(current.trial_ends_at)
    : new Date();
  const trialEnd = new Date(base);
  trialEnd.setMonth(trialEnd.getMonth() + months);

  const { data, error } = await db
    .from("churches")
    .update({
      trial_ends_at: trialEnd.toISOString(),
      trial_granted_by: grantedByUserId,
    })
    .eq("id", churchId)
    .is("deleted_at", null)
    .select("id, name, trial_ends_at")
    .single();

  if (error) {
    logger.error({ err: error, churchId }, "grantFreeTrial failed");
    throw new Error("Failed to grant free trial.");
  }

  // Record history (audit + cap enforcement source of truth)
  await db.from("trial_grant_history").insert({
    church_id: churchId,
    trial_days: requestedDays,
    granted_by: grantedByUserId,
    expires_at: trialEnd.toISOString(),
    reason: opts.override
      ? `OVERRIDE: ${opts.reason || "no reason given"}`
      : opts.reason || null,
  });

  return data;
}

export async function revokeFreeTrial(churchId: string) {
  const { data, error } = await db
    .from("churches")
    .update({
      trial_ends_at: null,
      trial_granted_by: null,
    })
    .eq("id", churchId)
    .select("id, name, trial_ends_at")
    .single();

  if (error) {
    logger.error({ err: error, churchId }, "revokeFreeTrial failed");
    throw new Error("Failed to revoke trial.");
  }

  return data;
}

export async function getChurchTrialStatus(churchId: string) {
  const { data, error } = await db
    .from("churches")
    .select("id, name, trial_ends_at, trial_granted_by")
    .eq("id", churchId)
    .single();

  if (error) {
    logger.error({ err: error, churchId }, "getChurchTrialStatus failed");
    throw error;
  }

  const isActive = data?.trial_ends_at && new Date(data.trial_ends_at) > new Date();

  // Include cumulative history so admins can see the cap remaining.
  const { data: history } = await db
    .from("trial_grant_history")
    .select("trial_days")
    .eq("church_id", churchId);

  const lifetimeDaysUsed = (history || []).reduce(
    (s: number, r: any) => s + (Number(r.trial_days) || 0),
    0,
  );

  return {
    church_id: data?.id,
    trial_ends_at: data?.trial_ends_at,
    trial_active: !!isActive,
    days_remaining: isActive
      ? Math.ceil((new Date(data.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0,
    lifetime_days_used: lifetimeDaysUsed,
    lifetime_days_cap: LIFETIME_TRIAL_DAYS_CAP,
    lifetime_days_remaining: Math.max(0, LIFETIME_TRIAL_DAYS_CAP - lifetimeDaysUsed),
  };
}
