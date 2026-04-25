import { rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

const TZ = "Asia/Kolkata";
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function getChurchIncomeSummary(churchId: string) {
  try {
    // Single SQL query: daily, monthly, yearly sums + weekly breakdown — all in IST
    const { rows } = await rawQuery<{
      daily_income: string;
      monthly_income: string;
      yearly_income: string;
      successful_payments_count: string;
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date THEN p.amount END), 0) AS daily_income,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $2) = date_trunc('month', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS monthly_income,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $2) = date_trunc('year', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS yearly_income,
        COUNT(*)::text AS successful_payments_count
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
    `, [churchId, TZ]);

    const summary = rows[0] || { daily_income: "0", monthly_income: "0", yearly_income: "0", successful_payments_count: "0" };

    // Weekly breakdown by day-of-week (current IST week, Sun–Sat)
    const { rows: weeklyRows } = await rawQuery<{ dow: number; income: string }>(`
      SELECT
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $2)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND (p.payment_date AT TIME ZONE $2)::date >= date_trunc('week', NOW() AT TIME ZONE $2)::date
        AND p.payment_date <= NOW()
      GROUP BY 1
    `, [churchId, TZ]);

    const weeklyMap: Record<number, number> = {};
    for (const r of weeklyRows) weeklyMap[r.dow] = Number(r.income);

    const weekly_income_breakdown = dayNames.map((day, i) => ({
      day,
      income: Number((weeklyMap[i] || 0).toFixed(2)),
    }));

    return {
      daily_income: Number(Number(summary.daily_income).toFixed(2)),
      monthly_income: Number(Number(summary.monthly_income).toFixed(2)),
      yearly_income: Number(Number(summary.yearly_income).toFixed(2)),
      successful_payments_count: Number(summary.successful_payments_count),
      weekly_income_breakdown,
    };
  } catch (err) {
    logger.error({ err, churchId }, "getChurchIncomeSummary failed");
    throw err;
  }
}

export async function getPlatformIncomeSummary() {
  try {
    const { rows } = await rawQuery<{
      daily_income: string;
      monthly_income: string;
      yearly_income: string;
      successful_payments_count: string;
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date THEN p.amount END), 0) AS daily_income,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $1) = date_trunc('month', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS monthly_income,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $1) = date_trunc('year', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS yearly_income,
        COUNT(*)::text AS successful_payments_count
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
      JOIN churches c ON c.id = m.church_id AND c.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
    `, [TZ]);

    const summary = rows[0] || { daily_income: "0", monthly_income: "0", yearly_income: "0", successful_payments_count: "0" };

    const { rows: weeklyRows } = await rawQuery<{ dow: number; income: string }>(`
      SELECT
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $1)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
      JOIN churches c ON c.id = m.church_id AND c.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND (p.payment_date AT TIME ZONE $1)::date >= date_trunc('week', NOW() AT TIME ZONE $1)::date
        AND p.payment_date <= NOW()
      GROUP BY 1
    `, [TZ]);

    const weeklyMap: Record<number, number> = {};
    for (const r of weeklyRows) weeklyMap[r.dow] = Number(r.income);

    return {
      daily_income: Number(Number(summary.daily_income).toFixed(2)),
      monthly_income: Number(Number(summary.monthly_income).toFixed(2)),
      yearly_income: Number(Number(summary.yearly_income).toFixed(2)),
      successful_payments_count: Number(summary.successful_payments_count),
      weekly_income_breakdown: dayNames.map((day, i) => ({
        day,
        income: Number((weeklyMap[i] || 0).toFixed(2)),
      })),
    };
  } catch (err) {
    logger.error({ err }, "getPlatformIncomeSummary failed");
    throw err;
  }
}

