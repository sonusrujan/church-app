import { useState, useMemo, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, CheckCheck, MapPin, Users, UserCheck } from "lucide-react";
import { apiRequest } from "../lib/api";
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
    token,
    loadEventsAndNotifications,
  } = useApp();
  const { t } = useI18n();

  const [eventsPage, setEventsPage] = useState(1);
  const [notificationsPage, setNotificationsPage] = useState(1);

  // RSVP state
  type RsvpSummary = { going: number; interested: number; myStatus: string | null };
  const [rsvpData, setRsvpData] = useState<Record<string, RsvpSummary>>({});
  const [rsvpBusy, setRsvpBusy] = useState<string | null>(null);

  // Load RSVP summaries when events change
  useEffect(() => {
    if (!events.length || !token) return;
    const ids = events.map((e) => e.id);
    apiRequest<Record<string, RsvpSummary>>("/api/engagement/events/rsvp-summaries", {
      method: "POST", token, body: { event_ids: ids },
    }).then((data) => { if (data) setRsvpData(data); }).catch(() => {});
  }, [events, token]);

  const handleRsvp = useCallback(async (eventId: string, status: "going" | "interested") => {
    if (!token || rsvpBusy) return;
    setRsvpBusy(eventId);
    try {
      await apiRequest("/api/engagement/events/" + eventId + "/rsvp", {
        method: "POST", token, body: { status },
      });
      // Refresh summaries
      const ids = events.map((e) => e.id);
      const data = await apiRequest<Record<string, RsvpSummary>>("/api/engagement/events/rsvp-summaries", {
        method: "POST", token, body: { event_ids: ids },
      });
      if (data) setRsvpData(data);
    } catch {} finally { setRsvpBusy(null); }
  }, [token, rsvpBusy, events]);

  // Read/unread tracking — server-backed with localStorage cache
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("shalom_read_notifications");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Load server-side read IDs on mount
  useEffect(() => {
    if (!token) return;
    apiRequest<string[]>("/api/engagement/notifications/read-ids", { token })
      .then((ids) => {
        if (ids && ids.length) {
          setReadIds((prev) => {
            const merged = new Set(prev);
            for (const id of ids) merged.add(id);
            localStorage.setItem("shalom_read_notifications", JSON.stringify([...merged]));
            return merged;
          });
        }
      })
      .catch(() => {});
  }, [token]);

  const markAsRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("shalom_read_notifications", JSON.stringify([...next]));
      return next;
    });
    // Persist to server
    if (token) apiRequest("/api/engagement/notifications/mark-read", { method: "POST", token, body: { notification_ids: [id] } }).catch(() => {});
  }, [token]);

  const markAllRead = useCallback(() => {
    const allIds = notifications.map((n) => n.id);
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of allIds) next.add(id);
      localStorage.setItem("shalom_read_notifications", JSON.stringify([...next]));
      return next;
    });
    // Persist to server
    if (token) apiRequest("/api/engagement/notifications/mark-read", { method: "POST", token, body: { notification_ids: allIds } }).catch(() => {});
  }, [notifications, token]);

  const unreadCount = useMemo(() => notifications.filter((n) => !readIds.has(n.id)).length, [notifications, readIds]);

  function addToCalendar(title: string, message: string, eventDate: string, endTime?: string | null, location?: string | null) {
    const start = new Date(eventDate);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT",
      `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${title}`, `DESCRIPTION:${message.replace(/\n/g, "\\n")}`,
    ];
    if (location) lines.push(`LOCATION:${location.replace(/[,;]/g, " ")}`);
    lines.push("END:VEVENT", "END:VCALENDAR");
    const ics = lines.join("\r\n");
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "var(--radius-md)", marginBottom: "0.75rem" }}
                    />
                  ) : null}
                  <strong>{eventItem.title}</strong>
                  <span className="prose-block">{eventItem.message}</span>
                  <span className="numeric-meta">
                    {t("events.eventDate")} {formatDate(eventItem.event_date)}
                    {eventItem.end_time ? ` — ${formatDate(eventItem.end_time)}` : null}
                  </span>
                  {eventItem.location ? (
                    <span className="numeric-meta"><MapPin size={13} style={{ verticalAlign: "middle" }} /> {eventItem.location}</span>
                  ) : null}
                  <span className="numeric-meta">{t("events.posted")} {formatDate(eventItem.created_at)}</span>
                  {eventItem.event_date ? (
                    <div className="actions-row" style={{ marginTop: "0.5rem", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => addToCalendar(eventItem.title, eventItem.message || "", eventItem.event_date!, eventItem.end_time, eventItem.location)}
                      >
                        <CalendarPlus size={14} /> {t("events.addToCalendar")}
                      </button>
                      <button
                        className={`btn btn-sm${rsvpData[eventItem.id]?.myStatus === "going" ? " btn-primary" : ""}`}
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => handleRsvp(eventItem.id, "going")}
                        disabled={rsvpBusy === eventItem.id}
                      >
                        <UserCheck size={14} /> {t("events.going")} {rsvpData[eventItem.id]?.going ? `(${rsvpData[eventItem.id].going})` : ""}
                      </button>
                      <button
                        className={`btn btn-sm${rsvpData[eventItem.id]?.myStatus === "interested" ? " btn-primary" : ""}`}
                        style={{ fontSize: "0.8rem" }}
                        onClick={() => handleRsvp(eventItem.id, "interested")}
                        disabled={rsvpBusy === eventItem.id}
                      >
                        <Users size={14} /> {t("events.interested")} {rsvpData[eventItem.id]?.interested ? `(${rsvpData[eventItem.id].interested})` : ""}
                      </button>
                    </div>
                  ) : null}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>{t("events.notifications")} {unreadCount > 0 ? <span className="group-badge">{unreadCount}</span> : null}</h3>
          {unreadCount > 0 ? (
            <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
              <CheckCheck size={14} /> {t("events.markAllRead")}
            </button>
          ) : null}
        </div>
        <div className="list-stack">
          {notifications.length ? (
            <>
              {paginate(notifications, notificationsPage, 8).map((notification) => {
                const isUnread = !readIds.has(notification.id);
                return (
                <div
                  key={notification.id}
                  className="list-item"
                  style={isUnread ? { borderLeft: "3px solid var(--primary)", paddingLeft: "0.75rem", fontWeight: 600 } : undefined}
                  onClick={() => { if (isUnread) markAsRead(notification.id); }}
                >
                  {notification.image_url ? (
                    <img
                      src={notification.image_url}
                      alt={notification.title}
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: "var(--radius-md)", marginBottom: "0.75rem" }}
                    />
                  ) : null}
                  <strong>{notification.title}</strong>
                  <span className="prose-block" style={{ fontWeight: 400 }}>{notification.message}</span>
                  <span className="numeric-meta">
                    {t("events.posted")} {formatDate(notification.created_at)}
                  </span>
                </div>
                );
              })}
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
