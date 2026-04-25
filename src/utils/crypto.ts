import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:";

// Use a dedicated encryption key if provided; fall back to JWT_SECRET derivation for backward compatibility
const ENCRYPTION_KEY_SOURCE = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "";
const encryptionKey = crypto
  .createHash("sha256")
  .update(`razorpay-encryption:${ENCRYPTION_KEY_SOURCE}`)
  .digest();

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: enc:<iv>:<authTag>:<ciphertext> (all base64)
  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  // If not encrypted (legacy plaintext), return as-is
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;

  const parts = stored.slice(ENCRYPTED_PREFIX.length).split(":");
  if (parts.length !== 3) return "";

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  return Boolean(value && value.startsWith(ENCRYPTED_PREFIX));
}
