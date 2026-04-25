import { db } from "./dbClient";
import { logger } from "../utils/logger";
import { encryptSecret, decryptSecret, isEncrypted } from "../utils/crypto";

const SINGLETON_ID = "default";

type PlatformConfigRow = {
  id: string;
  razorpay_key_id: string | null;
  razorpay_key_secret: string | null;
  updated_at: string;
};

export type PlatformPaymentCredentials = {
  key_id: string;
  key_secret: string;
  configured: boolean;
};

async function ensureRow(): Promise<PlatformConfigRow> {
  const { data: existing } = await db
    .from("platform_config")
    .select("*")
    .eq("id", SINGLETON_ID)
    .maybeSingle<PlatformConfigRow>();

  if (existing) return existing;

  const { data, error } = await db
    .from("platform_config")
    .upsert({ id: SINGLETON_ID })
    .select()
    .single<PlatformConfigRow>();

  if (error) {
    logger.error({ err: error }, "ensureRow platform_config failed");
    throw error;
  }
  return data;
}

export async function getPlatformConfig(): Promise<{
  key_id: string;
  has_key_secret: boolean;
}> {
  const row = await ensureRow();
  return {
    key_id: row.razorpay_key_id || "",
    has_key_secret: Boolean(row.razorpay_key_secret),
  };
}

export async function updatePlatformConfig(input: {
  key_id?: string;
  key_secret?: string;
}): Promise<{ key_id: string; has_key_secret: boolean }> {
  const row = await ensureRow();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof input.key_id === "string") {
    patch.razorpay_key_id = input.key_id.trim() || null;
  }

  if (typeof input.key_secret === "string") {
    const trimmed = input.key_secret.trim();
    patch.razorpay_key_secret = trimmed ? encryptSecret(trimmed) : null;
  }

  const { data, error } = await db
    .from("platform_config")
    .update(patch)
    .eq("id", row.id)
    .select()
    .single<PlatformConfigRow>();

  if (error) {
    logger.error({ err: error }, "updatePlatformConfig failed");
    throw error;
  }

  return {
    key_id: data.razorpay_key_id || "",
    has_key_secret: Boolean(data.razorpay_key_secret),
  };
}

export async function getPlatformPaymentCredentials(): Promise<PlatformPaymentCredentials> {
  const row = await ensureRow();

  const keyId = (row.razorpay_key_id || "").trim();
  const rawSecret = (row.razorpay_key_secret || "").trim();
  // HIGH-06: Encrypt synchronously before returning
  let keySecret: string;
  if (rawSecret && !isEncrypted(rawSecret)) {
    keySecret = rawSecret;
    try {
      await db
        .from("platform_config")
        .update({ razorpay_key_secret: encryptSecret(rawSecret) })
        .eq("id", row.id);
      logger.info("auto-encrypted legacy plaintext platform Razorpay key_secret");
    } catch (encErr: any) {
      logger.warn({ err: encErr }, "auto-encrypt platform key_secret failed");
    }
  } else {
    keySecret = rawSecret ? decryptSecret(rawSecret) : "";
  }

  if (!keyId || !keySecret) {
    return { key_id: "", key_secret: "", configured: false };
  }

  return { key_id: keyId, key_secret: keySecret, configured: true };
}
