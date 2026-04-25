import { useState, useEffect, useCallback } from "react";
import { Activity } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { SubscriptionEventRow } from "../../types";
import { formatAmount, formatDate, toReadableEvent } from "../../types";
import { useI18n } from "../../i18n";

export default function ActivityLogTab() {
  const { t } = useI18n();
  const { token, setNotice } = useApp();

  const [events, setEvents] = useState<SubscriptionEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const loadEvents = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<SubscriptionEventRow[]>("/api/subscriptions/activity?limit=200", { token });
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
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <button className="btn" onClick={() => void loadEvents()} disabled={loading}>
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
