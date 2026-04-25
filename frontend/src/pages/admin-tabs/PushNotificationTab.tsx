import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import { apiRequest } from "../../lib/api";

type DioceseOption = { id: string; name: string };
type ChurchOption = { id: string; name: string; diocese_id: string | null };
type MemberOption = { id: string; full_name: string; email: string | null; church_id: string };

type NotificationBatch = {
  id: string;
  channel: string;
  scope: string;
  scope_id: string | null;
  title: string | null;
  body: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  cancelled_count: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  counts?: {
    total: number;
    pending: number;
    sent: number;
    delivered: number;
    failed: number;
    cancelled: number;
  };
};

export default function PushNotificationTab() {
  const { t } = useI18n();
  const { token, busyKey, setBusyKey, setNotice } = useApp();

  const [dioceses, setDioceses] = useState<DioceseOption[]>([]);
  const [churches, setChurches] = useState<ChurchOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);

  const [selectedDiocese, setSelectedDiocese] = useState("");
  const [selectedChurch, setSelectedChurch] = useState("");
  const [selectedMember, setSelectedMember] = useState("");
  const [channel, setChannel] = useState<"push" | "sms">("push");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("/");

  // Tracking state
  const [batches, setBatches] = useState<NotificationBatch[]>([]);
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<NotificationBatch | null>(null);
  const [loadingBatches, setLoadingBatches] = useState(false);

  // Load dioceses on mount
  useEffect(() => {
    apiRequest<DioceseOption[]>("/api/push/dioceses", { token }).then(setDioceses).catch(() => {});
  }, [token]);

  // Load churches when diocese changes
  useEffect(() => {
    const url = selectedDiocese
      ? `/api/push/churches?diocese_id=${selectedDiocese}`
      : "/api/push/churches";
    apiRequest<ChurchOption[]>(url, { token }).then(setChurches).catch(() => {});
    setSelectedChurch("");
    setSelectedMember("");
  }, [selectedDiocese, token]);

  // Load members when church changes
  useEffect(() => {
    if (!selectedChurch) {
      setMembers([]);
      setSelectedMember("");
      return;
    }
    apiRequest<MemberOption[]>(`/api/push/members?church_id=${selectedChurch}`, { token })
      .then(setMembers)
      .catch(() => {});
    setSelectedMember("");
  }, [selectedChurch, token]);

  const scopeLabel = selectedMember
    ? t("adminTabs.pushNotification.scopeSelectedMember")
    : selectedChurch
      ? t("adminTabs.pushNotification.scopeSelectedChurch")
      : selectedDiocese
        ? t("adminTabs.pushNotification.scopeSelectedDiocese")
        : t("adminTabs.pushNotification.scopeGlobal");

  // ── Batch tracking ──
  const fetchBatches = useCallback(() => {
    setLoadingBatches(true);
    apiRequest<NotificationBatch[]>("/api/push/notification-batches?limit=20", { token })
      .then(setBatches)
      .catch(() => {})
      .finally(() => setLoadingBatches(false));
  }, [token]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Auto-refresh batches that are still sending
  useEffect(() => {
    const hasSending = batches.some((b) => b.status === "sending");
    if (!hasSending) return;
    const timer = setInterval(fetchBatches, 5000);
    return () => clearInterval(timer);
  }, [batches, fetchBatches]);

  // Auto-refresh expanded batch detail
  useEffect(() => {
    if (!expandedBatch) { setBatchDetail(null); return; }
    let cancelled = false;
    const load = () => {
      apiRequest<NotificationBatch>(`/api/push/notification-batches/${expandedBatch}`, { token })
        .then((d) => { if (!cancelled) setBatchDetail(d); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [expandedBatch, token]);

  async function handleSend() {
    if (!message.trim()) {
      setNotice({ tone: "error", text: t("adminTabs.pushNotification.messageRequired") });
      return;
    }
    if (channel === "push" && !title.trim()) {
      setNotice({ tone: "error", text: t("adminTabs.pushNotification.titleRequiredForPush") });
      return;
    }

    setBusyKey("send-notif");
    try {
      const result = await apiRequest<{ queued: number; batch_id: string; message: string }>("/api/push/send-notification", {
        method: "POST",
        token,
        body: {
          diocese_id: selectedDiocese || undefined,
          church_id: selectedChurch || undefined,
          member_id: selectedMember || undefined,
          channel,
          title: title.trim(),
          message: message.trim(),
          url: channel === "push" ? url : undefined,
        },
      });
      setNotice({ tone: "success", text: result.message || t("adminTabs.pushNotification.notificationsQueued", { count: result.queued }) });
      setTitle("");
      setMessage("");
      setUrl("/");
      // Refresh batches and expand the new one
      fetchBatches();
      if (result.batch_id) setExpandedBatch(result.batch_id);
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("adminTabs.pushNotification.sendFailed") });
    } finally {
      setBusyKey("");
    }
  }

  async function handleCancelBatch(batchId: string) {
    setBusyKey("cancel-batch");
    try {
      const result = await apiRequest<{ cancelled: number; message: string }>(`/api/push/notification-batches/${batchId}/cancel`, {
        method: "POST",
        token,
        body: {},
      });
      setNotice({ tone: "success", text: result.message });
      fetchBatches();
      if (expandedBatch === batchId) {
        // Refresh detail
        apiRequest<NotificationBatch>(`/api/push/notification-batches/${batchId}`, { token })
          .then(setBatchDetail).catch(() => {});
      }
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("adminTabs.pushNotification.cancelFailed") });
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: "0.25rem" }}>{t("adminTabs.pushNotification.title")}</h2>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
        {t("adminTabs.pushNotification.description")}
      </p>

      <div className="field-stack" style={{ maxWidth: 560 }}>
        {/* Channel selector */}
        <label>
          {t("adminTabs.pushNotification.channelLabel")}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              type="button"
              className={`btn ${channel === "push" ? "btn-primary" : ""}`}
              onClick={() => setChannel("push")}
              style={{ flex: 1 }}
            >
              {t("adminTabs.pushNotification.pushNotificationButton")}
            </button>
            <button
              type="button"
              className={`btn ${channel === "sms" ? "btn-primary" : ""}`}
              onClick={() => setChannel("sms")}
              style={{ flex: 1 }}
            >
              {t("adminTabs.pushNotification.smsButton")}
            </button>
          </div>
        </label>

        {/* Filters */}
        <label>
          {t("adminTabs.pushNotification.dioceseLabel")} <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{t("adminTabs.pushNotification.optionalFilter")}</span>
          <select value={selectedDiocese} onChange={(e) => setSelectedDiocese(e.target.value)}>
            <option value="">{t("adminTabs.pushNotification.allDiocesesOption")}</option>
            {dioceses.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>

        <label>
          {t("adminTabs.pushNotification.churchLabel")} <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{t("adminTabs.pushNotification.optionalFilter")}</span>
          <select value={selectedChurch} onChange={(e) => setSelectedChurch(e.target.value)}>
            <option value="">{selectedDiocese ? t("adminTabs.pushNotification.allChurchesInDioceseOption") : t("adminTabs.pushNotification.allChurchesOption")}</option>
            {churches.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {selectedChurch && members.length > 0 && (
          <label>
            {t("adminTabs.pushNotification.memberLabel")} <span className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>{t("adminTabs.pushNotification.optionalSelectOne")}</span>
            <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}>
              <option value="">{t("adminTabs.pushNotification.allMembersInChurchOption")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name}{m.email ? ` (${m.email})` : ""}</option>
              ))}
            </select>
          </label>
        )}

        <div
          style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "6px",
            fontSize: "0.82rem",
            background: "var(--tertiary-container, #e0fdff)",
            color: "var(--primary, #2E2A5A)",
            fontWeight: 500,
          }}
        >
          {t("adminTabs.pushNotification.scopeLabel")} {scopeLabel}
        </div>

        {/* Message fields */}
        {channel === "push" && (
          <label>
            {t("adminTabs.pushNotification.titleLabel")}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("adminTabs.pushNotification.titlePlaceholder")}
              maxLength={120}
            />
          </label>
        )}

        <label>
          {t("adminTabs.pushNotification.messageLabel")}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={channel === "sms" ? t("adminTabs.pushNotification.smsPlaceholder") : t("adminTabs.pushNotification.pushPlaceholder")}
            rows={4}
            maxLength={channel === "sms" ? 320 : 1000}
            style={{ resize: "vertical", minHeight: 80 }}
          />
          {channel === "sms" && (
            <span className="muted" style={{ fontSize: "0.75rem" }}>
              {t("adminTabs.pushNotification.charsCount", { count: message.length })}
            </span>
          )}
        </label>

        {channel === "push" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {t("adminTabs.pushNotification.landingPageLabel")}
            <select value={url} onChange={(e) => setUrl(e.target.value)} className="input">
              <option value="/">{t("adminTabs.pushNotification.pageHome")}</option>
              <option value="/dashboard">{t("adminTabs.pushNotification.pageDashboard")}</option>
              <option value="/events">{t("adminTabs.pushNotification.pageEvents")}</option>
              <option value="/prayer-request">{t("adminTabs.pushNotification.pagePrayerRequests")}</option>
              <option value="/donate">{t("adminTabs.pushNotification.pageDonate")}</option>
              <option value="/history">{t("adminTabs.pushNotification.pagePaymentHistory")}</option>
              <option value="/profile">{t("adminTabs.pushNotification.pageProfile")}</option>
              <option value="/settings">{t("adminTabs.pushNotification.pageSettings")}</option>
            </select>
          </label>
        )}

        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={busyKey === "send-notif" || !message.trim()}
          style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}
        >
          {busyKey === "send-notif" ? t("adminTabs.pushNotification.sending") : channel === "push" ? t("adminTabs.pushNotification.sendPushButton") : t("adminTabs.pushNotification.sendSmsButton")}
        </button>
      </div>

      {/* ───── Notification Tracking ───── */}
      <div style={{ marginTop: "2.5rem", borderTop: "1px solid var(--border, #e2e2e2)", paddingTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h2 style={{ margin: 0 }}>{t("adminTabs.pushNotification.sentNotificationsTitle")}</h2>
          <button className="btn" onClick={fetchBatches} disabled={loadingBatches} style={{ fontSize: "0.8rem" }}>
            {loadingBatches ? t("adminTabs.pushNotification.refreshing") : "↻ "  + t("common.refresh")}
          </button>
        </div>

        {batches.length === 0 && !loadingBatches && (
          <p className="muted" style={{ fontSize: "0.85rem" }}>{t("adminTabs.pushNotification.noNotificationsSent")}</p>
        )}

        {batches.map((b) => {
          const isExpanded = expandedBatch === b.id;
          const detail = isExpanded ? batchDetail : null;
          const counts = detail?.counts || {
            total: b.total_count,
            pending: 0,
            sent: b.sent_count,
            delivered: 0,
            failed: b.failed_count,
            cancelled: b.cancelled_count,
          };
          const hasPending = b.status === "sending";
          const statusColor = b.status === "completed" ? "#16a34a" : b.status === "cancelled" ? "#9ca3af" : b.status === "partially_failed" ? "#dc2626" : "#f59e0b";
          const statusLabel = b.status === "sending" ? t("adminTabs.pushNotification.statusInProgress") : b.status === "completed" ? t("adminTabs.pushNotification.statusCompleted") : b.status === "cancelled" ? t("adminTabs.pushNotification.statusCancelled") : t("adminTabs.pushNotification.statusPartiallyFailed");

          return (
            <div
              key={b.id}
              style={{
                border: "1px solid var(--border, #e2e2e2)",
                borderRadius: 8,
                marginBottom: "0.75rem",
                overflow: "hidden",
              }}
            >
              {/* Batch header row */}
              <div
                onClick={() => setExpandedBatch(isExpanded ? null : b.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  cursor: "pointer",
                  background: isExpanded ? "var(--surface-container, #f5f5f5)" : "transparent",
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>{b.channel === "push" ? "🔔" : "💬"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.title || b.body.slice(0, 60)}{b.body.length > 60 && !b.title ? "…" : ""}
                  </div>
                  <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.15rem" }}>
                    {b.channel.toUpperCase()} · {b.scope} · {new Date(b.created_at).toLocaleString()}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 12,
                    background: statusColor + "1a",
                    color: statusColor,
                    whiteSpace: "nowrap",
                  }}
                >
                  {statusLabel}
                </span>
                <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>{b.total_count} {t("adminTabs.pushNotification.sent")}</span>
                <span style={{ fontSize: "0.85rem", transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▼</span>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border, #e2e2e2)" }}>
                  {/* Message preview */}
                  <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "var(--surface-container, #f9f9f9)", borderRadius: 6, fontSize: "0.85rem" }}>
                    {b.title && <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{b.title}</div>}
                    <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{b.body}</div>
                  </div>

                  {/* Status bar */}
                  {detail && (
                    <>
                      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                        <StatusPill label={t("adminTabs.pushNotification.pillTotal")} count={counts.total} color="#6b7280" />
                        <StatusPill label={t("adminTabs.pushNotification.pillPending")} count={counts.pending} color="#f59e0b" />
                        <StatusPill label={t("adminTabs.pushNotification.pillSent")} count={counts.sent + counts.delivered} color="#16a34a" />
                        <StatusPill label={t("adminTabs.pushNotification.pillFailed")} count={counts.failed} color="#dc2626" />
                        {counts.cancelled > 0 && <StatusPill label={t("adminTabs.pushNotification.pillCancelled")} count={counts.cancelled} color="#9ca3af" />}
                      </div>

                      {/* Progress bar */}
                      {counts.total > 0 && (
                        <div style={{ height: 6, borderRadius: 3, background: "#e5e7eb", overflow: "hidden", marginBottom: "0.75rem" }}>
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 3,
                              width: `${((counts.sent + counts.delivered + counts.failed + counts.cancelled) / counts.total) * 100}%`,
                              background: counts.failed > 0 ? "linear-gradient(90deg, #16a34a, #dc2626)" : "#16a34a",
                              transition: "width 0.5s ease",
                            }}
                          />
                        </div>
                      )}
                    </>
                  )}

                  {!detail && <p className="muted" style={{ fontSize: "0.8rem" }}>{t("adminTabs.pushNotification.loadingDetails")}</p>}

                  {/* Cancel button */}
                  {hasPending && (
                    <button
                      className="btn"
                      onClick={(e) => { e.stopPropagation(); handleCancelBatch(b.id); }}
                      disabled={busyKey === "cancel-batch"}
                      style={{
                        fontSize: "0.8rem",
                        color: "#dc2626",
                        borderColor: "#dc2626",
                      }}
                    >
                      {busyKey === "cancel-batch" ? t("adminTabs.pushNotification.cancelling") : t("adminTabs.pushNotification.cancelPendingButton")}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{
      fontSize: "0.75rem",
      fontWeight: 600,
      padding: "2px 10px",
      borderRadius: 12,
      background: color + "15",
      color,
    }}>
      {label}: {count}
    </span>
  );
}
