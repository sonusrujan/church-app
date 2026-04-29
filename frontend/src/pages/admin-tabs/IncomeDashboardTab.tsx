import { useState, useEffect, useCallback, useRef } from "react";
import { TrendingUp, Download } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { IncomeAnalytics, IncomeAnalyticsPeriod, IncomeDetail, MonthlyTrendEntry, WeeklyIncomeEntry } from "../../types";
import { formatAmount, emptyWeeklyIncome, emptyMonthlyTrend } from "../../types";
import { useI18n } from "../../i18n";

type ReportPeriod = "daily" | "monthly" | "yearly" | "custom";
const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);
const monthNames = Array.from({ length: 12 }, (_, i) =>
  new Intl.DateTimeFormat(navigator.language, { month: "long" }).format(new Date(2000, i, 1))
);

type IncomeChartDatum = WeeklyIncomeEntry | MonthlyTrendEntry;

function IncomeBarChart({
  data,
  xKey,
  fill,
  name,
}: {
  data: IncomeChartDatum[];
  xKey: "day" | "month";
  fill: string;
  name: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const nextWidth = Math.floor(frame.getBoundingClientRect().width);
      setWidth(nextWidth > 0 ? nextWidth : 0);
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(frame);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div className="income-chart-shell" ref={frameRef}>
      {width > 0 ? (
        <BarChart data={data} width={width} height={200} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--outline-variant, #e2e8f0)" opacity={0.5} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
          <Bar dataKey="income" fill={fill} radius={[4, 4, 0, 0]} name={name} />
        </BarChart>
      ) : null}
    </div>
  );
}

const analyticsColors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2"];

type NamedAmount = { name: string; amount: number; count?: number; donors?: number };

function currencyTooltip(value: unknown, name: unknown): [string, string] {
  return [formatAmount(Number(value || 0)), String(name || "")];
}

function EmptyAnalyticsChart({ label }: { label: string }) {
  return <div className="income-analytics-empty">{label}</div>;
}