export async function getChurchGrowthMetrics(churchId: string) {
  try {
    // Total members
    const { rows: countRows } = await rawQuery<{ total: string }>(`
      SELECT COUNT(*)::text AS total FROM members WHERE church_id = $1 AND deleted_at IS NULL
    `, [churchId]);
    const totalMembers = Number(countRows[0]?.total || 0);

    // Monthly growth — last 6 months bucketed in IST
    const { rows: growthRows } = await rawQuery<{ ym: string; count: string }>(`
      SELECT to_char(created_at AT TIME ZONE $2, 'Mon YY') AS ym, COUNT(*)::text AS count
      FROM members
      WHERE church_id = $1 AND deleted_at IS NULL
        AND created_at >= date_trunc('month', NOW() AT TIME ZONE $2 - INTERVAL '5 months') AT TIME ZONE $2
      GROUP BY 1, date_trunc('month', created_at AT TIME ZONE $2)
      ORDER BY date_trunc('month', created_at AT TIME ZONE $2)
    `, [churchId, TZ]);

    // Build 6-month bucket list
    const now = new Date();
    const buckets: Array<{ month: string; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ month: `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`, count: 0 });
    }
    const growthMap: Record<string, number> = {};
    for (const r of growthRows) growthMap[r.ym] = Number(r.count);
    for (const b of buckets) b.count = growthMap[b.month] || 0;

    // Subscription stats via SQL COUNT
    const { rows: subRows } = await rawQuery<{ active: string; overdue: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE s.status = 'active')::text AS active,
        COUNT(*) FILTER (WHERE s.status = 'overdue')::text AS overdue
      FROM subscriptions s
      JOIN members m ON m.id = s.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
    `, [churchId]);

    return {
      total_members: totalMembers,
      monthly_growth: buckets,
      active_subscriptions: Number(subRows[0]?.active || 0),
      overdue_subscriptions: Number(subRows[0]?.overdue || 0),
    };
  } catch (err) {
    logger.error({ err, churchId }, "getChurchGrowthMetrics failed");
    throw err;
  }
}

// ── Detailed income breakdown (donations vs subscriptions) ──

export async function getChurchIncomeDetail(churchId: string) {
  try {
    // Single query: daily/monthly/yearly sums split by donation vs subscription
    const { rows } = await rawQuery<{
      is_donation: boolean;
      daily: string; monthly: string; yearly: string; cnt: string;
    }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date THEN p.amount END), 0) AS daily,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $2) = date_trunc('month', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS monthly,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $2) = date_trunc('year', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS yearly,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
      GROUP BY 1
    `, [churchId, TZ]);

    const sub = { daily: 0, monthly: 0, yearly: 0, count: 0 };
    const don = { daily: 0, monthly: 0, yearly: 0, count: 0 };
    for (const r of rows) {
      const target = r.is_donation ? don : sub;
      target.daily = Number(r.daily);
      target.monthly = Number(r.monthly);
      target.yearly = Number(r.yearly);
      target.count = Number(r.cnt);
    }

    // Weekly breakdown by day-of-week, split by donation vs subscription
    const { rows: weeklyRows } = await rawQuery<{ is_donation: boolean; dow: number; income: string }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $2)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND (p.payment_date AT TIME ZONE $2)::date >= date_trunc('week', NOW() AT TIME ZONE $2)::date
        AND p.payment_date <= NOW()
      GROUP BY 1, 2
    `, [churchId, TZ]);

    const subWeekly: Record<number, number> = {};
    const donWeekly: Record<number, number> = {};
    for (const r of weeklyRows) {
      const map = r.is_donation ? donWeekly : subWeekly;
      map[r.dow] = Number(r.income);
    }

    // Monthly trend (last 6 months), split by type
    const { rows: trendRows } = await rawQuery<{ is_donation: boolean; ym: string; income: string }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        to_char(p.payment_date AT TIME ZONE $2, 'Mon YY') AS ym,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND p.payment_date >= date_trunc('month', NOW() AT TIME ZONE $2 - INTERVAL '5 months') AT TIME ZONE $2
      GROUP BY 1, 2, date_trunc('month', p.payment_date AT TIME ZONE $2)
      ORDER BY date_trunc('month', p.payment_date AT TIME ZONE $2)
    `, [churchId, TZ]);

    // Build 6-month trend buckets
    const now = new Date();
    const trendBuckets: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendBuckets.push(`${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`);
    }

    const subMonthly: Record<string, number> = {};
    const donMonthly: Record<string, number> = {};
    for (const r of trendRows) {
      const map = r.is_donation ? donMonthly : subMonthly;
      map[r.ym] = Number(r.income);
    }

    const toWeekly = (m: Record<number, number>) => dayNames.map((d, i) => ({ day: d, income: Number((m[i] || 0).toFixed(2)) }));
    const toTrend = (m: Record<string, number>) => trendBuckets.map((month) => ({ month, income: Number((m[month] || 0).toFixed(2)) }));

    return {
      subscription_income: {
        daily: Number(sub.daily.toFixed(2)),
        monthly: Number(sub.monthly.toFixed(2)),
        yearly: Number(sub.yearly.toFixed(2)),
        count: sub.count,
        weekly: toWeekly(subWeekly),
        monthly_trend: toTrend(subMonthly),
      },
      donation_income: {
        daily: Number(don.daily.toFixed(2)),
        monthly: Number(don.monthly.toFixed(2)),
        yearly: Number(don.yearly.toFixed(2)),
        count: don.count,
        weekly: toWeekly(donWeekly),
        monthly_trend: toTrend(donMonthly),
      },
      total_income: {
        daily: Number((sub.daily + don.daily).toFixed(2)),
        monthly: Number((sub.monthly + don.monthly).toFixed(2)),
        yearly: Number((sub.yearly + don.yearly).toFixed(2)),
        count: sub.count + don.count,
      },
    };
  } catch (err) {
    logger.error({ err, churchId }, "getChurchIncomeDetail failed");
    throw err;
  }
}

