import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import type { PreRegisterResult } from "../../types";
import { useI18n } from "../../i18n";
import { normalizeIndianPhone } from "../../types";

export default function PreRegisterTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [phone, setPhone] = useState("+91 ");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [result, setResult] = useState<PreRegisterResult | null>(null);

  async function preRegister() {
    if (!phone.trim() && !email.trim()) { setNotice({ tone: "error", text: "Phone number or email is required." }); return; }
    const { isUuid } = await import("../../types");
    const cid = churchId.trim();
    if (cid && !isUuid(cid)) { setNotice({ tone: "error", text: "Selected church is invalid." }); return; }
    const amountText = amount.trim();
    let amountValue: number | undefined;
    if (amountText) {
      amountValue = Number(amountText);
      if (!Number.isFinite(amountValue) || amountValue < 0) { setNotice({ tone: "error", text: "Subscription amount must be a positive number." }); return; }
      if (amountValue !== 0 && amountValue < 200) { setNotice({ tone: "error", text: "Subscription amount must be at least ₹200 (or 0 to skip)." }); return; }
    }
    const res = await withAuthRequest(
      "pre-register",
      () => apiRequest<PreRegisterResult>("/api/admins/pre-register-member", {
        method: "POST", token,
        body: {
          phone_number: phone.trim() ? normalizeIndianPhone(phone) : undefined,
          email: email.trim() || undefined,
          full_name: name.trim() || undefined,
          membership_id: membershipId.trim() || undefined,
          address: address.trim() || undefined,
          subscription_amount: amountValue,
          church_id: cid || undefined,
        },
      }),
      "Member pre-registered.",
    );
    if (res) {
      setResult(res);
      setPhone("+91 "); setEmail(""); setName(""); setMembershipId(""); setAddress(""); setAmount("");
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.preRegister.title")}</h3>
      <p className="muted">{t("adminTabs.preRegister.description")}</p>
      <div className="field-stack">
        <label>Phone Number (primary) <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
        <label>{t("adminTabs.preRegister.emailLabel")} (optional) <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("adminTabs.preRegister.emailPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.fullNameLabel")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("adminTabs.preRegister.fullNamePlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.membershipIdLabel")}<input value={membershipId} onChange={(e) => setMembershipId(e.target.value)} placeholder={t("adminTabs.preRegister.membershipIdPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.addressLabel")}<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("adminTabs.preRegister.addressPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.subscriptionAmountLabel")}<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.preRegister.subscriptionAmountPlaceholder")} /></label>
        {isSuperAdmin ? (
          <label>
            {t("admin.church")}
            <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
              <option value="">{t("adminTabs.preRegister.useOwnChurchOption")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <button className="btn btn-primary" onClick={preRegister} disabled={busyKey === "pre-register"}>
        {busyKey === "pre-register" ? t("common.saving") : t("adminTabs.preRegister.title")}
      </button>
      {result ? (
        <div className="notice notice-success" style={{ marginTop: "0.75rem" }}>
          <strong>{t("adminTabs.preRegister.lastRegistrationLabel")}</strong> {result.member?.full_name || result.member?.phone_number || result.member?.email || "Member"} {t("adminTabs.preRegister.registeredSuccessfully")}
        </div>
      ) : null}
    </article>
  );
}
