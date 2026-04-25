import cron from "node-cron";
import { reconcileOverdueSubscriptions } from "../services/subscriptionTrackingService";
import { processScheduledReports } from "../services/scheduledReportService";
import { processJobQueue } from "../services/jobQueueService";
import { processSubscriptionReminders, enforceGracePeriods } from "../services/subscriptionReminderService";
import { reconcilePendingPayments } from "../services/paymentReconciliationService";
import { processSpecialDateReminders } from "../services/specialDateReminderService";
import { cleanupExpiredEvents } from "../services/engagementService";
import { logger } from "../utils/logger";
import { pool } from "../services/dbClient";

/** Track last successful run timestamps for health monitoring */
const jobHealth: Record<string, { lastRun: string; status: "ok" | "error"; detail?: string }> = {};

export function getSchedulerHealth() {
  return { jobs: { ...jobHealth }, upSince: schedulerStartTime };
}

let schedulerStartTime = "";

/**
 * Try to acquire a distributed advisory lock using PostgreSQL's pg_try_advisory_lock.
 * Returns a release function if the lock was acquired, or null if another instance holds it.
 * Uses hashtext() so we can pass a human-readable job name.
 */
async function tryAdvisoryLock(jobName: string): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [jobName],
    );
    if (!rows[0]?.acquired) {
      client.release();
      return null;
    }
    // Return a release function — caller MUST invoke it in a finally block
    return async () => {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [jobName]);
      } finally {
        client.release();
      }
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

/**
 * Schedules the overdue subscription reconciliation job.
 *
 * Runs daily at 00:30 UTC — marks any "active" subscription with
 * next_payment_date < today as "overdue" and records audit events.
 *
 * This replaces the previous manual-only POST /api/subscriptions/reconcile-overdue
 * which only ran when an admin explicitly triggered it.
 */
