import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Download } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { IncomeDetail } from "../../types";
import { formatAmount, emptyWeeklyIncome, emptyMonthlyTrend } from "../../types";
import { useI18n } from "../../i18n";

type ReportPeriod = "daily" | "monthly" | "yearly" | "custom";
const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function IncomeDashboardTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, setNotice, churches } = useApp();

  const [incomeDetail, setIncomeDetail] = useState<IncomeDetail | null>(null);
  const [incomeDetailLoading, setIncomeDetailLoading] = useState(false);
  const [incomeChurchId, setIncomeChurchId] = useState(churches[0]?.id || "");

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
    if (!churchId) { setIncomeDetail(null); return; }
    setIncomeDetailLoading(true);
    try {
      const query = isSuperAdmin ? `?church_id=${encodeURIComponent(churchId)}` : "";
      const data = await apiRequest<IncomeDetail>(`/api/admins/income-detail${query}`, { token });
      setIncomeDetail(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.incomeDashboard.errorLoadFailed") });
    } finally {
      setIncomeDetailLoading(false);
    }
  }, [token, setNotice, isSuperAdmin, incomeChurchId, authContext]);

  useEffect(() => {
    void loadIncomeDetail();
  }, [loadIncomeDetail]);

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
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        </div>
      ) : null}
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "2rem", marginBottom: "2rem" }}>
            <div>
              <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.incomeDashboard.subscriptionIncomeTitle")}</h4>
              <div className="stats-grid">
                <div className="stat"><span>{t("adminTabs.incomeDashboard.dailyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.daily)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.monthlyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.monthly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.yearlyLabel")}</span><strong>{formatAmount(incomeDetail.subscription_income.yearly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.paymentsLabel")}</span><strong>{incomeDetail.subscription_income.count}</strong></div>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.75rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.thisWeekSubscriptions")}</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={incomeDetail.subscription_income.weekly.length ? incomeDetail.subscription_income.weekly : emptyWeeklyIncome} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="income" fill="var(--accent, #0071e3)" radius={[4, 4, 0, 0]} name={t("adminTabs.incomeDashboard.chartSubscriptions")} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "1rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.monthlyTrendSubscriptions")}</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={incomeDetail.subscription_income.monthly_trend.length ? incomeDetail.subscription_income.monthly_trend : emptyMonthlyTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="income" fill="var(--accent, #0071e3)" radius={[4, 4, 0, 0]} name="Subscriptions" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Donation Income ── */}
            <div>
              <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.incomeDashboard.donationIncomeTitle")}</h4>
              <div className="stats-grid">
                <div className="stat"><span>{t("adminTabs.incomeDashboard.dailyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.daily)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.monthlyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.monthly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.yearlyLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.yearly)}</strong></div>
                <div className="stat"><span>{t("adminTabs.incomeDashboard.donationsLabel")}</span><strong>{formatAmount(incomeDetail.donation_income.count)}</strong></div>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "0.75rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.thisWeekDonations")}</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={incomeDetail.donation_income.weekly.length ? incomeDetail.donation_income.weekly : emptyWeeklyIncome} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="income" fill="#8b5cf6" radius={[4, 4, 0, 0]} name={t("adminTabs.incomeDashboard.chartDonations")} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "1rem 0 0.25rem" }}>{t("adminTabs.incomeDashboard.monthlyTrendDonations")}</p>
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <BarChart data={incomeDetail.donation_income.monthly_trend.length ? incomeDetail.donation_income.monthly_trend : emptyMonthlyTrend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "none", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)" }} />
                    <Bar dataKey="income" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Donations" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="actions-row">
            <button className="btn" onClick={() => void loadIncomeDetail()} disabled={incomeDetailLoading}>
              {incomeDetailLoading ? t("adminTabs.incomeDashboard.refreshing") : t("adminTabs.incomeDashboard.refreshIncomeData")}
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

            <div className="field-stack" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
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
              {reportPeriod === "daily" && "Report for today's payments."}
              {reportPeriod === "monthly" && `Report for ${monthNames[reportMonth - 1]} ${reportYear}.`}
              {reportPeriod === "yearly" && `Full year report for ${reportYear} — includes monthly breakdown.`}
              {reportPeriod === "custom" && customStart && customEnd && `Report from ${customStart} to ${customEnd}.`}
              {reportPeriod === "custom" && (!customStart || !customEnd) && "Select start and end dates."}
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
