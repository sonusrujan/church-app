import { rawQuery } from "./dbClient";
import { logger } from "../utils/logger";

const TZ = "Asia/Kolkata";
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const incomeAnalyticsPeriods = new Set(["current_month", "year_to_date", "last_12_months"]);

export type IncomeAnalyticsPeriod = "current_month" | "year_to_date" | "last_12_months";

export interface IncomeAnalytics {
  period: IncomeAnalyticsPeriod;
  scope: "church" | "platform";
  revenue_mix: Array<{ label: string; amount: number; count: number }>;
  collection_rate: {
    expected: number;
    collected: number;
    overdue: number;
    pending: number;
    collection_rate: number;
    expected_count: number;
    collected_count: number;
    overdue_count: number;
    pending_count: number;
  };
  aging_ledger: Array<{ bucket: string; amount: number; count: number }>;
  donation_funds: Array<{ fund: string; amount: number; count: number }>;
  payment_methods: Array<{ method: string; amount: number; count: number }>;
  monthly_growth: Array<{ month: string; subscription: number; donation: number; platform_fee: number; total: number }>;
  payment_funnel: Array<{ stage: string; count: number; amount: number }>;
  donor_bands: Array<{ band: string; donors: number; amount: number }>;
}

export function normalizeIncomeAnalyticsPeriod(period?: string): IncomeAnalyticsPeriod {
  return incomeAnalyticsPeriods.has(period || "") ? period as IncomeAnalyticsPeriod : "current_month";
}

function money(value: unknown): number {
  const next = Number(value || 0);
  return Number(Number.isFinite(next) ? next.toFixed(2) : 0);
}

function count(value: unknown): number {
  return Number(value || 0);
}

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

function analyticsScope(churchId?: string | null) {
  const scoped = !!churchId;
  return {
    paymentWhere: scoped ? "p.church_id = $1::uuid" : "TRUE",
    dueWhere: scoped ? "smd.church_id = $1::uuid" : "TRUE",
    feeWhere: scoped ? "pfc.church_id = $1::uuid" : "TRUE",
    reconciliationWhere: scoped ? "prq.church_id = $1::uuid" : "TRUE",
    params: scoped ? [churchId] : [],
    periodIndex: scoped ? 2 : 1,
    tzIndex: scoped ? 3 : 2,
  };
}

