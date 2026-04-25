import { useState, useMemo } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

function normalizePhone(p: string) {
  const d = p.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+${d}` : d.length === 10 ? `+91${d}` : d;
}

export default function RolesTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, churches, admins, loadAdmins } = useApp();

  const [grantPhone, setGrantPhone] = useState("");
  const [grantChurchId, setGrantChurchId] = useState("");
  const [revokePhone, setRevokePhone] = useState("");

  const existingAdminPhones = useMemo(
    () => new Set(admins.map((a) => normalizePhone(a.phone_number || "")).filter(Boolean)),
    [admins],
  );

  const isDuplicate = useMemo(() => {
    const input = normalizePhone(grantPhone.trim());
    return input.length >= 10 && existingAdminPhones.has(input);
  }, [grantPhone, existingAdminPhones]);

  async function grantAdmin() {
    if (!grantPhone.trim()) { setNotice({ tone: "error", text: t("adminTabs.roles.grantPhoneRequired") }); return; }
    if (isDuplicate) { setNotice({ tone: "error", text: t("adminTabs.roles.alreadyAdmin") }); return; }
    const { isUuid } = await import("../../types");
    const churchId = grantChurchId.trim();
    if (churchId && !isUuid(churchId)) { setNotice({ tone: "error", text: t("adminTabs.roles.errorInvalidChurch") }); return; }
    const result = await withAuthRequest(
      "grant",
      () => apiRequest<unknown>("/api/admins/grant", { method: "POST", token, body: { phone_number: grantPhone.trim(), church_id: churchId || undefined } }),
      t("adminTabs.roles.grantSuccess"),
    );
    if (result) { setGrantPhone(""); setGrantChurchId(""); await loadAdmins(); }
  }

  async function revokeAdmin() {
    if (!revokePhone.trim()) { setNotice({ tone: "error", text: t("adminTabs.roles.revokePhoneRequired") }); return; }
    const result = await withAuthRequest(
      "revoke",
      () => apiRequest<unknown>("/api/admins/revoke", { method: "POST", token, body: { phone_number: revokePhone.trim() } }),
      t("adminTabs.roles.revokeSuccess"),
    );
    if (result) { setRevokePhone(""); await loadAdmins(); }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.roles.title")}</h3>
      <div className="field-stack">
        <label>{t("adminTabs.roles.grantPhoneLabel")}<input value={grantPhone} onChange={(e) => setGrantPhone(e.target.value)} placeholder="+91 9876543210" /></label>
        {isDuplicate && <p className="field-hint field-error" style={{ color: "var(--error, #b3261e)", fontSize: "0.82rem", margin: "-0.25rem 0 0" }}>{t("adminTabs.roles.alreadyAdmin")}</p>}
        <label>
          {t("adminTabs.roles.grantChurchLabel")}
          <select value={grantChurchId} onChange={(e) => setGrantChurchId(e.target.value)}>
            <option value="">{t("adminTabs.roles.useCurrentChurch")}</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
          </select>
        </label>
        <div className="actions-row">
          <button className="btn btn-primary" onClick={grantAdmin} disabled={busyKey === "grant" || isDuplicate}>
            {busyKey === "grant" ? t("common.processing") : t("adminTabs.roles.grantButton")}
          </button>
        </div>
        <label>{t("adminTabs.roles.revokePhoneLabel")}<input value={revokePhone} onChange={(e) => setRevokePhone(e.target.value)} placeholder="+91 9876543210" /></label>
        <button className="btn btn-danger" onClick={revokeAdmin} disabled={busyKey === "revoke"}>
          {busyKey === "revoke" ? t("common.processing") : t("adminTabs.roles.revokeButton")}
        </button>
      </div>
    </article>
  );
}
