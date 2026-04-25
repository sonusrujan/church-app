import { useState } from "react";
import { AlertTriangle, CheckCircle, XOctagon, ArrowRightCircle } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { RefundRequestRow } from "../../types";
import { formatAmount, formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function RefundRequestsTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, isChurchAdmin, busyKey, setNotice, withAuthRequest, refreshAdminCounts } = useApp();

  const [requests, setRequests] = useState<RefundRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"pending" | "forwarded" | "all">("pending");
  const [page, setPage] = useState(1);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  async function loadRequests() {
    setLoading(true);
    try {
      const filterParam = filter !== "all" ? `?status=${filter}` : "";
      const data = await apiRequest<RefundRequestRow[]>(`/api/ops/refund-requests${filterParam}`, { token });
      setRequests(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.refundRequests.loadFailed") });
    } finally {
      setLoading(false);
    }
  }

  async function forward(id: string) {
    await withAuthRequest(
      "forward-refund",
      () => apiRequest<{ message: string }>(`/api/ops/refund-requests/${id}/forward`, { method: "POST", token }),
      t("adminTabs.refundRequests.forwardedSuccess"),
    );
    await loadRequests();
    void refreshAdminCounts();
  }

  async function review(id: string, action: "approved" | "denied") {
    const note = reviewNotes[id] || "";
    await withAuthRequest(
      "review-refund",
      () => apiRequest<{ message: string }>(`/api/ops/refund-requests/${id}/review`, {
        method: "POST", token, body: { decision: action, review_note: note.trim() || undefined },
      }),
      action === "approved" ? t("adminTabs.refundRequests.requestApproved") : t("adminTabs.refundRequests.requestDenied"),
    );
    setReviewNotes((prev) => { const next = { ...prev }; delete next[id]; return next; });
    await loadRequests();
    void refreshAdminCounts();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.refundRequests.title")}</h3>
      <p className="muted">
        {isSuperAdmin
          ? t("adminTabs.refundRequests.descriptionSuperAdmin")
          : t("adminTabs.refundRequests.descriptionChurchAdmin")}
      </p>
      <div className="actions-row" style={{ marginBottom: "1rem", gap: 8 }}>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "forwarded" | "all")} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border-color, #ddd)" }}>
          <option value="pending">{t("adminTabs.refundRequests.filterPending")}</option>
          <option value="forwarded">{t("adminTabs.refundRequests.filterForwarded")}</option>
          <option value="all">{t("adminTabs.refundRequests.filterAll")}</option>
        </select>
      </div>
      {loading ? (
        <LoadingSkeleton lines={5} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 8).map((rr) => (
            <div key={rr.id} className="list-item" style={{ padding: "0.75rem", marginBottom: "0.5rem", border: "1px solid var(--border-color, #eee)", borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <strong>{rr.member?.full_name || rr.member_id.slice(0, 8)}</strong>
                <span className={`event-badge ${
                  rr.status === "pending" ? "badge-system" :
                  rr.status === "forwarded" ? "badge-payment" :
                  rr.status === "approved" || rr.status === "processed" ? "badge-created" :
                  "badge-overdue"
                }`}>{rr.status}</span>
              </div>
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                {t("adminTabs.refundRequests.amountLabel")} <strong>{formatAmount(rr.amount)}</strong>
                {rr.reason ? <> &middot; {t("adminTabs.refundRequests.reasonLabel")} {rr.reason}</> : null}
                {rr.payment?.receipt_number ? <> &middot; {t("adminTabs.refundRequests.receiptLabel")} {rr.payment.receipt_number}</> : null}
              </div>
              <div className="muted" style={{ fontSize: "0.8rem", marginTop: 4 }}>
                {t("adminTabs.refundRequests.requestedLabel")} {formatDate(rr.created_at)}
                {rr.forwarded_at ? <> &middot; {t("adminTabs.refundRequests.forwardedLabel")} {formatDate(rr.forwarded_at)}</> : null}
                {rr.reviewed_at ? <> &middot; {t("adminTabs.refundRequests.reviewedLabel")} {formatDate(rr.reviewed_at)}</> : null}
              </div>
              {rr.review_note ? <div className="muted" style={{ fontSize: "0.8rem", marginTop: 2 }}>{t("adminTabs.refundRequests.noteLabel")} {rr.review_note}</div> : null}
              <div className="actions-row" style={{ marginTop: 8 }}>
                {isChurchAdmin && rr.status === "pending" ? (
                  <button className="btn" onClick={() => void forward(rr.id)} disabled={busyKey === "forward-refund"}>
                    <ArrowRightCircle size={14} /> {t("adminTabs.refundRequests.forwardButton")}
                  </button>
                ) : null}
                {isSuperAdmin && rr.status === "forwarded" ? (
                  <>
                    <input
                      value={reviewNotes[rr.id] || ""}
                      onChange={(e) => setReviewNotes((prev) => ({ ...prev, [rr.id]: e.target.value }))}
                      placeholder={t("adminTabs.refundRequests.reviewNotePlaceholder")}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-color, #ddd)", fontSize: "0.85rem" }}
                    />
                    <button className="btn btn-primary" onClick={() => void review(rr.id, "approved")} disabled={busyKey === "review-refund"}>
                      <CheckCircle size={14} /> {t("adminTabs.refundRequests.approveButton")}
                    </button>
                    <button className="btn btn-danger" onClick={() => void review(rr.id, "denied")} disabled={busyKey === "review-refund"}>
                      <XOctagon size={14} /> {t("adminTabs.refundRequests.denyButton")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 8)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<AlertTriangle size={32} />} title={t("adminTabs.refundRequests.emptyTitle")} description={t("adminTabs.refundRequests.emptyDescription")} />
      )}
    </article>
  );
}