function periodBoundsSql(periodIndex: number, tzIndex: number) {
  return `
    SELECT
      CASE $${periodIndex}
        WHEN 'year_to_date' THEN date_trunc('year', NOW() AT TIME ZONE $${tzIndex})::date
        WHEN 'last_12_months' THEN (date_trunc('month', NOW() AT TIME ZONE $${tzIndex}) - INTERVAL '11 months')::date
        ELSE date_trunc('month', NOW() AT TIME ZONE $${tzIndex})::date
      END AS start_date,
      ((NOW() AT TIME ZONE $${tzIndex})::date + INTERVAL '1 day')::date AS end_date
  `;
}

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
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND p.church_id = $1
    `, [churchId, TZ]);

    const summary = rows[0] || { daily_income: "0", monthly_income: "0", yearly_income: "0", successful_payments_count: "0" };

    // Weekly breakdown by day-of-week (current IST week, Sun–Sat)
    const { rows: weeklyRows } = await rawQuery<{ dow: number; income: string }>(`
      SELECT
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $2)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND p.church_id = $1
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
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
    `, [TZ]);

    const summary = rows[0] || { daily_income: "0", monthly_income: "0", yearly_income: "0", successful_payments_count: "0" };

    const { rows: weeklyRows } = await rawQuery<{ dow: number; income: string }>(`
      SELECT
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $1)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date THEN p.amount END), 0) AS daily,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $2) = date_trunc('month', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS monthly,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $2) = date_trunc('year', NOW() AT TIME ZONE $2) THEN p.amount END), 0) AS yearly,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND p.church_id = $1
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $2)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND p.church_id = $1
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        to_char(p.payment_date AT TIME ZONE $2, 'Mon YY') AS ym,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND p.church_id = $1
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        COALESCE(SUM(CASE WHEN (p.payment_date AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date THEN p.amount END), 0) AS daily,
        COALESCE(SUM(CASE WHEN date_trunc('month', p.payment_date AT TIME ZONE $1) = date_trunc('month', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS monthly,
        COALESCE(SUM(CASE WHEN date_trunc('year', p.payment_date AT TIME ZONE $1) = date_trunc('year', NOW() AT TIME ZONE $1) THEN p.amount END), 0) AS yearly,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        EXTRACT(DOW FROM p.payment_date AT TIME ZONE $1)::int AS dow,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
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
        (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        ) AS is_donation,
        to_char(p.payment_date AT TIME ZONE $1, 'Mon YY') AS ym,
        COALESCE(SUM(p.amount), 0) AS income
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      WHERE ${appSuccessfulPaymentWhere("p")}
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

async function getIncomeAnalyticsForScope(
  churchId: string | null,
  requestedPeriod?: string,
): Promise<IncomeAnalytics> {
  const period = normalizeIncomeAnalyticsPeriod(requestedPeriod);
  const scope = analyticsScope(churchId);
  const params = [...scope.params, period, TZ];
  const bounds = periodBoundsSql(scope.periodIndex, scope.tzIndex);

  try {
    const { rows: revenueRows } = await rawQuery<{ label: string; amount: string; cnt: string; sort_order: number }>(`
      WITH bounds AS (${bounds}),
      fee_by_payment AS (
        SELECT pfc.payment_id, COALESCE(SUM(pfc.fee_amount), 0) AS fee_amount
        FROM platform_fee_collections pfc
        WHERE ${scope.feeWhere}
        GROUP BY pfc.payment_id
      ),
      payment_base AS (
        SELECT
          p.id,
          (
            LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
            OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
          ) AS is_donation,
          GREATEST(p.amount - COALESCE(f.fee_amount, 0), 0) AS net_amount,
          COALESCE(f.fee_amount, 0) AS fee_amount
        FROM payments p
        JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        LEFT JOIN fee_by_payment f ON f.payment_id = p.id
        WHERE ${appSuccessfulPaymentWhere("p")}
          AND ${scope.paymentWhere}
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      )
      SELECT 'Subscriptions' AS label,
             COALESCE(SUM(net_amount) FILTER (WHERE NOT is_donation), 0)::text AS amount,
             COUNT(*) FILTER (WHERE NOT is_donation)::text AS cnt,
             1 AS sort_order
      FROM payment_base
      UNION ALL
      SELECT 'Donations',
             COALESCE(SUM(net_amount) FILTER (WHERE is_donation), 0)::text,
             COUNT(*) FILTER (WHERE is_donation)::text,
             2
      FROM payment_base
      UNION ALL
      SELECT 'Platform fees',
             COALESCE(SUM(fee_amount), 0)::text,
             COUNT(*) FILTER (WHERE fee_amount > 0)::text,
             3
      FROM payment_base
      ORDER BY sort_order
    `, params);

    const { rows: collectionRows } = await rawQuery<{
      expected: string;
      collected: string;
      overdue: string;
      pending: string;
      expected_count: string;
      collected_count: string;
      overdue_count: string;
      pending_count: string;
    }>(`
      WITH bounds AS (${bounds}),
      dues AS (
        SELECT
          smd.id,
          smd.status,
          smd.due_month,
          CASE
            WHEN LOWER(COALESCE(s.billing_cycle, '')) = 'yearly' THEN s.amount / 12.0
            ELSE s.amount
          END AS due_amount
        FROM subscription_monthly_dues smd
        JOIN subscriptions s ON s.id = smd.subscription_id
        JOIN churches c ON c.id = smd.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        WHERE ${scope.dueWhere}
          AND smd.due_month >= b.start_date
          AND smd.due_month < b.end_date
      ),
      app_paid_dues AS (
        SELECT DISTINCT pma.due_id
        FROM payment_month_allocations pma
        JOIN payments p ON p.id = pma.payment_id
        JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        WHERE ${appSuccessfulPaymentWhere("p")}
          AND ${scope.paymentWhere}
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      )
      SELECT
        COALESCE(SUM(due_amount) FILTER (WHERE status = 'pending' OR apd.due_id IS NOT NULL), 0)::text AS expected,
        COALESCE(SUM(due_amount) FILTER (WHERE apd.due_id IS NOT NULL), 0)::text AS collected,
        COALESCE(SUM(due_amount) FILTER (
          WHERE status = 'pending'
            AND due_month < date_trunc('month', NOW() AT TIME ZONE $${scope.tzIndex})::date
        ), 0)::text AS overdue,
        COALESCE(SUM(due_amount) FILTER (WHERE status = 'pending'), 0)::text AS pending,
        COUNT(*) FILTER (WHERE status = 'pending' OR apd.due_id IS NOT NULL)::text AS expected_count,
        COUNT(*) FILTER (WHERE apd.due_id IS NOT NULL)::text AS collected_count,
        COUNT(*) FILTER (
          WHERE status = 'pending'
            AND due_month < date_trunc('month', NOW() AT TIME ZONE $${scope.tzIndex})::date
        )::text AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'pending')::text AS pending_count
      FROM dues
      LEFT JOIN app_paid_dues apd ON apd.due_id = dues.id
    `, params);

    const agingTzIndex = scope.params.length + 1;
    const { rows: agingRows } = await rawQuery<{ bucket: string; amount: string; cnt: string; sort_order: number }>(`
      WITH pending_dues AS (
        SELECT
          CASE
            WHEN ((NOW() AT TIME ZONE $${agingTzIndex})::date - smd.due_month::date) <= 30 THEN '0-30 days'
            WHEN ((NOW() AT TIME ZONE $${agingTzIndex})::date - smd.due_month::date) <= 60 THEN '31-60 days'
            ELSE '60+ days'
          END AS bucket,
          CASE
            WHEN ((NOW() AT TIME ZONE $${agingTzIndex})::date - smd.due_month::date) <= 30 THEN 1
            WHEN ((NOW() AT TIME ZONE $${agingTzIndex})::date - smd.due_month::date) <= 60 THEN 2
            ELSE 3
          END AS sort_order,
          CASE
            WHEN LOWER(COALESCE(s.billing_cycle, '')) = 'yearly' THEN s.amount / 12.0
            ELSE s.amount
          END AS due_amount
        FROM subscription_monthly_dues smd
        JOIN subscriptions s ON s.id = smd.subscription_id
        JOIN churches c ON c.id = smd.church_id AND c.deleted_at IS NULL
        WHERE ${scope.dueWhere}
          AND smd.status = 'pending'
          AND smd.due_month < (NOW() AT TIME ZONE $${agingTzIndex})::date
      )
      SELECT bucket, COALESCE(SUM(due_amount), 0)::text AS amount, COUNT(*)::text AS cnt, sort_order
      FROM pending_dues
      GROUP BY bucket, sort_order
      ORDER BY sort_order
    `, [...scope.params, TZ]);

    const { rows: fundRows } = await rawQuery<{ fund: string; amount: string; cnt: string }>(`
      WITH bounds AS (${bounds}),
      fee_by_payment AS (
        SELECT pfc.payment_id, COALESCE(SUM(pfc.fee_amount), 0) AS fee_amount
        FROM platform_fee_collections pfc
        WHERE ${scope.feeWhere}
        GROUP BY pfc.payment_id
      )
      SELECT
        COALESCE(NULLIF(TRIM(p.fund_name), ''), 'General') AS fund,
        COALESCE(SUM(GREATEST(p.amount - COALESCE(f.fee_amount, 0), 0)), 0)::text AS amount,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      CROSS JOIN bounds b
      LEFT JOIN fee_by_payment f ON f.payment_id = p.id
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND ${scope.paymentWhere}
        AND (
          LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        )
        AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
        AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      GROUP BY 1
      ORDER BY SUM(GREATEST(p.amount - COALESCE(f.fee_amount, 0), 0)) DESC, fund
      LIMIT 8
    `, params);

    const { rows: methodRows } = await rawQuery<{ method: string; amount: string; cnt: string }>(`
      WITH bounds AS (${bounds})
      SELECT
        CASE
          WHEN LOWER(COALESCE(p.payment_method, '')) = 'subscription_paynow' THEN 'Subscription checkout'
          WHEN LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation') THEN 'Donation checkout'
          ELSE 'Razorpay checkout'
        END AS method,
        COALESCE(SUM(p.amount), 0)::text AS amount,
        COUNT(*)::text AS cnt
      FROM payments p
      JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
      CROSS JOIN bounds b
      WHERE ${appSuccessfulPaymentWhere("p")}
        AND ${scope.paymentWhere}
        AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
        AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      GROUP BY 1
      ORDER BY SUM(p.amount) DESC, method
    `, params);

    const monthlyTzIndex = scope.params.length + 1;
    const { rows: growthRows } = await rawQuery<{
      month: string;
      subscription: string;
      donation: string;
      platform_fee: string;
      total: string;
      month_start: string;
    }>(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', NOW() AT TIME ZONE $${monthlyTzIndex}) - INTERVAL '11 months',
          date_trunc('month', NOW() AT TIME ZONE $${monthlyTzIndex}),
          INTERVAL '1 month'
        )::date AS month_start
      ),
      fee_by_payment AS (
        SELECT pfc.payment_id, COALESCE(SUM(pfc.fee_amount), 0) AS fee_amount
        FROM platform_fee_collections pfc
        WHERE ${scope.feeWhere}
        GROUP BY pfc.payment_id
      ),
      payment_base AS (
        SELECT
          date_trunc('month', p.payment_date AT TIME ZONE $${monthlyTzIndex})::date AS month_start,
          (
            LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
            OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
          ) AS is_donation,
          GREATEST(p.amount - COALESCE(f.fee_amount, 0), 0) AS net_amount,
          COALESCE(f.fee_amount, 0) AS fee_amount
        FROM payments p
        JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
        LEFT JOIN fee_by_payment f ON f.payment_id = p.id
        WHERE ${appSuccessfulPaymentWhere("p")}
          AND ${scope.paymentWhere}
          AND (p.payment_date AT TIME ZONE $${monthlyTzIndex})::date >= (
            date_trunc('month', NOW() AT TIME ZONE $${monthlyTzIndex}) - INTERVAL '11 months'
          )::date
      )
      SELECT
        to_char(m.month_start, 'Mon YY') AS month,
        COALESCE(SUM(pb.net_amount) FILTER (WHERE pb.is_donation = false), 0)::text AS subscription,
        COALESCE(SUM(pb.net_amount) FILTER (WHERE pb.is_donation = true), 0)::text AS donation,
        COALESCE(SUM(pb.fee_amount), 0)::text AS platform_fee,
        COALESCE(SUM(pb.net_amount + pb.fee_amount), 0)::text AS total,
        m.month_start::text AS month_start
      FROM months m
      LEFT JOIN payment_base pb ON pb.month_start = m.month_start
      GROUP BY m.month_start
      ORDER BY m.month_start
    `, [...scope.params, TZ]);

    const { rows: funnelRows } = await rawQuery<{ stage: string; cnt: string; amount: string; sort_order: number }>(`
      WITH bounds AS (${bounds}),
      payments_in_period AS (
        SELECT p.payment_status, p.amount
        FROM payments p
        JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        WHERE ${scope.paymentWhere}
          AND ${appPaymentOriginWhere("p")}
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      ),
      reconciliation_in_period AS (
        SELECT prq.status, prq.expected_amount
        FROM payment_reconciliation_queue prq
        JOIN churches c ON c.id = prq.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        WHERE ${scope.reconciliationWhere}
          AND (prq.created_at AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
          AND (prq.created_at AT TIME ZONE $${scope.tzIndex})::date < b.end_date
      )
      SELECT 'Recorded attempts' AS stage, COUNT(*)::text AS cnt, COALESCE(SUM(amount), 0)::text AS amount, 1 AS sort_order
      FROM payments_in_period
      UNION ALL
      SELECT 'Successful', COUNT(*)::text, COALESCE(SUM(amount), 0)::text, 2
      FROM payments_in_period
      WHERE LOWER(COALESCE(payment_status, '')) = 'success'
      UNION ALL
      SELECT 'Pending', COUNT(*)::text, COALESCE(SUM(amount), 0)::text, 3
      FROM payments_in_period
      WHERE LOWER(COALESCE(payment_status, '')) = 'pending'
      UNION ALL
      SELECT 'Failed', COUNT(*)::text, COALESCE(SUM(amount), 0)::text, 4
      FROM payments_in_period
      WHERE LOWER(COALESCE(payment_status, '')) = 'failed'
      UNION ALL
      SELECT 'Needs review', COUNT(*)::text, COALESCE(SUM(expected_amount), 0)::text, 5
      FROM reconciliation_in_period
      WHERE status IN ('pending', 'failed', 'manual_review')
      ORDER BY sort_order
    `, params);

    const { rows: donorRows } = await rawQuery<{ band: string; donors: string; amount: string; sort_order: number }>(`
      WITH bounds AS (${bounds}),
      fee_by_payment AS (
        SELECT pfc.payment_id, COALESCE(SUM(pfc.fee_amount), 0) AS fee_amount
        FROM platform_fee_collections pfc
        WHERE ${scope.feeWhere}
        GROUP BY pfc.payment_id
      ),
      payer_totals AS (
        SELECT
          COALESCE(p.member_id::text, p.transaction_id, p.id::text) AS payer_key,
          COALESCE(SUM(GREATEST(p.amount - COALESCE(f.fee_amount, 0), 0)), 0) AS total_amount
        FROM payments p
        JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
        CROSS JOIN bounds b
        LEFT JOIN fee_by_payment f ON f.payment_id = p.id
        WHERE ${appSuccessfulPaymentWhere("p")}
          AND ${scope.paymentWhere}
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date >= b.start_date
          AND (p.payment_date AT TIME ZONE $${scope.tzIndex})::date < b.end_date
        GROUP BY 1
      ),
      bands AS (
        SELECT
          CASE
            WHEN total_amount <= 500 THEN '0-500'
            WHEN total_amount <= 1000 THEN '501-1,000'
            WHEN total_amount <= 5000 THEN '1,001-5,000'
            WHEN total_amount <= 10000 THEN '5,001-10,000'
            ELSE '10,000+'
          END AS band,
          CASE
            WHEN total_amount <= 500 THEN 1
            WHEN total_amount <= 1000 THEN 2
            WHEN total_amount <= 5000 THEN 3
            WHEN total_amount <= 10000 THEN 4
            ELSE 5
          END AS sort_order,
          total_amount
        FROM payer_totals
      )
      SELECT band, COUNT(*)::text AS donors, COALESCE(SUM(total_amount), 0)::text AS amount, sort_order
      FROM bands
      GROUP BY band, sort_order
      ORDER BY sort_order
    `, params);

    const collection = collectionRows[0] || {
      expected: "0",
      collected: "0",
      overdue: "0",
      pending: "0",
      expected_count: "0",
      collected_count: "0",
      overdue_count: "0",
      pending_count: "0",
    };
    const expected = money(collection.expected);
    const collected = money(collection.collected);

    return {
      period,
      scope: churchId ? "church" : "platform",
      revenue_mix: revenueRows.map((r) => ({ label: r.label, amount: money(r.amount), count: count(r.cnt) })),
      collection_rate: {
        expected,
        collected,
        overdue: money(collection.overdue),
        pending: money(collection.pending),
        collection_rate: expected > 0 ? Number(((collected / expected) * 100).toFixed(1)) : 0,
        expected_count: count(collection.expected_count),
        collected_count: count(collection.collected_count),
        overdue_count: count(collection.overdue_count),
        pending_count: count(collection.pending_count),
      },
      aging_ledger: agingRows.map((r) => ({ bucket: r.bucket, amount: money(r.amount), count: count(r.cnt) })),
      donation_funds: fundRows.map((r) => ({ fund: r.fund, amount: money(r.amount), count: count(r.cnt) })),
      payment_methods: methodRows.map((r) => ({ method: r.method, amount: money(r.amount), count: count(r.cnt) })),
      monthly_growth: growthRows.map((r) => ({
        month: r.month,
        subscription: money(r.subscription),
        donation: money(r.donation),
        platform_fee: money(r.platform_fee),
        total: money(r.total),
      })),
      payment_funnel: funnelRows.map((r) => ({ stage: r.stage, count: count(r.cnt), amount: money(r.amount) })),
      donor_bands: donorRows.map((r) => ({ band: r.band, donors: count(r.donors), amount: money(r.amount) })),
    };
  } catch (err) {
    logger.error({ err, churchId, period }, "getIncomeAnalyticsForScope failed");
    throw err;
  }
}

export async function getChurchIncomeAnalytics(churchId: string, period?: string): Promise<IncomeAnalytics> {
  return getIncomeAnalyticsForScope(churchId, period);
}

export async function getPlatformIncomeAnalytics(period?: string): Promise<IncomeAnalytics> {
  return getIncomeAnalyticsForScope(null, period);
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
      COALESCE(m.full_name, 'Public donor') AS member_name,
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
      CASE
        WHEN LOWER(COALESCE(p.payment_method, '')) IN ('donation', 'public_donation')
          OR LOWER(COALESCE(p.payment_category, '')) = 'donation'
        THEN 'Donation'
        ELSE 'Subscription'
      END AS payment_type,
      to_char(p.payment_date AT TIME ZONE $2, 'Mon YYYY') AS month_label,
      p.fund_name,
      (
        SELECT string_agg(to_char(smd.due_month, 'Mon YYYY'), ', ' ORDER BY smd.due_month)
        FROM payment_month_allocations pma
        JOIN subscription_monthly_dues smd ON smd.id = pma.due_id
        WHERE pma.payment_id = p.id
      ) AS months_covered
    FROM payments p
    JOIN churches c ON c.id = p.church_id AND c.deleted_at IS NULL
    LEFT JOIN members m ON m.id = p.member_id AND m.deleted_at IS NULL
    LEFT JOIN subscriptions s ON s.id = p.subscription_id
    WHERE ${appSuccessfulPaymentWhere("p")}
      AND p.church_id = $1
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
