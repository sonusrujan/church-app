import { useState, useRef, useCallback } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { Heart, ShieldCheck, ArrowLeft, CheckCircle, Download, AlertTriangle } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";
import { openRazorpayCheckout } from "../lib/razorpayCheckout";
import { apiRequest } from "../lib/api";
import { useApp } from "../context/AppContext";
import { useI18n } from "../i18n";
import CheckoutSummary from "../components/CheckoutSummary";

type DonationState = {
  amount: number;
  fund: string;
  churchId: string;
  churchName: string;
  donorName: string;
  donorEmail: string;
  donorPhone: string;
  message: string;
  platformFeeEnabled?: boolean;
  platformFeePercent?: number;
};

export default function DonationCheckoutPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as DonationState | null;
  const { token, refreshMemberDashboard } = useApp();

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [successTxnId, setSuccessTxnId] = useState("");
  const { t } = useI18n();

  const downloadReceipt = useCallback(() => {
    if (!state || !successTxnId) return;
    const lines = [
      "═══════════════════════════════════════",
      "        DONATION RECEIPT",
      "═══════════════════════════════════════",
      "",
      `Date:           ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
      `Church:         ${state.churchName}`,
      `Fund:           ${state.fund}`,
      `Amount:         ₹${state.amount.toLocaleString("en-IN")}`,
      `Transaction ID: ${successTxnId}`,
      "",
      `Donor Name:     ${state.donorName || "Anonymous"}`,
      `Donor Email:    ${state.donorEmail || "-"}`,
      `Donor Phone:    ${state.donorPhone || "-"}`,
      state.message ? `Message:        ${state.message}` : "",
      "",
      "═══════════════════════════════════════",
      "  Thank you for your generous gift!",
      "  Powered by Shalom Church Platform",
      "═══════════════════════════════════════",
    ].filter(Boolean).join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `donation-receipt-${successTxnId.slice(0, 12)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state, successTxnId]);

  if (!state || !state.amount) {
    return <Navigate to="/donate" replace />;
  }

  const { amount, fund, churchId, churchName, donorName, donorEmail, donorPhone, message } = state;
  const feeEnabled = !!(state as DonationState).platformFeeEnabled;
  const feePct = Number((state as DonationState).platformFeePercent || 0);
  const feeAmount = feeEnabled ? Math.round(amount * feePct) / 100 : 0;
  const totalAmount = amount + feeAmount;

  async function handlePay() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      // 1. Create order — pass token when logged in so server can link payment to member
      const authedToken = isLoggedIn ? token : undefined;
      const orderData = await apiRequest<{ key_id: string; order: { id: string; amount: number; currency: string } }>("/api/payments/public/donation/order", {
        method: "POST",
        token: authedToken,
        body: {
          amount,
          church_id: churchId,
          donor_name: donorName,
          donor_email: donorEmail,
          donor_phone: donorPhone,
          fund,
          message,
        },
        timeout: 30_000,
      });

      // 2. Open Razorpay checkout via shared helper
      const razorpayResponse = await openRazorpayCheckout({
        keyId: orderData.key_id,
        orderId: orderData.order.id,
        amountPaise: orderData.order.amount,
        currency: orderData.order.currency,
        name: churchName || t("donation.churchName"),
        description: fund || t("donation.offeringDonation"),
        prefill: {
          name: donorName || undefined,
          email: donorEmail || undefined,
        },
        notes: {
          type: "public_donation",
          fund,
          message: message || "",
        },
        themeColor: "#041627",
      });

      // 3. Verify payment
      await apiRequest("/api/payments/public/donation/verify", {
        method: "POST",
        token: authedToken,
        body: {
          razorpay_order_id: razorpayResponse.razorpay_order_id,
          razorpay_payment_id: razorpayResponse.razorpay_payment_id,
          razorpay_signature: razorpayResponse.razorpay_signature,
          church_id: churchId,
          donor_name: donorName,
          donor_email: donorEmail,
          donor_phone: donorPhone,
          fund,
          message,
        },
        timeout: 30_000,
      });

      setSuccessTxnId(razorpayResponse.razorpay_payment_id);
      setSuccess(true);
      // Refresh member dashboard so the new donation appears immediately.
      if (isLoggedIn && refreshMemberDashboard) {
        refreshMemberDashboard().catch(() => { /* non-blocking */ });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("donation.errorPaymentFailed");
      if ((err as any)?.cancelled || msg.includes("cancelled")) {
        setError("");
      } else {
        setError(msg);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="public-donation-shell">
        <nav className="public-donation-nav">
          <div className="public-donation-nav-inner">
            <div className="public-donation-brand">
              <img src={shalomLogo} alt="Shalom" className="public-donation-logo" />
              <span className="public-donation-brand-name">Shalom</span>
            </div>
          </div>
        </nav>

        <section className="public-donation-success">
          <div className="public-donation-success-icon">
            <CheckCircle size={48} />
          </div>
          <h1>{t("donation.thankYou")}</h1>
          <p>
            {t("donation.thankYouDesc", { amount: amount.toLocaleString("en-IN"), fund })}
          </p>
          {successTxnId && (
            <div style={{ background: "var(--surface-container, #f5f5f5)", borderRadius: 8, padding: "0.75rem 1rem", marginBottom: "1rem", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span style={{ color: "var(--text-muted)" }}>{t("dashboard.transactionId")}</span>
                <code style={{ fontSize: "0.8rem" }}>{successTxnId}</code>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>{t("dashboard.amountPaid")}</span>
                <strong>₹{amount.toLocaleString("en-IN")}</strong>
              </div>
            </div>
          )}
          <blockquote className="public-donation-verse">
            {t("donation.scriptureVerse")}
            <cite>{t("donation.scriptureRef")}</cite>
          </blockquote>

          {/* Receipt warning + download */}
          <div className="notice notice-warning" style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", textAlign: "left", marginBottom: "1rem" }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t("donation.receiptWarning")}</span>
          </div>
          <button className="btn btn-primary" onClick={downloadReceipt} style={{ marginBottom: "0.75rem", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
            <Download size={16} /> {t("donation.saveReceipt")}
          </button>

          <div className="public-donation-success-actions">
            <button className="btn btn-primary" onClick={() => navigate("/donate")}>
              {t("donation.makeAnotherGift")}
            </button>
            <a href={isLoggedIn ? "/dashboard" : "/signin"} className="btn">
              {isLoggedIn ? t("donation.backToDashboard") : t("donation.signInToShalom")}
            </a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="public-donation-shell">
      {/* Nav bar */}
      <nav className="public-donation-nav">
        <div className="public-donation-nav-inner">
          <div className="public-donation-brand">
            <button
              className="public-donation-back-btn"
              onClick={() => navigate("/donate")}
              aria-label={t("donation.backToDonationPage")}
            >
              <ArrowLeft size={20} />
            </button>
            <img src={shalomLogo} alt="Shalom" className="public-donation-logo" />
            <span className="public-donation-brand-name">Shalom</span>
          </div>
        </div>
      </nav>

      {/* Checkout Section */}
      <section className="public-donation-checkout">
        <div className="public-donation-checkout-icon">
          <Heart size={32} />
        </div>
        <h1>{t("donation.confirmGift")}</h1>
        <p className="public-donation-checkout-tagline">
          {t("donation.confirmTagline")}
        </p>

        {/* Summary Card */}
        <div className="public-donation-summary-card">
          <div className="public-donation-summary-row">
            <span>Church</span>
            <strong>{churchName}</strong>
          </div>
          <div className="public-donation-summary-divider" />
          <div className="public-donation-summary-row">
            <span>{t("donation.fund")}</span>
            <strong>{fund}</strong>
          </div>
          <div className="public-donation-summary-divider" />
          <div className="public-donation-summary-row">
            <span>{t("donation.frequency")}</span>
            <strong>{t("donation.oneTimeGift")}</strong>
          </div>
          {donorName ? (
            <>
              <div className="public-donation-summary-divider" />
              <div className="public-donation-summary-row">
                <span>{t("donation.donor")}</span>
                <strong>{donorName}</strong>
              </div>
            </>
          ) : null}
          {message ? (
            <>
              <div className="public-donation-summary-divider" />
              <div className="public-donation-summary-row public-donation-summary-message">
                <span>{t("donation.message")}</span>
                <strong>{message}</strong>
              </div>
            </>
          ) : null}
          <div className="public-donation-summary-divider" />
          <div className="public-donation-summary-row">
            <span>{t("donation.date")}</span>
            <strong>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</strong>
          </div>
        </div>

        {error ? <div className="notice notice-error">{error}</div> : null}

        {/* Checkout Summary with fee breakdown */}
        <div className="public-donation-summary-card" style={{ marginTop: "1rem" }}>
          <CheckoutSummary
            items={[{ label: t("donation.amount"), amount }]}
            platformFeePercent={feePct}
            platformFeeEnabled={feeEnabled}
            baseAmount={amount}
            feeAmount={feeAmount}
            totalAmount={totalAmount}
            payLabel={t("checkout.payDonation")}
            busy={busy}
            onPay={handlePay}
            onCancel={() => navigate("/donate")}
          />
        </div>

        {/* Trust */}
        <div className="public-donation-checkout-trust">
          <ShieldCheck size={16} />
          <span>{t("donation.securePayment")}</span>
        </div>
        <p className="public-donation-checkout-terms">
          {t("donation.termsNotice")}
        </p>
      </section>

      {/* Footer */}
      <footer className="public-donation-footer">
        <p>{t("donation.footer")}</p>
      </footer>

      {/* Razorpay loading overlay */}
      {busy && (
        <div className="payment-loading-overlay" aria-live="assertive">
          <div className="payment-loading-spinner" />
          <p>{t("dashboard.openingPaymentGateway")}</p>
        </div>
      )}
    </div>
  );
}
