import { useState, useEffect, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { MembershipRequestRow } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function MembershipRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest } = useApp();

  const [requests, setRequests] = useState<MembershipRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "";
      const data = await apiRequest<MembershipRequestRow[]>(`/api/requests/membership-requests${statusParam}`, { token });
      setRequests(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.membershipRequests.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected") {
    await withAuthRequest("review-membership", async () => {
      await apiRequest(`/api/requests/membership-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body: { decision },
      });
      void loadRequests();
    }, decision === "approved" ? t("adminTabs.membershipRequests.successApproved") : t("adminTabs.membershipRequests.successRejected"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.membershipRequests.title")}</h3>
      <p className="muted">{t("adminTabs.membershipRequests.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.membershipRequests.pendingOnly")}</option>
          <option value="all">{t("adminTabs.membershipRequests.allRequests")}</option>
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
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
                <strong>{req.full_name}</strong>
                <span className="muted">{req.phone_number || req.email}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
              </div>
              {req.phone_number ? <span className="muted">{t("adminTabs.membershipRequests.phoneLabel")} {req.phone_number}</span> : null}
              {req.address ? <span className="muted">{t("adminTabs.membershipRequests.addressLabel")} {req.address}</span> : null}
              <span className="muted">{t("adminTabs.membershipRequests.requestedLabel")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div className="actions-row" style={{ marginTop: 4 }}>
                  <button className="btn btn-primary" onClick={() => review(req.id, "approved")} disabled={busyKey === "review-membership"}>{t("adminTabs.membershipRequests.approve")}</button>
                  <button className="btn" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-membership"}>{t("adminTabs.membershipRequests.reject")}</button>
                </div>
              ) : null}
              {req.review_note ? <span className="muted">{t("adminTabs.membershipRequests.noteLabel")} {req.review_note}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<ClipboardList size={32} />} title={t("adminTabs.membershipRequests.emptyTitle")} description={t("adminTabs.membershipRequests.emptyDescription")} />
      )}
    </article>
  );
}
