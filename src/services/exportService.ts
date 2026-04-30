import { db, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";
import { toCsvRow } from "../utils/csv";
import { buildExcelHtmlReport, excelFilename, formatExcelMoney } from "../utils/excelReport";

function appPaymentOriginWhere(alias: string) {
  return `
    LEFT(COALESCE(${alias}.transaction_id, ''), 4) = 'pay_'
    AND LEFT(LOWER(COALESCE(${alias}.payment_method, '')), 7) <> 'manual_'
  `;
}

function appSuccessfulPaymentWhere(alias: string) {
  return `
    LOWER(COALESCE(${alias}.payment_status, '')) = 'success'
    AND ${appPaymentOriginWhere(alias)}
  `;
}

function paymentIsDonationSql(alias: string) {
  return `
    (
      LOWER(COALESCE(${alias}.payment_method, '')) IN ('donation', 'public_donation')
      OR LOWER(COALESCE(${alias}.payment_category, '')) = 'donation'
    )
  `;
}

function churchPaymentAmount(alias = "p", feeAlias = "f") {
  return `
    CASE
      WHEN ${paymentIsDonationSql(alias)} THEN GREATEST(COALESCE(${alias}.amount, 0) - COALESCE(${feeAlias}.fee_amount, 0), 0)
      ELSE COALESCE(${alias}.amount, 0)
    END
  `;
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
    months_covered: string | null;
  }>(
    `WITH fee_by_payment AS (
       SELECT payment_id, COALESCE(SUM(fee_amount), 0) AS fee_amount
       FROM platform_fee_collections
       WHERE church_id = $1
       GROUP BY payment_id
     )
     SELECT m.full_name, m.email, ${churchPaymentAmount()}::text AS amount, p.payment_method, p.transaction_id,
            p.payment_status, p.payment_date, p.receipt_number, p.fund_name,
            (
              SELECT string_agg(to_char(smd.due_month, 'Mon YYYY'), ', ' ORDER BY smd.due_month)
              FROM payment_month_allocations pma
              JOIN subscription_monthly_dues smd ON smd.id = pma.due_id
              WHERE pma.payment_id = p.id
            ) AS months_covered
     FROM payments p
     JOIN members m ON m.id = p.member_id
     LEFT JOIN fee_by_payment f ON f.payment_id = p.id
     WHERE m.church_id = $1 AND m.deleted_at IS NULL
       AND ${appSuccessfulPaymentWhere("p")}
     ORDER BY p.payment_date DESC
     LIMIT 10000`,
    [churchId],
  );

  const header = "Member,Email,Amount,Method,Fund,Transaction ID,Status,Date,Receipt Number,Months Covered";
  const lines = rows.map((p) =>
    toCsvRow([p.full_name, p.email, p.amount, p.payment_method, p.fund_name || "", p.transaction_id, p.payment_status, p.payment_date, p.receipt_number, p.months_covered || ""])
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
    `WITH fee_by_payment AS (
       SELECT payment_id, COALESCE(SUM(fee_amount), 0) AS fee_amount
       FROM platform_fee_collections
       WHERE church_id = $1
       GROUP BY payment_id
     )
     SELECT COALESCE(m.full_name, 'Public donor') AS full_name,
            COALESCE(m.email, '') AS email,
            COALESCE(SUM(CASE WHEN ${paymentIsDonationSql("p")} THEN ${churchPaymentAmount()} ELSE 0 END), 0) AS total_donations,
            COALESCE(SUM(CASE WHEN NOT ${paymentIsDonationSql("p")} THEN COALESCE(p.amount, 0) ELSE 0 END), 0) AS total_subscriptions,
            COALESCE(SUM(${churchPaymentAmount()}), 0) AS total_amount,
            COUNT(p.id)::text AS payment_count
     FROM payments p
     LEFT JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
     LEFT JOIN fee_by_payment f ON f.payment_id = p.id
     WHERE p.church_id = $1
       AND ${appSuccessfulPaymentWhere("p")}
     GROUP BY COALESCE(m.full_name, 'Public donor'), COALESCE(m.email, '')
     ORDER BY full_name`,
    [churchId],
  );

  const header = "Member,Email,Total Donated,Total Subscription Paid,Total Amount,Payment Count";
  const lines = rows.map((r) =>
    toCsvRow([r.full_name, r.email, Number(r.total_donations).toFixed(2), Number(r.total_subscriptions).toFixed(2), Number(r.total_amount).toFixed(2), r.payment_count])
  );

  return [header, ...lines].join("\n");
}

