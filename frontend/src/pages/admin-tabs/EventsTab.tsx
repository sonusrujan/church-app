import { useState, useEffect, useCallback } from "react";
import { CalendarDays, Bell, Pencil, Trash2, Plus, Search, X } from "lucide-react";
import { apiRequest, apiUploadRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { EventRow, NotificationRow, ChurchRow } from "../../types";
import { useI18n } from "../../i18n";

const PAGE_SIZE = 8;

export default function EventsTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, setNotice, withAuthRequest, loadEventsAndNotifications } = useApp();

  // ── view mode ──
  const [view, setView] = useState<"events" | "notifications">("events");

  // ── super admin church scope ──
  const [churchQuery, setChurchQuery] = useState("");
  const [churchResults, setChurchResults] = useState<ChurchRow[]>([]);
  const [selectedChurch, setSelectedChurch] = useState<ChurchRow | null>(null);

  // ── data ──
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [evPage, setEvPage] = useState(1);
  const [notPage, setNotPage] = useState(1);

  // ── create / edit form ──
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formEndTime, setFormEndTime] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [imageUploading, setImageUploading] = useState(false);

  // ── helpers ──
  const scopedChurchId = selectedChurch?.id;

  const loadEvents = useCallback(async () => {
    if (isSuperAdmin && !scopedChurchId) {
      const rows = await withAuthRequest("load-events", () =>
        apiRequest<EventRow[]>("/api/engagement/all-events?limit=500", { token }),
      );
      if (rows) setEvents(rows);
    } else {
      const qs = scopedChurchId ? `?church_id=${encodeURIComponent(scopedChurchId)}` : "";
      const rows = await withAuthRequest("load-events", () =>
        apiRequest<EventRow[]>(`/api/engagement/events${qs}`, { token }),
      );
      if (rows) setEvents(rows);
    }
  }, [isSuperAdmin, scopedChurchId, token, withAuthRequest]);

  const loadNotifications = useCallback(async () => {
    if (isSuperAdmin && !scopedChurchId) {
      const rows = await withAuthRequest("load-notifications", () =>
        apiRequest<NotificationRow[]>("/api/engagement/all-notifications?limit=500", { token }),
      );
      if (rows) setNotifications(rows);
    } else {
      const qs = scopedChurchId ? `?church_id=${encodeURIComponent(scopedChurchId)}` : "";
      const rows = await withAuthRequest("load-notifications", () =>
        apiRequest<NotificationRow[]>(`/api/engagement/notifications${qs}`, { token }),
      );
      if (rows) setNotifications(rows);
    }
  }, [isSuperAdmin, scopedChurchId, token, withAuthRequest]);

  useEffect(() => {
    if (view === "events") loadEvents();
    else loadNotifications();
  }, [view, loadEvents, loadNotifications]);

  // ── church search (super admin) ──
  async function searchChurches() {
    if (!isSuperAdmin || !churchQuery.trim()) return;
    const rows = await withAuthRequest("church-search", () =>
      apiRequest<ChurchRow[]>(`/api/churches/search?query=${encodeURIComponent(churchQuery.trim())}`, { token }),
    );
    if (rows) setChurchResults(rows);
  }

  function pickChurch(church: ChurchRow) {
    setSelectedChurch(church);
    setChurchResults([]);
    setChurchQuery("");
    setEvPage(1);
    setNotPage(1);
  }

  function clearChurchScope() {
    setSelectedChurch(null);
    setChurchResults([]);
    setChurchQuery("");
    setEvPage(1);
    setNotPage(1);
  }

  // ── form open / close ──
  function openCreateForm() {
    if (!isSuperAdmin && !selectedChurch) {
      // Regular admin — no need to select a church
    }
    setEditingId(null);
    setFormTitle("");
    setFormMessage("");
    setFormDate("");
    setFormEndTime("");
    setFormLocation("");
    setFormImageUrl("");
    setShowForm(true);
  }

  function openEditEvent(ev: EventRow) {
    setEditingId(ev.id);
    setFormTitle(ev.title);
    setFormMessage(ev.message);
    setFormDate(ev.event_date ? ev.event_date.slice(0, 16) : "");
    setFormEndTime(ev.end_time ? ev.end_time.slice(0, 16) : "");
    setFormLocation(ev.location || "");
    setFormImageUrl(ev.image_url || "");
    setShowForm(true);
  }

  function openEditNotification(n: NotificationRow) {
    setEditingId(n.id);
    setFormTitle(n.title);
    setFormMessage(n.message);
    setFormDate("");
    setFormImageUrl(n.image_url || "");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormImageUrl("");
    setFormEndTime("");
    setFormLocation("");
  }

  // ── Image upload for events/notifications ──
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setImageUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", view === "events" ? "events" : "notifications");
      if (scopedChurchId) form.append("target_church_id", scopedChurchId);

      const data = await apiUploadRequest<{ url: string }>("/api/uploads/image", form, { token });
      setFormImageUrl(data.url);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.events.errorUploadFailed") });
    } finally {
      setImageUploading(false);
      e.target.value = "";
    }
  }

  // ── CRUD actions ──
  async function handleSave() {
    if (!formTitle.trim() || !formMessage.trim()) {
      setNotice({ tone: "error", text: t("adminTabs.events.errorTitleMessageRequired") });
      return;
    }

    const churchIdPayload = scopedChurchId ? { church_id: scopedChurchId } : {};

    if (view === "events") {
      if (editingId) {
        await withAuthRequest("update-event", () =>
          apiRequest(`/api/engagement/events/${editingId}`, {
            method: "PUT", token,
            body: { ...churchIdPayload, title: formTitle.trim(), message: formMessage.trim(), event_date: formDate || null, end_time: formEndTime || null, location: formLocation.trim() || null, image_url: formImageUrl || null },
          }),
          t("adminTabs.events.successEventUpdated"),
        );
      } else {
        await withAuthRequest("post-event", () =>
          apiRequest<EventRow>("/api/engagement/events", {
            method: "POST", token,
            body: { ...churchIdPayload, title: formTitle.trim(), message: formMessage.trim(), event_date: formDate || undefined, end_time: formEndTime || undefined, location: formLocation.trim() || undefined, image_url: formImageUrl || undefined },
          }),
          t("adminTabs.events.successEventCreated"),
        );
      }
      await loadEvents();
    } else {
      if (editingId) {
        await withAuthRequest("update-notification", () =>
          apiRequest(`/api/engagement/notifications/${editingId}`, {
            method: "PUT", token,
            body: { ...churchIdPayload, title: formTitle.trim(), message: formMessage.trim(), image_url: formImageUrl || null },
          }),
          t("adminTabs.events.successNotificationUpdated"),
        );
      } else {
        await withAuthRequest("post-notification", () =>
          apiRequest<NotificationRow>("/api/engagement/notifications", {
            method: "POST", token,
            body: { ...churchIdPayload, title: formTitle.trim(), message: formMessage.trim(), image_url: formImageUrl || undefined },
          }),
          t("adminTabs.events.successNotificationCreated"),
        );
      }
      await loadNotifications();
    }

    closeForm();
    await loadEventsAndNotifications();
  }

  async function handleDeleteEvent(id: string) {
    if (!window.confirm(t("adminTabs.events.confirmDeleteEvent"))) return;
    const qs = scopedChurchId ? `?church_id=${encodeURIComponent(scopedChurchId)}` : "";
    await withAuthRequest("delete-event", () =>
      apiRequest(`/api/engagement/events/${id}${qs}`, { method: "DELETE", token }),
      t("adminTabs.events.successEventDeleted"),
    );
    await loadEvents();
    await loadEventsAndNotifications();
  }

  async function handleDeleteNotification(id: string) {
    if (!window.confirm(t("adminTabs.events.confirmDeleteNotification"))) return;
    const qs = scopedChurchId ? `?church_id=${encodeURIComponent(scopedChurchId)}` : "";
    await withAuthRequest("delete-notification", () =>
      apiRequest(`/api/engagement/notifications/${id}${qs}`, { method: "DELETE", token }),
      t("adminTabs.events.successNotificationDeleted"),
    );
    await loadNotifications();
    await loadEventsAndNotifications();
  }

  // ── render ──
  const canCreate = isSuperAdmin ? !!selectedChurch : true;

  const pagedEvents = paginate(events, evPage, PAGE_SIZE);
  const pagedNotifications = paginate(notifications, notPage, PAGE_SIZE);

  return (
    <article className="panel">
      <h3><CalendarDays size={18} /> {t("adminTabs.events.title")}</h3>

      {/* ── Super admin church selector ── */}
      {isSuperAdmin ? (
        <div className="field-stack" style={{ marginBottom: "1rem", padding: "0.75rem", background: "var(--bg-muted)", borderRadius: 8 }}>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>
            <Search size={14} /> {t("adminTabs.events.churchScopeLabel")}
            {selectedChurch ? (
              <span style={{ fontWeight: 400, marginLeft: 8 }}>
                — {selectedChurch.name} ({selectedChurch.church_code || selectedChurch.id.slice(0, 8)})
                <button className="btn btn-link" onClick={clearChurchScope} style={{ marginLeft: 8, padding: 0 }}>
                  <X size={14} /> {t("adminTabs.events.clearButton")}
                </button>
              </span>
            ) : (
              <span style={{ fontWeight: 400, marginLeft: 8 }}>— {t("adminTabs.events.viewingAllChurches")}</span>
            )}
          </p>
          <div className="actions-row" style={{ gap: 8 }}>
            <input
              value={churchQuery}
              onChange={(e) => setChurchQuery(e.target.value)}
              placeholder={t("adminTabs.events.searchPlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && searchChurches()}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={searchChurches} disabled={busyKey === "church-search" || !churchQuery.trim()}>
              {busyKey === "church-search" ? t("common.searching") : t("common.search")}
            </button>
          </div>
          {churchResults.length > 0 ? (
            <div className="table-wrapper" style={{ marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
              <table className="data-table">
                <thead><tr><th>{t("adminTabs.events.nameHeader")}</th><th>{t("adminTabs.events.codeHeader")}</th><th>{t("adminTabs.events.addressHeader")}</th><th></th></tr></thead>
                <tbody>
                  {churchResults.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.church_code || "—"}</td>
                      <td>{c.address || "—"}</td>
                      <td><button className="btn btn-sm" onClick={() => pickChurch(c)}>{t("adminTabs.events.selectButton")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Tab toggle ── */}
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <button className={`btn${view === "events" ? " btn-primary" : ""}`} onClick={() => { setView("events"); setShowForm(false); }}>
          <CalendarDays size={14} /> {t("adminTabs.events.eventsToggle")}
        </button>
        <button className={`btn${view === "notifications" ? " btn-primary" : ""}`} onClick={() => { setView("notifications"); setShowForm(false); }}>
          <Bell size={14} /> {t("adminTabs.events.notificationsToggle")}
        </button>
        <span style={{ flex: 1 }} />
        {canCreate ? (
          <button className="btn btn-primary" onClick={openCreateForm} disabled={showForm}>
            <Plus size={14} /> {view === "events" ? t("adminTabs.events.newEvent") : t("adminTabs.events.newNotification")}
          </button>
        ) : null}
      </div>

      {/* ── Create / Edit form ── */}
      {showForm ? (
        <div className="field-stack" style={{ marginBottom: "1.5rem", padding: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
          <h4>{editingId ? (view === "events" ? t("adminTabs.events.editEvent") : t("adminTabs.events.editNotification")) : (view === "events" ? t("adminTabs.events.createEvent") : t("adminTabs.events.createNotification"))}</h4>
          <label>
            {t("adminTabs.events.titleLabel")}
            <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder={view === "events" ? t("adminTabs.events.titlePlaceholderEvent") : t("adminTabs.events.titlePlaceholderNotification")} />
          </label>
          <label>
            {t("adminTabs.events.messageLabel")}
            <textarea value={formMessage} onChange={(e) => setFormMessage(e.target.value)} placeholder={t("adminTabs.events.messagePlaceholder")} rows={3} />
          </label>
          {view === "events" ? (
            <>
              <label>
                {t("adminTabs.events.eventDateLabel")}
                <input type="datetime-local" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </label>
              <label>
                {t("adminTabs.events.endTimeLabel")}
                <input type="datetime-local" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
              </label>
              <label>
                {t("adminTabs.events.locationLabel")}
                <input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} placeholder={t("adminTabs.events.locationPlaceholder")} maxLength={500} />
              </label>
            </>
          ) : null}
          <label>
            {t("adminTabs.events.posterLabel")}
            <input type="file" accept="image/*" onChange={handleImageUpload} disabled={imageUploading} />
          </label>
          {imageUploading ? <p style={{ fontSize: "0.85rem", color: "var(--secondary)" }}>{t("adminTabs.events.uploading")}</p> : null}
          {formImageUrl ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <img src={formImageUrl} alt="Preview" style={{ width: 80, height: 50, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }} />
              <button className="btn btn-sm btn-ghost" onClick={() => setFormImageUrl("")} aria-label="Remove image"><X size={14} /></button>
            </div>
          ) : null}
          <div className="actions-row">
            <button className="btn btn-primary" onClick={handleSave} disabled={busyKey === "post-event" || busyKey === "update-event" || busyKey === "post-notification" || busyKey === "update-notification"}>
              {editingId ? t("adminTabs.events.saveChanges") : t("adminTabs.events.createButton")}
            </button>
            <button className="btn" onClick={closeForm}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}

      {/* ── Events list ── */}
      {view === "events" ? (
        events.length === 0 ? (
          <EmptyState title={t("adminTabs.events.noEventsYet")} />
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>{t("adminTabs.events.titleHeader")}</th><th>{t("adminTabs.events.messageHeader")}</th><th>{t("adminTabs.events.locationHeader")}</th><th>{t("adminTabs.events.imageHeader")}</th><th>{t("adminTabs.events.eventDateHeader")}</th><th>{t("adminTabs.events.createdHeader")}</th><th>{t("adminTabs.events.actionsHeader")}</th></tr>
                </thead>
                <tbody>
                  {pagedEvents.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ fontWeight: 600 }}>{ev.title}</td>
                      <td style={{ maxWidth: 300, whiteSpace: "pre-wrap" }}>{ev.message}</td>
                      <td>{ev.location || "—"}</td>
                      <td>{ev.image_url ? <img src={ev.image_url} alt="" style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 4 }} /> : "—"}</td>
                      <td>{ev.event_date ? new Date(ev.event_date).toLocaleString() : "—"}{ev.end_time ? <><br/><span style={{ fontSize: "0.8rem", color: "var(--secondary)" }}>→ {new Date(ev.end_time).toLocaleString()}</span></> : null}</td>
                      <td>{new Date(ev.created_at).toLocaleDateString()}</td>
                      <td>
                        <div className="actions-row" style={{ gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditEvent(ev)} title="Edit"><Pencil size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteEvent(ev.id)} title="Delete" disabled={busyKey === "delete-event"}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={evPage} total={totalPages(events.length, PAGE_SIZE)} onPageChange={setEvPage} />
          </>
        )
      ) : null}

      {/* ── Notifications list ── */}
      {view === "notifications" ? (
        notifications.length === 0 ? (
          <EmptyState title={t("adminTabs.events.noNotificationsYet")} />
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>{t("adminTabs.events.titleHeader")}</th><th>{t("adminTabs.events.messageHeader")}</th><th>{t("adminTabs.events.imageHeader")}</th><th>{t("adminTabs.events.createdHeader")}</th><th>{t("adminTabs.events.actionsHeader")}</th></tr>
                </thead>
                <tbody>
                  {pagedNotifications.map((n) => (
                    <tr key={n.id}>
                      <td style={{ fontWeight: 600 }}>{n.title}</td>
                      <td style={{ maxWidth: 300, whiteSpace: "pre-wrap" }}>{n.message}</td>
                      <td>{n.image_url ? <img src={n.image_url} alt="" style={{ width: 48, height: 32, objectFit: "cover", borderRadius: 4 }} /> : "—"}</td>
                      <td>{new Date(n.created_at).toLocaleDateString()}</td>
                      <td>
                        <div className="actions-row" style={{ gap: 4 }}>
                          <button className="btn btn-sm" onClick={() => openEditNotification(n)} title="Edit"><Pencil size={14} /></button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDeleteNotification(n.id)} title="Delete" disabled={busyKey === "delete-notification"}><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={notPage} total={totalPages(notifications.length, PAGE_SIZE)} onPageChange={setNotPage} />
          </>
        )
      ) : null}
    </article>
  );
}
