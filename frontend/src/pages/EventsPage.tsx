import { useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import Pagination, { paginate, totalPages } from "../components/Pagination";
import { formatDate } from "../types";

export default function EventsPage() {
  const {
    isSuperAdmin,
    events,
    notifications,
    busyKey,
    loadEventsAndNotifications,
  } = useApp();
  const { t } = useI18n();

  const [eventsPage, setEventsPage] = useState(1);
  const [notificationsPage, setNotificationsPage] = useState(1);

  return (
    <section className="page-grid">
      <article className="panel panel-wide">
        <h3>{t("events.churchEvents")}</h3>
        <div className="actions-row">
          <button
            className="btn"
            onClick={loadEventsAndNotifications}
            disabled={busyKey === "events" || busyKey === "notifications"}
          >
            {t("events.refreshEvents")}
          </button>
        </div>
        <div className="list-stack">
          {events.length ? (
            <>
              {paginate(events, eventsPage, 8).map((eventItem) => (
                <div key={eventItem.id} className="list-item">
                  {eventItem.image_url ? (
                    <img
                      src={eventItem.image_url}
                      alt={eventItem.title}
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "var(--radius-md)", marginBottom: "0.5rem" }}
                    />
                  ) : null}
                  <strong>{eventItem.title}</strong>
                  <span className="prose-block">{eventItem.message}</span>
                  <span className="numeric-meta">
                    {t("events.eventDate")} {formatDate(eventItem.event_date)}
                  </span>
                  <span className="numeric-meta">{t("events.posted")} {formatDate(eventItem.created_at)}</span>
                </div>
              ))}
              <Pagination page={eventsPage} total={totalPages(events.length, 8)} onPageChange={setEventsPage} />
            </>
          ) : (
            <p className="muted empty-state">{t("events.noEvents")}</p>
          )}
        </div>
      </article>

      <article className="panel panel-wide">
        <h3>{t("events.notifications")}</h3>
        <div className="list-stack">
          {notifications.length ? (
            <>
              {paginate(notifications, notificationsPage, 8).map((notification) => (
                <div key={notification.id} className="list-item">
                  {notification.image_url ? (
                    <img
                      src={notification.image_url}
                      alt={notification.title}
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "var(--radius-md)", marginBottom: "0.5rem" }}
                    />
                  ) : null}
                  <strong>{notification.title}</strong>
                  <span className="prose-block">{notification.message}</span>
                  <span className="numeric-meta">
                    {t("events.posted")} {formatDate(notification.created_at)}
                  </span>
                </div>
              ))}
              <Pagination page={notificationsPage} total={totalPages(notifications.length, 8)} onPageChange={setNotificationsPage} />
            </>
          ) : (
            <p className="muted empty-state">{t("events.noNotifications")}</p>
          )}
        </div>
      </article>

      {!isSuperAdmin ? (
        <article className="panel panel-wide">
          <h3>{t("events.requestPrayer")}</h3>
          <p className="muted">
            {t("events.prayerCallToAction")}
          </p>
          <div className="actions-row">
            <Link to="/prayer-request" className="btn btn-primary">
              {t("events.goToPrayerRequests")}
            </Link>
          </div>
        </article>
      ) : null}
    </section>
  );
}
