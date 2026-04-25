import { useI18n } from "../i18n";

export interface CheckoutLineItem {
  label: string;
  amount: number;
}

interface CheckoutSummaryProps {
  /** Individual line items (subscriptions, donation, etc.) */
  items: CheckoutLineItem[];
  /** Platform fee percentage — 0 means not set by admin (show waived 1%) */
  platformFeePercent: number;
  /** Whether the platform fee is enabled for this church */
  platformFeeEnabled: boolean;
  /** Base amount before fee (sum of items) */
  baseAmount: number;
  /** Actual fee amount (0 when waived) */
  feeAmount: number;
  /** Total to charge */
  totalAmount: number;
  /** Pay button label override */
  payLabel?: string;
  /** Whether payment is in progress */
  busy?: boolean;
  onPay: () => void;
  onCancel: () => void;
}

function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function CheckoutSummary({
  items,
  platformFeePercent,
  platformFeeEnabled,
  baseAmount,
  feeAmount,
  totalAmount,
  payLabel,
  busy = false,
  onPay,
  onCancel,
}: CheckoutSummaryProps) {
  const { t } = useI18n();

  // Only show fee row when platform fee is actually enabled and charged
  const showActiveFee = platformFeeEnabled && feeAmount > 0;

  return (
    <div className="checkout-summary">
      <h3 className="checkout-summary-title">{t("checkout.title")}</h3>

      {/* Line items */}
      <div className="checkout-summary-items">
        {items.map((item, i) => (
          <div key={i} className="checkout-summary-row">
            <span>{item.label}</span>
            <strong>{formatINR(item.amount)}</strong>
          </div>
        ))}
      </div>

      <div className="checkout-summary-divider" />

      {/* Subtotal */}
      {items.length > 1 && (
        <>
          <div className="checkout-summary-row">
            <span>{t("checkout.subtotal")}</span>
            <strong>{formatINR(baseAmount)}</strong>
          </div>
          <div className="checkout-summary-divider" />
        </>
      )}

      {/* Platform fee — only shown when actually charged */}
      {showActiveFee && (
        <div className="checkout-summary-row checkout-summary-fee">
          <span>{t("checkout.processingFee", { percent: String(platformFeePercent) })}</span>
          <strong>+ {formatINR(feeAmount)}</strong>
        </div>
      )}

      <div className="checkout-summary-divider checkout-summary-divider-bold" />

      {/* Total */}
      <div className="checkout-summary-row checkout-summary-total">
        <span>{t("checkout.total")}</span>
        <strong>{formatINR(totalAmount)}</strong>
      </div>

      {/* Actions */}
      <div className="checkout-summary-actions">
        <button className="btn btn-primary checkout-pay-btn" onClick={onPay} disabled={busy}>
          {busy ? t("common.processing") : (payLabel || t("checkout.payNow"))}
        </button>
        <button className="btn checkout-cancel-btn" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