function RevenueMixDonut({ data, emptyLabel }: { data: IncomeAnalytics["revenue_mix"]; emptyLabel: string }) {
  const chartData = data.filter((row) => row.amount > 0);
  if (!chartData.length) return <EmptyAnalyticsChart label={emptyLabel} />;

  return (
    <div className="income-analytics-chart income-analytics-chart-compact">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={chartData} dataKey="amount" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={2}>
            {chartData.map((entry, index) => (
              <Cell key={entry.label} fill={analyticsColors[index % analyticsColors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={currencyTooltip} />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function AmountBarChart({
  data,
  fill,
  amountLabel,
  emptyLabel,
}: {
  data: NamedAmount[];
  fill: string;
  amountLabel: string;
  emptyLabel: string;
}) {
  const chartData = data.filter((row) => row.amount > 0 || (row.count || row.donors || 0) > 0);
  if (!chartData.length) return <EmptyAnalyticsChart label={emptyLabel} />;

  return (
    <div className="income-analytics-chart">
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--outline-variant, #e2e8f0)" opacity={0.5} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: 8, border: "1px solid var(--outline-variant)", boxShadow: "0 6px 18px rgba(15,23,42,0.12)" }} />
          <Bar dataKey="amount" fill={fill} radius={[4, 4, 0, 0]} name={amountLabel} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyGrowthLine({
  data,
  emptyLabel,
  labels,
}: {
  data: IncomeAnalytics["monthly_growth"];
  emptyLabel: string;
  labels: { subscription: string; donation: string; platformFee: string };
}) {
  const hasData = data.some((row) => row.total > 0);
  if (!hasData) return <EmptyAnalyticsChart label={emptyLabel} />;
  const showPlatformFee = data.some((row) => Number(row.platform_fee || 0) > 0);

  return (
    <div className="income-analytics-chart income-analytics-chart-wide">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--outline-variant, #e2e8f0)" opacity={0.55} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--on-surface-variant, #94a3b8)" tickLine={false} axisLine={false} />
          <Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: 8, border: "1px solid var(--outline-variant)", boxShadow: "0 6px 18px rgba(15,23,42,0.12)" }} />
          <Legend verticalAlign="bottom" height={36} iconType="line" />
          <Line type="monotone" dataKey="subscription" stroke="#2563eb" strokeWidth={2.5} dot={false} name={labels.subscription} />
          <Line type="monotone" dataKey="donation" stroke="#16a34a" strokeWidth={2.5} dot={false} name={labels.donation} />
          {showPlatformFee ? <Line type="monotone" dataKey="platform_fee" stroke="#f59e0b" strokeWidth={2.5} dot={false} name={labels.platformFee} /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function IncomeDashboardTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, setNotice, churches } = useApp();

  const [incomeDetail, setIncomeDetail] = useState<IncomeDetail | null>(null);
  const [incomeDetailLoading, setIncomeDetailLoading] = useState(false);
  const [incomeAnalytics, setIncomeAnalytics] = useState<IncomeAnalytics | null>(null);
  const [incomeAnalyticsLoading, setIncomeAnalyticsLoading] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<IncomeAnalyticsPeriod>("current_month");
  const [incomeChurchId, setIncomeChurchId] = useState("");

  /* ── Report download state ── */
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>("monthly");
  const [reportYear, setReportYear] = useState(currentYear);
  const [reportMonth, setReportMonth] = useState(currentMonth);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [downloading, setDownloading] = useState(false);

  const loadIncomeDetail = useCallback(async () => {
    if (!token) return;
    const churchId = isSuperAdmin ? incomeChurchId : (authContext?.auth.church_id || "");
    if (!churchId && !isSuperAdmin) { setIncomeDetail(null); return; }
    setIncomeDetailLoading(true);
    try {
      const query = isSuperAdmin && churchId ? `?church_id=${encodeURIComponent(churchId)}` : "";
      const data = await apiRequest<IncomeDetail>(`/api/admins/income-detail${query}`, { token });
      setIncomeDetail(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.incomeDashboard.errorLoadFailed") });
    } finally {
      setIncomeDetailLoading(false);
    }
  }, [token, setNotice, isSuperAdmin, incomeChurchId, authContext]);

  const loadIncomeAnalytics = useCallback(async () => {
    if (!token) return;
    const churchId = isSuperAdmin ? incomeChurchId : (authContext?.auth.church_id || "");
    if (!churchId && !isSuperAdmin) { setIncomeAnalytics(null); return; }
    setIncomeAnalyticsLoading(true);
    try {
      const params = new URLSearchParams({ period: analyticsPeriod });
      if (isSuperAdmin && churchId) params.set("church_id", churchId);
      const data = await apiRequest<IncomeAnalytics>(`/api/admins/income-analytics?${params.toString()}`, { token });
      setIncomeAnalytics(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.incomeDashboard.errorAnalyticsLoadFailed") });
    } finally {
      setIncomeAnalyticsLoading(false);
    }
  }, [token, setNotice, isSuperAdmin, incomeChurchId, authContext, analyticsPeriod]);

  useEffect(() => {
    void loadIncomeDetail();
  }, [loadIncomeDetail]);

  useEffect(() => {
    void loadIncomeAnalytics();
  }, [loadIncomeAnalytics]);

  const downloadReport = async () => {
    const churchId = isSuperAdmin ? incomeChurchId : (authContext?.auth.church_id || "");
    if (!churchId) { setNotice({ tone: "error", text: t("adminTabs.incomeDashboard.errorSelectChurch") }); return; }
    if (reportPeriod === "custom" && (!customStart || !customEnd)) {
      setNotice({ tone: "error", text: t("adminTabs.incomeDashboard.errorSelectDates") }); return;
    }
    setDownloading(true);
    try {
      const params = new URLSearchParams({ period: reportPeriod, church_id: churchId });
      if (reportPeriod === "monthly" || reportPeriod === "yearly") params.set("year", String(reportYear));
      if (reportPeriod === "monthly") params.set("month", String(reportMonth));
      if (reportPeriod === "custom") { params.set("start_date", customStart); params.set("end_date", customEnd); }
      const blob = await apiBlobRequest(`/api/admins/payment-report?${params}`, {
        token,
        accept: "text/csv",
      });
      const filename = `payment_report_${reportPeriod}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNotice({ tone: "success", text: t("adminTabs.incomeDashboard.successDownloaded") });
    } catch (err: unknown) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : t("adminTabs.incomeDashboard.errorDownloadFailed") });
    } finally { setDownloading(false); }
  };

  return (
    <article className="panel panel-wide">
      <h3>{t("adminTabs.incomeDashboard.title")}</h3>
      {isSuperAdmin ? (
        <div className="field-stack" style={{ marginBottom: "1.5rem" }}>
          <label>
            {t("admin.church")}
            <select value={incomeChurchId} onChange={(e) => setIncomeChurchId(e.target.value)}>
              <option value="">{t("adminTabs.incomeDashboard.allChurches")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
          {!churches.length ? <p className="muted">{t("adminTabs.incomeDashboard.loadChurchesFirst")}</p> : null}
          {!incomeChurchId ? <p className="muted">{t("adminTabs.incomeDashboard.viewingPlatformTotals")}</p> : null}
        </div>
      ) : null}
      <div className="field-stack admin-responsive-grid" style={{ marginBottom: "1.5rem" }}>
        <label>
          {t("adminTabs.incomeDashboard.analyticsPeriodLabel")}
          <select value={analyticsPeriod} onChange={(e) => setAnalyticsPeriod(e.target.value as IncomeAnalyticsPeriod)}>
            <option value="current_month">{t("adminTabs.incomeDashboard.analyticsPeriodCurrentMonth")}</option>
            <option value="year_to_date">{t("adminTabs.incomeDashboard.analyticsPeriodYearToDate")}</option>
            <option value="last_12_months">{t("adminTabs.incomeDashboard.analyticsPeriodLast12Months")}</option>
          </select>
        </label>
      </div>
      {incomeDetailLoading && !incomeDetail ? (
        <LoadingSkeleton lines={8} />
      ) : incomeDetail ? (
        <>
          {/* ── Total Summary ── */}
          <div className="stats-grid" style={{ marginBottom: "2rem" }}>
            <div className="stat-card">
              <div className="stat-label">{t("adminTabs.incomeDashboard.todayLabel")}</div>
              <div className="stat-value">{formatAmount(incomeDetail.total_income.daily)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t("adminTabs.incomeDashboard.thisMonthLabel")}</div>
              <div className="stat-value">{formatAmount(incomeDetail.total_income.monthly)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t("adminTabs.incomeDashboard.thisYearLabel")}</div>
              <div className="stat-value">{formatAmount(incomeDetail.total_income.yearly)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t("adminTabs.incomeDashboard.totalPaymentsLabel")}</div>
              <div className="stat-value">{incomeDetail.total_income.count}</div>
            </div>
          </div>

          {/* ── Subscription Income ── */}
          <div className="income-dashboard-sections">
            <div className="income-dashboard-section">
              <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.incomeDashboard.subscriptionIncomeTitle")}</h4>
              <div className="stats-grid">
                <div className="stat"><span>{t("adminTabs.incomeDashboard.dailyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.daily)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.monthlyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.monthly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.yearlyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.yearly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.paymentsLabel")}</span><strong>{incomeDetail.subscription_income.count}</strong></div>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.75rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.thisWeekSubscriptions")}</p>
              <IncomeBarChart
                data={incomeDetail.subscription_income.weekly.length ? incomeDetail.subscription_income.weekly : emptyWeeklyIncome}
                xKey="day"
                fill="var(--accent, #0071e3)"
                name={t("adminTabs.incomeDashboard.chartSubscriptions")}
              />
              <p className="muted" style={{ fontSize: "0.85rem", margin: "1rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.monthlyTrendSubscriptions")}</p>
              <IncomeBarChart
                data={incomeDetail.subscription_income.monthly_trend.length ? incomeDetail.subscription_income.monthly_trend : emptyMonthlyTrend}
                xKey="month"
                fill="var(--accent, #0071e3)"
                name={t("adminTabs.incomeDashboard.chartSubscriptions")}
              />
            </div>

            {/* ── Donation Income ── */}
            <div className="income-dashboard-section">
              <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.incomeDashboard.donationIncomeTitle")}</h4>
              <div className="stats-grid">
                <div className="stat"><span>{t("adminTabs.incomeDashboard.dailyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.daily)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.monthlyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.monthly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.yearlyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.yearly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.donationsLabel")}</span><strong>{incomeDetail.donation_income.count}</strong></div>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.75rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.thisWeekDonations")}</p>
              <IncomeBarChart
                data={incomeDetail.donation_income.weekly.length ? incomeDetail.donation_income.weekly : emptyWeeklyIncome}
                xKey="day"
                fill="var(--color-secondary, #8b5cf6)"
                name={t("adminTabs.incomeDashboard.chartDonations")}
              />
              <p className="muted" style={{ fontSize: "0.85rem", margin: "1rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.monthlyTrendDonations")}</p>
              <IncomeBarChart
                data={incomeDetail.donation_income.monthly_trend.length ? incomeDetail.donation_income.monthly_trend : emptyMonthlyTrend}
                xKey="month"
                fill="var(--color-secondary, #8b5cf6)"
                name={t("adminTabs.incomeDashboard.chartDonations")}
              />
            </div>
          </div>

          {incomeAnalyticsLoading && !incomeAnalytics ? (
            <div style={{ marginTop: "2rem" }}>
              <LoadingSkeleton lines={6} />
            </div>
          ) : incomeAnalytics ? (
            <section className="income-analytics-section">
              <div className="income-analytics-header">
                <div>
                  <h4>{t("adminTabs.incomeDashboard.advancedAnalyticsTitle")}</h4>
                  <p className="muted">{t("adminTabs.incomeDashboard.advancedAnalyticsSubtitle")}</p>
                </div>
                <span className="badge badge-info">
                  {incomeAnalytics.scope === "platform"
                    ? t("adminTabs.incomeDashboard.platformScope")
                    : t("adminTabs.incomeDashboard.churchScope")}
                </span>
              </div>

              <div className="income-analytics-grid">
                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.revenueMixTitle")}</h5>
                  <RevenueMixDonut data={incomeAnalytics.revenue_mix} emptyLabel={t("adminTabs.incomeDashboard.noChartData")} />
                  <div className="income-analytics-list">
                    {incomeAnalytics.revenue_mix.map((row, index) => (
                      <div key={row.label} className="income-analytics-list-row">
                        <span><i style={{ background: analyticsColors[index % analyticsColors.length] }} />{row.label}</span>
                        <strong>{formatAmount(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.collectionRateTitle")}</h5>
                  <div className="income-rate-value">{incomeAnalytics.collection_rate.collection_rate}%</div>
                  <div className="income-rate-meter">
                    <span style={{ width: `${Math.min(100, Math.max(0, incomeAnalytics.collection_rate.collection_rate))}%` }} />
                  </div>
                  <div className="income-mini-stats">
                    <div><span>{t("adminTabs.incomeDashboard.expectedLabel")}</span><strong>{formatAmount(incomeAnalytics.collection_rate.expected)}</strong></div>
                    <div><span>{t("adminTabs.incomeDashboard.collectedLabel")}</span><strong>{formatAmount(incomeAnalytics.collection_rate.collected)}</strong></div>
                    <div><span>{t("adminTabs.incomeDashboard.overdueLabel")}</span><strong>{formatAmount(incomeAnalytics.collection_rate.overdue)}</strong></div>
                    <div><span>{t("adminTabs.incomeDashboard.pendingLabel")}</span><strong>{formatAmount(incomeAnalytics.collection_rate.pending)}</strong></div>
                  </div>
                </div>

                <div className="income-analytics-card income-analytics-card-wide">
                  <h5>{t("adminTabs.incomeDashboard.monthlyGrowthTitle")}</h5>
                  <MonthlyGrowthLine
                    data={incomeAnalytics.monthly_growth}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                    labels={{
                      subscription: t("adminTabs.incomeDashboard.chartSubscriptions"),
                      donation: t("adminTabs.incomeDashboard.chartDonations"),
                      platformFee: t("adminTabs.incomeDashboard.platformFeeLabel"),
                    }}
                  />
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.agingLedgerTitle")}</h5>
                  <AmountBarChart
                    data={incomeAnalytics.aging_ledger.map((row) => ({ name: row.bucket, amount: row.amount, count: row.count }))}
                    fill="#dc2626"
                    amountLabel={t("adminTabs.incomeDashboard.overdueLabel")}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                  />
                  <div className="income-analytics-list">
                    {incomeAnalytics.aging_ledger.map((row) => (
                      <div key={row.bucket} className="income-analytics-list-row">
                        <span>{row.bucket}</span>
                        <strong>{formatAmount(row.amount)} · {row.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.donationFundsTitle")}</h5>
                  <AmountBarChart
                    data={incomeAnalytics.donation_funds.map((row) => ({ name: row.fund, amount: row.amount, count: row.count }))}
                    fill="#16a34a"
                    amountLabel={t("adminTabs.incomeDashboard.chartDonations")}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                  />
                  <div className="income-analytics-list">
                    {incomeAnalytics.donation_funds.map((row) => (
                      <div key={row.fund} className="income-analytics-list-row">
                        <span>{row.fund}</span>
                        <strong>{formatAmount(row.amount)} · {row.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.paymentMethodsTitle")}</h5>
                  <AmountBarChart
                    data={incomeAnalytics.payment_methods.map((row) => ({ name: row.method, amount: row.amount, count: row.count }))}
                    fill="#0891b2"
                    amountLabel={t("adminTabs.incomeDashboard.amountLabel")}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                  />
                  <div className="income-analytics-list">
                    {incomeAnalytics.payment_methods.map((row) => (
                      <div key={row.method} className="income-analytics-list-row">
                        <span>{row.method}</span>
                        <strong>{formatAmount(row.amount)} · {row.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.paymentFunnelTitle")}</h5>
                  <AmountBarChart
                    data={incomeAnalytics.payment_funnel.map((row) => ({ name: row.stage, amount: row.amount, count: row.count }))}
                    fill="#7c3aed"
                    amountLabel={t("adminTabs.incomeDashboard.amountLabel")}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                  />
                  <div className="income-analytics-list">
                    {incomeAnalytics.payment_funnel.map((row) => (
                      <div key={row.stage} className="income-analytics-list-row">
                        <span>{row.stage}</span>
                        <strong>{row.count} · {formatAmount(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="income-analytics-card">
                  <h5>{t("adminTabs.incomeDashboard.donorBandsTitle")}</h5>
                  <AmountBarChart
                    data={incomeAnalytics.donor_bands.map((row) => ({ name: row.band, amount: row.amount, donors: row.donors }))}
                    fill="#f59e0b"
                    amountLabel={t("adminTabs.incomeDashboard.amountLabel")}
                    emptyLabel={t("adminTabs.incomeDashboard.noChartData")}
                  />
                  <div className="income-analytics-list">
                    {incomeAnalytics.donor_bands.map((row) => (
                      <div key={row.band} className="income-analytics-list-row">
                        <span>{row.band}</span>
                        <strong>{row.donors} · {formatAmount(row.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <div className="actions-row">
            <button className="btn" onClick={() => { void loadIncomeDetail(); void loadIncomeAnalytics(); }} disabled={incomeDetailLoading || incomeAnalyticsLoading}>
              {incomeDetailLoading || incomeAnalyticsLoading ? t("adminTabs.incomeDashboard.refreshing") : t("adminTabs.incomeDashboard.refreshIncomeData")}
            </button>
          </div>

          {/* ── Payment Report Download ── */}
          <div style={{ marginTop: "2.5rem", borderTop: "1px solid var(--border, #e2e8f0)", paddingTop: "2rem" }}>
            <h4 style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <Download size={18} /> {t("adminTabs.incomeDashboard.downloadPaymentReport")}
            </h4>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
              {t("adminTabs.incomeDashboard.reportDescription")}
            </p>

            <div className="field-stack admin-responsive-grid" style={{ marginBottom: "1rem" }}>
              <label>
                {t("adminTabs.incomeDashboard.reportPeriodLabel")}
                <select value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value as ReportPeriod)}>
                  <option value="daily">{t("adminTabs.incomeDashboard.reportPeriodToday")}</option>
                  <option value="monthly">{t("adminTabs.incomeDashboard.reportPeriodMonthly")}</option>
                  <option value="yearly">{t("adminTabs.incomeDashboard.reportPeriodYearly")}</option>
                  <option value="custom">{t("adminTabs.incomeDashboard.reportPeriodCustom")}</option>
                </select>
              </label>

              {(reportPeriod === "monthly" || reportPeriod === "yearly") && (
                <label>
                  {t("adminTabs.incomeDashboard.yearLabel")}
                  <select value={reportYear} onChange={(e) => setReportYear(Number(e.target.value))}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </label>
              )}

              {reportPeriod === "monthly" && (
                <label>
                  {t("adminTabs.incomeDashboard.monthLabel")}
                  <select value={reportMonth} onChange={(e) => setReportMonth(Number(e.target.value))}>
                    {monthNames.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
                  </select>
                </label>
              )}

              {reportPeriod === "custom" && (
                <>
                  <label>
                    {t("adminTabs.incomeDashboard.startDateLabel")}
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                  </label>
                  <label>
                    {t("adminTabs.incomeDashboard.endDateLabel")}
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                  </label>
                </>
              )}
            </div>

            <p className="muted" style={{ fontSize: "0.8rem", marginBottom: "1rem" }}>
              {reportPeriod === "daily" && t("adminTabs.incomeDashboard.reportPreviewToday")}
              {reportPeriod === "monthly" && t("adminTabs.incomeDashboard.reportPreviewMonthly", { month: monthNames[reportMonth - 1], year: reportYear })}
              {reportPeriod === "yearly" && t("adminTabs.incomeDashboard.reportPreviewYearly", { year: reportYear })}
              {reportPeriod === "custom" && customStart && customEnd && t("adminTabs.incomeDashboard.reportPreviewCustom", { start: customStart, end: customEnd })}
              {reportPeriod === "custom" && (!customStart || !customEnd) && t("adminTabs.incomeDashboard.reportPreviewSelectDates")}
            </p>

            <button className="btn" onClick={() => void downloadReport()} disabled={downloading} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
              <Download size={16} />
              {downloading ? t("adminTabs.incomeDashboard.generatingReport") : t("adminTabs.incomeDashboard.downloadReportCsv")}
            </button>
          </div>
        </>
      ) : (
        <EmptyState icon={<TrendingUp size={32} />} title={t("adminTabs.incomeDashboard.emptyTitle")} description={isSuperAdmin ? t("adminTabs.incomeDashboard.emptyDescSuperAdmin") : t("adminTabs.incomeDashboard.emptyDescAdmin")} />
      )}
    </article>
  );
}
