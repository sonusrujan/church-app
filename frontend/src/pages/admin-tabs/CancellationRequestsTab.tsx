import { useState, useEffect, useCallback } from "react";
import { XCircle } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { CancellationRequestRow } from "../../types";
import { formatAmount, formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function CancellationRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, openOperationConfirmDialog, refreshAdminCounts } = useApp();

  const [requests, setRequests] = useState<CancellationRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "";
      const data = await apiRequest<CancellationRequestRow[]>(`/api/requests/cancellation-requests${statusParam}`, { token });
      setRequests(data);
      setSelectedIds([]);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.cancellationRequests.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected") {
    const body: Record<string, string> = { decision };
    if (decision === "rejected" && rejectReasons[id]?.trim()) {
      body.review_note = rejectReasons[id].trim();
    }
    await withAuthRequest("review-cancellation", async () => {
      await apiRequest(`/api/requests/cancellation-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body,
      });
      setRejectingId(null);
      setRejectReasons((prev) => { const next = { ...prev }; delete next[id]; return next; });
      void loadRequests();
      void refreshAdminCounts();
    }, t("adminTabs.cancellationRequests.successReviewed", { decision }));
  }

  const pendingIds = requests.filter((request) => request.status === "pending").map((request) => request.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedIds.includes(id));

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((value) => value !== id));
  }

  function toggleAllPending(checked: boolean) {
    setSelectedIds(checked ? pendingIds : []);
  }

  async function batchReview(decision: "approved" | "rejected") {
    if (!selectedIds.length) {
      setNotice({ tone: "error", text: t("adminTabs.cancellationRequests.batchSelectAtLeastOne") });
      return;
    }

    const result = await withAuthRequest(`batch-cancellation-${decision}`, () =>
      apiRequest<{ processed: number; succeeded: number; failed: number }>("/api/requests/cancellation-requests/batch-review", {
        method: "POST",
        token,
        body: { request_ids: selectedIds, decision },
      }),
    );

    if (result) {
      setSelectedIds([]);
      const failedNote = result.failed > 0 ? t("adminTabs.cancellationRequests.batchFailedNote", { count: result.failed }) : "";
      setNotice({
        tone: result.failed > 0 ? "info" : "success",
        text: t("adminTabs.cancellationRequests.batchCompleted", { succeeded: result.succeeded, decision, failedNote }),
      });
      void loadRequests();
      void refreshAdminCounts();
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.cancellationRequests.title")}</h3>
      <p className="muted">{t("adminTabs.cancellationRequests.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.cancellationRequests.filterPending")}</option>
          <option value="all">{t("adminTabs.cancellationRequests.filterAll")}</option>
        </select>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {pendingIds.length ? (
        <div className="actions-row" style={{ marginBottom: "1rem", gap: 8, flexWrap: "wrap" }}>
          <label className="checkbox-line">
            <input type="checkbox" checked={allPendingSelected} onChange={(e) => toggleAllPending(e.target.checked)} />
            {t("adminTabs.cancellationRequests.batchSelectAllPending", { count: pendingIds.length })}
          </label>
          <button className="btn btn-primary" onClick={() => void batchReview("approved")} disabled={!selectedIds.length || busyKey === "batch-cancellation-approved"}>{t("adminTabs.cancellationRequests.batchApprove")}</button>
          <button className="btn" onClick={() => void batchReview("rejected")} disabled={!selectedIds.length || busyKey === "batch-cancellation-rejected"}>{t("adminTabs.cancellationRequests.batchReject")}</button>
        </div>
      ) : null}
      {loading && !requests.length ? (
        <LoadingSkeleton lines={4} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 10).map((req) => (
            <div key={req.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
                {req.status === "pending" ? (
                  <input type="checkbox" checked={selectedIds.includes(req.id)} onChange={(e) => toggleSelected(req.id, e.target.checked)} />
                ) : null}
                <strong>{req.member?.full_name || t("adminTabs.cancellationRequests.fallbackMember")}</strong>
                <span className="muted">{req.member?.email || ""}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
              </div>
              {req.reason ? <span className="muted">{t("adminTabs.cancellationRequests.labelReason")} {req.reason}</span> : null}
              {req.subscription ? <span className="muted">{t("adminTabs.cancellationRequests.labelSubscription")} {req.subscription.plan_name} — {formatAmount(req.subscription.amount)}</span> : null}
              <span className="muted">{t("adminTabs.cancellationRequests.labelRequested")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div className="actions-row" style={{ marginTop: 4, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => {
                    openOperationConfirmDialog(
                      t("adminTabs.cancellationRequests.approveCancellation"),
                      t("adminTabs.cancellationRequests.approveConfirmMessage", { name: req.member?.full_name || t("adminTabs.cancellationRequests.fallbackMember"), plan: req.subscription?.plan_name || "plan" }),
                      t("adminTabs.cancellationRequests.approveConfirmWord"),
                      () => review(req.id, "approved"),
                    );
                  }} disabled={busyKey === "review-cancellation"}>{t("adminTabs.cancellationRequests.approveCancellation")}</button>
                  {rejectingId === req.id ? (
                    <>
                      <input
                        value={rejectReasons[req.id] || ""}
                        onChange={(e) => setRejectReasons((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        placeholder={t("adminTabs.cancellationRequests.rejectReasonPlaceholder")}
                        style={{ flex: 1, minWidth: 160 }}
                      />
                      <button className="btn btn-danger" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-cancellation"}>{t("adminTabs.cancellationRequests.confirmReject")}</button>
                      <button className="btn" onClick={() => setRejectingId(null)}>{t("common.cancel")}</button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => setRejectingId(req.id)} disabled={busyKey === "review-cancellation"}>{t("adminTabs.cancellationRequests.reject")}</button>
                  )}
                </div>
              ) : null}
              {req.review_note ? <span className="muted">{t("adminTabs.cancellationRequests.labelNote")} {req.review_note}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<XCircle size={32} />} title={t("adminTabs.cancellationRequests.emptyTitle")} description={t("adminTabs.cancellationRequests.emptyDescription")} />
      )}
    </article>
  );
}
