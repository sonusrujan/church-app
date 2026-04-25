import { db } from "./dbClient";
import { logger } from "../utils/logger";

export async function grantFreeTrial(churchId: string, months: number, grantedByUserId: string) {
  if (months < 1 || months > 24 || !Number.isInteger(months)) {
    throw new Error("Trial months must be between 1 and 24.");
  }

  const trialEnd = new Date();
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

  return {
    church_id: data?.id,
    trial_ends_at: data?.trial_ends_at,
    trial_active: !!isActive,
    days_remaining: isActive
      ? Math.ceil((new Date(data.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : 0,
  };
}
