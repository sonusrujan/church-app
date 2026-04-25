import { useState, useCallback } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { isUuid, formatAmount } from "../../types";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow, SubscriptionRow } from "../../types";
import { useI18n } from "../../i18n";

export default function EditSubscriptionTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches, openOperationConfirmDialog } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberSubs, setMemberSubs] = useState<SubscriptionRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const [subId, setSubId] = useState("");
  const [amount, setAmount] = useState("");
  const [billingCycle, setBillingCycle] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [status, setStatus] = useState("");
  const [planName, setPlanName] = useState("");

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  async function loadMemberSubs(mid: string) {
    if (!mid) return;
    setSubsLoading(true);
    try {
      const subs = await apiRequest<SubscriptionRow[]>(
        `/api/subscriptions/my?member_id=${encodeURIComponent(mid)}`,
        { token },
      );
      setMemberSubs(subs || []);
      if (!subs?.length) setNotice({ tone: "error", text: t("adminTabs.editSubscription.errorNoSubscriptions") });
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.editSubscription.errorLoadFailed") });
      setMemberSubs([]);
    } finally {
      setSubsLoading(false);
    }
  }

  function selectSub(sub: SubscriptionRow) {
    setSubId(sub.id);
    setAmount(String(sub.amount));
    setBillingCycle(sub.billing_cycle || "");
    setNextDate(sub.next_payment_date || "");
    setStatus("");
    setPlanName(sub.plan_name || "");
  }

  function clearSelection() {
    setMemberId("");
    setMemberSubs([]);
    setSubId("");
    setAmount("");
    setBillingCycle("");
    setNextDate("");
    setStatus("");
    setPlanName("");
  }

  async function doUpdate() {
    const body: Record<string, unknown> = {};
    if (amount.trim()) body.amount = Number(amount);
    if (billingCycle.trim()) body.billing_cycle = billingCycle.trim();
    if (nextDate) body.next_payment_date = nextDate;
    if (status.trim()) body.status = status.trim();
    if (planName.trim()) body.plan_name = planName.trim();
    if (!Object.keys(body).length) { setNotice({ tone: "error", text: t("adminTabs.editSubscription.errorNoField") }); return; }
    await withAuthRequest("update-subscription", async () => {
      await apiRequest(`/api/ops/subscriptions/${encodeURIComponent(subId.trim())}`, { method: "PATCH", token, body });
      clearSelection();
    }, t("adminTabs.editSubscription.successUpdated"));
  }

  async function update() {
    if (!subId.trim() || !isUuid(subId.trim())) { setNotice({ tone: "error", text: t("adminTabs.editSubscription.errorNoSubscription") }); return; }
    // Warn if amount or status changed
    if (amount.trim() || status.trim()) {
      openOperationConfirmDialog(
        t("adminTabs.editSubscription.impactWarningTitle"),
        t("adminTabs.editSubscription.impactWarningMessage"),
        t("adminTabs.editSubscription.impactConfirmWord"),
        doUpdate,
      );
    } else {
      await doUpdate();
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.editSubscription.title")}</h3>
      <p className="muted">{t("adminTabs.editSubscription.description")}</p>
      <div className="field-stack">
        <label>
          {t("admin.searchMember")}
          <SearchSelect
            placeholder={t("adminTabs.createSubscription.placeholderSearchMember")}
            onSearch={searchMembers}
            value={memberId}
            onSelect={(opt) => {
              setMemberId(opt.id);
              setSubId("");
              void loadMemberSubs(opt.id);
            }}
            onClear={clearSelection}
          />
        </label>

        {subsLoading && <p className="muted">{t("adminTabs.manualPayment.loadingSubscriptions")}</p>}

        {memberSubs.length > 0 && !subId && (
          <div>
            <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>{t("adminTabs.editSubscription.selectSubscriptionPrompt")}</p>
            {memberSubs.map((sub) => (
              <div
                key={sub.id}
                onClick={() => selectSub(sub)}
                style={{
                  padding: "0.75rem", marginBottom: "0.5rem", cursor: "pointer",
                  border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-md)",
                  background: "var(--surface-container-lowest)",
                }}
              >
                <strong>{sub.plan_name || "Default Plan"}</strong>
                {sub.person_name ? <span className="muted"> — {sub.person_name}</span> : null}
                <div style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)", marginTop: "0.25rem" }}>
                  {formatAmount(sub.amount)} / {sub.billing_cycle} · Status: {sub.status}
                </div>
                <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--on-surface-variant)" }}>
                  ID: {sub.id}
                </div>
              </div>
            ))}
          </div>
        )}

        {subId && (
          <>
            <div style={{ padding: "0.5rem 0.75rem", background: "var(--surface-container)", borderRadius: "var(--radius-md)", fontSize: "0.85rem", marginBottom: "0.25rem" }}>
              {t("adminTabs.editSubscription.editingLabel")} <strong>{planName || "Subscription"}</strong> — <span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{subId}</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: "0.5rem" }} onClick={() => { setSubId(""); setAmount(""); setBillingCycle(""); setNextDate(""); setStatus(""); setPlanName(""); }}>{t("adminTabs.editSubscription.changeButton")}</button>
            </div>
            <label>{t("adminTabs.editSubscription.amountLabel")} <span className="muted">{t("adminTabs.editSubscription.amountHint")}</span><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.editSubscription.amountHint")} /></label>
            <label>
              {t("adminTabs.editSubscription.billingCycleLabel")}
              <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
                <option value="">{t("adminTabs.editSubscription.keepCurrent")}</option>
                <option value="monthly">{t("adminTabs.editSubscription.monthly")}</option>
                <option value="yearly">{t("adminTabs.editSubscription.yearly")}</option>
              </select>
            </label>
            <label>
              {t("adminTabs.editSubscription.statusLabel")}
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t("adminTabs.editSubscription.keepCurrent")}</option>
                <option value="active">{t("adminTabs.editSubscription.statusActive")}</option>
                <option value="paused">{t("adminTabs.editSubscription.statusPaused")}</option>
                <option value="cancelled">{t("adminTabs.editSubscription.statusCancelled")}</option>
                <option value="overdue">{t("adminTabs.editSubscription.statusOverdue")}</option>
                <option value="pending_first_payment">{t("adminTabs.editSubscription.statusPendingFirstPayment")}</option>
              </select>
            </label>
            <label>{t("adminTabs.editSubscription.nextPaymentDateLabel")}<input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></label>
            <label>{t("adminTabs.editSubscription.planNameLabel")}<input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder={t("adminTabs.editSubscription.planNamePlaceholder")} /></label>
            <button className="btn btn-primary" onClick={() => void update()} disabled={busyKey === "update-subscription"}>
              {busyKey === "update-subscription" ? t("adminTabs.editSubscription.updating") : t("adminTabs.editSubscription.updateButton")}
            </button>
          </>
        )}
      </div>
    </article>
  );
}
