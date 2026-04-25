import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import type { TrialStatus } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function TrialTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice: _setNotice, withAuthRequest, churches } = useApp();

  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [months, setMonths] = useState("3");
  const [status, setStatus] = useState<TrialStatus | null>(null);

  async function loadStatus() {
    if (!churchId) return;
    const s = await withAuthRequest("trial-status", () =>
      apiRequest<TrialStatus>(`/api/admin/trial?church_id=${encodeURIComponent(churchId)}`, { token })
    );
    if (s) setStatus(s);
  }

  async function grant() {
    await withAuthRequest("grant-trial", async () => {
      await apiRequest("/api/admin/trial/grant", {
        method: "POST", token, body: { church_id: churchId, months: Number(months) },
      });
      void loadStatus();
    }, t("adminTabs.trial.grantSuccess"));
  }

  async function revoke() {
    await withAuthRequest("revoke-trial", async () => {
      await apiRequest("/api/admin/trial/revoke", {
        method: "POST", token, body: { church_id: churchId },
      });
      void loadStatus();
    }, t("adminTabs.trial.revokeSuccess"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.trial.title")}</h3>
      <p className="muted">{t("adminTabs.trial.description")}</p>
      <div className="field-stack">
        <label>
          {t("admin.church")}
          <select value={churchId} onChange={(e) => { setChurchId(e.target.value); setStatus(null); }}>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.church_code})</option>)}
          </select>
        </label>
        <div className="actions-row">
          <button className="btn" onClick={() => void loadStatus()} disabled={busyKey === "trial-status" || !churchId}>
            {busyKey === "trial-status" ? t("common.loading") : t("adminTabs.trial.checkStatusButton")}
          </button>
        </div>
        {status ? (
          <div style={{ background: "var(--bg-muted, #f7f7f7)", padding: 12, borderRadius: 8, marginTop: 8 }}>
            <p><strong>Status:</strong> {status.is_active ? t("adminTabs.trial.statusActive") : t("adminTabs.trial.statusInactive")}</p>
            {status.is_active ? <p><strong>{t("adminTabs.trial.daysRemainingLabel")}</strong> {status.days_remaining}</p> : null}
            {status.trial_ends_at ? <p><strong>{t("adminTabs.trial.endsAtLabel")}</strong> {formatDate(status.trial_ends_at)}</p> : null}
          </div>
        ) : null}
        <label>
          {t("adminTabs.trial.trialDurationLabel")}
          <input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} />
        </label>
        <div className="actions-row">
          <button className="btn btn-primary" onClick={() => void grant()} disabled={busyKey === "grant-trial" || !churchId}>
            {busyKey === "grant-trial" ? t("common.processing") : t("adminTabs.trial.grantTrialButton")}
          </button>
          <button className="btn" onClick={() => void revoke()} disabled={busyKey === "revoke-trial" || !churchId}>
            {busyKey === "revoke-trial" ? t("common.processing") : t("adminTabs.trial.revokeTrialButton")}
          </button>
        </div>
      </div>
    </article>
  );
}
