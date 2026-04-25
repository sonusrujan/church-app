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
  const [routesEnabled, setRoutesEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function loadConfig(targetId?: string) {
    if (!isAdminUser) return;
    const scopedId = isSuperAdmin ? (targetId || churchId || "") : authContext?.auth.church_id || "";
    if (!scopedId) { setEnabled(false); setRoutesEnabled(false); setLoaded(false); return; }
    const query = isSuperAdmin ? `?church_id=${encodeURIComponent(scopedId)}` : "";
    const config = await withAuthRequest(
      "church-payment-config",
      () => apiRequest<ChurchPaymentSettings>(`/api/churches/payment-config${query}`, { token }),
      t("adminTabs.paymentGateway.successConfigLoaded"),
    );
    if (!config) return;
    setEnabled(Boolean(config.payments_enabled));
    setRoutesEnabled(Boolean((config as any).routes_enabled));
    setLoaded(true);
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
        },
      }),
      t("adminTabs.paymentGateway.successConfigSaved"),
    );
    if (!result) return;
    setEnabled(Boolean(result.payments_enabled));
    setRoutesEnabled(Boolean((result as any).routes_enabled));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.paymentGateway.title")}</h3>
      <p className="muted">
        {t("adminTabs.paymentGateway.description")}
        {" "}Payment routing is handled automatically via Razorpay Routes (linked accounts) — no per-church API keys required.
      </p>
      <div className="field-stack">
        {isSuperAdmin && (
          <label>
            {t("admin.church")}
            <select value={churchId} onChange={(e) => { setChurchId(e.target.value); setLoaded(false); }}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        )}
        <label className="checkbox-line">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("adminTabs.paymentGateway.enablePayments")}
        </label>
        {loaded && (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Razorpay Routes:{" "}
            <strong style={{ color: routesEnabled ? "var(--color-success, #16a34a)" : "var(--color-warning, #d97706)" }}>
              {routesEnabled ? "Linked account active" : "Not yet linked — contact super admin"}
            </strong>
          </p>
        )}
      </div>
      <div className="actions-row">
        <button className="btn" onClick={() => void loadConfig()} disabled={busyKey === "church-payment-config"}>
          {busyKey === "church-payment-config" ? t("common.loading") : t("adminTabs.paymentGateway.loadConfig")}
        </button>
        <button className="btn btn-primary" onClick={saveConfig} disabled={busyKey === "save-church-payment-config"}>
          {busyKey === "save-church-payment-config" ? t("common.saving") : t("adminTabs.paymentGateway.savePaymentConfig")}
        </button>
      </div>
    </article>
  );
}
