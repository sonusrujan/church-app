import { useState, useCallback } from "react";
import { CreditCard, Download } from "lucide-react";
import { apiRequest, API_BASE_URL } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { PaymentHistoryRow, MemberRow } from "../../types";
import { isUuid, formatAmount, formatDate, humanizePaymentMethod, isManualPayment } from "../../types";
import { useI18n } from "../../i18n";

export default function PaymentHistoryTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, setNotice, churches } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [history, setHistory] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  async function downloadReceipt(paymentId: string, receiptNumber: string | null) {
    if (!token || downloadingIds.has(paymentId)) return;
    setDownloadingIds((prev) => new Set(prev).add(paymentId));
    try {
      const response = await fetch(`${API_BASE_URL}/api/payments/${paymentId}/receipt`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
      });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
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

  async function load(mid?: string) {
    const id = mid || memberId;
    if (!id.trim() || !isUuid(id.trim())) { setNotice({ tone: "error", text: t("adminTabs.paymentHistory.errorSelectMember") }); return; }
    setLoading(true);
    try {
      const data = await apiRequest<PaymentHistoryRow[]>(
        `/api/ops/payments/member/${encodeURIComponent(id.trim())}?limit=200`,
        { token },
      );
      setHistory(data);
      setPage(1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load payment history";
      setNotice({ tone: "error", text: msg });
    } finally {
      setLoading(false);
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
              setHistory([]);
              void load(opt.id);
            }}
            onClear={() => { setMemberId(""); setMemberName(""); setHistory([]); }}
          />
        </label>
        <button className="btn" onClick={() => void load()} disabled={loading || !memberId}>
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
                  <th>{t("common.date")}</th>
                  <th>{t("common.amount")}</th>
                  <th>{t("common.method")}</th>
                  <th>{t("adminTabs.paymentHistory.categoryHeader")}</th>
                  <th>{t("adminTabs.paymentHistory.statusHeader")}</th>
                  <th>{t("adminTabs.paymentHistory.receiptHeader")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginate(history, page, 15).map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.payment_date)}</td>
                    <td>{formatAmount(p.amount)}</td>
                    <td>{humanizePaymentMethod(p.payment_method)}</td>
                    <td>
                      <span className={`pill ${isManualPayment(p.payment_method) ? "pill--manual" : ""}`}>
                        {(p.payment_category || "other").charAt(0).toUpperCase() + (p.payment_category || "other").slice(1)}
                        {isManualPayment(p.payment_method) ? ` ${t("adminTabs.paymentHistory.manualSuffix")}` : ""}
                      </span>
                    </td>
                    <td>{p.payment_status || "—"}</td>
                    <td>{p.receipt_number || "—"}</td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        title={t("adminTabs.paymentHistory.downloadReceipt")}
                        disabled={downloadingIds.has(p.id)}
                        onClick={() => downloadReceipt(p.id, p.receipt_number)}
                      >
                        <Download size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={totalPages(history.length, 15)} onPageChange={setPage} />
        </>
      ) : memberId ? (
        <EmptyState icon={<CreditCard size={32} />} title={t("adminTabs.paymentHistory.emptyTitle")} description={t("adminTabs.paymentHistory.emptyDescription")} />
      ) : null}
    </article>
  );
}