export async function exportMonthlyDuesCsv(churchId: string): Promise<string> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    plan_name: string;
    due_month: string;
    monthly_amount: string;
    status: string;
    paid_at: string | null;
  }>(
    `SELECT m.full_name, m.email, s.plan_name,
            to_char(smd.due_month, 'Mon YYYY') AS due_month,
            smd.amount_due::text AS monthly_amount,
            smd.status,
            to_char(smd.paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at
     FROM subscription_monthly_dues smd
     JOIN subscriptions s ON s.id = smd.subscription_id
     JOIN members m ON m.id = s.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
     ORDER BY m.full_name, smd.due_month DESC
     LIMIT 20000`,
    [churchId],
  );

  const header = "Member,Email,Plan,Month,Amount Due,Status,Paid At";
  const lines = rows.map((r) =>
    toCsvRow([r.full_name, r.email, r.plan_name, r.due_month, r.monthly_amount, r.status, r.paid_at || ""])
  );

  return [header, ...lines].join("\n");
}

export async function exportMembersReport(churchId: string): Promise<{ content: string; filename: string }> {
  const { data, error } = await db
    .from("members")
    .select("id, full_name, email, phone_number, address, membership_id, subscription_amount, verification_status, created_at")
    .eq("church_id", churchId)
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .limit(5000);

  if (error) {
    logger.error({ err: error, churchId }, "exportMembersReport failed");
    throw new Error("Failed to export members.");
  }

  const rows: Array<{
    name: string;
    email: string;
    phone: string;
    address: string;
    membership_id: string;
    subscription_amount: number;
    status: string;
    registered: string;
  }> = (data || []).map((m: any) => ({
    name: m.full_name || "",
    email: m.email || "",
    phone: m.phone_number || "",
    address: m.address || "",
    membership_id: m.membership_id || "",
    subscription_amount: Number(m.subscription_amount) || 0,
    status: m.verification_status || "",
    registered: m.created_at || "",
  }));
  const activeCount = rows.filter((r) => String(r.status).toLowerCase() === "verified" || String(r.status).toLowerCase() === "active").length;

  return {
    filename: excelFilename(`members-${new Date().toISOString().slice(0, 10)}.xls`),
    content: buildExcelHtmlReport({
      title: "Members Report",
      subtitle: "Readable member directory export for church administration.",
      kpis: [
        { label: "Total Members", value: rows.length },
        { label: "Verified / Active", value: activeCount },
        { label: "With Subscription Amount", value: rows.filter((r) => r.subscription_amount > 0).length },
      ],
      notes: [
        "Use this report as a readable member directory for admin review.",
        "Subscription Amount is shown only where a member amount is configured.",
      ],
      sections: [{
        title: "Member Directory",
        columns: [
          { key: "name", header: "Name", type: "text", width: 190 },
          { key: "phone", header: "Phone", type: "text", width: 120 },
          { key: "email", header: "Email", type: "text", width: 190 },
          { key: "membership_id", header: "Membership ID", type: "text", width: 120 },
          { key: "subscription_amount", header: "Subscription Amount", type: "currency", width: 135 },
          { key: "status", header: "Status", type: "status", width: 110 },
          { key: "registered", header: "Registered", type: "date", width: 150 },
          { key: "address", header: "Address", type: "text", width: 260 },
        ],
        rows,
      }],
    }),
  };
}

