import { useState, useCallback } from "react";
import { Check, CreditCard, Download, Edit2, X } from "lucide-react";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import EmptyState from "../../components/EmptyState";
import type { MemberRow, MonthlyPaymentHistoryRow } from "../../types";
import { isUuid, formatAmount, formatDate } from "../../types";
import { useI18n } from "../../i18n";

const PAGE_SIZE = 10;

function monthYearLabel(monthIso?: string | null) {
  if (!monthIso) return "-";
  const d = new Date(`${monthIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return monthIso;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function PaymentHistoryTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, setNotice, churches, withAuthRequest, busyKey, openOperationConfirmDialog } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [history, setHistory] = useState<MonthlyPaymentHistoryRow[]>([]);
  const [personNameFilter, setPersonNameFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPayFields, setEditPayFields] = useState<{ amount: string; method: string; date: string; note: string }>({ amount: "", method: "", date: "", note: "" });

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

  function startEditPayment(paymentId: string, row: MonthlyPaymentHistoryRow) {
    setEditingPaymentId(paymentId);
    setEditPayFields({ amount: String(row.paid_amount || ""), method: "", date: row.paid_date || "", note: "" });
  }

  async function saveEditPayment(paymentId: string) {
    const body: Record<string, unknown> = {};
    if (editPayFields.amount) body.amount = Number(editPayFields.amount);
    if (editPayFields.method) body.payment_method = editPayFields.method;
    if (editPayFields.date) body.payment_date = editPayFields.date;
    if (editPayFields.note) body.note = editPayFields.note;
    if (!Object.keys(body).length) {
      setNotice({ tone: "error", text: t("adminTabs.paymentHistory.noChangesToSave") });
      return;
    }
    const result = await withAuthRequest("edit-payment", () =>
      apiRequest(`/api/ops/payments/${encodeURIComponent(paymentId)}`, { method: "PATCH", token, body }),
      t("adminTabs.paymentHistory.paymentUpdated"),
    );
    if (result) {
      setEditingPaymentId(null);
      void load(undefined, page);
    }
  }

  function voidPayment(paymentId: string) {
    openOperationConfirmDialog(
      t("adminTabs.paymentHistory.voidTitle"),
      t("adminTabs.paymentHistory.voidMessage"),
      t("adminTabs.paymentHistory.voidKeyword"),
      async () => {
        const result = await withAuthRequest("void-payment", () =>
          apiRequest(`/api/ops/payments/${encodeURIComponent(paymentId)}/void`, { method: "POST", token, body: {} }),
          t("adminTabs.paymentHistory.paymentVoided"),
        );
        if (result) void load(undefined, page);
      },
    );
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
                  <th>{t("common.amount")}</th>
                  <th>{t("common.name")}</th>
                  <th>{t("common.date")}</th>
                  <th>{t("adminTabs.paymentHistory.receiptHeader")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((p) => (
                  <tr key={p.id}>
                    <td>{monthYearLabel(p.month_year)}</td>
                    <td>{formatAmount(p.paid_amount)}</td>
                    <td>{p.person_name || t("common.member")}</td>
                    <td>{p.paid_date ? formatDate(p.paid_date) : "-"}</td>
                    <td>{p.receipt_number || "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={t("adminTabs.paymentHistory.downloadReceipt")}
                          disabled={!p.payment_id || downloadingIds.has(p.payment_id)}
                          onClick={() => { if (p.payment_id) downloadReceipt(p.payment_id, p.receipt_number); }}
                        >
                          <Download size={14} />
                        </button>
                        {p.payment_id ? (
                          <>
                            <button className="btn btn-ghost btn-sm" title={t("adminTabs.paymentHistory.editPaymentTitle")} onClick={() => startEditPayment(p.payment_id!, p)}><Edit2 size={14} /></button>
                            <button className="btn btn-ghost btn-sm" title={t("adminTabs.paymentHistory.voidPaymentTitle")} onClick={() => voidPayment(p.payment_id!)} disabled={busyKey === "void-payment"}>✕</button>
                          </>
                        ) : null}
                      </div>
                      {editingPaymentId === p.payment_id && p.payment_id && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          <input type="number" placeholder={t("adminTabs.paymentHistory.amountPlaceholder")} value={editPayFields.amount} onChange={(e) => setEditPayFields((f) => ({ ...f, amount: e.target.value }))} style={{ width: 80 }} />
                          <select value={editPayFields.method} onChange={(e) => setEditPayFields((f) => ({ ...f, method: e.target.value }))}>
                            <option value="">{t("adminTabs.paymentHistory.methodOption")}</option>
                            <option value="cash">{t("adminTabs.paymentHistory.methodCash")}</option>
                            <option value="upi">{t("adminTabs.paymentHistory.methodUpi")}</option>
                            <option value="bank_transfer">{t("adminTabs.paymentHistory.methodBankTransfer")}</option>
                            <option value="cheque">{t("adminTabs.paymentHistory.methodCheque")}</option>
                          </select>
                          <input type="date" value={editPayFields.date} onChange={(e) => setEditPayFields((f) => ({ ...f, date: e.target.value }))} />
                          <input placeholder={t("adminTabs.paymentHistory.notePlaceholder")} value={editPayFields.note} onChange={(e) => setEditPayFields((f) => ({ ...f, note: e.target.value }))} />
                          <button className="btn btn-ghost btn-sm" onClick={() => { if (p.payment_id) void saveEditPayment(p.payment_id); }} disabled={busyKey === "edit-payment"}><Check size={14} /></button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingPaymentId(null)}><X size={14} /></button>
                        </div>
                      )}
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
