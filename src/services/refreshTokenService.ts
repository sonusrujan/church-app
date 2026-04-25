import crypto from "crypto";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";

const REFRESH_TOKEN_EXPIRY_DAYS = 30;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Create a new refresh token and store the hash in DB. */
export async function createRefreshToken(userId: string, churchId?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const row: Record<string, any> = {
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: expiresAt.toISOString(),
  };
  if (churchId) row.church_id = churchId;

  await db.from("refresh_tokens").insert(row);

  return { token, expiresAt };
}

/** Validate a refresh token. Returns user_id + church_id if valid, null otherwise. Rotates the token. */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; churchId: string | null; newToken: string; expiresAt: Date } | null> {
  const tokenHash = hashToken(token);

  const { data: row } = await db
    .from("refresh_tokens")
    .select("id, user_id, church_id, expires_at, revoked, updated_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Expired — revoke it
    await db.from("refresh_tokens").update({ revoked: true }).eq("id", row.id);
    return null;
  }

  // RT-001: Grace period reduced to 5s for concurrent tab refreshes.
  // If the token was revoked within the last 5s (another tab just rotated it),
  // find and return the newest active token for this user instead of failing.
  if (row.revoked) {
    const revokedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    if (Date.now() - revokedAt < 5_000) {
      const { data: latest } = await db
        .from("refresh_tokens")
        .select("id, user_id, token_hash, expires_at")
        .eq("user_id", row.user_id)
        .eq("revoked", false)
        .order("expires_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest && new Date(latest.expires_at).getTime() > Date.now()) {
        // Return the current active token's info (token text is unknown, issue a fresh one)
        await db.from("refresh_tokens").update({ revoked: true }).eq("id", latest.id);
        const newToken = crypto.randomBytes(48).toString("base64url");
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const insertRow: Record<string, any> = {
          user_id: row.user_id,
          token_hash: hashToken(newToken),
          expires_at: expiresAt.toISOString(),
        };
        if (row.church_id) insertRow.church_id = row.church_id;
        await db.from("refresh_tokens").insert(insertRow);
        return { userId: row.user_id, churchId: row.church_id || null, newToken, expiresAt };
      }
    }
    // RT-001: Token family revocation — revoked token reused outside grace window
    // This indicates potential token theft. Revoke ALL tokens for this user.
    logger.warn({ userId: row.user_id }, "Revoked refresh token reused outside grace window — revoking all tokens (possible theft)");
    await db
      .from("refresh_tokens")
      .update({ revoked: true })
      .eq("user_id", row.user_id)
      .eq("revoked", false);
    return null;
  }

  // Revoke the old token
  await db.from("refresh_tokens").update({ revoked: true }).eq("id", row.id);

  // Issue a new one (rotation)
  const newToken = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const insertRow: Record<string, any> = {
    user_id: row.user_id,
    token_hash: hashToken(newToken),
    expires_at: expiresAt.toISOString(),
  };
  if (row.church_id) insertRow.church_id = row.church_id;
  await db.from("refresh_tokens").insert(insertRow);

  return { userId: row.user_id, churchId: row.church_id || null, newToken, expiresAt };
}

/** Revoke all refresh tokens for a user (e.g., on role change or logout). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await db
    .from("refresh_tokens")
    .update({ revoked: true })
    .eq("user_id", userId)
    .eq("revoked", false);
}

/** Revoke a single refresh token. */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await db.from("refresh_tokens").update({ revoked: true }).eq("token_hash", tokenHash);
}