export async function exportPaymentsReport(churchId: string): Promise<{ content: string; filename: string }> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    amount: string;
    payment_method: string;
    transaction_id: string | null;
    payment_status: string;
    payment_date: string;
    receipt_number: string | null;
    fund_name: string | null;
    months_covered: string | null;
  }>(
    `WITH fee_by_payment AS (
       SELECT payment_id, COALESCE(SUM(fee_amount), 0) AS fee_amount
       FROM platform_fee_collections
       WHERE church_id = $1
       GROUP BY payment_id
     )
     SELECT COALESCE(m.full_name, 'Public donor') AS full_name,
            COALESCE(m.email, '') AS email,
            CASE
              WHEN LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
                OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
              THEN GREATEST(COALESCE(p.amount, 0) - COALESCE(f.fee_amount, 0), 0)
              ELSE COALESCE(p.amount, 0)
            END::text AS amount,
            p.payment_method, p.transaction_id,
            p.payment_status, p.payment_date, p.receipt_number, p.fund_name,
            (
              SELECT string_agg(to_char(smd.due_month, 'Mon YYYY'), ', ' ORDER BY smd.due_month)
              FROM payment_month_allocations pma
              JOIN subscription_monthly_dues smd ON smd.id = pma.due_id
              WHERE pma.payment_id = p.id
            ) AS months_covered
     FROM payments p
     LEFT JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
     LEFT JOIN fee_by_payment f ON f.payment_id = p.id
     WHERE p.church_id = $1
       AND ${appSuccessfulPaymentWhere("p")}
     ORDER BY p.payment_date DESC
     LIMIT 10000`,
    [churchId],
  );

  const reportRows = rows.map((p) => ({
    member: p.full_name,
    email: p.email,
    amount: Number(p.amount) || 0,
    method: p.payment_method,
    fund: p.fund_name || "",
    transaction_id: p.transaction_id || "",
    status: p.payment_status,
    date: p.payment_date,
    receipt: p.receipt_number || "",
    months_covered: p.months_covered || "",
  }));
  const total = reportRows.reduce((sum, row) => sum + row.amount, 0);

  return {
    filename: excelFilename(`payments-${new Date().toISOString().slice(0, 10)}.xls`),
    content: buildExcelHtmlReport({
      title: "Payments Report",
      subtitle: "All successful app payments for this church, formatted for reconciliation.",
      kpis: [
        { label: "Total Collected", value: formatExcelMoney(total), note: "Church-facing amount" },
        { label: "Payment Records", value: reportRows.length },
        { label: "Receipts Generated", value: reportRows.filter((r) => r.receipt).length },
      ],
      notes: [
        "Amounts exclude platform fees where applicable.",
        "Use Receipt # and Transaction ID for reconciliation with payment gateway records.",
      ],
      sections: [{
        title: "Payment Transactions",
        columns: [
          { key: "date", header: "Date", type: "date", width: 150 },
          { key: "member", header: "Member / Donor", type: "text", width: 190 },
          { key: "amount", header: "Amount", type: "currency", width: 120 },
          { key: "method", header: "Method", type: "text", width: 135 },
          { key: "fund", header: "Fund", type: "text", width: 160 },
          { key: "status", header: "Status", type: "status", width: 90 },
          { key: "receipt", header: "Receipt #", type: "text", width: 205 },
          { key: "transaction_id", header: "Transaction ID", type: "text", width: 180 },
          { key: "months_covered", header: "Months Covered", type: "text", width: 160 },
          { key: "email", header: "Email", type: "text", width: 190 },
        ],
        rows: reportRows,
      }],
    }),
  };
}

