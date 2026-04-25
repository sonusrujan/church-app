import { PAYMENTS_ENABLED, RAZORPAY_KEY_ID } from "../config";
import { logger } from "../utils/logger";
import { encryptSecret, decryptSecret, isEncrypted } from "../utils/crypto";
import { db } from "./dbClient";

const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

type ChurchPaymentRow = {
  id: string;
  payments_enabled: boolean | null;
  razorpay_key_id: string | null;
  razorpay_key_secret: string | null;
};

export type EffectivePaymentConfig = {
  payments_enabled: boolean;
  key_id: string;
  key_secret: string;
  source: "church" | "global" | "disabled";
  reason: string;
};

function isMissingChurchPaymentColumnsError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  const normalized = message.toLowerCase();
  return (
    normalized.includes("payments_enabled") ||
    normalized.includes("razorpay_key_id") ||
    normalized.includes("razorpay_key_secret")
  );
}

async function readChurchPaymentRow(churchId: string) {
  const { data, error } = await db
    .from("churches")
    .select("id, payments_enabled, razorpay_key_id, razorpay_key_secret")
    .eq("id", churchId)
    .maybeSingle<ChurchPaymentRow>();

  if (error) {
    if (isMissingChurchPaymentColumnsError(error)) {
      return {
        data: null,
        missingColumns: true,
      };
    }

    logger.error({ err: error, churchId }, "readChurchPaymentRow failed");
    throw error;
  }

  return {
    data,
    missingColumns: false,
  };
}

function getGlobalFallbackConfig() {
  const hasGlobalKeys = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
  if (!PAYMENTS_ENABLED || !hasGlobalKeys) {
    return {
      enabled: false,
      key_id: "",
      key_secret: "",
      reason: PAYMENTS_ENABLED
        ? "No church-level or global Razorpay credentials configured"
        : "Payments disabled by server",
    };
  }

  return {
    enabled: true,
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
    reason: "Using legacy global Razorpay credentials",
  };
}

export async function getEffectivePaymentConfig(churchId?: string | null): Promise<EffectivePaymentConfig> {
  if (!PAYMENTS_ENABLED) {
    return {
      payments_enabled: false,
      key_id: "",
      key_secret: "",
      source: "disabled",
      reason: "Payments disabled by server",
    };
  }

  if (!churchId) {
    const fallback = getGlobalFallbackConfig();
    return {
      payments_enabled: fallback.enabled,
      key_id: fallback.key_id,
      key_secret: fallback.key_secret,
      source: fallback.enabled ? "global" : "disabled",
      reason: fallback.reason,
    };
  }

  const church = await readChurchPaymentRow(churchId);
  if (church.missingColumns) {
    const fallback = getGlobalFallbackConfig();
    return {
      payments_enabled: fallback.enabled,
      key_id: fallback.key_id,
      key_secret: fallback.key_secret,
      source: fallback.enabled ? "global" : "disabled",
      reason: fallback.reason,
    };
  }

  if (!church.data) {
    return {
      payments_enabled: false,
      key_id: "",
      key_secret: "",
      source: "disabled",
      reason: "Church not found",
    };
  }

  const enabled = Boolean(church.data.payments_enabled);
  const keyId = church.data.razorpay_key_id?.trim() || "";
  const rawKeySecret = church.data.razorpay_key_secret?.trim() || "";
  // HIGH-06: Encrypt synchronously before returning — do not return plaintext
  let keySecret: string;
  if (rawKeySecret && !isEncrypted(rawKeySecret)) {
    keySecret = rawKeySecret;
    // Persist encryption synchronously so plaintext is never stored again
    try {
      await db
        .from("churches")
        .update({ razorpay_key_secret: encryptSecret(rawKeySecret) })
        .eq("id", churchId);
      logger.info({ churchId }, "auto-encrypted legacy plaintext Razorpay key_secret");
    } catch (encErr: any) {
      logger.warn({ err: encErr, churchId }, "auto-encrypt key_secret failed");
    }
  } else {
    keySecret = rawKeySecret ? decryptSecret(rawKeySecret) : "";
  }

  if (!enabled) {
    return {
      payments_enabled: false,
      key_id: "",
      key_secret: "",
      source: "disabled",
      reason: "Church payments are disabled",
    };
  }

  if (!keyId || !keySecret) {
    return {
      payments_enabled: false,
      key_id: "",
      key_secret: "",
      source: "disabled",
      reason: "Church Razorpay credentials are incomplete",
    };
  }

  return {
    payments_enabled: true,
    key_id: keyId,
    key_secret: keySecret,
    source: "church",
    reason: "Church payment credentials active",
  };
}

