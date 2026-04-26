import { loadRazorpayCheckoutScript } from "../types";

export interface RazorpayCheckoutOptions {
  /** Razorpay key_id (per-church or platform) */
  keyId: string;
  /** Order ID from the backend */
  orderId: string;
  /** Amount in paise (smallest currency unit) */
  amountPaise: number;
  /** Currency code */
  currency?: string;
  /** Display name in the popup */
  name?: string;
  /** Description shown in the popup */
  description?: string;
  /** Prefill fields */
  prefill?: { name?: string; email?: string; contact?: string };
  /** Razorpay notes metadata */
  notes?: Record<string, string>;
  /** Theme color */
  themeColor?: string;
}

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

type RazorpayInstance = {
  open: () => void;
};

type RazorpayConstructor = new (options: {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: RazorpayCheckoutOptions["prefill"];
  notes: Record<string, string>;
  theme: { color: string };
  handler: (response: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
}) => RazorpayInstance;

function getRazorpayConstructor(): RazorpayConstructor | null {
  return typeof window.Razorpay === "function" ? (window.Razorpay as RazorpayConstructor) : null;
}

/**
 * Open the Razorpay checkout popup and wait for the payment response.
 * Loads the Razorpay script if not already loaded.
 * Returns the Razorpay response on success, throws on failure/cancellation.
 */
export async function openRazorpayCheckout(
  opts: RazorpayCheckoutOptions,
): Promise<RazorpayResponse> {
  const loaded = await loadRazorpayCheckoutScript();
  const Razorpay = getRazorpayConstructor();
  if (!loaded || !Razorpay) {
    throw new Error("Failed to load Razorpay checkout. Please refresh and try again.");
  }

  return new Promise<RazorpayResponse>((resolve, reject) => {
    const razorpay = new Razorpay({
      key: opts.keyId,
      amount: opts.amountPaise,
      currency: opts.currency || "INR",
      order_id: opts.orderId,
      name: opts.name || "Shalom",
      description: opts.description || "Payment",
      prefill: opts.prefill || {},
      notes: opts.notes || {},
      theme: { color: opts.themeColor || "#2a6f7c" },
      handler: (response: RazorpayResponse) => {
        resolve(response);
      },
      modal: {
        ondismiss: () => {
          const err = new Error("Payment cancelled by user");
          Object.assign(err, { cancelled: true });
          reject(err);
        },
      },
    });
    razorpay.open();
  });
}
