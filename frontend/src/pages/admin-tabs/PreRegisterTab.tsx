import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import type { PreRegisterResult } from "../../types";
import { useI18n } from "../../i18n";
import { normalizeIndianPhone } from "../../types";

function buildMonthOptions() {
  const start = new Date("2025-01-01T00:00:00.000Z");
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const out: Array<{ value: string; label: string }> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    out.push({
      value: iso,
      label: cursor.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export default function PreRegisterTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [phone, setPhone] = useState("+91 ");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [occupation, setOccupation] = useState("");
  const [confirmationTaken, setConfirmationTaken] = useState<boolean | null>(null);
  const [age, setAge] = useState("");
  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [result, setResult] = useState<PreRegisterResult | null>(null);
  const [pendingMonths, setPendingMonths] = useState<string[]>([]);
  const [noPendingPayments, setNoPendingPayments] = useState(false);

  const monthOptions = buildMonthOptions();

  const occupationOptions = [
    "Farmer", "Teacher", "Business", "Government Employee", "Private Employee",
    "Self Employed", "Student", "Retired", "Homemaker", "Pastor", "Other",
  ];

  async function preRegister() {
    if (!phone.trim() && !email.trim()) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorPhoneOrEmailRequired") }); return; }
    if (!name.trim()) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorNameRequired") }); return; }
    if (!address.trim()) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorAddressRequired") }); return; }
    if (!occupation) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorOccupationRequired") }); return; }
    if (confirmationTaken === null) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorConfirmationRequired") }); return; }
    if (!age.trim() || isNaN(Number(age)) || Number(age) < 1 || Number(age) > 150) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorAgeRequired") }); return; }
    const { isUuid } = await import("../../types");
    const cid = churchId.trim();
    if (cid && !isUuid(cid)) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorInvalidChurch") }); return; }
    const amountText = amount.trim();
    let amountValue: number | undefined;
    if (amountText) {
      amountValue = Number(amountText);
      if (!Number.isFinite(amountValue) || amountValue < 0) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorAmountPositive") }); return; }
      if (amountValue !== 0 && amountValue < 200) { setNotice({ tone: "error", text: t("adminTabs.preRegister.errorAmountMin200") }); return; }
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
          occupation,
          confirmation_taken: confirmationTaken,
          age: Number(age),
          pending_months: noPendingPayments ? [] : pendingMonths,
          no_pending_payments: noPendingPayments,
        },
      }),
      t("adminTabs.preRegister.successRegistered"),
    );
    if (res) {
      setResult(res);
      setPhone("+91 "); setEmail(""); setName(""); setMembershipId(""); setAddress(""); setAmount("");
      setOccupation(""); setConfirmationTaken(null); setAge("");
      setPendingMonths([]); setNoPendingPayments(false);
    }
  }

  function togglePendingMonth(month: string) {
    setPendingMonths((current) => current.includes(month) ? current.filter((m) => m !== month) : [...current, month]);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.preRegister.title")}</h3>
      <p className="muted">{t("adminTabs.preRegister.description")}</p>
      <div className="field-stack">
        <label>{t("adminTabs.preRegister.phoneLabel")} <span className="required">*</span> <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
        <label>{t("adminTabs.preRegister.emailLabel")} ({t("common.optional")}) <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("adminTabs.preRegister.emailPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.fullNameLabel")} <span className="required">*</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("adminTabs.preRegister.fullNamePlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.membershipIdLabel")}<input value={membershipId} onChange={(e) => setMembershipId(e.target.value)} placeholder={t("adminTabs.preRegister.membershipIdPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.addressLabel")} <span className="required">*</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("adminTabs.preRegister.addressPlaceholder")} /></label>
        <label>{t("adminTabs.preRegister.occupationLabel")} <span className="required">*</span>
          <select value={occupation} onChange={(e) => setOccupation(e.target.value)}>
            <option value="">{t("adminTabs.preRegister.selectOccupation")}</option>
            {occupationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <div>
          <span>{t("adminTabs.preRegister.confirmationTakenLabel")} <span className="required">*</span></span>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
            <button type="button" className={`btn btn-sm ${confirmationTaken === true ? "btn-primary" : "btn-outline"}`} onClick={() => setConfirmationTaken(true)}>{t("common.yes")}</button>
            <button type="button" className={`btn btn-sm ${confirmationTaken === false ? "btn-primary" : "btn-outline"}`} onClick={() => setConfirmationTaken(false)}>{t("common.no")}</button>
          </div>
        </div>
        <label>{t("adminTabs.preRegister.ageLabel")} <span className="required">*</span><input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder={t("adminTabs.preRegister.agePlaceholder")} min="1" max="150" /></label>
        <label>{t("adminTabs.preRegister.subscriptionAmountLabel")}<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.preRegister.subscriptionAmountPlaceholder")} /></label>
        <div>
          <p className="field-label">Legacy Pending Months (from Jan 2025)</p>
          <label className="checkbox-row" style={{ marginTop: "0.5rem" }}>
            <input
              id="no-pending-payments"
              type="checkbox"
              checked={noPendingPayments}
              onChange={(e) => setNoPendingPayments(e.target.checked)}
            />
            <span>No pending payments (mark all months as paid/imported)</span>
          </label>
          <p className="muted" style={{ marginTop: "0.4rem", fontSize: "0.82rem" }}>
            Select only unpaid months. Non-selected months will be marked as already paid/imported.
          </p>
          <div className="months-scroll-box">
            {monthOptions.map((m) => (
              <label key={m.value} className={`checkbox-row${noPendingPayments ? " disabled" : ""}`}>
                <input
                  type="checkbox"
                  disabled={noPendingPayments}
                  checked={pendingMonths.includes(m.value)}
                  onChange={() => togglePendingMonth(m.value)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>
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
