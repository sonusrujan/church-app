import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

function escapeCsvField(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

export async function exportMembersCsv(churchId: string): Promise<string> {
  const { data, error } = await db
    .from("members")
    .select("id, full_name, email, phone_number, address, membership_id, subscription_amount, verification_status, created_at")
    .eq("church_id", churchId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .limit(5000);

  if (error) {
    logger.error({ err: error, churchId }, "exportMembersCsv failed");
    throw new Error("Failed to export members.");
  }

  const rows = data || [];
  const header = "Name,Email,Phone,Address,Membership ID,Subscription Amount,Status,Registered";
  const lines = rows.map((m: any) =>
    toCsvRow([m.full_name, m.email, m.phone_number, m.address, m.membership_id, m.subscription_amount, m.verification_status, m.created_at])
  );

  return [header, ...lines].join("\n");
}

export async function exportPaymentsCsv(churchId: string): Promise<string> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    amount: number;
    payment_method: string;
    transaction_id: string;
    payment_status: string;
    payment_date: string;
    receipt_number: string | null;
    fund_name: string | null;
  }>(
    `SELECT m.full_name, m.email, p.amount, p.payment_method, p.transaction_id,
            p.payment_status, p.payment_date, p.receipt_number, p.fund_name
     FROM payments p
     JOIN members m ON m.id = p.member_id
     WHERE m.church_id = $1 AND m.deleted_at IS NULL
     ORDER BY p.payment_date DESC
     LIMIT 10000`,
    [churchId],
  );

  const header = "Member,Email,Amount,Method,Fund,Transaction ID,Status,Date,Receipt Number";
  const lines = rows.map((p) =>
    toCsvRow([p.full_name, p.email, p.amount, p.payment_method, p.fund_name || "", p.transaction_id, p.payment_status, p.payment_date, p.receipt_number])
  );

  return [header, ...lines].join("\n");
}

export async function exportDonationSummaryCsv(churchId: string): Promise<string> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    total_donations: string;
    total_subscriptions: string;
    total_amount: string;
    payment_count: string;
  }>(
    `SELECT m.full_name, m.email,
            COALESCE(SUM(CASE WHEN p.payment_method = 'donation' THEN p.amount ELSE 0 END), 0) AS total_donations,
            COALESCE(SUM(CASE WHEN p.payment_method != 'donation' THEN p.amount ELSE 0 END), 0) AS total_subscriptions,
            COALESCE(SUM(p.amount), 0) AS total_amount,
            COUNT(p.id)::text AS payment_count
     FROM members m
     JOIN payments p ON p.member_id = m.id AND p.payment_status = 'success'
     WHERE m.church_id = $1 AND m.deleted_at IS NULL
     GROUP BY m.id, m.full_name, m.email
     ORDER BY m.full_name`,
    [churchId],
  );

  const header = "Member,Email,Total Donated,Total Subscription Paid,Total Amount,Payment Count";
  const lines = rows.map((r) =>
    toCsvRow([r.full_name, r.email, Number(r.total_donations).toFixed(2), Number(r.total_subscriptions).toFixed(2), Number(r.total_amount).toFixed(2), r.payment_count])
  );

  return [header, ...lines].join("\n");
}
