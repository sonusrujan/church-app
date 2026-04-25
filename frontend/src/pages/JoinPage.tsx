import { useState, useEffect, useCallback } from "react";
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

type ChurchPreview = { name: string; address: string | null; logo_url: string | null };

export default function JoinPage({ token, userEmail, userPhone, onSignOut, onJoined }: Props) {
  const [churchCode, setChurchCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ChurchPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { t } = useI18n();
  const [searchParams] = useSearchParams();

  // Auto-fill church code from QR scan URL param
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && /^\d{8}$/.test(code)) {
      setChurchCode(code);
    }
  }, [searchParams]);

  const fetchPreview = useCallback(async (code: string) => {
    if (!/^\d{8}$/.test(code)) { setPreview(null); return; }
    setPreviewLoading(true);
    try {
      const data = await apiRequest<ChurchPreview>(`/api/churches/preview/${code}`, {});
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Fetch preview when code reaches 8 digits
  useEffect(() => {
    const trimmed = churchCode.trim();
    if (/^\d{8}$/.test(trimmed)) {
      void fetchPreview(trimmed);
    } else {
      setPreview(null);
    }
  }, [churchCode, fetchPreview]);

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

    // Show confirmation dialog first
    if (!showConfirm) {
      setShowConfirm(true);
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
      setShowConfirm(false);
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
              onChange={(e) => { setChurchCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setShowConfirm(false); }}
              placeholder={t("join.churchCodePlaceholder")}
              required
              maxLength={8}
              inputMode="numeric"
              pattern="\d{8}"
              autoFocus
            />
          </label>

          {/* Church preview */}
          {previewLoading && <p className="muted" style={{ fontSize: "0.85rem" }}>{t("common.loading")}</p>}
          {preview && !previewLoading && (
            <div style={{ padding: "0.75rem", background: "var(--surface-container-low, #f5f5f5)", borderRadius: 8, marginBottom: "0.5rem" }}>
              <strong>{preview.name}</strong>
              {preview.address && <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>{preview.address}</p>}
            </div>
          )}

          {/* Confirmation dialog */}
          {showConfirm && preview && (
            <div className="notice notice-info" style={{ marginBottom: "0.75rem" }}>
              <p style={{ margin: 0 }}>{t("join.confirmJoin", { churchName: preview.name })}</p>
            </div>
          )}

          <div className="actions-row join-actions-bottom">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t("common.processing") : showConfirm ? t("join.confirmButton") : t("join.joinButton")}
            </button>
            {showConfirm && (
              <button className="btn" type="button" onClick={() => setShowConfirm(false)}>
                {t("common.cancel")}
              </button>
            )}
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
