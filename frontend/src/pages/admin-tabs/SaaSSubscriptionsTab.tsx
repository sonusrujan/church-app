import { useState, useEffect, useCallback } from "react";
import { BarChart3, ChevronUp } from "lucide-react";
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
  const { token, setNotice, busyKey, withAuthRequest, churches } = useApp();

  const [overview, setOverview] = useState<ChurchSubscriptionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [revenue, setRevenue] = useState<SuperAdminRevenue | null>(null);

  // Create subscription form
  const [showCreate, setShowCreate] = useState(false);
  const [createChurchId, setCreateChurchId] = useState("");
  const [createAmount, setCreateAmount] = useState("");
  const [createCycle, setCreateCycle] = useState<"monthly" | "yearly">("monthly");
  const [createStartDate, setCreateStartDate] = useState("");

  // Record payment form
  const [paySubId, setPaySubId] = useState("");
  const [payChurchId, setPayChurchId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("manual");
  const [payTxnId, setPayTxnId] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payDate, setPayDate] = useState("");
  const [showPayForm, setShowPayForm] = useState<string | null>(null);  // church_id of expanded row

  const loadOverview = useCallback(async () => {
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
  }, [filter, token, setNotice]);

  const loadRevenue = useCallback(async () => {
    try {
      const data = await apiRequest<SuperAdminRevenue>("/api/saas/revenue", { token });
      setRevenue(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.loadRevenueFailed") });
    }
  }, [token, setNotice]);

  useEffect(() => { void loadOverview(); void loadRevenue(); }, [loadOverview, loadRevenue]);

  async function createSubscription() {
    if (!createChurchId) { setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.errorSelectChurch") }); return; }
    const amount = Number(createAmount);
    if (!amount || amount < 200) { setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.errorMinAmount") }); return; }
    const result = await withAuthRequest("saas-create-sub", () =>
      apiRequest("/api/saas/subscription", {
        method: "POST", token,
        body: {
          church_id: createChurchId,
          amount,
          billing_cycle: createCycle,
          start_date: createStartDate || undefined,
        },
      }),
      t("adminTabs.saasSubscriptions.successCreated"),
    );
    if (result) {
      setCreateChurchId(""); setCreateAmount(""); setCreateCycle("monthly"); setCreateStartDate("");
      setShowCreate(false);
      void loadOverview(); void loadRevenue();
    }
  }

  async function recordPayment(s: ChurchSubscriptionSummary) {
    const amount = Number(payAmount);
    if (!amount || amount < 1) { setNotice({ tone: "error", text: t("adminTabs.saasSubscriptions.errorValidAmount") }); return; }
    const result = await withAuthRequest("saas-record-pay", () =>
      apiRequest("/api/saas/payment", {
        method: "POST", token,
        body: {
          church_subscription_id: paySubId || s.church_id,
          church_id: payChurchId || s.church_id,
          amount,
          payment_method: payMethod,
          transaction_id: payTxnId || undefined,
          note: payNote || undefined,
          payment_date: payDate || undefined,
        },
      }),
      t("adminTabs.saasSubscriptions.successPaymentRecorded"),
    );
    if (result) {
      setPayAmount(""); setPayMethod("manual"); setPayTxnId(""); setPayNote(""); setPayDate(""); setPaySubId(""); setPayChurchId("");
      setShowPayForm(null);
      void loadOverview(); void loadRevenue();
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
        <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)} style={{ marginLeft: "auto" }}>
          {showCreate ? <><ChevronUp size={14} /> {t("adminTabs.saasSubscriptions.hideButton")}</> : t("adminTabs.saasSubscriptions.newSubscriptionButton")}
        </button>
      </div>

      {/* Create new church subscription */}
      {showCreate && (
        <div style={{ background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "1rem", marginBottom: "1.25rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("adminTabs.saasSubscriptions.createTitle")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.5rem" }}>
            <label>{t("admin.church")} *
              <select value={createChurchId} onChange={(e) => setCreateChurchId(e.target.value)}>
                <option value="">{t("adminTabs.saasSubscriptions.selectChurchPlaceholder")}</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>{t("adminTabs.saasSubscriptions.amountLabel")}
              <input type="number" min="200" value={createAmount} onChange={(e) => setCreateAmount(e.target.value)} />
            </label>
            <label>{t("adminTabs.saasSubscriptions.billingCycleLabel")}
              <select value={createCycle} onChange={(e) => setCreateCycle(e.target.value as "monthly" | "yearly")}>
                <option value="monthly">{t("adminTabs.saasSubscriptions.billingMonthly")}</option>
                <option value="yearly">{t("adminTabs.saasSubscriptions.billingYearly")}</option>
              </select>
            </label>
            <label>{t("adminTabs.saasSubscriptions.startDateLabel")}
              <input type="date" value={createStartDate} onChange={(e) => setCreateStartDate(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" style={{ marginTop: "0.75rem" }} onClick={() => void createSubscription()} disabled={busyKey === "saas-create-sub"}>
            {busyKey === "saas-create-sub" ? t("adminTabs.saasSubscriptions.creating") : t("adminTabs.saasSubscriptions.createSubscriptionButton")}
          </button>
        </div>
      )}

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
            <div key={s.church_id} style={{ borderBottom: "1px solid var(--border-color, #eee)", paddingBottom: "0.5rem", marginBottom: "0.5rem" }}>
              <div className="list-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0" }}>
                <div>
                  <strong>{s.church_name}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>{formatAmount(s.amount)}{t("adminTabs.saasSubscriptions.perMonth")}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {s.next_payment_date ? <span className="muted" style={{ fontSize: "0.8rem" }}>{t("adminTabs.saasSubscriptions.nextPayment")} {formatDate(s.next_payment_date)}</span> : null}
                  <span className={`event-badge ${s.status === "active" ? "badge-created" : s.status === "overdue" ? "badge-overdue" : "badge-system"}`}>{s.status}</span>
                  {s.inactive_days != null && s.inactive_days > 0 ? (
                    <span className="muted" style={{ fontSize: "0.75rem" }}>({t("adminTabs.saasSubscriptions.daysInactive", { count: s.inactive_days })})</span>
                  ) : null}
                  <button className="btn btn-sm" onClick={() => {
                    setShowPayForm(showPayForm === s.church_id ? null : s.church_id);
                    setPayChurchId(s.church_id);
                    setPaySubId("");
                    setPayAmount(String(s.amount || ""));
                    setPayMethod("manual");
                    setPayTxnId(""); setPayNote(""); setPayDate("");
                  }}>
                    {showPayForm === s.church_id ? <ChevronUp size={12} /> : t("adminTabs.saasSubscriptions.recordPaymentButton")}
                  </button>
                </div>
              </div>
              {showPayForm === s.church_id && (
                <div style={{ background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "0.75rem", marginTop: "0.25rem" }}>
                  <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("adminTabs.saasSubscriptions.recordPaymentTitle", { church: s.church_name })}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.4rem" }}>
                    <label>{t("adminTabs.saasSubscriptions.paymentAmountLabel")}
                      <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                    </label>
                    <label>{t("adminTabs.saasSubscriptions.paymentMethodLabel")}
                      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                        <option value="manual">{t("adminTabs.saasSubscriptions.methodManual")}</option>
                        <option value="bank_transfer">{t("adminTabs.saasSubscriptions.methodBankTransfer")}</option>
                        <option value="upi">{t("adminTabs.saasSubscriptions.methodUpi")}</option>
                        <option value="cheque">{t("adminTabs.saasSubscriptions.methodCheque")}</option>
                        <option value="razorpay">{t("adminTabs.saasSubscriptions.methodRazorpay")}</option>
                      </select>
                    </label>
                    <label>{t("adminTabs.saasSubscriptions.transactionIdLabel")}
                      <input value={payTxnId} onChange={(e) => setPayTxnId(e.target.value)} placeholder={t("adminTabs.saasSubscriptions.transactionIdPlaceholder")} />
                    </label>
                    <label>{t("adminTabs.saasSubscriptions.paymentDateLabel")}
                      <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>{t("adminTabs.saasSubscriptions.noteLabel")}
                      <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder={t("adminTabs.saasSubscriptions.notePlaceholder")} />
                    </label>
                  </div>
                  <div className="actions-row" style={{ marginTop: "0.5rem", gap: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => void recordPayment(s)} disabled={busyKey === "saas-record-pay"}>
                      {busyKey === "saas-record-pay" ? t("adminTabs.saasSubscriptions.recordingPayment") : t("adminTabs.saasSubscriptions.recordPaymentButton")}
                    </button>
                    <button className="btn btn-sm" onClick={() => setShowPayForm(null)}>{t("common.cancel")}</button>
                  </div>
                </div>
              )}
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