export async function getChurchPaymentSettings(churchId: string) {
  const church = await readChurchPaymentRow(churchId);
  if (church.missingColumns) {
    return {
      church_id: churchId,
      payments_enabled: false,
      key_id: "",
      has_key_secret: false,
      schema_ready: false,
    };
  }

  if (!church.data) {
    throw new Error("Church not found");
  }

  return {
    church_id: churchId,
    payments_enabled: Boolean(church.data.payments_enabled),
    key_id: church.data.razorpay_key_id || "",
    has_key_secret: Boolean(church.data.razorpay_key_secret),
    schema_ready: true,
  };
}

export async function updateChurchPaymentSettings(input: {
  church_id: string;
  payments_enabled?: boolean;
  key_id?: string;
  key_secret?: string;
}) {
  const church = await readChurchPaymentRow(input.church_id);
  if (church.missingColumns) {
    throw new Error("Church payment columns missing. Run db/shalom_expansion_migration.sql");
  }

  if (!church.data) {
    throw new Error("Church not found");
  }

  const currentEnabled = Boolean(church.data.payments_enabled);
  const currentKeyId = church.data.razorpay_key_id?.trim() || "";
  const currentKeySecret = church.data.razorpay_key_secret?.trim() || "";

  const nextEnabled =
    typeof input.payments_enabled === "boolean" ? input.payments_enabled : currentEnabled;
  const nextKeyId =
    typeof input.key_id === "string" ? input.key_id.trim() : currentKeyId;
  const nextKeySecret =
    typeof input.key_secret === "string" ? input.key_secret.trim() : currentKeySecret;

  // MED-06: Validate Razorpay credential format
  if (typeof input.key_id === "string" && input.key_id.trim()) {
    const keyIdTrimmed = input.key_id.trim();
    if (!/^rzp_(live|test)_[A-Za-z0-9]{14,}$/.test(keyIdTrimmed)) {
      throw new Error("Invalid Razorpay key_id format. Expected rzp_live_... or rzp_test_...");
    }
  }

  if (nextEnabled && (!nextKeyId || !nextKeySecret)) {
    throw new Error("Enable payments only after setting both Razorpay key_id and key_secret");
  }

  const patch: Record<string, unknown> = {
    payments_enabled: nextEnabled,
  };

  if (typeof input.key_id === "string") {
    patch.razorpay_key_id = nextKeyId || null;
  }

  if (typeof input.key_secret === "string") {
    patch.razorpay_key_secret = nextKeySecret ? encryptSecret(nextKeySecret) : null;
  }

  const { data, error } = await db
    .from("churches")
    .update(patch)
    .eq("id", input.church_id)
    .select("id, payments_enabled, razorpay_key_id, razorpay_key_secret")
    .single<ChurchPaymentRow>();

  if (error) {
    logger.error({ err: error, churchId: input.church_id }, "updateChurchPaymentSettings failed");
    throw error;
  }

  return {
    church_id: data.id,
    payments_enabled: Boolean(data.payments_enabled),
    key_id: data.razorpay_key_id || "",
    has_key_secret: Boolean(data.razorpay_key_secret),
    schema_ready: true,
  };
}
