import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Sparkles, Check, Clock, Edit2, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import type { ChurchLeadershipRow } from "../types";
import { useI18n } from "../i18n";

interface PrayerRequestRow {
  id: string;
  church_id: string;
  member_id: string;
  member_name: string;
  member_email: string;
  details: string;
  status: string;
  created_at: string;
}

export default function PrayerRequestPage() {
  const { token, memberDashboard, withAuthRequest, busyKey, setNotice } = useApp();
  const navigate = useNavigate();
  const { t } = useI18n();

  const [selectedLeaderIds, setSelectedLeaderIds] = useState<string[]>([]);
  const [prayerDetails, setPrayerDetails] = useState("");
  const [showDialog, setShowDialog] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [myRequests, setMyRequests] = useState<PrayerRequestRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load pastoral leaders (DC, Presbyter, Pastor) from leadership hierarchy
  const [leaders, setLeaders] = useState<ChurchLeadershipRow[]>([]);
  const churchId = memberDashboard?.church?.id;

  const loadLeaders = useCallback(async () => {
    if (!token || !churchId) return;
    try {
      const data = await apiRequest<ChurchLeadershipRow[]>(
        `/api/leadership/pastoral/${encodeURIComponent(churchId)}`,
        { token },
      );
      setLeaders(data);
    } catch {
      // silently fail
    }
  }, [token, churchId]);

  useEffect(() => {
    void loadLeaders();
  }, [loadLeaders]);

  const loadMyRequests = useCallback(async () => {
    if (!token || !churchId) return;
    try {
      const data = await apiRequest<PrayerRequestRow[]>(
        `/api/engagement/prayer-requests?church_id=${encodeURIComponent(churchId)}`,
        { token },
      );
      setMyRequests(data);
    } catch {
      // silently fail
    }
  }, [token, churchId]);

  useEffect(() => {
    void loadMyRequests();
  }, [loadMyRequests]);

  async function handleEditPrayer(id: string) {
    if (!editText.trim() || !churchId) return;
    const result = await withAuthRequest(
      "edit-prayer",
      () => apiRequest(`/api/engagement/prayer-requests/${id}`, {
        method: "PATCH",
        token,
        body: { details: editText.trim(), church_id: churchId },
      }),
      t("prayer.editSuccess"),
    );
    if (result) {
      setEditingId(null);
      setEditText("");
      void loadMyRequests();
    }
  }

  async function handleDeletePrayer(id: string) {
    if (!churchId) return;
    const result = await withAuthRequest(
      "delete-prayer",
      () => apiRequest(`/api/engagement/prayer-requests/${id}?church_id=${encodeURIComponent(churchId)}`, {
        method: "DELETE",
        token,
      }),
      t("prayer.deleteSuccess"),
    );
    if (result) {
      setDeletingId(null);
      void loadMyRequests();
    }
  }

  function toggleLeader(id: string) {
    setSelectedLeaderIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function selectAll() {
    setSelectedLeaderIds(leaders.map((l) => l.id));
    setShowDialog(true);
  }

  function openDialog() {
    if (!selectedLeaderIds.length) {
      setNotice({ tone: "error", text: t("prayer.errorSelectLeader") });
      return;
    }
    setShowDialog(true);
  }

  async function handleSubmit() {
    if (!prayerDetails.trim()) {
      setNotice({ tone: "error", text: t("prayer.errorDescribeNeed") });
      return;
    }

    const result = await withAuthRequest(
      "prayer-request",
      () =>
        apiRequest<{ prayer_request: { id: string } }>("/api/engagement/prayer-requests", {
          method: "POST",
          token,
          body: { church_id: memberDashboard?.church?.id, leader_ids: selectedLeaderIds, details: prayerDetails.trim() },
        }),
      t("prayer.successSubmitted"),
    );

    if (result) {
      setSubmitted(true);
      setPrayerDetails("");
      setSelectedLeaderIds([]);
      setShowDialog(false);
      void loadMyRequests();
    }
  }

  if (submitted) {
    return (
      <div className="prayer-page">
        <div className="prayer-success">
          <div className="prayer-success-check">
            <Check size={40} />
          </div>
          <h2 className="prayer-success-title">{t("prayer.requestSent")}</h2>
          <p className="prayer-success-text">
            {t("prayer.requestSentDescription")}
          </p>
          <div className="prayer-success-actions">
            <button className="prayer-btn-primary" onClick={() => navigate("/dashboard")}>
              {t("prayer.backToDashboard")}
            </button>
            <button
              className="prayer-btn-outline"
              onClick={() => setSubmitted(false)}
            >
              {t("prayer.sendAnother")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="prayer-page">
      {/* Back nav */}
      <button className="prayer-back" onClick={() => navigate("/dashboard")}>
        <ArrowLeft size={18} />
        <span>{t("prayer.dashboard")}</span>
      </button>

      {/* Hero */}
      <div className="prayer-hero">
        <h1 className="prayer-hero-title">{t("prayer.selectPastor")}</h1>
        <p className="prayer-hero-sub">
          {t("prayer.heroDescription")}
        </p>
      </div>

      {/* Leader Grid */}
      <div className="prayer-grid">
        {leaders.map((leader) => (
          <div
            key={leader.id}
            className={`prayer-card ${selectedLeaderIds.includes(leader.id) ? "prayer-card--selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={selectedLeaderIds.includes(leader.id)}
            onClick={() => toggleLeader(leader.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLeader(leader.id); } }}
          >
            <div className="prayer-avatar-circle">
              {leader.photo_url ? (
                <img src={leader.photo_url} alt={leader.full_name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
              ) : (
                leader.full_name.charAt(0)
              )}
            </div>
            <div className="prayer-card-body">
              <span className="prayer-card-role">{leader.role_name || t("prayer.pastor")}</span>
              <h3 className="prayer-card-name">{leader.full_name}</h3>
              {leader.bio && (
                <p className="prayer-card-desc">{leader.bio}</p>
              )}
            </div>
            <button
              className={`prayer-btn-select ${selectedLeaderIds.includes(leader.id) ? "prayer-btn-select--active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleLeader(leader.id);
              }}
            >
              {selectedLeaderIds.includes(leader.id) ? t("prayer.selected") : t("prayer.select")}
            </button>
            {selectedLeaderIds.includes(leader.id) && (
              <div className="prayer-card-check">
                <Check size={16} />
              </div>
            )}
          </div>
        ))}

        {/* General Request CTA */}
        {leaders.length > 0 && (
          <div className="prayer-card-general" role="button" tabIndex={0} onClick={selectAll} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectAll(); } }}>
            <Sparkles size={32} />
            <h3 className="prayer-general-title">{t("prayer.generalRequest")}</h3>
            <p className="prayer-general-desc">
              {t("prayer.generalDescription")}
            </p>
            <button
              className="prayer-btn-general"
              onClick={(e) => {
                e.stopPropagation();
                selectAll();
              }}
            >
              {t("prayer.sendToAll")}
            </button>
          </div>
        )}
      </div>

      {/* Floating action bar */}
      {selectedLeaderIds.length > 0 && !showDialog ? (
        <div className="prayer-fab">
          <span className="prayer-fab-count">
            {t("prayer.pastorsSelected", { n: String(selectedLeaderIds.length) })}
          </span>
          <button className="prayer-btn-primary" onClick={openDialog}>
            {t("prayer.continue")}
            <Send size={16} />
          </button>
        </div>
      ) : null}

      {leaders.length === 0 ? (
        <div className="prayer-empty">
          <p>{t("prayer.noPastors")}</p>
        </div>
      ) : null}

      {/* Prayer Details Dialog */}
      {showDialog ? (
        <div
          className="prayer-dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t("prayer.shareNeed")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDialog(false);
          }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowDialog(false); }}
        >
          <div className="prayer-dialog">
            <h3 className="prayer-dialog-title">{t("prayer.shareNeed")}</h3>
            <p className="prayer-dialog-sub">
              {t("prayer.dialogDescription", { target: selectedLeaderIds.length === leaders.length
                ? t("prayer.allPastors")
                : t("prayer.selectedPastors", { n: String(selectedLeaderIds.length) }) })}
            </p>
            <textarea
              className="prayer-dialog-textarea"
              value={prayerDetails}
              onChange={(e) => setPrayerDetails(e.target.value)}
              placeholder={t("prayer.placeholder")}
              rows={5}
              autoFocus
            />
            <div className="prayer-dialog-actions">
              <button
                className="prayer-btn-outline"
                onClick={() => setShowDialog(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="prayer-btn-primary"
                onClick={handleSubmit}
                disabled={busyKey === "prayer-request" || !prayerDetails.trim()}
              >
                {busyKey === "prayer-request" ? t("prayer.sending") : t("prayer.sendRequest")}
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* My Prayer Requests History */}
      {myRequests.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "1.15rem", marginBottom: "1rem" }}>
            <Clock size={20} /> {t("prayer.myPrayerRequests")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {myRequests.map((pr) => (
              <div
                key={pr.id}
                style={{
                  padding: "1rem",
                  background: "var(--surface-container-low, #f5f5f5)",
                  border: "1px solid var(--outline-variant, #ddd)",
                  borderRadius: "var(--radius-md, 12px)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      background: pr.status === "sent" ? "#e6f4ea" : pr.status === "pending" ? "#fff8e1" : "#f0f0f0",
                      color: pr.status === "sent" ? "#1b7a3d" : pr.status === "pending" ? "#b8860b" : "#666",
                    }}
                  >
                    {pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "var(--outline, #999)" }}>
                    {new Date(pr.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--on-surface, #333)" }}>
                  {editingId === pr.id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        style={{ fontSize: "0.9rem", padding: "0.5rem", borderRadius: 8, border: "1px solid #ddd" }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="prayer-btn-primary" onClick={() => void handleEditPrayer(pr.id)} disabled={!editText.trim() || busyKey === "edit-prayer"} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
                          {t("common.save")}
                        </button>
                        <button className="prayer-btn-outline" onClick={() => { setEditingId(null); setEditText(""); }} style={{ fontSize: "0.8rem", padding: "4px 12px" }}>
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    pr.details
                  )}
                </p>
                {editingId !== pr.id && (
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <button
                      style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--primary, #1565c0)", padding: 0 }}
                      onClick={() => { setEditingId(pr.id); setEditText(pr.details); }}
                    >
                      <Edit2 size={12} /> {t("common.edit")}
                    </button>
                    {deletingId === pr.id ? (
                      <span style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {t("prayer.confirmDelete")}
                        <button
                          style={{ fontSize: "0.75rem", background: "none", border: "none", cursor: "pointer", color: "var(--error, #c33)", fontWeight: 600 }}
                          onClick={() => void handleDeletePrayer(pr.id)}
                          disabled={busyKey === "delete-prayer"}
                        >
                          {t("common.yes")}
                        </button>
                        <button
                          style={{ fontSize: "0.75rem", background: "none", border: "none", cursor: "pointer", color: "var(--outline, #666)" }}
                          onClick={() => setDeletingId(null)}
                        >
                          {t("common.no")}
                        </button>
                      </span>
                    ) : (
                      <button
                        style={{ fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--error, #c33)", padding: 0 }}
                        onClick={() => setDeletingId(pr.id)}
                      >
                        <Trash2 size={12} /> {t("common.delete")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
