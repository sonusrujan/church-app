import { useState, useCallback } from "react";
import { CreditCard, Download, Edit2, Check, X } from "lucide-react";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import EmptyState from "../../components/EmptyState";
import type { MemberRow, MonthlyPaymentHistoryRow } from "../../types";
import { isUuid, formatAmount, formatDate } from "../../types";
import { useI18n } from "../../i18n";

const PAGE_SIZE = 10;
const DUE_STATUSES = ["pending", "paid", "imported_paid", "waived"] as const;

function monthYearLabel(monthIso?: string | null) {
  if (!monthIso) return "-";
  const d = new Date(`${monthIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return monthIso;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function PaymentHistoryTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, setNotice, churches, withAuthRequest } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [history, setHistory] = useState<MonthlyPaymentHistoryRow[]>([]);
  const [personNameFilter, setPersonNameFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  const [editDueStatus, setEditDueStatus] = useState("");

  async function downloadReceipt(paymentId: string, receiptNumber: string | null) {
    if (!token || downloadingIds.has(paymentId)) return;
    setDownloadingIds((prev) => new Set(prev).add(paymentId));
    try {
      const blob = await apiBlobRequest(`/api/payments/${paymentId}/receipt`, { token });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${receiptNumber || paymentId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setNotice({ tone: "error", text: err.message || t("adminTabs.paymentHistory.errorDownloadFailed") });
    } finally {
      setDownloadingIds((prev) => { const s = new Set(prev); s.delete(paymentId); return s; });
    }
  }

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  async function load(mid?: string, targetPage = 1) {
    const id = mid || memberId;
    if (!id.trim() || !isUuid(id.trim())) { setNotice({ tone: "error", text: t("adminTabs.paymentHistory.errorSelectMember") }); return; }
    setLoading(true);
    try {
      const offset = (targetPage - 1) * PAGE_SIZE;
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE + 1),
        offset: String(offset),
      });
      if (personNameFilter !== "all") {
        query.set("person_name", personNameFilter);
      }
      const data = await apiRequest<MonthlyPaymentHistoryRow[]>(
        `/api/ops/payments/member/${encodeURIComponent(id.trim())}/monthly-history?${query.toString()}`,
        { token },
      );
      setHistory(data.slice(0, PAGE_SIZE));
      setHasMore(data.length > PAGE_SIZE);
      setPage(targetPage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("adminTabs.paymentHistory.loadFailed");
      setNotice({ tone: "error", text: msg });
    } finally {
      setLoading(false);
    }
  }

  async function toggleDueStatus(dueId: string) {
    if (!editDueStatus) return;
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    const result = await withAuthRequest(
      "toggle-due",
      () => apiRequest(`/api/ops/monthly-dues/${dueId}`, {
        method: "PATCH",
        token,
        body: { new_status: editDueStatus, church_id: churchId },
      }),
      t("adminTabs.paymentHistory.dueStatusUpdated"),
    );
    if (result) {
      setEditingDueId(null);
      void load(undefined, page);
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.paymentHistory.title")}</h3>
      <p className="muted">{t("adminTabs.paymentHistory.description")}</p>
      <div className="field-stack">
        <label>
          {t("adminTabs.createSubscription.labelMember")}
          <SearchSelect
            placeholder={t("adminTabs.paymentHistory.memberPlaceholder")}
            onSearch={searchMembers}
            value={memberName}
            onSelect={(opt) => {
              setMemberId(opt.id);
              setMemberName(opt.label);
              setPersonNameFilter("all");
              setHistory([]);
              void load(opt.id, 1);
            }}
            onClear={() => {
              setMemberId("");
              setMemberName("");
              setPersonNameFilter("all");
              setHistory([]);
              setPage(1);
              setHasMore(false);
            }}
          />
        </label>
        <label>
          {t("common.name")}
          <input
            value={personNameFilter === "all" ? "" : personNameFilter}
            placeholder={t("adminTabs.paymentHistory.filterByPerson")}
            onChange={(e) => {
              const value = e.target.value.trim();
              setPersonNameFilter(value || "all");
            }}
          />
        </label>
        <button className="btn" onClick={() => void load(undefined, 1)} disabled={loading || !memberId}>
          {loading ? t("common.loading") : t("adminTabs.paymentHistory.loadPaymentHistory")}
        </button>
      </div>
      {loading && !history.length ? (
        <div className="muted" style={{ padding: "2rem 0" }}>{t("common.loading")}</div>
      ) : history.length ? (
        <>
          <div className="history-table-scroll" style={{ marginTop: "1rem" }}>
            <table className="csv-preview-table">
              <thead>
                <tr>
                  <th>{t("historyPage.monthAndYear")}</th>
                  <th>{t("historyPage.status")}</th>
                  <th>{t("common.amount")}</th>
                  <th>{t("common.name")}</th>
                  <th>{t("common.date")}</th>
                  <th>{t("adminTabs.paymentHistory.receiptHeader")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td>{monthYearLabel(p.month_year)}</td>
                    <td>
                      {editingDueId === p.id ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <select
                            value={editDueStatus}
                            onChange={(e) => setEditDueStatus(e.target.value)}
                            style={{ fontSize: "0.8rem", padding: "2px 4px", borderRadius: 4 }}
                          >
                            {DUE_STATUSES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <button className="btn btn-ghost btn-sm" onClick={() => void toggleDueStatus(p.id)} title={t("common.save")}><Check size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingDueId(null)} title={t("common.cancel")}><X size={14} /></button>
                        </div>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span className={`history-status-badge ${p.due_status === "paid" ? "badge-paid" : p.due_status === "imported_paid" ? "badge-imported" : p.due_status === "waived" ? "badge-imported" : "badge-pending"}`}>
                            {p.due_status || "pending"}
                          </span>
                          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingDueId(p.id); setEditDueStatus(p.due_status || "pending"); }} title={t("adminTabs.paymentHistory.editDueStatus")}><Edit2 size={12} /></button>
                        </span>
                      )}
                    </td>
                    <td>{formatAmount(p.paid_amount)}</td>
                    <td>{p.person_name || t("common.member")}</td>
                    <td>{p.paid_date ? formatDate(p.paid_date) : "-"}</td>
                    <td>{p.receipt_number || "—"}</td>
                    <td>
                      {p.payment_id ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        title={t("adminTabs.paymentHistory.downloadReceipt")}
                        disabled={downloadingIds.has(p.payment_id)}
                        onClick={() => downloadReceipt(p.payment_id!, p.receipt_number)}
                      >
                        <Download size={14} />
                      </button>
                      ) : <span className="muted">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.75rem" }}>
            <span className="muted">{t("adminTabs.paymentHistory.paginationInfo")}</span>
            <div style={{ display: "inline-flex", gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={loading || page <= 1}
                onClick={() => void load(undefined, Math.max(1, page - 1))}
              >
                {t("common.prev")}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={loading || !hasMore}
                onClick={() => void load(undefined, page + 1)}
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        </>
      ) : memberId ? (
        <EmptyState icon={<CreditCard size={32} />} title={t("adminTabs.paymentHistory.emptyTitle")} description={t("adminTabs.paymentHistory.emptyDescription")} />
      ) : null}
    </article>
  );
}
