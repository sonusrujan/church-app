import { useState, useEffect, useCallback } from "react";
import { Trash2 } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { AccountDeletionRequestRow } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function AccountDeletionRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, openOperationConfirmDialog, refreshAdminCounts } = useApp();

  const [requests, setRequests] = useState<AccountDeletionRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "";
      const data = await apiRequest<AccountDeletionRequestRow[]>(`/api/requests/account-deletion-requests${statusParam}`, { token });
      setRequests(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.accountDeletion.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected", reviewNote?: string) {
    await withAuthRequest("review-deletion", async () => {
      await apiRequest(`/api/requests/account-deletion-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body: { decision, review_note: reviewNote },
      });
      void loadRequests();
      void refreshAdminCounts();
    }, t("adminTabs.accountDeletion.successReviewed", { decision }));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.accountDeletion.title")}</h3>
      <p className="muted">{t("adminTabs.accountDeletion.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.accountDeletion.filterPending")}</option>
          <option value="all">{t("adminTabs.accountDeletion.filterAll")}</option>
        </select>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {loading && !requests.length ? (
        <LoadingSkeleton lines={4} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 10).map((req) => (
            <div key={req.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", flexWrap: "wrap" }}>
                <strong>{req.member_full_name || t("adminTabs.accountDeletion.unknownMember")}</strong>
                <span className="muted">{req.member_email || req.member_phone || ""}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
                {(req.family_member_count ?? 0) > 0 && (
                  <span className="event-badge badge-system" title={t("adminTabs.accountDeletion.familyNote")}>
                    {t("adminTabs.accountDeletion.familyMembers", { count: req.family_member_count ?? 0 })}
                  </span>
                )}
              </div>
              {req.reason ? <span className="muted">{t("adminTabs.accountDeletion.labelReason")} {req.reason}</span> : null}
              <span className="muted">{t("adminTabs.accountDeletion.labelRequested")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div className="actions-row" style={{ marginTop: 4 }}>
                  <button className="btn btn-danger" onClick={() => {
                    openOperationConfirmDialog(
                      t("adminTabs.accountDeletion.approveTitle"),
                      t("adminTabs.accountDeletion.approveMessage", { name: req.member_full_name || t("adminTabs.accountDeletion.unknownMember"), familyCount: req.family_member_count ?? 0 }),
                      t("adminTabs.accountDeletion.approveConfirmWord"),
                      () => review(req.id, "approved"),
                    );
                  }} disabled={busyKey === "review-deletion"}>{t("adminTabs.accountDeletion.approve")}</button>
                  <button className="btn" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-deletion"}>{t("adminTabs.accountDeletion.reject")}</button>
                </div>
              ) : null}
              {req.review_note ? <span className="muted">{t("adminTabs.accountDeletion.labelNote")} {req.review_note}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<Trash2 size={32} />} title={t("adminTabs.accountDeletion.emptyTitle")} description={t("adminTabs.accountDeletion.emptyDescription")} />
      )}
    </article>
  );
}
