import { rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

/**
 * SaaS lifecycle enforcement — automatically disables churches that fail to pay.
 *
 * Logic:
 * 1. Churches with church_subscription_enabled=true AND an overdue subscription
 *    past the grace period (14 days overdue) → set service_enabled=false
 * 2. Churches with trial_ends_at in the past AND no active subscription → disable
 * 3. Churches that become active again (payment received) are re-enabled by the
 *    subscription payment handler, not by this job.
 */

const GRACE_PERIOD_DAYS = 14;

export async function enforceSaaSSubscriptions(): Promise<{
  disabled: number;
  trialExpired: number;
}> {
  // 1. Disable churches with overdue subscriptions past grace period
  const { rows: overdueChurches } = await rawQuery<{ church_id: string }>(
    `UPDATE churches
     SET service_enabled = false
     WHERE id IN (
       SELECT c.id
       FROM churches c
       JOIN church_subscriptions cs ON cs.church_id = c.id
       WHERE c.church_subscription_enabled = true
         AND c.service_enabled = true
         AND c.deleted_at IS NULL
         AND cs.status = 'overdue'
         AND cs.next_payment_date < NOW() - INTERVAL '${GRACE_PERIOD_DAYS} days'
     )
     AND service_enabled = true
     RETURNING id AS church_id`,
    []
  );

  if (overdueChurches.length > 0) {
    logger.warn(
      { count: overdueChurches.length, churchIds: overdueChurches.map((r) => r.church_id) },
      "SaaS enforcement: disabled churches with overdue subscriptions past grace period"
    );
  }

  // 2. Disable churches whose trial has expired with no active subscription
  const { rows: trialExpired } = await rawQuery<{ church_id: string }>(
    `UPDATE churches
     SET service_enabled = false
     WHERE id IN (
       SELECT c.id
       FROM churches c
       WHERE c.trial_ends_at IS NOT NULL
         AND c.trial_ends_at < NOW()
         AND c.service_enabled = true
         AND c.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM church_subscriptions cs
           WHERE cs.church_id = c.id AND cs.status = 'active'
         )
     )
     AND service_enabled = true
     RETURNING id AS church_id`,
    []
  );

  if (trialExpired.length > 0) {
    logger.warn(
      { count: trialExpired.length, churchIds: trialExpired.map((r) => r.church_id) },
      "SaaS enforcement: disabled churches with expired trials and no active subscription"
    );
  }

  return {
    disabled: overdueChurches.length,
    trialExpired: trialExpired.length,
  };
}
