import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

export default function RolesTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, churches, loadAdmins } = useApp();

  const [grantIdentifier, setGrantIdentifier] = useState("");
  const [grantChurchId, setGrantChurchId] = useState("");
  const [revokeIdentifier, setRevokeIdentifier] = useState("");

  function parseIdentifier(val: string): { email?: string; phone_number?: string } {
    const trimmed = val.trim();
    if (/^\+?\d[\d\s-]{6,14}$/.test(trimmed.replace(/[\s-]/g, ""))) {
      return { phone_number: trimmed };
    }
    return { email: trimmed };
  }

  async function grantAdmin() {
    if (!grantIdentifier.trim()) { setNotice({ tone: "error", text: t("adminTabs.roles.grantEmailRequired") }); return; }
    const { isUuid } = await import("../../types");
    const churchId = grantChurchId.trim();
    if (churchId && !isUuid(churchId)) { setNotice({ tone: "error", text: "Selected church is invalid." }); return; }
    const ident = parseIdentifier(grantIdentifier);
    const result = await withAuthRequest(
      "grant",
      () => apiRequest<unknown>("/api/admins/grant", { method: "POST", token, body: { ...ident, church_id: churchId || undefined } }),
      t("adminTabs.roles.grantSuccess"),
    );
    if (result) { setGrantIdentifier(""); await loadAdmins(); }
  }

  async function revokeAdmin() {
    if (!revokeIdentifier.trim()) { setNotice({ tone: "error", text: t("adminTabs.roles.revokeEmailRequired") }); return; }
    const ident = parseIdentifier(revokeIdentifier);
    const result = await withAuthRequest(
      "revoke",
      () => apiRequest<unknown>("/api/admins/revoke", { method: "POST", token, body: ident }),
      t("adminTabs.roles.revokeSuccess"),
    );
    if (result) { setRevokeIdentifier(""); await loadAdmins(); }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.roles.title")}</h3>
      <div className="field-stack">
        <label>{t("adminTabs.roles.grantEmailLabel")}<input value={grantIdentifier} onChange={(e) => setGrantIdentifier(e.target.value)} placeholder="Phone or email" /></label>
        <label>
          {t("adminTabs.roles.grantChurchLabel")}
          <select value={grantChurchId} onChange={(e) => setGrantChurchId(e.target.value)}>
            <option value="">{t("adminTabs.roles.useCurrentChurch")}</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
          </select>
        </label>
        <div className="actions-row">
          <button className="btn btn-primary" onClick={grantAdmin} disabled={busyKey === "grant"}>
            {busyKey === "grant" ? t("common.processing") : t("adminTabs.roles.grantButton")}
          </button>
        </div>
        <label>{t("adminTabs.roles.revokeEmailLabel")}<input value={revokeIdentifier} onChange={(e) => setRevokeIdentifier(e.target.value)} placeholder="Phone or email" /></label>
        <button className="btn btn-danger" onClick={revokeAdmin} disabled={busyKey === "revoke"}>
          {busyKey === "revoke" ? t("common.processing") : t("adminTabs.roles.revokeButton")}
        </button>
      </div>
    </article>
  );
}
