import { useState, useCallback } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow, SubscriptionRow } from "../../types";
import { formatAmount } from "../../types";
import { useI18n } from "../../i18n";

export default function CreateSubscriptionTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [planName, setPlanName] = useState("");
  const [amount, setAmount] = useState("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [existingSubs, setExistingSubs] = useState<SubscriptionRow[]>([]);

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  async function onMemberSelected(opt: SearchSelectOption) {
    setMemberId(opt.id);
    setMemberName(opt.label);
    try {
      const subs = await apiRequest<SubscriptionRow[]>(
        `/api/subscriptions/my?member_id=${encodeURIComponent(opt.id)}`,
        { token },
      );
      setExistingSubs(subs || []);
    } catch {
      setExistingSubs([]);
    }
  }

  async function create() {
    if (!memberId.trim()) { setNotice({ tone: "error", text: t("adminTabs.createSubscription.errorSelectMember") }); return; }
    const amt = Number(amount);
    if (!amt || amt < 200) { setNotice({ tone: "error", text: t("adminTabs.createSubscription.errorMinAmount") }); return; }
    if (!planName.trim()) { setNotice({ tone: "error", text: t("adminTabs.createSubscription.errorPlanRequired") }); return; }

    const duplicate = existingSubs.find(
      (s) => s.plan_name?.toLowerCase() === planName.trim().toLowerCase() && s.status !== "cancelled",
    );
    if (duplicate) {
      setNotice({ tone: "error", text: t("adminTabs.createSubscription.errorDuplicatePlan", { plan: duplicate.plan_name, status: duplicate.status }) });
      return;
    }

    await withAuthRequest("create-subscription", async () => {
      await apiRequest("/api/subscriptions/create", {
        method: "POST",
        token,
        body: { member_id: memberId.trim(), plan_name: planName.trim(), amount: amt, billing_cycle: billingCycle },
      });
      setMemberId(""); setMemberName(""); setPlanName(""); setAmount(""); setBillingCycle("monthly"); setExistingSubs([]);
    }, t("adminTabs.createSubscription.successCreated"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.createSubscription.title")}</h3>
      <p className="muted">{t("adminTabs.createSubscription.description")}</p>
      <p className="muted" style={{ fontSize: "0.82rem", marginTop: "0.25rem" }}>
        {t("adminTabs.createSubscription.usageHint")}
      </p>
      <div className="field-stack">
        <label>
          {t("adminTabs.createSubscription.labelMember")}
          <SearchSelect
            placeholder={t("adminTabs.createSubscription.placeholderSearchMember")}
            onSearch={searchMembers}
            value={memberName}
            onSelect={(opt) => void onMemberSelected(opt)}
            onClear={() => { setMemberId(""); setMemberName(""); setExistingSubs([]); }}
          />
        </label>

        {existingSubs.length > 0 && (
          <div style={{ padding: "0.75rem", background: "#fff8e1", border: "1px solid #f9a825", borderRadius: "var(--radius-md)", fontSize: "0.85rem" }}>
            <strong style={{ color: "#b8860b" }}>{t("adminTabs.createSubscription.existingSubsWarning", { count: existingSubs.length })}</strong>
            <ul style={{ margin: "0.35rem 0 0 1.25rem", padding: 0 }}>
              {existingSubs.map((s) => (
                <li key={s.id}>{s.plan_name || "Default"} — {formatAmount(s.amount)} / {s.billing_cycle} ({s.status})</li>
              ))}
            </ul>
            <p style={{ marginTop: "0.35rem", color: "#b8860b" }}>{t("adminTabs.createSubscription.existingSubsHint")}</p>
          </div>
        )}

        <label>{t("adminTabs.createSubscription.labelPlanName")}<input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder={t("adminTabs.createSubscription.placeholderPlanName")} /></label>
        <label>{t("adminTabs.createSubscription.labelAmount")}<input type="number" min={200} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.createSubscription.placeholderAmount")} /></label>
        <label>
          {t("adminTabs.createSubscription.labelBillingCycle")}
          <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="monthly">{t("adminTabs.createSubscription.optionMonthly")}</option>
            <option value="yearly">{t("adminTabs.createSubscription.optionYearly")}</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={() => void create()} disabled={busyKey === "create-subscription"}>
          {busyKey === "create-subscription" ? t("adminTabs.createSubscription.creating") : t("adminTabs.createSubscription.saveAndCreate")}
        </button>
      </div>
    </article>
  );
}
