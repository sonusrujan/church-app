import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import type { ChurchRow } from "../../types";
import { isValidIndianPhone, normalizeIndianPhone } from "../../types";
import { useI18n } from "../../i18n";

export default function CreateChurchTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, churches: _churches, loadChurches, loadAdmins } = useApp();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [admins, setAdmins] = useState("");
  const [memberSubEnabled, setMemberSubEnabled] = useState(false);
  const [churchSubEnabled, setChurchSubEnabled] = useState(false);
  const [churchSubAmount, setChurchSubAmount] = useState("");
  const [platformFeeEnabled, setPlatformFeeEnabled] = useState(false);
  const [platformFeePercent, setPlatformFeePercent] = useState("2");
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [phoneWarning, setPhoneWarning] = useState("");

  async function createChurch() {
    if (!name.trim()) { setNotice({ tone: "error", text: t("adminTabs.createChurch.errorNameRequired") }); return; }
    const adminPhones = admins.split(",").map((p) => p.trim()).filter(Boolean);
    const PHONE_RE = /^\+?\d{7,15}$/;
    const invalid = adminPhones.find((p) => !PHONE_RE.test(p.replace(/[\s-]/g, "")));
    if (invalid) { setNotice({ tone: "error", text: `Invalid phone number: ${invalid}` }); return; }
    if (phone.trim()) {
      const normalizedPhone = normalizeIndianPhone(phone);
      if (!isValidIndianPhone(normalizedPhone)) {
        setPhoneWarning(t("adminTabs.createChurch.phoneWarning"));
        setNotice({ tone: "error", text: t("adminTabs.createChurch.errorInvalidPhone") });
        return;
      }
    }
    const result = await withAuthRequest(
      "create-church",
      () => apiRequest<{ church: ChurchRow; assigned_admins: unknown[] }>("/api/churches/create", {
        method: "POST", token,
        body: {
          name: name.trim(),
          address: address.trim() || undefined,
          location: location.trim() || undefined,
          contact_phone: phone.trim() ? normalizeIndianPhone(phone) : undefined,
          admin_phones: adminPhones.length ? adminPhones : undefined,
          member_subscription_enabled: memberSubEnabled,
          church_subscription_enabled: churchSubEnabled,
          church_subscription_amount: churchSubEnabled ? parseFloat(churchSubAmount) || 0 : undefined,
          platform_fee_enabled: platformFeeEnabled,
          platform_fee_percentage: platformFeeEnabled ? parseFloat(platformFeePercent) || 2 : undefined,
          service_enabled: serviceEnabled,
        },
      }),
      t("adminTabs.createChurch.successCreated"),
    );
    if (!result) return;
    setName(""); setAddress(""); setLocation(""); setPhone(""); setAdmins("");
    setMemberSubEnabled(false); setChurchSubEnabled(false); setChurchSubAmount("");
    setPlatformFeeEnabled(false); setPlatformFeePercent("2"); setServiceEnabled(true);
    await loadChurches();
    await loadAdmins();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.createChurch.title")}</h3>
      <p className="muted">{t("adminTabs.createChurch.description")}</p>
      <div className="field-stack">
        <label>{t("adminTabs.createChurch.labelChurchName")}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderChurchName")} /></label>
        <label>{t("adminTabs.createChurch.labelAddress")}<input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderAddress")} /></label>
        <label>{t("adminTabs.createChurch.labelLocation")}<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderLocation")} /></label>
        <label>{t("adminTabs.createChurch.labelContactPhone")}
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 0.75rem", background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)", border: "1px solid rgba(220,208,255,0.30)", borderRight: "none", fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap", userSelect: "none" }}>{t("adminTabs.createChurch.phonePrefix")}</span>
            <input type="tel" inputMode="numeric" value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); if (phoneWarning) setPhoneWarning(""); }} onBlur={() => { const v = phone.trim(); if (v && !isValidIndianPhone(normalizeIndianPhone(v))) setPhoneWarning(t("adminTabs.createChurch.phoneWarning")); else setPhoneWarning(""); }} placeholder={t("adminTabs.createChurch.placeholderPhone")} maxLength={10} style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }} />
          </div>
        </label>
        {phoneWarning && <span className="field-error">{phoneWarning}</span>}
        <label>{t("adminTabs.createChurch.labelAdminPhones")}<input value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderAdminPhones")} /></label>

        <p className="muted" style={{ marginTop: "0.75rem", marginBottom: "0.25rem", fontWeight: 600 }}>{t("adminTabs.createChurch.saasConfigTitle")}</p>
        <label className="checkbox-line">
          <input type="checkbox" checked={serviceEnabled} onChange={(e) => setServiceEnabled(e.target.checked)} />
          {t("adminTabs.createChurch.serviceEnabled")}
        </label>
        <label className="checkbox-line">
          <input type="checkbox" checked={memberSubEnabled} onChange={(e) => setMemberSubEnabled(e.target.checked)} />
          {t("adminTabs.createChurch.enableMemberSubscriptions")}
        </label>
        <label className="checkbox-line">
          <input type="checkbox" checked={churchSubEnabled} onChange={(e) => setChurchSubEnabled(e.target.checked)} />
          {t("adminTabs.createChurch.enableChurchSubscription")}
        </label>
        {churchSubEnabled ? (
          <label>{t("adminTabs.createChurch.labelChurchSubAmount")}<input type="number" min="0" step="100" value={churchSubAmount} onChange={(e) => setChurchSubAmount(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderSubAmount")} /></label>
        ) : null}
        <label className="checkbox-line">
          <input type="checkbox" checked={platformFeeEnabled} onChange={(e) => setPlatformFeeEnabled(e.target.checked)} />
          {t("adminTabs.createChurch.enablePlatformFee")}
        </label>
        {platformFeeEnabled ? (
          <label>{t("adminTabs.createChurch.labelPlatformFeePercent")}<input type="number" min="0" max="100" step="0.5" value={platformFeePercent} onChange={(e) => setPlatformFeePercent(e.target.value)} placeholder={t("adminTabs.createChurch.placeholderFeePercent")} /></label>
        ) : null}
      </div>
      <button className="btn btn-primary" onClick={createChurch} disabled={busyKey === "create-church"}>
        {busyKey === "create-church" ? t("adminTabs.createChurch.creating") : t("adminTabs.createChurch.createChurch")}
      </button>
    </article>
  );
}