export async function getPlatformIncomeDetail() {
  try {
    const { rows } = await rawQuery<{
      is_donation: boolean;
      daily: string; monthly: string; yearly: string; cnt: string;
    }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date THEN p.amount END), 0) AS daily,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $1) = date_trunc('month', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS monthly,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $1) = date_trunc('year', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS yearly,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
      JOIN churches c ON c.id = m.church_id AND c.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
      GROUP BY 1
    `, [TZ]);

    const sub = { daily: 0, monthly: 0, yearly: 0, count: 0 };
    const don = { daily: 0, monthly: 0, yearly: 0, count: 0 };
    for (const r of rows) {
      const target = r.is_donation ? don : sub;
      target.daily = Number(r.daily);
      target.monthly = Number(r.monthly);
      target.yearly = Number(r.yearly);
      target.count = Number(r.cnt);
    }

    const { rows: weeklyRows } = await rawQuery<{ is_donation: boolean; dow: number; income: string }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $1)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
      JOIN churches c ON c.id = m.church_id AND c.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND (p.payment_date AT TIME ZONE $1)::date >= date_trunc('week', NOW() AT TIME ZONE $1)::date
        AND p.payment_date <= NOW()
      GROUP BY 1, 2
    `, [TZ]);

    const subWeekly: Record<number, number> = {};
    const donWeekly: Record<number, number> = {};
    for (const r of weeklyRows) {
      const map = r.is_donation ? donWeekly : subWeekly;
      map[r.dow] = Number(r.income);
    }

    const { rows: trendRows } = await rawQuery<{ is_donation: boolean; ym: string; income: string }>(`
      SELECT
        (LOWER(p.payment_method) = 'donation') AS is_donation,
        to_char(p.payment_date AT TIME ZONE $1, 'Mon YY') AS ym,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
      JOIN churches c ON c.id = m.church_id AND c.deleted_at IS NULL
      WHERE LOWER(p.payment_status) = 'success'
        AND p.payment_date >= date_trunc('month', NOW() AT TIME ZONE $1 - INTERVAL '5 months') AT TIME ZONE $1
      GROUP BY 1, 2, date_trunc('month', p.payment_date AT TIME ZONE $1)
      ORDER BY date_trunc('month', p.payment_date AT TIME ZONE $1)
    `, [TZ]);

    const now = new Date();
    const trendBuckets: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendBuckets.push(`${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`);
    }

    const subMonthly: Record<string, number> = {};
    const donMonthly: Record<string, number> = {};
    for (const r of trendRows) {
      const map = r.is_donation ? donMonthly : subMonthly;
      map[r.ym] = Number(r.income);
    }

    const toWeekly = (m: Record<number, number>) => dayNames.map((d, i) => ({ day: d, income: Number((m[i] || 0).toFixed(2)) }));
    const toTrend = (m: Record<string, number>) => trendBuckets.map((month) => ({ month, income: Number((m[month] || 0).toFixed(2)) }));

    return {
      subscription_income: {
        daily: Number(sub.daily.toFixed(2)),
        monthly: Number(sub.monthly.toFixed(2)),
        yearly: Number(sub.yearly.toFixed(2)),
        count: sub.count,
        weekly: toWeekly(subWeekly),
        monthly_trend: toTrend(subMonthly),
      },
      donation_income: {
        daily: Number(don.daily.toFixed(2)),
        monthly: Number(don.monthly.toFixed(2)),
        yearly: Number(don.yearly.toFixed(2)),
        count: don.count,
        weekly: toWeekly(donWeekly),
        monthly_trend: toTrend(donMonthly),
      },
      total_income: {
        daily: Number((sub.daily + don.daily).toFixed(2)),
        monthly: Number((sub.monthly + don.monthly).toFixed(2)),
        yearly: Number((sub.yearly + don.yearly).toFixed(2)),
        count: sub.count + don.count,
      },
    };
  } catch (err) {
    logger.error({ err }, "getPlatformIncomeDetail failed");
    throw err;
  }
}