export async function exportDonationSummaryReport(churchId: string): Promise<{ content: string; filename: string }> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    total_donations: string;
    total_subscriptions: string;
    total_amount: string;
    payment_count: string;
  }>(
    `WITH fee_by_payment AS (
       SELECT payment_id, COALESCE(SUM(fee_amount), 0) AS fee_amount
       FROM platform_fee_collections
       WHERE church_id = $1
       GROUP BY payment_id
     )
     SELECT COALESCE(m.full_name, 'Public donor') AS full_name,
            COALESCE(m.email, '') AS email,
            COALESCE(SUM(CASE
              WHEN LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
                OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
              THEN GREATEST(COALESCE(p.amount, 0) - COALESCE(f.fee_amount, 0), 0)
              ELSE 0
            END), 0)::text AS total_donations,
            COALESCE(SUM(CASE
              WHEN NOT (LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
                OR LOWER(COALESCE(p.payment_category, '')) = 'donation')
              THEN COALESCE(p.amount, 0)
              ELSE 0
            END), 0)::text AS total_subscriptions,
            COALESCE(SUM(CASE
              WHEN LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
                OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
              THEN GREATEST(COALESCE(p.amount, 0) - COALESCE(f.fee_amount, 0), 0)
              ELSE COALESCE(p.amount, 0)
            END), 0)::text AS total_amount,
            COUNT(p.id)::text AS payment_count
     FROM payments p
     LEFT JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
     LEFT JOIN fee_by_payment f ON f.payment_id = p.id
     WHERE p.church_id = $1
       AND ${appSuccessfulPaymentWhere("p")}
     GROUP BY COALESCE(m.full_name, 'Public donor'), COALESCE(m.email, '')
     ORDER BY full_name`,
    [churchId],
  );

  const reportRows = rows.map((r) => ({
    member: r.full_name,
    email: r.email,
    donations: Number(r.total_donations) || 0,
    subscriptions: Number(r.total_subscriptions) || 0,
    total: Number(r.total_amount) || 0,
    payments: Number(r.payment_count) || 0,
  }));

  return {
    filename: excelFilename(`donation-summary-${new Date().toISOString().slice(0, 10)}.xls`),
    content: buildExcelHtmlReport({
      title: "Donation & Contribution Summary",
      subtitle: "Donor/member contribution summary with church-facing totals.",
      kpis: [
        { label: "Total Amount", value: formatExcelMoney(reportRows.reduce((sum, r) => sum + r.total, 0)) },
        { label: "Donation Amount", value: formatExcelMoney(reportRows.reduce((sum, r) => sum + r.donations, 0)) },
        { label: "People / Donors", value: reportRows.length },
      ],
      notes: ["Donation totals exclude platform fees where applicable."],
      sections: [{
        title: "Contribution Summary",
        columns: [
          { key: "member", header: "Member / Donor", type: "text", width: 190 },
          { key: "donations", header: "Donations", type: "currency", width: 125 },
          { key: "subscriptions", header: "Subscriptions", type: "currency", width: 125 },
          { key: "total", header: "Total", type: "currency", width: 125 },
          { key: "payments", header: "# Payments", type: "number", width: 90 },
          { key: "email", header: "Email", type: "text", width: 190 },
        ],
        rows: reportRows,
      }],
    }),
  };
}

export async function exportMonthlyDuesReport(churchId: string): Promise<{ content: string; filename: string }> {
  const { rows } = await rawQuery<{
    full_name: string;
    email: string;
    plan_name: string;
    due_month: string;
    monthly_amount: string;
    status: string;
    paid_at: string | null;
  }>(
    `SELECT m.full_name, m.email, s.plan_name,
            to_char(smd.due_month, 'Mon YYYY') AS due_month,
            smd.amount_due::text AS monthly_amount,
            smd.status,
            to_char(smd.paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at
     FROM subscription_monthly_dues smd
     JOIN subscriptions s ON s.id = smd.subscription_id
     JOIN members m ON m.id = s.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
     ORDER BY m.full_name, smd.due_month DESC
     LIMIT 20000`,
    [churchId],
  );

  const reportRows = rows.map((r) => ({
    member: r.full_name,
    email: r.email,
    plan: r.plan_name,
    month: r.due_month,
    amount: Number(r.monthly_amount) || 0,
    status: r.status,
    paid_at: r.paid_at || "",
  }));

  return {
    filename: excelFilename(`monthly-dues-${new Date().toISOString().slice(0, 10)}.xls`),
    content: buildExcelHtmlReport({
      title: "Monthly Dues Report",
      subtitle: "Subscription due tracking for office reconciliation.",
      kpis: [
        { label: "Total Due Rows", value: reportRows.length },
        { label: "Total Amount", value: formatExcelMoney(reportRows.reduce((sum, r) => sum + r.amount, 0)) },
        { label: "Paid Rows", value: reportRows.filter((r) => String(r.status).toLowerCase() === "paid").length },
      ],
      notes: ["Filter by Status in Excel to review pending, overdue, and paid dues."],
      sections: [{
        title: "Monthly Dues Ledger",
        columns: [
          { key: "member", header: "Member", type: "text", width: 190 },
          { key: "plan", header: "Plan", type: "text", width: 170 },
          { key: "month", header: "Due Month", type: "text", width: 110 },
          { key: "amount", header: "Amount Due", type: "currency", width: 120 },
          { key: "status", header: "Status", type: "status", width: 100 },
          { key: "paid_at", header: "Paid At", type: "date", width: 150 },
          { key: "email", header: "Email", type: "text", width: 190 },
        ],
        rows: reportRows,
      }],
    }),
  };
}
