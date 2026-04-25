import { useState, useCallback, useEffect } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow, SubscriptionRow } from "../../types";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

type PaymentPurpose = "subscription" | "donation" | "other";

export default function ManualPaymentTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [memberId, setMemberId] = useState("");
  const [memberLabel, setMemberLabel] = useState("");
  const [purpose, setPurpose] = useState<PaymentPurpose>("subscription");
  const [subId, setSubId] = useState("");
  const [memberSubs, setMemberSubs] = useState<SubscriptionRow[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  // Fetch member's subscriptions when member changes
  useEffect(() => {
    if (!memberId || !isUuid(memberId)) {
      setMemberSubs([]);
      setSubId("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSubs(true);
      try {
        const subs = await apiRequest<SubscriptionRow[]>(
          `/api/subscriptions/my?member_id=${encodeURIComponent(memberId)}`,
          { token },
        );
        if (!cancelled) {
          setMemberSubs(subs || []);
          // Auto-select first active subscription
          const active = (subs || []).find((s) => s.status === "active");
          if (active) setSubId(active.id);
          else if (subs?.length) setSubId(subs[0].id);
          else setSubId("");
        }
      } catch {
        if (!cancelled) setMemberSubs([]);
      } finally {
        if (!cancelled) setLoadingSubs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberId, token]);

  async function record() {
    if (!memberId.trim() || !isUuid(memberId.trim())) { setNotice({ tone: "error", text: t("adminTabs.manualPayment.errorSelectMember") }); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setNotice({ tone: "error", text: t("adminTabs.manualPayment.errorAmountPositive") }); return; }
    if (!date) { setNotice({ tone: "error", text: t("adminTabs.manualPayment.errorDateRequired") }); return; }
    if (purpose === "subscription" && !subId) { setNotice({ tone: "error", text: t("adminTabs.manualPayment.errorSelectSubscription") }); return; }

    await withAuthRequest("manual-payment", async () => {
      await apiRequest("/api/ops/payments/manual", {
        method: "POST", token,
        body: {
          member_id: memberId.trim(),
          subscription_id: purpose === "subscription" ? subId : undefined,
          amount: amt,
          payment_method: method,
          payment_date: date,
          payment_category: purpose,
          note: note.trim() || undefined,
        },
      });
      setMemberId(""); setMemberLabel(""); setSubId(""); setAmount(""); setNote(""); setDate("");
      setMemberSubs([]);
    }, t("adminTabs.manualPayment.successRecorded"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.manualPayment.title")}</h3>
      <p className="muted">{t("adminTabs.manualPayment.description")}</p>
      <div className="field-stack">
        <label>
          {t("adminTabs.createSubscription.labelMember")}
          <SearchSelect
            placeholder={t("adminTabs.manualPayment.memberPlaceholder")}
            onSearch={searchMembers}
            value={memberLabel}
            onSelect={(opt) => { setMemberId(opt.id); setMemberLabel(opt.label); }}
            onClear={() => { setMemberId(""); setMemberLabel(""); setSubId(""); setMemberSubs([]); }}
          />
        </label>

        <label>
          {t("adminTabs.manualPayment.paymentForLabel")}
          <select value={purpose} onChange={(e) => { setPurpose(e.target.value as PaymentPurpose); if (e.target.value !== "subscription") setSubId(""); }}>
            <option value="subscription">{t("adminTabs.manualPayment.purposeSubscription")}</option>
            <option value="donation">{t("adminTabs.manualPayment.purposeDonation")}</option>
            <option value="other">{t("adminTabs.manualPayment.purposeOther")}</option>
          </select>
        </label>

        {purpose === "subscription" && memberId && (
          <label>
            {t("adminTabs.manualPayment.subscriptionLabel")}
            {loadingSubs ? (
              <input disabled value={t("adminTabs.manualPayment.loadingSubscriptions")} />
            ) : memberSubs.length > 0 ? (
              <select value={subId} onChange={(e) => setSubId(e.target.value)}>
                <option value="">{t("adminTabs.manualPayment.selectSubscription")}</option>
                {memberSubs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.plan_name} — ₹{Number(s.amount).toFixed(0)}/{s.billing_cycle} ({s.status})
                  </option>
                ))}
              </select>
            ) : (
              <input disabled value={t("adminTabs.manualPayment.noSubscriptionsFound")} />
            )}
          </label>
        )}

        <label>{t("adminTabs.manualPayment.amountLabel")}<input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.manualPayment.amountPlaceholder")} /></label>
        <label>
          {t("adminTabs.manualPayment.paymentMethodLabel")}
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">{t("adminTabs.manualPayment.methodCash")}</option>
            <option value="bank_transfer">{t("adminTabs.manualPayment.methodBankTransfer")}</option>
            <option value="upi_manual">{t("adminTabs.manualPayment.methodUpiManual")}</option>
            <option value="cheque">{t("adminTabs.manualPayment.methodCheque")}</option>
            <option value="other">{t("adminTabs.manualPayment.methodOther")}</option>
          </select>
        </label>
        <label>{t("adminTabs.manualPayment.paymentDateLabel")}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t("adminTabs.manualPayment.noteLabel")}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("adminTabs.manualPayment.notePlaceholder")} /></label>
        <button className="btn btn-primary" onClick={() => void record()} disabled={busyKey === "manual-payment"}>
          {busyKey === "manual-payment" ? t("adminTabs.manualPayment.recording") : t("adminTabs.manualPayment.recordPayment")}
        </button>
      </div>
    </article>
  );
}
