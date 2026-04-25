import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { ChurchSubscriptionSummary, SuperAdminRevenue } from "../../types";
import { formatAmount, formatDate } from "../../types";

export default function SaaSSubscriptionsTab() {
  const { t } = useI18n();
  const { token, setNotice } = useApp();

  const [overview, setOverview] = useState<ChurchSubscriptionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [revenue, setRevenue] = useState<SuperAdminRevenue | null>(null);

  async function loadOverview() {
    setLoading(true);
    try {
      const filterParam = filter !== "all" ? `?filter=${filter}` : "";
      const data = await apiRequest<ChurchSubscriptionSummary[]>(`/api/saas/overview${filterParam}`, { token });
      setOverview(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.loadOverviewFailed") });
    } finally {
      setLoading(false);
    }
  }

  async function loadRevenue() {
    try {
      const data = await apiRequest<SuperAdminRevenue>("/api/saas/revenue", { token });
      setRevenue(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.loadRevenueFailed") });
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.saasSubscriptions.title")}</h3>
      <p className="muted">{t("adminTabs.saasSubscriptions.description")}</p>

      <div className="actions-row" style={{ marginBottom: "1rem", gap: 8 }}>
        <button className="btn" onClick={() => { void loadOverview(); void loadRevenue(); }} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "active" | "inactive")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border-color, #ddd)" }}>
          <option value="all">{t("adminTabs.saasSubscriptions.filterAll")}</option>
          <option value="active">{t("adminTabs.saasSubscriptions.filterActive")}</option>
          <option value="inactive">{t("adminTabs.saasSubscriptions.filterInactive")}</option>
        </select>
      </div>
      {revenue ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: "1.5rem" }}>
          <div className="stat-card" style={{ background: "var(--color-success-bg, #f0fdf4)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>{t("adminTabs.saasSubscriptions.churchSubRevenue")}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-success, #16a34a)" }}>{formatAmount(revenue.church_subscription_revenue)}</p>
          </div>
          <div className="stat-card" style={{ background: "var(--color-info-bg, #eff6ff)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>{t("adminTabs.saasSubscriptions.platformFeeRevenue")}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-info, #2563eb)" }}>{formatAmount(revenue.platform_fee_revenue)}</p>
          </div>
          <div className="stat-card" style={{ background: "var(--color-warning-bg, #fffbeb)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>{t("adminTabs.saasSubscriptions.totalRevenue")}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--color-warning, #d97706)" }}>{formatAmount(revenue.total_revenue)}</p>
          </div>
          <div className="stat-card" style={{ background: "var(--color-primary-bg, #f0f4ff)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: 4 }}>{t("adminTabs.saasSubscriptions.activeInactive")}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              <span style={{ color: "var(--color-success, #16a34a)" }}>{revenue.active_church_subscriptions}</span>
              {" / "}
              <span style={{ color: "var(--color-error, #dc2626)" }}>{revenue.inactive_church_subscriptions}</span>
            </p>
          </div>
        </div>
      ) : null}
      {loading ? (
        <LoadingSkeleton lines={5} />
      ) : overview.length ? (
        <>
          {paginate(overview, page, 10).map((s) => (
            <div key={s.church_id} className="list-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div>
                <strong>{s.church_name}</strong>
                <span className="muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>{formatAmount(s.amount)}{t("adminTabs.saasSubscriptions.perMonth")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {s.next_payment_date ? <span className="muted" style={{ fontSize: "0.8rem" }}>{t("adminTabs.saasSubscriptions.nextPayment")} {formatDate(s.next_payment_date)}</span> : null}
                <span className={`event-badge ${s.status === "active" ? "badge-created" : s.status === "overdue" ? "badge-overdue" : "badge-system"}`}>{s.status}</span>
                {s.inactive_days != null && s.inactive_days > 0 ? (
                  <span className="muted" style={{ fontSize: "0.75rem" }}>({t("adminTabs.saasSubscriptions.daysInactive", { count: s.inactive_days })})</span>
                ) : null}
              </div>
            </div>
          ))}
          <Pagination page={page} total={totalPages(overview.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<BarChart3 size={32} />} title={t("adminTabs.saasSubscriptions.emptyTitle")} description={t("adminTabs.saasSubscriptions.emptyDescription")} />
      )}
    </article>
  );
}
