import { useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { Download, ChevronLeft, ChevronRight, Receipt, RotateCcw, AlertTriangle } from "lucide-react";
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
  const [selectedPersonName, setSelectedPersonName] = useState<string>("all");

  const personOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [{ value: "all", label: t("historyPage.allFamilyMembers") }];
    const selfName = memberDashboard?.member?.full_name?.trim();
    if (selfName) out.push({ value: selfName, label: selfName });
    for (const fm of memberDashboard?.family_members || []) {
      if (fm.full_name?.trim()) out.push({ value: fm.full_name.trim(), label: fm.full_name.trim() });
    }
    const seen = new Set<string>();
    return out.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [memberDashboard?.member?.full_name, memberDashboard?.family_members]);

  useEffect(() => {
    setPage(1);
  }, [selectedPersonName]);

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
        if (selectedPersonName && selectedPersonName !== "all") {
          query.set("person_name", selectedPersonName);
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
  }, [token, page, selectedPersonName, setNotice]);

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

      <div className="history-table-container">
        <div className="history-filters" style={{ justifyContent: "space-between", gap: 12 }}>
          <label style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{t("historyPage.selectPerson")}</span>
            <select
              value={selectedPersonName}
              onChange={(e) => setSelectedPersonName(e.target.value)}
              style={{ minWidth: 260 }}
            >
              {personOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <span className="muted" style={{ fontSize: "0.85rem", alignSelf: "end" }}>{rows.length > 0 ? t("historyPage.paginationInfo", { start: String((page - 1) * PAGE_SIZE + 1), end: String((page - 1) * PAGE_SIZE + rows.length), total: String(hasMore ? "..." : ((page - 1) * PAGE_SIZE + rows.length)) }) : ""}</span>
        </div>

        {loading ? (
          <LoadingSkeleton lines={6} />
        ) : rows.length ? (
          <div className="history-table-scroll">
            <table className="history-table">
              <thead>
                <tr>
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
                {rows.map((row) => {
                  const isPaid = row.due_status === "paid";
                  const isImported = row.due_status === "imported_paid";
                  const isPending = !isPaid && !isImported;
                  return (
                  <tr key={row.id} className={`history-row ${isPending ? "history-row-pending" : ""}`}>
                    <td>{monthYearLabel(row.month_year)}</td>
                    <td>
                      <span className={`history-status-badge ${isPaid ? "badge-paid" : isImported ? "badge-imported" : "badge-pending"}`}>
                        {isPaid ? t("historyPage.statusPaid") : isImported ? t("historyPage.statusImported") : t("historyPage.statusUnpaid")}
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
