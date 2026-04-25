import { db } from "../services/dbClient";
import { sendEmail } from "../services/mailerService";
import { exportMembersCsv, exportPaymentsCsv, exportDonationSummaryCsv, exportMonthlyDuesCsv } from "../services/exportService";
import { logger } from "../utils/logger";
import { APP_NAME } from "../config";

/**
 * Scheduled report configuration stored in DB table: scheduled_reports
 * Columns: id, church_id, report_type, frequency, recipient_emails, last_sent_at, enabled
 */

type ScheduledReportRow = {
  id: string;
  church_id: string;
  report_type: string;
  frequency: string;
  recipient_emails: string[];
  last_sent_at: string | null;
  enabled: boolean;
  church_name?: string;
};

export async function createScheduledReport(input: {
  church_id: string;
  report_type: string;
  frequency: string;
  recipient_emails?: string[];
  recipient_phones?: string[];
}) {
  const validTypes = ["members", "payments", "donations", "monthly_dues"];
  const validFrequencies = ["daily", "weekly", "monthly"];

  if (!validTypes.includes(input.report_type)) {
    throw new Error(`report_type must be one of: ${validTypes.join(", ")}`);
  }
  if (!validFrequencies.includes(input.frequency)) {
    throw new Error(`frequency must be one of: ${validFrequencies.join(", ")}`);
  }

  const emails = (input.recipient_emails || [])
    .map(e => e.trim().toLowerCase())
    .filter(e => e.includes("@"));

  const phones = (input.recipient_phones || [])
    .map(p => p.trim())
    .filter(p => /^\+?\d{7,15}$/.test(p.replace(/\s/g, "")));

  if (!emails.length && !phones.length) {
    throw new Error("At least one recipient email or phone is required");
  }

  const { data, error } = await db
    .from("scheduled_reports")
    .insert([{
      church_id: input.church_id,
      report_type: input.report_type,
      frequency: input.frequency,
      recipient_emails: emails,
      recipient_phones: phones,
      enabled: true,
    }])
    .select("id, church_id, report_type, frequency, recipient_emails, recipient_phones, enabled, last_sent_at")
    .single();

  if (error) {
    logger.error({ err: error }, "createScheduledReport failed");
    throw error;
  }
  return data;
}

export async function listScheduledReports(churchId?: string) {
  let query = db
    .from("scheduled_reports")
    .select("id, church_id, report_type, frequency, recipient_emails, enabled, last_sent_at, created_at")
    .order("created_at", { ascending: false });

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ err: error }, "listScheduledReports failed");
    throw error;
  }
  return data || [];
}

export async function deleteScheduledReport(id: string, churchId?: string) {
  let query = db
    .from("scheduled_reports")
    .delete()
    .eq("id", id);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { error } = await query;

  if (error) {
    logger.error({ err: error }, "deleteScheduledReport failed");
    throw error;
  }
  return { deleted: true, id };
}

export async function toggleScheduledReport(id: string, enabled: boolean, churchId?: string) {
  let query = db
    .from("scheduled_reports")
    .update({ enabled })
    .eq("id", id);

  if (churchId) {
    query = query.eq("church_id", churchId);
  }

  const { data, error } = await query
    .select("id, enabled")
    .single();

  if (error) throw error;
  return data;
}

// ── Cron execution: find due reports and send them ──

// SCHED-001: HTML-escape content before embedding in email
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isDue(frequency: string, lastSent: string | null): boolean {
  if (!lastSent) return true;
  const last = new Date(lastSent).getTime();
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  switch (frequency) {
    case "daily": return (now - last) >= day;
    case "weekly": return (now - last) >= 7 * day;
    case "monthly": return (now - last) >= 28 * day;
    default: return false;
  }
}

async function generateReportCsv(churchId: string, reportType: string): Promise<string> {
  switch (reportType) {
    case "members": return exportMembersCsv(churchId);
    case "payments": return exportPaymentsCsv(churchId);
    case "donations": return exportDonationSummaryCsv(churchId);
    case "monthly_dues": return exportMonthlyDuesCsv(churchId);
    default: throw new Error(`Unknown report type: ${reportType}`);
  }
}

export async function processScheduledReports() {
  const { data: reports, error } = await db
    .from("scheduled_reports")
    .select("id, church_id, report_type, frequency, recipient_emails, last_sent_at, enabled")
    .eq("enabled", true);

  if (error) {
    logger.error({ err: error }, "processScheduledReports: failed to load reports");
    return { sent: 0, errors: 0 };
  }

  const dueReports = (reports || []).filter((r: ScheduledReportRow) =>
    isDue(r.frequency, r.last_sent_at)
  );

  // Batch-fetch church names to avoid N+1
  const churchIds = [...new Set(dueReports.map((r: ScheduledReportRow) => r.church_id))];
  const churchNameMap = new Map<string, string>();
  if (churchIds.length > 0) {
    const { data: churches } = await db
      .from("churches")
      .select("id, name")
      .in("id", churchIds);
    for (const c of churches || []) {
      churchNameMap.set(c.id, c.name);
    }
  }

  let sent = 0;
  let errors = 0;

  for (const report of dueReports as ScheduledReportRow[]) {
    try {
      const csv = await generateReportCsv(report.church_id, report.report_type);

      const churchName = churchNameMap.get(report.church_id) || "Church";
      const subject = `${APP_NAME} ${report.frequency} ${report.report_type} report — ${churchName}`;
      const date = new Date().toISOString().slice(0, 10);

      // Send emails in parallel
      await Promise.all(report.recipient_emails.map((email) =>
        sendEmail({
          to: email,
          subject,
          text: `Please find the attached ${report.report_type} report for ${churchName} (${date}).`,
          html: `<p>${report.report_type.charAt(0).toUpperCase() + report.report_type.slice(1)} report for <strong>${escapeHtml(churchName)}</strong> generated on ${date}.</p><p>Report data:</p><pre style="font-size:12px;overflow-x:auto;">${escapeHtml(csv.slice(0, 50000))}</pre>`,
        })
      ));

      await db
        .from("scheduled_reports")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", report.id);

      sent++;
    } catch (err) {
      logger.error({ err, reportId: report.id }, "processScheduledReports: failed to send report");
      errors++;
    }
  }

  return { sent, errors, total_due: dueReports.length };
}
