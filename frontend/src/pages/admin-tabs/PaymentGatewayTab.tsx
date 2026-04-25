import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import type { ChurchPaymentSettings } from "../../types";
import { useI18n } from "../../i18n";

export default function PaymentGatewayTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, isAdminUser, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [enabled, setEnabled] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [schemaReady, setSchemaReady] = useState(true);

  async function loadConfig(targetId?: string) {
    if (!isAdminUser) return;
    const scopedId = isSuperAdmin ? (targetId || churchId || "") : authContext?.auth.church_id || "";
    if (!scopedId) { setEnabled(false); setKeyId(""); setHasSecret(false); setSchemaReady(true); return; }
    const query = isSuperAdmin ? `?church_id=${encodeURIComponent(scopedId)}` : "";
    const config = await withAuthRequest(
      "church-payment-config",
      () => apiRequest<ChurchPaymentSettings>(`/api/churches/payment-config${query}`, { token }),
      t("adminTabs.paymentGateway.successConfigLoaded"),
    );
    if (!config) return;
    setEnabled(Boolean(config.payments_enabled));
    setKeyId(config.key_id || "");
    setHasSecret(Boolean(config.has_key_secret));
    setSchemaReady(Boolean(config.schema_ready));
    setKeySecret("");
  }

  async function saveConfig() {
    if (!isAdminUser) return;
    const scopedId = isSuperAdmin ? (churchId || "") : authContext?.auth.church_id || "";
    if (!scopedId) { setNotice({ tone: "error", text: t("adminTabs.paymentGateway.errorSelectChurch") }); return; }
    const result = await withAuthRequest(
      "save-church-payment-config",
      () => apiRequest<ChurchPaymentSettings>("/api/churches/payment-config", {
        method: "POST", token,
        body: {
          church_id: isSuperAdmin ? scopedId : undefined,
          payments_enabled: enabled,
          key_id: keyId.trim() || undefined,
          key_secret: keySecret.trim() || undefined,
        },
      }),
      t("adminTabs.paymentGateway.successConfigSaved"),
    );
    if (!result) return;
    setEnabled(Boolean(result.payments_enabled));
    setKeyId(result.key_id || "");
    setHasSecret(Boolean(result.has_key_secret));
    setSchemaReady(Boolean(result.schema_ready));
    setKeySecret("");
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.paymentGateway.title")}</h3>
      <p className="muted">{t("adminTabs.paymentGateway.description")}</p>
      <div className="field-stack">
        <label>
          {t("admin.church")}
          <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
            <option value="">{t("admin.selectChurch")}</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
          </select>
        </label>
        <label className="checkbox-line">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("adminTabs.paymentGateway.enablePayments")}
        </label>
        <label>{t("adminTabs.paymentGateway.razorpayKeyIdLabel")}<input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder={t("adminTabs.paymentGateway.razorpayKeyIdPlaceholder")} /></label>
        <label>{t("adminTabs.paymentGateway.razorpayKeySecretLabel")}<input type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} placeholder={hasSecret ? t("adminTabs.paymentGateway.secretSavedPlaceholder") : t("adminTabs.paymentGateway.pasteSecretPlaceholder")} /></label>
      </div>
      <div className="actions-row">
        <button className="btn" onClick={() => void loadConfig()} disabled={busyKey === "church-payment-config"}>
          {busyKey === "church-payment-config" ? t("common.loading") : t("adminTabs.paymentGateway.loadConfig")}
        </button>
        <button className="btn btn-primary" onClick={saveConfig} disabled={busyKey === "save-church-payment-config" || !schemaReady}>
          {busyKey === "save-church-payment-config" ? t("common.saving") : t("adminTabs.paymentGateway.savePaymentConfig")}
        </button>
      </div>
      {!schemaReady ? <p className="muted">{t("adminTabs.paymentGateway.schemaMissing")}</p> : null}
    </article>
  );
}
