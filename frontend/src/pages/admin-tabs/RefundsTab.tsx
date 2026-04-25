import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

export default function RefundsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, openOperationConfirmDialog } = useApp();

  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("original_method");

  async function record() {
    if (!paymentId.trim() || !isUuid(paymentId.trim())) { setNotice({ tone: "error", text: "Valid Payment ID is required." }); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setNotice({ tone: "error", text: "Refund amount must be a positive number." }); return; }
    await withAuthRequest("record-refund", async () => {
      await apiRequest(`/api/ops/payments/${encodeURIComponent(paymentId.trim())}/refund`, {
        method: "POST", token,
        body: { refund_amount: amt, refund_reason: reason.trim() || undefined, refund_method: method },
      });
      setPaymentId(""); setAmount(""); setReason("");
    }, "Refund recorded.");
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.refunds.title")}</h3>
      <p className="muted">{t("adminTabs.refunds.description")}</p>
      <div className="field-stack">
        <label>{t("adminTabs.refunds.paymentIdLabel")}<input value={paymentId} onChange={(e) => setPaymentId(e.target.value)} placeholder={t("adminTabs.refunds.paymentIdPlaceholder")} /></label>
        <label>{t("adminTabs.refunds.amountLabel")}<input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t("adminTabs.refunds.amountPlaceholder")} /></label>
        <label>
          {t("adminTabs.refunds.methodLabel")}
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="original_method">{t("adminTabs.refunds.methodOriginal")}</option>
            <option value="bank_transfer">{t("adminTabs.refunds.methodBankTransfer")}</option>
            <option value="cash">{t("adminTabs.refunds.methodCash")}</option>
            <option value="upi">{t("adminTabs.refunds.methodUpi")}</option>
          </select>
        </label>
        <label>{t("adminTabs.refunds.reasonLabel")}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("adminTabs.refunds.reasonPlaceholder")} /></label>
        <button className="btn btn-primary" onClick={() => {
          if (!paymentId.trim() || !isUuid(paymentId.trim())) { setNotice({ tone: "error", text: "Valid Payment ID is required." }); return; }
          const amt = Number(amount);
          if (!amt || amt <= 0) { setNotice({ tone: "error", text: "Refund amount must be a positive number." }); return; }
          openOperationConfirmDialog(
            t("adminTabs.refunds.confirmTitle"),
            t("adminTabs.refunds.confirmMessage", { amount: amt, id: paymentId.trim().slice(0, 8) + "..." }),
            t("adminTabs.refunds.confirmKeyword"),
            () => void record(),
          );
        }} disabled={busyKey === "record-refund"}>
          {busyKey === "record-refund" ? t("adminTabs.refunds.recording") : t("adminTabs.refunds.recordButton")}
        </button>
      </div>
    </article>
  );
}
