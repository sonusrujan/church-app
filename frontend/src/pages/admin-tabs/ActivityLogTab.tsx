import { useState, useEffect, useCallback } from "react";
import { Activity } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { SubscriptionEventRow, MemberRow } from "../../types";
import { formatAmount, formatDate, toReadableEvent } from "../../types";
import { useI18n } from "../../i18n";

export default function ActivityLogTab() {
  const { t } = useI18n();
  const { token, setNotice, authContext, isSuperAdmin, churches } = useApp();

  const [events, setEvents] = useState<SubscriptionEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterMemberId, setFilterMemberId] = useState("");
  const [filterMemberName, setFilterMemberName] = useState("");

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  const loadEvents = useCallback(async (memberId?: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (memberId) params.set("member_id", memberId);
      const data = await apiRequest<SubscriptionEventRow[]>(`/api/subscriptions/activity?${params.toString()}`, { token });
      setEvents(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.activityLog.errorLoadEvents") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice]);

  useEffect(() => { void loadEvents(); }, [loadEvents]);

  return (
    <article className="panel">
      <h3>{t("adminTabs.activityLog.title")}</h3>
      <p className="muted">{t("adminTabs.activityLog.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ minWidth: 220, flex: 1, maxWidth: 320 }}>
          <SearchSelect
            placeholder={t("adminTabs.activityLog.filterByMember")}
            onSearch={searchMembers}
            value={filterMemberName}
            onSelect={(opt) => {
              setFilterMemberId(opt.id);
              setFilterMemberName(opt.label);
              setPage(1);
              void loadEvents(opt.id);
            }}
            onClear={() => {
              setFilterMemberId("");
              setFilterMemberName("");
              void loadEvents();
            }}
          />
        </div>
        <button className="btn" onClick={() => void loadEvents(filterMemberId || undefined)} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {loading && !events.length ? (
        <LoadingSkeleton lines={6} />
      ) : events.length ? (
        <>
          {paginate(events, page, 15).map((evt) => {
            const badgeClass = evt.event_type.includes("payment") || evt.event_type === "subscription_due_paid"
              ? "badge-payment"
              : evt.event_type.includes("overdue")
                ? "badge-overdue"
                : evt.event_type.includes("created")
                  ? "badge-created"
                  : "badge-system";
            return (
              <div key={evt.id} className="activity-event-row">
                <span className={`event-badge ${badgeClass}`}>{toReadableEvent(evt.event_type)}</span>
                <span className="event-meta">{formatDate(evt.event_at)}</span>
                {evt.amount ? <span className="event-meta">{formatAmount(evt.amount)}</span> : null}
                {evt.status_before || evt.status_after ? (
                  <span className="event-meta">{evt.status_before || "—"} → {evt.status_after || "—"}</span>
                ) : null}
                {evt.source ? <span className="event-meta">{t("adminTabs.activityLog.via")} {evt.source}</span> : null}
              </div>
            );
          })}
          <Pagination page={page} total={totalPages(events.length, 15)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<Activity size={32} />} title={t("adminTabs.activityLog.emptyTitle")} description={t("adminTabs.activityLog.emptyDescription")} />
      )}
    </article>
  );
}
