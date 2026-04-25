import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { useI18n } from "../i18n";

type Props = {
  token: string;
  userEmail: string;
  userPhone: string;
  onSignOut: () => void;
  onJoined: () => void;
};

export default function JoinPage({ token, userEmail, userPhone, onSignOut, onJoined }: Props) {
  const [churchCode, setChurchCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { t } = useI18n();
  const [searchParams] = useSearchParams();

  // Auto-fill church code from QR scan URL param
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && /^\d{8}$/.test(code)) {
      setChurchCode(code);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedCode = churchCode.trim();

    if (!trimmedCode) {
      setError(t("join.codeRequired"));
      return;
    }
    if (!/^\d{8}$/.test(trimmedCode)) {
      setError(t("join.codeMustBe8Digits"));
      return;
    }

    setBusy(true);
    try {
      await apiRequest("/api/auth/join-church", {
        method: "POST",
        token,
        body: { church_code: trimmedCode },
      });
      onJoined();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("join.errorJoinFailed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card join-card-narrow">
        <h1>{t("join.joinChurch")}</h1>
        <p className="muted">
          {t("join.enterChurchCode", { identity: userPhone || userEmail })}
        </p>

        {error ? <div className="notice notice-error">{error}</div> : null}

        <form onSubmit={handleSubmit} className="join-form">
          <label>
            {t("join.churchCode")} <span className="join-required">*</span>
            <input
              value={churchCode}
              onChange={(e) => setChurchCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder={t("join.churchCodePlaceholder")}
              required
              maxLength={8}
              inputMode="numeric"
              pattern="\d{8}"
              autoFocus
            />
          </label>

          <div className="actions-row join-actions-bottom">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t("common.processing") : t("join.joinButton")}
            </button>
            <button className="btn" type="button" onClick={onSignOut}>
              {t("nav.signOut")}
            </button>
          </div>
        </form>

        <div className="muted" style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.875rem", lineHeight: 1.6 }}>
          <p>{t("join.noCodeHint")}</p>
          <Link to="/explore" className="explore-church-link" style={{ marginTop: "0.5rem", display: "inline-flex" }}>
            {t("join.exploreChurches")}
          </Link>
        </div>
      </section>
    </div>
  );
}
