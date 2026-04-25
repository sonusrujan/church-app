import { useState, useRef } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { Heart, ShieldCheck, ArrowLeft, CheckCircle } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";
import { loadRazorpayCheckoutScript } from "../types";
import { API_BASE_URL } from "../lib/api";
import { useI18n } from "../i18n";

type DonationState = {
  amount: number;
  fund: string;
  donorName: string;
  donorEmail: string;
  message: string;
};

export default function DonationCheckoutPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as DonationState | null;

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const { t } = useI18n();

  if (!state || !state.amount) {
    return <Navigate to="/donate" replace />;
  }

  const { amount, fund, donorName, donorEmail, message } = state;

  async function handlePay() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");

    try {
      // 1. Create order
      const orderRes = await fetch(`${API_BASE_URL}/api/payments/public/donation/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          amount,
          donor_name: donorName,
          donor_email: donorEmail,
          fund,
          message,
        }),
      });

      if (!orderRes.ok) {
        const err = await orderRes.json().catch(() => ({ error: "Failed to create order" }));
        throw new Error(err.error || "Failed to create order");
      }

      const orderData = await orderRes.json();

      // 2. Load Razorpay script
      const loaded = await loadRazorpayCheckoutScript();
      if (!loaded) throw new Error("Unable to load Razorpay checkout. Please retry.");

      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== "function") {
        throw new Error("Razorpay checkout is unavailable in this browser.");
      }

      // 3. Open Razorpay checkout
      await new Promise<void>((resolve, reject) => {
        const razorpay = new RazorpayConstructor({
          key: orderData.key_id,
          amount: orderData.order.amount,
          currency: orderData.order.currency,
          name: "Shalom Church",
          description: fund || "Offering / Donation",
          order_id: orderData.order.id,
          prefill: {
            name: donorName || undefined,
            email: donorEmail || undefined,
          },
          notes: {
            type: "public_donation",
            fund,
            message: message || undefined,
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch(
                `${API_BASE_URL}/api/payments/public/donation/verify`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Accept: "application/json" },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    donor_name: donorName,
                    donor_email: donorEmail,
                    fund,
                    message,
                  }),
                }
              );

              if (!verifyRes.ok) {
                const err = await verifyRes.json().catch(() => ({ error: "Verification failed" }));
                throw new Error(err.error || "Verification failed");
              }

              setSuccess(true);
              resolve();
            } catch (verifyError) {
              reject(verifyError);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment was cancelled.")),
          },
          theme: { color: "#041627" },
        });
        razorpay.open();
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Payment failed. Please try again.";
      if (msg.includes("cancelled")) {
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
          <blockquote className="public-donation-verse">
            "Each of you should give what you have decided in your heart to give,
            not reluctantly or under compulsion, for God loves a cheerful giver."
            <cite>— 2 Corinthians 9:7</cite>
          </blockquote>
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
              aria-label="Back to donation page"
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
            <span>{t("donation.amount")}</span>
            <strong>₹{amount.toLocaleString("en-IN")}</strong>
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

        {/* Pay Button */}
        <button
          className="btn btn-primary public-donation-pay-btn"
          onClick={handlePay}
          disabled={busy}
        >
          {busy ? t("donation.processing") : t("donation.payWithRazorpay", { amount: amount.toLocaleString("en-IN") })}
        </button>

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
    </div>
  );
}
