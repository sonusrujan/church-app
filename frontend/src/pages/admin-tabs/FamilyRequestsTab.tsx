import { useState, useEffect, useCallback } from "react";
import { Users } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function FamilyRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest } = useApp();

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "?status=all";
      const data = await apiRequest<any[]>(`/api/auth/family-requests${statusParam}`, { token });
      setRequests(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.familyRequests.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected") {
    await withAuthRequest("review-family-request", async () => {
      await apiRequest(`/api/auth/family-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body: { decision },
      });
      void loadRequests();
    }, decision === "approved" ? t("adminTabs.familyRequests.successApproved") : t("adminTabs.familyRequests.successRejected"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.familyRequests.title")}</h3>
      <p className="muted">{t("adminTabs.familyRequests.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.familyRequests.pendingOnly")}</option>
          <option value="all">{t("adminTabs.familyRequests.allRequests")}</option>
        </select>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {loading && !requests.length ? (
        <LoadingSkeleton lines={4} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 10).map((req: any) => (
            <div key={req.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", flexWrap: "wrap" }}>
                <strong>{req.requester_name || "Requester"}</strong>
                <span>{t("adminTabs.familyRequests.wantsToAdd")}</span>
                <strong>{req.target_name || "Target"}</strong>
                <span className="muted">{t("adminTabs.familyRequests.asRelation")} {req.relation}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
              </div>
              {req.requester_phone ? <span className="muted">{t("adminTabs.familyRequests.requesterPhone")} {req.requester_phone}</span> : null}
              <span className="muted">{t("adminTabs.familyRequests.requestedLabel")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div className="actions-row" style={{ marginTop: 4 }}>
                  <button className="btn btn-primary" onClick={() => review(req.id, "approved")} disabled={busyKey === "review-family-request"}>{t("adminTabs.familyRequests.approve")}</button>
                  <button className="btn" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-family-request"}>{t("adminTabs.familyRequests.reject")}</button>
                </div>
              ) : null}
              {req.review_note ? <span className="muted">{t("adminTabs.familyRequests.noteLabel")} {req.review_note}</span> : null}
              {req.rejection_reason ? <span className="muted">{t("adminTabs.familyRequests.reasonLabel")} {req.rejection_reason}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<Users size={32} />} title={t("adminTabs.familyRequests.emptyTitle")} description={t("adminTabs.familyRequests.emptyDescription")} />
      )}
    </article>
  );
}
