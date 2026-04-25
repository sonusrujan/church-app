import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import shalomLogo from "../assets/shalom-logo.png";
import { API_BASE_URL, apiRequest, setActiveChurchId } from "../lib/api";
import { openRazorpayCheckout } from "../lib/razorpayCheckout";

type SaasSettings = {
  church_id: string;
  church_subscription_enabled: boolean;
  church_subscription_amount: number;
  platform_fee_percent: number;
};

type SaasSubscription = {
  id: string;
  church_id: string;
  amount: number;
  billing_cycle: "monthly" | "yearly";
  status: "active" | "inactive" | "cancelled";
  next_payment_date: string | null;
  last_payment_date: string | null;
};

type MySettingsResponse = {
  settings: SaasSettings;
  subscription: SaasSubscription | null;
};

type OrderResponse = {
  order: { id: string; amount: number; currency: string };
  key_id: string;
  church_id: string;
  subscription_id: string;
  amount: number;
  billing_cycle: string;
};

type Phase = "exchanging" | "loading" | "ready" | "paying" | "success" | "error";

const DEEP_LINK_RETURN = "shalom://subscription/return";

async function exchangeHandoff(token: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/auth/web-handoff/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "Handoff exchange failed");
  }
  const data = await res.json();
  if (data?.church_id) setActiveChurchId(data.church_id);
  return data.access_token as string;
}

export default function SubscriptionManagePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [error, setError] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [data, setData] = useState<MySettingsResponse | null>(null);
  const exchangedRef = useRef(false);

  const handoffToken = useMemo(() => {
    const qs = new URLSearchParams(location.search);
    return qs.get("t") || "";
  }, [location.search]);

  // Step 1 — exchange handoff token (or skip if already have a session).
  useEffect(() => {
    if (exchangedRef.current) return;
    exchangedRef.current = true;

    (async () => {
      try {
        if (handoffToken) {
          const tok = await exchangeHandoff(handoffToken);
          setAccessToken(tok);
          // Strip the token from the URL so a back-button / refresh doesn't re-submit
          // (it's already single-use anyway, but the URL shouldn't linger).
          const url = new URL(window.location.href);
          url.searchParams.delete("t");
          window.history.replaceState({}, "", url.toString());
        }
        setPhase("loading");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed");
        setPhase("error");
      }
    })();
  }, [handoffToken]);

  // Step 2 — load subscription snapshot.
  useEffect(() => {
    if (phase !== "loading") return;
    (async () => {
      try {
        const payload = await apiRequest<MySettingsResponse>("/api/saas/my-settings", {
          token: accessToken || undefined,
        });
        setData(payload);
        setPhase("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load subscription");
        setPhase("error");
      }
    })();
  }, [phase, accessToken]);

  const handlePay = useCallback(async () => {
    if (phase !== "ready") return;
    setPhase("paying");
    setError("");
    try {
      const orderPayload = await apiRequest<OrderResponse>("/api/saas/pay/order", {
        method: "POST",
        token: accessToken || undefined,
      });

      const response = await openRazorpayCheckout({
        keyId: orderPayload.key_id,
        orderId: orderPayload.order.id,
        amountPaise: orderPayload.order.amount,
        currency: orderPayload.order.currency || "INR",
        name: "Shalom Platform",
        description: "Platform Subscription Fee",
        notes: {
          type: "saas_fee",
          church_id: orderPayload.church_id,
          subscription_id: orderPayload.subscription_id,
        },
      });

      await apiRequest<{ success: true }>("/api/saas/pay/verify", {
        method: "POST",
        token: accessToken || undefined,
        body: {
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        },
      });

      setPhase("success");
    } catch (err) {
      if ((err as any)?.cancelled) {
        setPhase("ready");
        return;
      }
      // Payment may still succeed via webhook reconciliation, so show soft warning.
      setError(err instanceof Error ? err.message : "Payment failed");
      setPhase("ready");
    }
  }, [phase, accessToken]);

  // On success, attempt to deep-link back into the native app.
  useEffect(() => {
    if (phase !== "success") return;
    const t = setTimeout(() => {
      window.location.href = DEEP_LINK_RETURN;
    }, 1500);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "exchanging") {
    return (
      <div className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <img src={shalomLogo} alt="Shalom" className="auth-logo" />
          <h1>Signing you in…</h1>
          <p>One moment — we're opening your subscription dashboard.</p>
        </section>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <img src={shalomLogo} alt="Shalom" className="auth-logo" />
          <h1>Loading your plan…</h1>
        </section>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <img src={shalomLogo} alt="Shalom" className="auth-logo" />
          <h1>Something went wrong</h1>
          <div className="notice notice-error">{error || "Unknown error"}</div>
          <div className="actions-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
            <button className="btn btn-primary" onClick={() => navigate("/", { replace: true })}>
              Back to home
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="auth-shell">
        <section className="auth-card" style={{ textAlign: "center" }}>
          <img src={shalomLogo} alt="Shalom" className="auth-logo" />
          <h1>Payment successful</h1>
          <p>Your subscription is active. Returning you to the app…</p>
          <div className="actions-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
            <a className="btn btn-primary" href={DEEP_LINK_RETURN}>
              Open Shalom app
            </a>
          </div>
        </section>
      </div>
    );
  }

  const sub = data?.subscription;
  const settings = data?.settings;
  const amount = sub?.amount ?? settings?.church_subscription_amount ?? 0;
  const cycle = sub?.billing_cycle ?? "monthly";
  const status = sub?.status ?? "inactive";
  const next = sub?.next_payment_date;

  return (
    <div className="auth-shell">
      <section className="auth-card" style={{ maxWidth: 480 }}>
        <img src={shalomLogo} alt="Shalom" className="auth-logo" />
        <h1>Manage Subscription</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Your church's Shalom platform subscription.
        </p>

        <div
          style={{
            marginTop: "1.25rem",
            padding: "1rem",
            borderRadius: "var(--radius-md)",
            background: "var(--surface-container)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Plan</span>
            <strong>₹{amount} / {cycle}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Status</span>
            <strong style={{ textTransform: "capitalize" }}>{status}</strong>
          </div>
          {next ? (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Next billing date</span>
              <strong>{new Date(next).toLocaleDateString("en-IN")}</strong>
            </div>
          ) : null}
        </div>

        {error ? <div className="notice notice-error" style={{ marginTop: "1rem" }}>{error}</div> : null}

        <div className="actions-row" style={{ marginTop: "1.25rem" }}>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={phase === "paying" || !amount}
            onClick={handlePay}
          >
            {phase === "paying" ? "Processing…" : "Pay Now"}
          </button>
        </div>

        <p className="muted" style={{ fontSize: "0.85rem", marginTop: "1rem", textAlign: "center" }}>
          Payments are processed securely by Razorpay. You'll return to the app automatically after payment.
        </p>
      </section>
    </div>
  );
}
