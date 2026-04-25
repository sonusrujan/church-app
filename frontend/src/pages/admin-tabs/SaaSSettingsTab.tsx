import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import type { ChurchSaaSSettings } from "../../types";

export default function SaaSSettingsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [settings, setSettings] = useState<ChurchSaaSSettings | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadSettings(targetId?: string) {
    const id = targetId || churchId;
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiRequest<ChurchSaaSSettings>(`/api/saas/settings/${id}`, { token });
      setSettings(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.saasSettings.loadFailed") });
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    const result = await withAuthRequest(
      "save-saas-settings",
      () => apiRequest<ChurchSaaSSettings>(`/api/saas/settings/${settings.church_id}`, {
        method: "PATCH", token,
        body: {
          member_subscription_enabled: settings.member_subscription_enabled,
          church_subscription_enabled: settings.church_subscription_enabled,
          church_subscription_amount: settings.church_subscription_amount,
          platform_fee_enabled: settings.platform_fee_enabled,
          platform_fee_percentage: settings.platform_fee_percentage,
          service_enabled: settings.service_enabled,
        },
      }),
      t("adminTabs.saasSettings.saveSuccess"),
    );
    if (result) setSettings(result);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.saasSettings.title")}</h3>
      <p className="muted">{t("adminTabs.saasSettings.description")}</p>
      <div className="field-stack">
        <label>
          {t("admin.church")}
          <select value={churchId} onChange={(e) => { setChurchId(e.target.value); setSettings(null); }}>
            <option value="">{t("admin.selectChurch")}</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
          </select>
        </label>
        <div className="actions-row">
          <button className="btn" onClick={() => void loadSettings()} disabled={loading || !churchId}>
            {loading ? t("common.loading") : t("adminTabs.saasSettings.loadSettingsButton")}
          </button>
        </div>
        {settings ? (
          <>
            <label className="checkbox-line">
              <input type="checkbox" checked={settings.service_enabled} onChange={(e) => setSettings({ ...settings, service_enabled: e.target.checked })} />
              {t("adminTabs.saasSettings.serviceEnabled")}
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={settings.member_subscription_enabled} onChange={(e) => setSettings({ ...settings, member_subscription_enabled: e.target.checked })} />
              {t("adminTabs.saasSettings.enableMemberSubscriptions")}
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={settings.church_subscription_enabled} onChange={(e) => setSettings({ ...settings, church_subscription_enabled: e.target.checked })} />
              {t("adminTabs.saasSettings.enableChurchSubscription")}
            </label>
            {settings.church_subscription_enabled ? (
              <label>{t("adminTabs.saasSettings.churchSubscriptionAmountLabel")}
                <input type="number" min="0" step="100" value={settings.church_subscription_amount} onChange={(e) => setSettings({ ...settings, church_subscription_amount: parseFloat(e.target.value) || 0 })} />
              </label>
            ) : null}
            <label className="checkbox-line">
              <input type="checkbox" checked={settings.platform_fee_enabled} onChange={(e) => setSettings({ ...settings, platform_fee_enabled: e.target.checked })} />
              {t("adminTabs.saasSettings.enablePlatformFee")}
            </label>
            {settings.platform_fee_enabled ? (
              <label>{t("adminTabs.saasSettings.platformFeeLabel")}
                <input type="number" min="0" max="100" step="0.5" value={settings.platform_fee_percentage} onChange={(e) => setSettings({ ...settings, platform_fee_percentage: parseFloat(e.target.value) || 0 })} />
              </label>
            ) : null}
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button className="btn btn-primary" onClick={() => void saveSettings()} disabled={busyKey === "save-saas-settings"}>
                {busyKey === "save-saas-settings" ? t("common.saving") : t("adminTabs.saasSettings.saveButton")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