export function startScheduledJobs() {
  schedulerStartTime = new Date().toISOString();

  // Daily at 00:30 UTC
  cron.schedule("30 0 * * *", async () => {
    const release = await tryAdvisoryLock("cron:overdue_reconciliation").catch(() => null);
    if (!release) {
      logger.info("cron: overdue reconciliation already in progress, skipping");
      return;
    }
    logger.info("cron: overdue reconciliation starting");
    try {
      const result = await reconcileOverdueSubscriptions();
      logger.info(
        { updated: result.updated_count, events: result.event_count },
        "cron: overdue reconciliation complete"
      );
      jobHealth["overdue_reconciliation"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: overdue reconciliation failed");
      jobHealth["overdue_reconciliation"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (overdue reconciliation: daily 00:30 UTC)");

  // Scheduled reports: every 6 hours at :15
  cron.schedule("15 */6 * * *", async () => {
    const release = await tryAdvisoryLock("cron:scheduled_reports").catch(() => null);
    if (!release) {
      logger.info("cron: scheduled reports already in progress, skipping");
      return;
    }
    logger.info("cron: scheduled reports starting");
    try {
      const result = await processScheduledReports();
      logger.info(
        { sent: result.sent, errors: result.errors },
        "cron: scheduled reports complete"
      );
      jobHealth["scheduled_reports"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: scheduled reports failed");
      jobHealth["scheduled_reports"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (scheduled reports: every 6 hours at :15)");

  // Job queue processing: every 3 seconds, 200 jobs per batch, 40 concurrent
  cron.schedule("*/3 * * * * *", async () => {
    const release = await tryAdvisoryLock("cron:job_queue").catch(() => null);
    if (!release) return;
    try {
      const result = await processJobQueue(200, 40);
      if (result.processed > 0 || result.failed > 0) {
        logger.info(
          { processed: result.processed, failed: result.failed },
          "cron: job queue batch complete"
        );
      }
      jobHealth["job_queue"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: job queue processing failed");
      jobHealth["job_queue"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (job queue: every 3 seconds, batch 200, concurrency 40)");

  // Subscription reminders: daily at 06:00 UTC (11:30 AM IST)
  cron.schedule("0 6 * * *", async () => {
    const release = await tryAdvisoryLock("cron:subscription_reminders").catch(() => null);
    if (!release) return;
    logger.info("cron: subscription reminders starting");
    try {
      const result = await processSubscriptionReminders();
      logger.info(
        { sent: result.sent, skipped: result.skipped },
        "cron: subscription reminders complete"
      );
      jobHealth["subscription_reminders"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: subscription reminders failed");
      jobHealth["subscription_reminders"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (subscription reminders: daily 06:00 UTC)");

  // Special date greetings (birthdays/anniversaries): daily at 03:30 UTC (9:00 AM IST)
  cron.schedule("30 3 * * *", async () => {
    const release = await tryAdvisoryLock("cron:special_date_reminders").catch(() => null);
    if (!release) return;
    logger.info("cron: special date reminders starting");
    try {
      const result = await processSpecialDateReminders();
      logger.info(
        { sent: result.sent, skipped: result.skipped },
        "cron: special date reminders complete"
      );
      jobHealth["special_date_reminders"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: special date reminders failed");
      jobHealth["special_date_reminders"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (special date reminders: daily 03:30 UTC / 9:00 AM IST)");

  // Grace period enforcement: daily at 01:00 UTC
  cron.schedule("0 1 * * *", async () => {
    const release = await tryAdvisoryLock("cron:grace_period_enforcement").catch(() => null);
    if (!release) {
      logger.info("cron: grace period enforcement already in progress, skipping");
      return;
    }
    logger.info("cron: grace period enforcement starting");
    try {
      const result = await enforceGracePeriods();
      logger.info(
        { deactivated: result.deactivated },
        "cron: grace period enforcement complete"
      );
      jobHealth["grace_period_enforcement"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: grace period enforcement failed");
      jobHealth["grace_period_enforcement"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (grace period enforcement: daily 01:00 UTC)");

  // Payment reconciliation: every 2 hours at :45
  // CRIT-08: Retry up to 3 times on failure with exponential backoff
  cron.schedule("45 */2 * * *", async () => {
    const release = await tryAdvisoryLock("cron:payment_reconciliation").catch(() => null);
    if (!release) {
      logger.info("cron: payment reconciliation already in progress, skipping");
      return;
    }
    logger.info("cron: payment reconciliation starting");
    let attempts = 0;
    const maxRetries = 3;
    while (attempts < maxRetries) {
      try {
        const result = await reconcilePendingPayments();
        logger.info(
          { reconciled: result.reconciled, failed: result.failed, already_ok: result.already_ok, manual_review: result.manual_review },
          "cron: payment reconciliation complete"
        );
        jobHealth["payment_reconciliation"] = { lastRun: new Date().toISOString(), status: "ok" };
        break; // Success — exit retry loop
      } catch (err) {
        attempts++;
        logger.error({ err, attempt: attempts, maxRetries }, "cron: payment reconciliation failed");
        if (attempts < maxRetries) {
          // Exponential backoff: 5s, 15s
          const delayMs = 5000 * Math.pow(3, attempts - 1);
          await new Promise(r => setTimeout(r, delayMs));
        } else {
          // All retries exhausted — log critical for CloudWatch alarm
          logger.error({ err }, "CRITICAL: payment reconciliation failed after all retries — manual intervention needed");
          jobHealth["payment_reconciliation"] = { lastRun: new Date().toISOString(), status: "error" };
        }
      }
    }
    await release();
  });

  logger.info("Scheduled jobs initialized (payment reconciliation: every 2 hours at :45)");

  // Expired event cleanup: daily at 02:00 UTC
  cron.schedule("0 2 * * *", async () => {
    const release = await tryAdvisoryLock("cron:expired_event_cleanup").catch(() => null);
    if (!release) {
      logger.info("cron: expired event cleanup already in progress, skipping");
      return;
    }
    logger.info("cron: expired event cleanup starting");
    try {
      const result = await cleanupExpiredEvents();
      logger.info(
        { deleted: result.deleted },
        "cron: expired event cleanup complete"
      );
      jobHealth["expired_event_cleanup"] = { lastRun: new Date().toISOString(), status: "ok" };
    } catch (err) {
      logger.error({ err }, "cron: expired event cleanup failed");
      jobHealth["expired_event_cleanup"] = { lastRun: new Date().toISOString(), status: "error" };
    } finally {
      await release();
    }
  });

  logger.info("Scheduled jobs initialized (expired event cleanup: daily 02:00 UTC)");
}
