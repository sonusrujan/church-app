import { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Download, ChevronLeft, ChevronRight, Receipt, RotateCcw, AlertTriangle, UserRound } from "lucide-react";
import { useApp } from "../context/AppContext";
import { apiRequest, apiBlobRequest } from "../lib/api";
import { formatAmount, formatDate, type MonthlyPaymentHistoryRow } from "../types";
import LoadingSkeleton from "../components/LoadingSkeleton";
import { useI18n } from "../i18n";

const PAGE_SIZE = 10;

function monthYearLabel(monthIso?: string | null) {
  if (!monthIso) return "-";
  const d = new Date(monthIso);
  if (Number.isNaN(d.getTime())) return monthIso;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function HistoryPage() {
  const { token, isSuperAdmin, memberDashboard, setNotice, withAuthRequest } = useApp();
  const { t } = useI18n();

  const [rows, setRows] = useState<MonthlyPaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [selectedPersonKey, setSelectedPersonKey] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "subscription" | "donation">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending">("all");

  const personOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [{ value: "all", label: t("historyPage.allFamilyMembers") }];
    const selfName = memberDashboard?.member?.full_name?.trim();
    if (selfName) out.push({ value: "self", label: selfName });
    for (const fm of memberDashboard?.family_members || []) {
      if (fm.full_name?.trim()) out.push({ value: `family:${fm.id}`, label: fm.full_name.trim() });
    }
    const seen = new Set<string>();
    return out.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [memberDashboard?.member?.full_name, memberDashboard?.family_members, t]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (typeFilter !== "all" && row.kind !== typeFilter) return false;
      const paid = row.due_status === "paid" || row.due_status === "imported_paid";
      if (statusFilter === "paid" && !paid) return false;
      if (statusFilter === "pending" && paid) return false;
      return true;
    });
  }, [rows, typeFilter, statusFilter]);

  const ledgerTotals = useMemo(() => {
    return visibleRows.reduce(
      (acc, row) => {
        const paid = row.due_status === "paid" || row.due_status === "imported_paid";
        if (paid) {
          acc.paid += Number(row.paid_amount || 0);
        } else {
          acc.pending += Number(row.paid_amount || 0);
        }
        return acc;
      },
      { paid: 0, pending: 0 },
    );
  }, [visibleRows]);

  useEffect(() => {
    setPage(1);
  }, [selectedPersonKey, typeFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) return;
      setLoading(true);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const query = new URLSearchParams({
          limit: String(PAGE_SIZE + 1),
          offset: String(offset),
          from_date: "2025-01-01",
        });
        if (selectedPersonKey && selectedPersonKey !== "all") {
          query.set("person_key", selectedPersonKey);
        }
        const data = await apiRequest<MonthlyPaymentHistoryRow[]>(`/api/payments/my-monthly-history?${query.toString()}`, { token });
        if (cancelled) return;
        setRows(data.slice(0, PAGE_SIZE));
        setHasMore(data.length > PAGE_SIZE);
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : t("historyPage.errorLoadFailed");
        setNotice({ tone: "error", text: message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, page, selectedPersonKey, setNotice, t]);

  async function downloadReceipt(row: MonthlyPaymentHistoryRow) {
    const pid = row.payment_id;
    if (!token || !pid || downloadingIds.has(pid)) return;
    setDownloadingIds((prev) => new Set(prev).add(pid));
    try {
      const blob = await apiBlobRequest(`/api/payments/${pid}/receipt`, { token });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${row.receipt_number || pid.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setFailedIds((prev) => new Set(prev).add(pid));
      const message = err instanceof Error ? err.message : t("historyPage.errorDownloadReceiptFailed");
      setNotice({ tone: "error", text: message });
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    }
  }

  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportText, setReportText] = useState("");

  async function submitReport(row: MonthlyPaymentHistoryRow) {
    if (!reportText.trim() || !row.payment_id) return;
    await withAuthRequest(
      "report-issue",
      () => apiRequest("/api/ops/refund-requests", {
        method: "POST",
        token,
        body: { payment_id: row.payment_id, reason: reportText.trim(), amount: row.paid_amount },
      }),
      t("historyPage.reportSubmitted"),
    );
    setReportingId(null);
    setReportText("");
  }

  if (isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="history-page">
      <div className="history-header">
        <h1 className="history-title">{t("historyPage.title")}</h1>
        <p className="history-subtitle">{t("historyPage.subtitle")}</p>
      </div>

      <div className="history-stats-grid">
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("historyPage.ledgerRows")}</span>
            <Receipt className="history-stat-icon history-stat-icon--success" size={18} />
          </div>
          <span className="history-stat-value">{visibleRows.length}</span>
          <span className="history-stat-sub">{t("historyPage.filteredEntries")}</span>
        </div>
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("historyPage.paid")}</span>
            <Download className="history-stat-icon history-stat-icon--success" size={18} />
          </div>
          <span className="history-stat-value">{formatAmount(ledgerTotals.paid)}</span>
          <span className="history-stat-sub history-stat-sub--success">{t("historyPage.receiptsAvailable")}</span>
        </div>
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("historyPage.pending")}</span>
            <AlertTriangle className="history-stat-icon history-stat-icon--warning" size={18} />
          </div>
          <span className="history-stat-value">{formatAmount(ledgerTotals.pending)}</span>
          <span className="history-stat-sub">{t("historyPage.openDues")}</span>
        </div>
      </div>

      <div className="history-table-container">
        <div className="history-section-header">
          <h2>{t("historyPage.ledger")}</h2>
        </div>
        <div className="history-filters">
          <label className="history-filter-select">
            <span style={{ fontWeight: 600 }}>{t("historyPage.selectPerson")}</span>
            <select
              value={selectedPersonKey}
              onChange={(e) => setSelectedPersonKey(e.target.value)}
            >
              {personOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <div className="history-filter-tabs" aria-label={t("historyPage.entryType")}>
            <button className={`history-filter-btn${typeFilter === "all" ? " active" : ""}`} onClick={() => setTypeFilter("all")} type="button">{t("historyPage.filterAll")}</button>
            <button className={`history-filter-btn${typeFilter === "subscription" ? " active" : ""}`} onClick={() => setTypeFilter("subscription")} type="button">{t("historyPage.filterDues")}</button>
            <button className={`history-filter-btn${typeFilter === "donation" ? " active" : ""}`} onClick={() => setTypeFilter("donation")} type="button">{t("historyPage.filterDonations")}</button>
          </div>
          <div className="history-filter-tabs" aria-label={t("historyPage.paymentStatus")}>
            <button className={`history-filter-btn${statusFilter === "all" ? " active" : ""}`} onClick={() => setStatusFilter("all")} type="button">{t("historyPage.filterAllStatus")}</button>
            <button className={`history-filter-btn${statusFilter === "paid" ? " active" : ""}`} onClick={() => setStatusFilter("paid")} type="button">{t("historyPage.filterPaid")}</button>
            <button className={`history-filter-btn${statusFilter === "pending" ? " active" : ""}`} onClick={() => setStatusFilter("pending")} type="button">{t("historyPage.filterUnpaid")}</button>
          </div>
        </div>

        {loading ? (
          <LoadingSkeleton lines={6} />
        ) : visibleRows.length ? (
          <div className="history-table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>{t("historyPage.entry")}</th>
                  <th>{t("historyPage.monthAndYear")}</th>
                  <th>{t("historyPage.status")}</th>
                  <th>{t("historyPage.paidAmount")}</th>
                  <th>{t("historyPage.paidBy")}</th>
                  <th>{t("historyPage.paidDate")}</th>
                  <th>{t("historyPage.receipt")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const isPaid = row.due_status === "paid";
                  const isImported = row.due_status === "imported_paid";
                  const isPending = !isPaid && !isImported;
                  const isDonation = row.kind === "donation";
                  return (
                  <tr key={row.id} className={`history-row ${isPending ? "history-row-pending" : ""}`}>
                    <td>
                      <div className="history-cell-desc">
                        <span className={`history-cell-icon ${isDonation ? "history-cell-icon--donation" : "history-cell-icon--sub"}`}>
                          {isDonation ? <Receipt size={16} /> : <UserRound size={16} />}
                        </span>
                        <div>
                          <span className="history-cell-title">{isDonation ? row.fund_name || t("historyPage.donationLabel") : row.person_name || t("common.member")}</span>
                          <span className="history-cell-receipt-no">{row.receipt_number || (isDonation ? t("historyPage.donationLabel") : t("historyPage.subscriptionDue"))}</span>
                        </div>
                      </div>
                    </td>
                    <td className="history-cell-date">
                      {monthYearLabel(row.month_year)}
                    </td>
                    <td>
                      <span className={`history-status-badge ${isPaid ? "history-status--paid" : isImported ? "history-status--paid" : "history-status--pending"}`}>
                        {isDonation ? t("historyPage.statusDonation") : isPaid ? t("historyPage.statusPaid") : isImported ? t("historyPage.statusImported") : t("historyPage.statusUnpaid")}
                      </span>
                    </td>
                    <td className="history-cell-amount">{isPending ? "-" : formatAmount(row.paid_amount)}</td>
                    <td>{row.person_name || t("common.member")}</td>
                    <td>{row.paid_date ? formatDate(row.paid_date) : "-"}</td>
                    <td className="history-cell-action">
                      {isPaid && row.payment_id ? (
                        failedIds.has(row.payment_id) ? (
                        <button
                          className="history-receipt-btn"
                            onClick={() => { setFailedIds((prev) => { const n = new Set(prev); n.delete(row.payment_id!); return n; }); downloadReceipt(row); }}
                        >
                          <RotateCcw size={14} />
                          {t("common.retry")}
                        </button>
                      ) : (
                        <button
                          className="history-receipt-btn"
                          onClick={() => downloadReceipt(row)}
                            disabled={downloadingIds.has(row.payment_id!)}
                        >
                          <Download size={14} />
                            {downloadingIds.has(row.payment_id!) ? t("common.loading") : t("historyPage.downloadBtn")}
                        </button>
                        )
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      {isPaid && row.payment_id ? (
                        reportingId === row.payment_id ? (
                          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                            <input
                              value={reportText}
                              onChange={(e) => setReportText(e.target.value)}
                              placeholder={t("historyPage.reportPlaceholder")}
                              style={{ fontSize: "0.8rem", padding: "2px 6px", borderRadius: 4, border: "1px solid #ddd", width: 140 }}
                            />
                            <button className="history-receipt-btn" onClick={() => void submitReport(row)} disabled={!reportText.trim()} style={{ fontSize: "0.75rem" }}>
                              {t("common.submit")}
                            </button>
                            <button className="history-receipt-btn" onClick={() => { setReportingId(null); setReportText(""); }} style={{ fontSize: "0.75rem" }}>
                              {t("common.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button className="history-receipt-btn" onClick={() => setReportingId(row.payment_id!)} style={{ fontSize: "0.75rem", color: "var(--error, #c33)" }}>
                            <AlertTriangle size={12} />
                            {t("historyPage.reportIssue")}
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="history-empty">
            <Receipt size={30} />
            <p>{t("historyPage.noEntries")}</p>
            <Link to="/dashboard" className="btn btn-primary" style={{ marginTop: "0.75rem" }}>
              {t("historyPage.goToDashboard")}
            </Link>
          </div>
        )}

        <div className="history-pagination" style={{ marginTop: 12 }}>
          <span className="history-pagination-info">{rows.length > 0 ? t("historyPage.paginationInfo", { start: String((page - 1) * PAGE_SIZE + 1), end: String((page - 1) * PAGE_SIZE + rows.length), total: String(hasMore ? "..." : ((page - 1) * PAGE_SIZE + rows.length)) }) : ""}</span>
          <div className="history-pagination-btns">
            <button className="history-pagination-btn" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={18} />
            </button>
            <button className="history-pagination-btn" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
