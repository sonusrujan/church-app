import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, Globe, Bell, BellOff, Trash2, User, Download } from "lucide-react";
import { useI18n, LANGUAGES, type SupportedLanguage } from "../i18n";
import { useDarkMode } from "../context/DarkModeContext";
import { useApp } from "../context/AppContext";
import { useNavigate, Link } from "react-router-dom";
import { getPushStatus, isSubscribed, subscribeToPush, unsubscribeFromPush } from "../lib/pushSubscription";
import { apiRequest, apiBlobRequest } from "../lib/api";

export default function SettingsPage({ busyKey }: { busyKey: string }) {
  const { language, setLanguage, t } = useI18n();
  const { darkMode: darkModeOn, toggleDarkMode } = useDarkMode();
  const { token, setNotice } = useApp();
  const navigate = useNavigate();

  const pushSupported = getPushStatus() !== "unsupported";
  const pushDenied = getPushStatus() === "denied";
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  // Notification category preferences
  const NOTIFY_CATEGORIES = ["events", "payments", "prayer", "family", "announcements"] as const;
  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, boolean>>({});
  const [notifyPrefsLoaded, setNotifyPrefsLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiRequest<Record<string, boolean>>("/api/engagement/notification-preferences", { token })
      .then((prefs) => { if (prefs) { setNotifyPrefs(prefs); setNotifyPrefsLoaded(true); } })
      .catch(() => {});
  }, [token]);

  async function toggleNotifyPref(category: string) {
    if (!token) return;
    const current = notifyPrefs[category] !== false;
    const updated = { ...notifyPrefs, [category]: !current };
    setNotifyPrefs(updated);
    try {
      await apiRequest("/api/engagement/notification-preferences", {
        method: "PUT", token, body: { category, enabled: !current },
      });
    } catch {
      setNotifyPrefs(notifyPrefs); // rollback
    }
  }

  useEffect(() => {
    if (!pushSupported) return;
    isSubscribed().then(setPushEnabled).catch((e) => console.warn("Failed to check push status", e));
  }, [pushSupported]);

  async function handleTogglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushEnabled) {
        const ok = await unsubscribeFromPush(token);
        if (ok) {
          setPushEnabled(false);
          setNotice({ tone: "success", text: t("settings.pushDisabled") });
        }
      } else {
        const ok = await subscribeToPush(token);
        if (ok) {
          setPushEnabled(true);
          setNotice({ tone: "success", text: t("settings.pushEnabled") });
        } else if (Notification.permission === "denied") {
          setNotice({ tone: "error", text: t("settings.pushBlockedNotice") });
        } else {
          setNotice({ tone: "error", text: t("settings.pushFailed") });
        }
      }
    } catch {
      setNotice({ tone: "error", text: t("settings.pushUpdateFailed") });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleExportMyData() {
    if (exportBusy || !token) return;
    setExportBusy(true);
    try {
      const blob = await apiBlobRequest("/api/auth/export-my-data", {
        token,
        accept: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", text: t("settings.exportSuccess") });
    } catch {
      setNotice({ tone: "error", text: t("settings.exportFailed") });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleDeleteAccountRequest() {
    if (deleteBusy) return;
    if (deleteConfirmText !== "DELETE") return;
    setDeleteBusy(true);
    try {
      await apiRequest("/api/requests/account-deletion-requests", {
        method: "POST",
        token,
        body: { reason: deleteReason.trim() || undefined },
      });
      setShowDeleteModal(false);
      setDeleteReason("");
      setDeleteConfirmText("");
      setNotice({ tone: "success", text: t("settings.deleteRequestSent") });
    } catch (err: any) {
      setNotice({ tone: "error", text: err?.message || t("settings.deleteRequestFailed") });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="page-content">
      <article className="panel">
        <h3>{t("settings.title")}</h3>

        {/* Edit Profile link */}
        <div className="settings-row">
          <div className="settings-row-label">
            <User size={18} />
            <span>{t("settings.editProfile")}</span>
          </div>
          <Link to="/profile" className="btn btn-ghost">
            {t("settings.goToProfile")}
          </Link>
        </div>

        {/* Language */}
        <div className="settings-row">
          <div className="settings-row-label">
            <Globe size={18} />
            <span>{t("language.selectLanguage")}</span>
          </div>
          <select
            className="settings-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as SupportedLanguage)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeLabel} ({lang.label})
              </option>
            ))}
          </select>
        </div>

        {/* Dark Mode */}
        <div className="settings-row">
          <div className="settings-row-label">
            {darkModeOn ? <Sun size={18} /> : <Moon size={18} />}
            <span>{darkModeOn ? t("settings.lightMode") : t("settings.darkMode")}</span>
          </div>
          <button className="btn btn-ghost" onClick={toggleDarkMode}>
            {darkModeOn ? t("settings.switchToLight") : t("settings.switchToDark")}
          </button>
        </div>

        {/* Push Notifications */}
        {pushSupported && (
          <div className="settings-row">
            <div className="settings-row-label">
              {pushEnabled ? <Bell size={18} /> : <BellOff size={18} />}
              <div>
                <span>{t("settings.pushNotifications")}</span>
                {pushDenied && (
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "2px 0 0" }}>
                    <p style={{ margin: 0 }}>{t("settings.pushBlocked")}</p>
                    <p style={{ margin: "4px 0 0", lineHeight: 1.4 }}>{t("settings.pushBlockedInstructions")}</p>
                  </div>
                )}
              </div>
            </div>
            <button
              className={`btn ${pushEnabled ? "btn-ghost" : "btn-primary"}`}
              onClick={handleTogglePush}
              disabled={pushBusy || pushDenied}
            >
              {pushBusy ? "..." : pushEnabled ? t("settings.disable") : t("settings.enable")}
            </button>
          </div>
        )}

        {/* Per-category notification preferences */}
        {notifyPrefsLoaded && (
          <div style={{ marginTop: "0.5rem" }}>
            <p style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: 8 }}>{t("settings.notifyCategories")}</p>
            {NOTIFY_CATEGORIES.map((cat) => (
              <div key={cat} className="settings-row" style={{ padding: "0.4rem 0" }}>
                <span style={{ fontSize: "0.85rem" }}>{t(`settings.notifyCat_${cat}`)}</span>
                <button
                  className={`btn btn-sm ${notifyPrefs[cat] !== false ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => toggleNotifyPref(cat)}
                  style={{ minWidth: 60 }}
                >
                  {notifyPrefs[cat] !== false ? t("settings.on") : t("settings.off")}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Data Export */}
        <div className="settings-row">
          <div className="settings-row-label">
            <Download size={18} />
            <div>
              <span>{t("settings.exportMyData")}</span>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "2px 0 0" }}>
                {t("settings.exportMyDataHint")}
              </p>
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={handleExportMyData}
            disabled={exportBusy}
          >
            {exportBusy ? t("common.processing") : t("settings.downloadData")}
          </button>
        </div>

        {/* ── Danger Zone ── */}
        <div className="settings-danger-zone">
          <p className="settings-danger-zone-label">{t("settings.dangerZone")}</p>

        {/* Sign Out */}
        <div className="settings-row settings-row-danger">
          <div className="settings-row-label">
            <LogOut size={18} />
            <span>{t("nav.signOut")}</span>
          </div>
          <button
            className="btn btn-danger"
            onClick={() => setShowSignOutConfirm(true)}
            disabled={busyKey === "logout"}
          >
            {busyKey === "logout" ? t("auth.signingOut") : t("nav.signOut")}
          </button>
        </div>

        {/* Delete Account */}
        <div className="settings-row settings-row-danger">
          <div className="settings-row-label">
            <Trash2 size={18} />
            <div>
              <span>{t("settings.deleteAccount")}</span>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "2px 0 0" }}>
                {t("settings.deleteAccountHint")}
              </p>
            </div>
          </div>
          <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>
            {t("settings.deleteAccount")}
          </button>
        </div>
        </div>
      </article>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => !deleteBusy && setShowDeleteModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("settings.deleteAccount")}>
            <h3 style={{ color: "var(--error, #d32f2f)", marginBottom: "0.75rem" }}>{t("settings.deleteAccount")}</h3>
            <div className="notice notice-error" style={{ marginBottom: "1rem" }}>
              <strong>{t("settings.deleteWarningTitle")}</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                <li>{t("settings.deleteWarning1")}</li>
                <li>{t("settings.deleteWarning2")}</li>
                <li>{t("settings.deleteWarning3")}</li>
                <li>{t("settings.deleteWarning4")}</li>
              </ul>
            </div>
            <p style={{ fontSize: "0.9rem", marginBottom: "1rem", color: "var(--on-surface-variant)" }}>
              {t("settings.deleteAdminNote")}
            </p>
            <label style={{ display: "block", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{t("settings.typeDeleteToConfirm")}</span>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                style={{ width: "100%", marginTop: "0.25rem", fontFamily: "monospace" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: "1rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>{t("settings.deleteReasonLabel")}</span>
              <textarea
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder={t("settings.deleteReasonPlaceholder")}
                rows={3}
                minLength={5}
                maxLength={500}
                style={{ width: "100%", marginTop: "0.25rem" }}
              />
              {deleteReason.trim().length > 0 && deleteReason.trim().length < 5 && (
                <p style={{ color: "var(--error, #d32f2f)", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
                  {t("settings.deleteReasonMinLength") || "Reason must be at least 5 characters."}
                </p>
              )}
            </label>
            <div className="actions-row">
              <button className="btn" onClick={() => setShowDeleteModal(false)} disabled={deleteBusy}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-danger" onClick={handleDeleteAccountRequest} disabled={deleteBusy || deleteConfirmText !== "DELETE" || (deleteReason.trim().length > 0 && deleteReason.trim().length < 5)}>
                {deleteBusy ? t("common.processing") : t("settings.confirmDeleteRequest")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sign Out Confirmation Modal */}
      {showSignOutConfirm && (
        <div className="modal-overlay" onClick={() => setShowSignOutConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("nav.signOut")}>
            <h3 style={{ marginBottom: "0.75rem" }}>{t("settings.signOutConfirmTitle")}</h3>
            <p style={{ marginBottom: "1rem", color: "var(--on-surface-variant)" }}>{t("settings.signOutConfirmDesc")}</p>
            <div className="actions-row">
              <button className="btn" onClick={() => setShowSignOutConfirm(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-danger" onClick={() => { setShowSignOutConfirm(false); navigate("/signout"); }}>
                {t("nav.signOut")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
