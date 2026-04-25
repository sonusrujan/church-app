import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { sendEmail } from "./mailerService";

// ── Job Queue Service — processes async jobs (email, SMS, push) ──

export type JobType = "send_email" | "send_sms" | "send_push" | "subscription_reminder";

export interface EnqueueJobInput {
  job_type: JobType;
  payload: Record<string, unknown>;
  scheduled_for?: string;
  max_attempts?: number;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<string> {
  const { data, error } = await db
    .from("job_queue")
    .insert({
      job_type: input.job_type,
      payload: input.payload,
      scheduled_for: input.scheduled_for || new Date().toISOString(),
      max_attempts: input.max_attempts || 3,
      status: "pending",
      attempts: 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    logger.error({ err: error, jobType: input.job_type }, "enqueueJob failed");
    throw error;
  }

  return data.id;
}

export async function enqueueEmailJob(to: string, subject: string, text: string, html?: string): Promise<string> {
  return enqueueJob({
    job_type: "send_email",
    payload: { to, subject, text, html },
  });
}

/**
 * Process pending jobs. Called by the scheduler on a cron interval.
 * Picks up to `batchSize` pending/retry jobs that are due and
 * processes them in parallel with up to `concurrency` workers.
 */
export async function processJobQueue(batchSize = 100, concurrency = 20): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString();

  const { data: jobs, error } = await db
    .from("job_queue")
    .select("*")
    .in("status", ["pending", "retry"])
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(batchSize);

  if (error) {
    logger.error({ err: error }, "processJobQueue fetch failed");
    return { processed: 0, failed: 0 };
  }

  if (!jobs || !jobs.length) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  // Process jobs in parallel chunks
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    const results = await Promise.allSettled(chunk.map((job: Record<string, any>) => processOneJob(job)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value === "processed") processed++;
        else if (r.value === "failed") failed++;
      }
    }
  }

  return { processed, failed };
}

async function processOneJob(job: Record<string, any>): Promise<"processed" | "failed" | "skipped"> {
  // Atomic claim: only update if still in pending/retry status (prevents double-execution)
  const { data: claimed, error: claimErr } = await db
    .from("job_queue")
    .update({ status: "processing", started_at: new Date().toISOString(), attempts: job.attempts + 1 })
    .eq("id", job.id)
    .in("status", ["pending", "retry"])
    .select("id")
    .maybeSingle();

  if (claimErr || !claimed) return "skipped";

  try {
    await executeJob(job.job_type, job.payload);

    await db
      .from("job_queue")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", job.id);

    // Sync delivery status
    if (job.payload?.delivery_id) {
      await db
        .from("notification_deliveries")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", job.payload.delivery_id);
    }

    return "processed";
  } catch (err: any) {
    const newAttempts = job.attempts + 1;
    const shouldRetry = newAttempts < job.max_attempts;

    // Push jobs get faster retries (5s, 10s, 20s) vs others (60s, 120s, 180s)
    const isPush = job.job_type === "send_push";
    const retryDelayMs = isPush
      ? Math.min(5000 * Math.pow(2, newAttempts - 1), 30000)  // 5s → 10s → 20s → 30s cap
      : newAttempts * 60 * 1000;                                // 60s → 120s → 180s

    await db
      .from("job_queue")
      .update({
        status: shouldRetry ? "retry" : "failed",
        error_message: err?.message || "Unknown error",
        scheduled_for: shouldRetry
          ? new Date(Date.now() + retryDelayMs).toISOString()
          : job.scheduled_for,
      })
      .eq("id", job.id);

    // Sync delivery status on final failure
    if (!shouldRetry && job.payload?.delivery_id) {
      await db
        .from("notification_deliveries")
        .update({ status: "failed", error_message: err?.message || "Unknown error" })
        .eq("id", job.payload.delivery_id);
    }

    logger.warn({ err, jobId: job.id, jobType: job.job_type, attempt: newAttempts }, "Job execution failed");
    return "failed";
  }
}

async function executeJob(jobType: string, payload: Record<string, unknown>): Promise<void> {
  switch (jobType) {
    case "send_email":
      await sendEmail({
        to: payload.to as string,
        subject: payload.subject as string,
        text: payload.text as string,
        html: payload.html as string | undefined,
      });
      break;

    case "send_sms": {
      const { sendSmsNow } = await import("./notificationService");
      const result = await sendSmsNow(payload.to as string, payload.body as string);
      if (!result.success) throw new Error(result.error || "SMS send failed");
      break;
    }

    case "send_push": {
      const { sendPushNow } = await import("./notificationService");
      const pushResult = await sendPushNow(
        payload.recipient_user_id as string | undefined,
        payload.subject as string || "",
        payload.body as string || "",
        payload.url as string | undefined,
      );
      if (!pushResult.success) throw new Error(pushResult.error || "Push send failed");
      // sent === 0 means user has no subscriptions — not an error, skip silently
      break;
    }

    case "subscription_reminder":
      // Handled by dedicated reminder processing
      logger.info({ payload }, "Subscription reminder processed");
      break;

    default:
      logger.warn({ jobType }, "Unknown job type");
  }
}
