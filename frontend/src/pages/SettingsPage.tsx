import { useState, useEffect } from "react";
import { Sun, Moon, LogOut, Globe, Bell, BellOff } from "lucide-react";
import { useI18n, LANGUAGES, type SupportedLanguage } from "../i18n";
import { useDarkMode } from "../context/DarkModeContext";
import { useApp } from "../context/AppContext";
import { useNavigate } from "react-router-dom";
import { getPushStatus, isSubscribed, subscribeToPush, unsubscribeFromPush } from "../lib/pushSubscription";

export default function SettingsPage({ busyKey }: { busyKey: string }) {
  const { language, setLanguage, t } = useI18n();
  const { darkMode: darkModeOn, toggleDarkMode } = useDarkMode();
  const { token, setNotice } = useApp();
  const navigate = useNavigate();

  const pushSupported = getPushStatus() !== "unsupported";
  const pushDenied = getPushStatus() === "denied";
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported) return;
    isSubscribed().then(setPushEnabled).catch(() => {});
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

  return (
    <div className="page-content">
      <article className="panel">
        <h3>{t("settings.title")}</h3>

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
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "2px 0 0" }}>
                    {t("settings.pushBlocked")}
                  </p>
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

        {/* Sign Out */}
        <div className="settings-row settings-row-danger">
          <div className="settings-row-label">
            <LogOut size={18} />
            <span>{t("nav.signOut")}</span>
          </div>
          <button
            className="btn btn-danger"
            onClick={() => navigate("/signout")}
            disabled={busyKey === "logout"}
          >
            {busyKey === "logout" ? t("auth.signingOut") : t("nav.signOut")}
          </button>
        </div>
      </article>
    </div>
  );
}
