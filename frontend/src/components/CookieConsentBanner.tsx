import { useState, useEffect } from "react";
import { useI18n } from "../i18n";

const CONSENT_KEY = "shalom_cookie_consent";

export default function CookieConsentBanner() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY);
    // Also check cookie in case localStorage was cleared
    const hasCookie = document.cookie.split(";").some((c) => c.trim().startsWith(`${CONSENT_KEY}=`));
    if (!consent && !hasCookie) setVisible(true);
  }, []);

  function accept() {
    localStorage.setItem(CONSENT_KEY, "accepted");
    // L-1: Set a browser cookie so consent is accessible server-side and survives XSS on localStorage
    document.cookie = `${CONSENT_KEY}=accepted; max-age=${365 * 24 * 60 * 60}; path=/; SameSite=Strict; Secure`;
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "var(--surface-container, #2d2640)",
        color: "var(--on-surface, #fff)",
        padding: "1rem 1.5rem",
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        paddingLeft: "calc(1.5rem + env(safe-area-inset-left, 0px))",
        paddingRight: "calc(1.5rem + env(safe-area-inset-right, 0px))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        flexWrap: "wrap",
        boxShadow: "0 -2px 8px rgba(0,0,0,0.15)",
        fontSize: "0.9rem",
      }}
    >
      <p style={{ margin: 0, maxWidth: 600 }}>
        {t("cookie.message")}{" "}
        <a href="/privacy" style={{ color: "var(--primary)", textDecoration: "underline" }}>
          {t("cookie.learnMore")}
        </a>
      </p>
      <button
        className="btn btn-primary"
        onClick={accept}
        style={{ whiteSpace: "nowrap" }}
      >
        {t("cookie.accept")}
      </button>
    </div>
  );
}
