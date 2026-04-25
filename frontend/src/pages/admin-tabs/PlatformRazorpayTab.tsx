import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

type PlatformConfigState = {
  key_id: string;
  has_key_secret: boolean;
  public_donation_fee_percent: number;
};

export default function PlatformRazorpayTab() {
  const { t } = useI18n();
  const { token, busyKey, withAuthRequest } = useApp();

  const [config, setConfig] = useState<PlatformConfigState | null>(null);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [donationFeePercent, setDonationFeePercent] = useState(5);

  async function loadConfig() {
    const data = await withAuthRequest(
      "load-platform-config",
      () => apiRequest<PlatformConfigState>("/api/saas/platform-config", { token }),
      t("adminTabs.platformRazorpay.configLoadedSuccess"),
    );
    if (!data) return;
    setConfig(data);
    setKeyId(data.key_id || "");
    setKeySecret("");
    setDonationFeePercent(data.public_donation_fee_percent ?? 5);
  }

  async function saveConfig() {
    const result = await withAuthRequest(
      "save-platform-config",
      () => apiRequest<PlatformConfigState>("/api/saas/platform-config", {
        method: "POST",
        token,
        body: {
          key_id: keyId.trim() || undefined,
          key_secret: keySecret.trim() || undefined,
          public_donation_fee_percent: donationFeePercent,
        },
      }),
      t("adminTabs.platformRazorpay.configSavedSuccess"),
    );
    if (!result) return;
    setConfig(result);
    setKeyId(result.key_id || "");
    setKeySecret("");
    setDonationFeePercent(result.public_donation_fee_percent ?? 5);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.platformRazorpay.title")}</h3>
      <p className="muted">
        {t("adminTabs.platformRazorpay.description")}
      </p>

      <div className="field-stack" style={{ marginTop: "1rem" }}>
        <label>
          {t("adminTabs.platformRazorpay.keyIdLabel")}
          <input
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
            placeholder={t("adminTabs.platformRazorpay.keyIdPlaceholder")}
          />
        </label>
        <label>
          {t("adminTabs.platformRazorpay.keySecretLabel")}
          <input
            type="password"
            value={keySecret}
            onChange={(e) => setKeySecret(e.target.value)}
            placeholder={
              config?.has_key_secret
                ? t("adminTabs.platformRazorpay.keySecretPlaceholderSaved")
                : t("adminTabs.platformRazorpay.keySecretPlaceholderNew")
            }
          />
        </label>
      </div>

      <div className="field-stack" style={{ marginTop: "1.25rem" }}>
        <label>
          {t("adminTabs.platformRazorpay.donationFeeLabel")}
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={donationFeePercent}
            onChange={(e) => setDonationFeePercent(Number(e.target.value))}
          />
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {t("adminTabs.platformRazorpay.donationFeeHint")}
          </span>
        </label>
      </div>

      <div className="actions-row" style={{ marginTop: "0.75rem" }}>
        <button
          className="btn"
          onClick={() => void loadConfig()}
          disabled={busyKey === "load-platform-config"}
        >
          {busyKey === "load-platform-config" ? t("common.loading") : t("adminTabs.platformRazorpay.loadConfigButton")}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void saveConfig()}
          disabled={busyKey === "save-platform-config"}
        >
          {busyKey === "save-platform-config" ? t("common.saving") : t("adminTabs.platformRazorpay.saveConfigButton")}
        </button>
      </div>

      {config ? (
        <div style={{ marginTop: "1rem", padding: "0.75rem", borderRadius: 8, background: "var(--color-success-bg, #f0fdf4)", fontSize: "0.85rem" }}>
          <strong>Status:</strong>{" "}
          {config.key_id && config.has_key_secret ? (
            <span style={{ color: "var(--color-success, #16a34a)" }}>{t("adminTabs.platformRazorpay.statusConfigured")}</span>
          ) : (
            <span style={{ color: "var(--color-warning, #d97706)" }}>{t("adminTabs.platformRazorpay.statusNotConfigured")}</span>
          )}
        </div>
      ) : null}
    </article>
  );
}