// ── Rich Payment Report (CSV) ──

interface PaymentReportRow {
  payment_date: string;
  member_name: string;
  membership_id: string | null;
  email: string;
  phone: string | null;
  payment_method: string;
  amount: string;
  payment_status: string;
  receipt_number: string | null;
  transaction_id: string | null;
  plan_name: string | null;
  billing_cycle: string | null;
  payment_type: string;
  month_label: string;
  fund_name: string | null;
  months_covered: string | null;
}

export async function generatePaymentReport(
  churchId: string,
  period: "daily" | "monthly" | "yearly" | "custom",
  year?: number,
  month?: number,
  startDate?: string,
  endDate?: string,
): Promise<{ csv: string; filename: string; summary: Record<string, unknown> }> {
  let dateFilter: string;
  let dateParams: unknown[];
  let filename: string;
  const now = new Date();
  const paramBase = [churchId, TZ];

  if (period === "daily") {
    dateFilter = `AND (p.payment_date AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date`;
    dateParams = paramBase;
    const d = now.toISOString().slice(0, 10);
    filename = `payment-report-daily-${d}.csv`;
  } else if (period === "monthly") {
    const y = year || now.getFullYear();
    const m = month != null ? month : now.getMonth() + 1;
    dateFilter = `AND EXTRACT(YEAR FROM p.payment_date AT TIME ZONE $2) = $3 AND EXTRACT(MONTH FROM p.payment_date AT TIME ZONE $2) = $4`;
    dateParams = [...paramBase, y, m];
    filename = `payment-report-${y}-${String(m).padStart(2, "0")}.csv`;
  } else if (period === "yearly") {
    const y = year || now.getFullYear();
    dateFilter = `AND EXTRACT(YEAR FROM p.payment_date AT TIME ZONE $2) = $3`;
    dateParams = [...paramBase, y];
    filename = `payment-report-${y}.csv`;
  } else {
    if (!startDate || !endDate) throw new Error("startDate and endDate required for custom period");
    dateFilter = `AND (p.payment_date AT TIME ZONE $2)::date >= $3::date AND (p.payment_date AT TIME ZONE $2)::date <= $4::date`;
    dateParams = [...paramBase, startDate, endDate];
    filename = `payment-report-${startDate}-to-${endDate}.csv`;
  }

  const { rows } = await rawQuery<PaymentReportRow>(`
    SELECT
      to_char(p.payment_date AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS payment_date,
      COALESCE(m.full_name, '') AS member_name,
      m.membership_id,
      COALESCE(m.email, '') AS email,
      COALESCE(m.phone_number, '') AS phone,
      COALESCE(p.payment_method, '') AS payment_method,
      p.amount::text AS amount,
      COALESCE(p.payment_status, '') AS payment_status,
      p.receipt_number,
      p.transaction_id,
      s.plan_name,
      s.billing_cycle,
      CASE WHEN LOWER(p.payment_method) = 'donation' THEN 'Donation' ELSE 'Subscription' END AS payment_type,
      to_char(p.payment_date AT TIME ZONE $2, 'Mon YYYY') AS month_label,
      p.fund_name,
      (
        SELECT string_agg(to_char(smd.due_month, 'Mon YYYY'), ', ' ORDER BY smd.due_month)
        FROM payment_month_allocations pma
        JOIN subscription_monthly_dues smd ON smd.id = pma.due_id
        WHERE pma.payment_id = p.id
      ) AS months_covered
    FROM payments p
    JOIN members m ON m.id = p.member_id AND m.church_id = $1 AND m.deleted_at IS NULL
    LEFT JOIN subscriptions s ON s.id = p.subscription_id
    WHERE LOWER(p.payment_status) = 'success'
    ${dateFilter}
    ORDER BY p.payment_date DESC
  `, dateParams);

  // Build summary
  let totalAmount = 0;
  let subscriptionTotal = 0;
  let donationTotal = 0;
  let subscriptionCount = 0;
  let donationCount = 0;
  const monthlyBreakdown: Record<string, { subscriptions: number; donations: number; total: number; count: number }> = {};

  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    totalAmount += amt;
    const ml = r.month_label;
    if (!monthlyBreakdown[ml]) monthlyBreakdown[ml] = { subscriptions: 0, donations: 0, total: 0, count: 0 };
    monthlyBreakdown[ml].total += amt;
    monthlyBreakdown[ml].count += 1;
    if (r.payment_type === "Donation") {
      donationTotal += amt;
      donationCount += 1;
      monthlyBreakdown[ml].donations += amt;
    } else {
      subscriptionTotal += amt;
      subscriptionCount += 1;
      monthlyBreakdown[ml].subscriptions += amt;
    }
  }

  // Build CSV
  const csvLines: string[] = [];

  // Report header
  csvLines.push(`"PAYMENT REPORT"`);
  csvLines.push(`"Period","${period.toUpperCase()}"`);
  csvLines.push(`"Generated","${now.toISOString().slice(0, 19).replace("T", " ")} IST"`);
  csvLines.push(`"Total Records","${rows.length}"`);
  csvLines.push(``);

  // Summary section
  csvLines.push(`"SUMMARY"`);
  csvLines.push(`"Total Income","₹${totalAmount.toFixed(2)}"`);
  csvLines.push(`"Subscription Income","₹${subscriptionTotal.toFixed(2)}","${subscriptionCount} payments"`);
  csvLines.push(`"Donation Income","₹${donationTotal.toFixed(2)}","${donationCount} payments"`);
  csvLines.push(``);

  // Monthly breakdown for yearly reports
  if (period === "yearly" || period === "custom") {
    csvLines.push(`"MONTHLY BREAKDOWN"`);
    csvLines.push(`"Month","Subscriptions","Donations","Total","# Payments"`);
    for (const [ml, data] of Object.entries(monthlyBreakdown)) {
      csvLines.push(`"${ml}","₹${data.subscriptions.toFixed(2)}","₹${data.donations.toFixed(2)}","₹${data.total.toFixed(2)}","${data.count}"`);
    }
    csvLines.push(``);
  }

  // Detail header
  csvLines.push(`"DETAILED TRANSACTIONS"`);
  csvLines.push(`"Date","Member Name","Membership ID","Email","Phone","Type","Plan","Amount (₹)","Method","Fund","Status","Receipt #","Transaction ID","Billing Cycle","Month","Months Covered"`);

  for (const r of rows) {
    csvLines.push([
      `"${r.payment_date}"`,
      `"${(r.member_name || "").replace(/"/g, '""')}"`,
      `"${r.membership_id || ""}"`,
      `"${(r.email || "").replace(/"/g, '""')}"`,
      `"${r.phone || ""}"`,
      `"${r.payment_type}"`,
      `"${(r.plan_name || "N/A").replace(/"/g, '""')}"`,
      `"${Number(r.amount).toFixed(2)}"`,
      `"${r.payment_method}"`,
      `"${r.fund_name || ""}"`,
      `"${r.payment_status}"`,
      `"${r.receipt_number || ""}"`,
      `"${r.transaction_id || ""}"`,
      `"${r.billing_cycle || ""}"`,
      `"${r.month_label}"`,
      `"${(r.months_covered || "").replace(/"/g, '""')}"`,
    ].join(","));
  }

  return {
    csv: csvLines.join("\n"),
    filename,
    summary: { totalAmount, subscriptionTotal, donationTotal, subscriptionCount, donationCount, totalRecords: rows.length },
  };
}
