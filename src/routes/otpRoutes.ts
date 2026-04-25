import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import Twilio from "twilio";
import { normalizeIndianPhone } from "../utils/phone";
import { validate, otpSendSchema, otpVerifySchema } from "../utils/zodSchemas";
// AWS SNS imports — kept for future use
// import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  // AWS_REGION,
  // AWS_ACCESS_KEY_ID,
  // AWS_SECRET_ACCESS_KEY,
  // OTP_EXPIRY_SECONDS,
  JWT_SECRET,
  APP_NAME,
  FRONTEND_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_VERIFY_SERVICE_SID,
  SUPER_ADMIN_PHONES,
} from "../config";
import { logger } from "../utils/logger";
import { db } from "../services/dbClient";
import { createRefreshToken } from "../services/refreshTokenService";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";

const router = Router();

// ── Twilio Verify client ──
let twilioClient: ReturnType<typeof Twilio> | null = null;
function getTwilioClient() {
  if (!twilioClient) {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error("Twilio credentials not configured");
    }
    twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// AWS SNS client — kept commented for future use
// let snsClient: SNSClient | null = null;
// function getSnsClient(): SNSClient {
//   if (!snsClient) {
//     snsClient = new SNSClient({
//       region: AWS_REGION,
//       ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
//         ? { credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } }
//         : {}),
//     });
//   }
//   return snsClient;
// }

// ── OTP helpers — no longer needed with Twilio Verify ──
// Twilio Verify handles OTP generation, storage, rate limiting, expiry, and verification.
// Keeping the old DB-backed helpers commented out for reference.

// const OTP_MAX_SENDS_PER_HOUR = 5;
// const OTP_MAX_VERIFY_ATTEMPTS = 5;
//
// function generateOtp(): string {
//   return String(crypto.randomInt(100000, 999999));
// }
//
// function hashOtp(otp: string): string {
//   return crypto.createHash("sha256").update(otp).digest("hex");
// }
//
// async function checkAndIncrementRateLimit(phone: string): Promise<boolean> { ... }
// async function storeOtp(phone: string, otp: string): Promise<void> { ... }
// async function verifyStoredOtp(phone: string, otp: string): Promise<{ valid: boolean; error?: string }> { ... }

// Look up user's role and church_id from the junction table (with users fallback)
async function getUserProfileForJwt(userId: string, email: string, phone: string) {
  let role = "member";
  let church_id = "";

  // Try by auth_user_id first to find the user
  const { data: byAuthId } = await db
    .from("users")
    .select("id, role, church_id")
    .eq("auth_user_id", userId)
    .limit(1)
    .maybeSingle();

  // Also try by user id directly
  const userRow = byAuthId || (await db
    .from("users")
    .select("id, role, church_id")
    .eq("id", userId)
    .limit(1)
    .maybeSingle()).data;

  if (userRow) {
    role = userRow.role || "member";
    // Check if super_admin
    if (role === "super_admin") {
      return { role, church_id: userRow.church_id || "" };
    }
  }

  // Use junction table to find all active church memberships
  const resolvedUserId = userRow?.id || userId;
  const { data: memberships } = await db
    .from("user_church_memberships")
    .select("church_id, role")
    .eq("user_id", resolvedUserId)
    .eq("is_active", true)
    .order("joined_at", { ascending: true })
    .limit(5);

  if (memberships && memberships.length > 0) {
    // Use the first (oldest) active membership as default church
    church_id = memberships[0].church_id;
    role = memberships[0].role || role;
    return { role, church_id };
  }

  // Fallback to users.church_id for backward compatibility (pre-migration data)
  if (userRow?.church_id) {
    church_id = userRow.church_id;
    return { role, church_id };
  }

  // Last resort: check members table by phone — scoped to user's own linked members only
  if (phone && resolvedUserId) {
    // Only match members that are already linked to this user (user_id) to avoid cross-tenant leakage
    const { data: mByUserPhone } = await db
      .from("members")
      .select("church_id")
      .eq("user_id", resolvedUserId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (mByUserPhone?.church_id) {
      church_id = mByUserPhone.church_id;
      // Sync to users table for backward compat
      await db.from("users").update({ church_id }).eq("id", resolvedUserId);
      // Create junction row
      await db.from("user_church_memberships").upsert({
        user_id: resolvedUserId,
        church_id,
        role: "member",
        is_active: true,
      }, { onConflict: "user_id,church_id" });
    }
  }

  return { role, church_id };
}

/** Ensure junction table rows exist for all member records linked to this user */
async function ensureJunctionRows(userId: string) {
  try {
    const { data: members } = await db
      .from("members")
      .select("id, church_id")
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (!members || members.length === 0) return;

    for (const m of members) {
      if (!m.church_id) continue;
      await db.from("user_church_memberships").upsert({
        user_id: userId,
        church_id: m.church_id,
        member_id: m.id,
        role: "member",
        is_active: true,
      }, { onConflict: "user_id,church_id" });
    }
  } catch (err) {
    logger.warn({ err, userId }, "ensureJunctionRows: non-fatal error syncing junction rows");
  }
}

// AWS SNS sendOtpSms — commented out, replaced by Twilio Verify
// async function sendOtpSms(phone: string, otp: string): Promise<void> {
//   const sns = getSnsClient();
//   await sns.send(
//     new PublishCommand({
//       PhoneNumber: phone,
//       Message: `Your ${APP_NAME} verification code is ${otp}. Valid for ${Math.floor(OTP_EXPIRY_SECONDS / 60)} minutes. Do not share this code.`,
//       MessageAttributes: {
//         "AWS.SNS.SMS.SenderID": { DataType: "String", StringValue: APP_NAME.slice(0, 11) },
//         "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
//       },
//     })
//   );
// }

// ── Send OTP via Twilio Verify ──
router.post("/send", validate(otpSendSchema), async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    const cleaned = normalizeIndianPhone(phone);
    if (!/^\+91[6-9]\d{9}$/.test(cleaned)) {
      return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number" });
    }

    const client = getTwilioClient();
    await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: cleaned, channel: "sms" });

    logger.info({ phone_number: cleaned }, "OTP sent via Twilio Verify");
    return res.json({ success: true, message: "OTP sent successfully" });
  } catch (err: any) {
    logger.error({ err }, "OTP send error");
    // Twilio rate-limits return status 429 / code 60203
    if (err?.code === 60203 || err?.status === 429) {
      return res.status(429).json({ error: "Too many OTP requests. Please try again later." });
    }
    const message = err?.message?.includes("credentials") || err?.message?.includes("Twilio")
      ? "OTP service is not configured"
      : "Failed to send OTP";
    return res.status(500).json({ error: message });
  }
});

// ── Verify OTP via Twilio Verify & issue JWT ──
router.post("/verify", validate(otpVerifySchema), async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;

    const cleaned = normalizeIndianPhone(phone);

    logger.info({ phone: cleaned }, "OTP verify attempt");

    // Twilio Verify handles timing normalization internally
    const client = getTwilioClient();
    let check;
    try {
      check = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: cleaned, code: otp.trim() });
    } catch (twilioErr: any) {
      // Twilio error 60200 = invalid parameter (no pending verification)
      if (twilioErr?.code === 60200) {
        return res.status(400).json({ error: "No OTP found for this number. Please request a new one." });
      }
      // Twilio error 60203 = max check attempts reached
      if (twilioErr?.code === 60203) {
        return res.status(429).json({ error: "Too many failed attempts. Please request a new OTP." });
      }
      // Twilio error 20404 = verification expired or already used
      if (twilioErr?.code === 20404) {
        return res.status(400).json({ error: "OTP has expired. Please request a new one." });
      }
      throw twilioErr;
    }

    if (check.status !== "approved") {
      logger.warn({ phone: cleaned, status: check.status }, "OTP verify failed");
      return res.status(400).json({ error: "Invalid OTP. Please try again." });
    }

    // Find or create user by phone
    let userId: string = "";
    let userPhone: string = cleaned;
    let userEmail: string = "";

    // Step 1: Try to find existing user by phone_number in users table
    const { data: existingRow } = await db
      .from("users")
      .select("id, email, phone_number, auth_user_id, church_id")
      .eq("phone_number", cleaned)
      .limit(1)
      .maybeSingle();

    if (existingRow) {
      // Even if user exists, verify they still have a member record (unless super admin)
      const isSuperPhone = SUPER_ADMIN_PHONES.includes(cleaned);
      if (!isSuperPhone) {
        // Scope member check to user's church if known, to prevent cross-church false positives
        let memberCheckQuery = db
          .from("members")
          .select("id")
          .eq("phone_number", cleaned);
        if (existingRow && (existingRow as any).church_id) {
          memberCheckQuery = memberCheckQuery.eq("church_id", (existingRow as any).church_id);
        }
        const { data: memberCheck } = await memberCheckQuery
          .limit(1)
          .maybeSingle();

        if (!memberCheck) {
          logger.warn({ phone: cleaned, userId: existingRow.id }, "Existing user but no member record — login rejected");
          return res.status(403).json({ error: "Your phone number is not registered with any church. Please contact your church administrator to register you as a member." });
        }
      }

      userId = existingRow.auth_user_id || existingRow.id;
      userPhone = existingRow.phone_number || cleaned;
      userEmail = existingRow.email || "";
    } else {
      // Step 2: Check if a member exists with this phone — merge with their user account
      // SEC: Query ALL matching members but deterministically pick the most recently created
      // linked member, or the most recently created unlinked member. Log cross-church hits.
      const { data: membersByPhone } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id, full_name")
        .eq("phone_number", cleaned)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(5);

      // Pick best match: prefer linked member, else most recent
      const memberByPhone = membersByPhone?.find((m: any) => m.user_id) || membersByPhone?.[0] || null;

      if (membersByPhone && membersByPhone.length > 1) {
        logger.warn({ phone: cleaned, count: membersByPhone.length, pickedId: memberByPhone?.id, churches: membersByPhone.map((m: any) => m.church_id) }, "Multiple members share same phone across churches — picked best match");
      }

      if (memberByPhone?.user_id) {
        // Member found with a linked user — add phone to that user to merge identities
        const { data: linkedUser } = await db
          .from("users")
          .select("id, email, phone_number, auth_user_id, church_id, full_name")
          .eq("id", memberByPhone.user_id)
          .maybeSingle();

        if (linkedUser) {
          // Update the existing user row with the phone number and any missing data
          const userUpdates: Record<string, any> = {};
          if (!linkedUser.phone_number) userUpdates.phone_number = cleaned;
          if (!linkedUser.church_id && memberByPhone.church_id) userUpdates.church_id = memberByPhone.church_id;
          if (!linkedUser.full_name && memberByPhone.full_name) userUpdates.full_name = memberByPhone.full_name;
          if (Object.keys(userUpdates).length > 0) {
            await db.from("users").update(userUpdates).eq("id", linkedUser.id);
          }
          userId = linkedUser.auth_user_id || linkedUser.id;
          userPhone = cleaned;
          userEmail = linkedUser.email || "";
          logger.info({ phone: cleaned, userId, email: userEmail }, "Phone-to-email user merged via member record");
        } else {
          // user_id on member is stale — fall through to email lookup
          userId = "";
        }
      } else if (memberByPhone) {
        // Member found by phone but not linked to any user account
        // Phone-only: create a new user — do NOT try to merge via email
        const insertData: Record<string, any> = {
          phone_number: cleaned,
          role: "member",
        };
        if (memberByPhone.church_id) insertData.church_id = memberByPhone.church_id;
        if (memberByPhone.full_name) insertData.full_name = memberByPhone.full_name;
        if (memberByPhone.email) insertData.email = memberByPhone.email;

        const { data: newUser, error: createErr } = await db
          .from("users")
          .insert(insertData)
          .select("id, email, phone_number")
          .single();

        if (createErr || !newUser) {
          logger.error({ err: createErr, phone: cleaned }, "Failed to create user for pre-registered member");
          return res.status(500).json({ error: "Failed to create user account" });
        }

        // Link the pre-registered member to the new user
        await db.from("members").update({ user_id: (newUser as any).id }).eq("id", memberByPhone.id);
        // Create junction table row for this membership
        await db.from("user_church_memberships").upsert({
          user_id: (newUser as any).id,
          church_id: memberByPhone.church_id,
          member_id: memberByPhone.id,
          role: "member",
          is_active: true,
        }, { onConflict: "user_id,church_id" });
        userId = (newUser as any).id;
        userPhone = cleaned;
        userEmail = memberByPhone.email || "";
        logger.info({ phone: cleaned, userId, memberId: memberByPhone.id, church_id: memberByPhone.church_id }, "Created user from pre-registered member and linked");
      }

      // Step 3: No member found by phone — reject login (only registered members allowed)
      // Exception: super admin phones are always allowed through
      if (!userId) {
        const isSuperPhone = SUPER_ADMIN_PHONES.includes(cleaned);
        if (!isSuperPhone) {
          logger.warn({ phone: cleaned }, "OTP verified but phone not found in members — login rejected");
          return res.status(403).json({ error: "Your phone number is not registered with any church. Please contact your church administrator to register you as a member." });
        }

        // Super admin — create bare user so they can access the system
        const { data: newUser, error: createErr } = await db
          .from("users")
          .insert({ phone_number: cleaned, role: "super_admin" })
          .select("id, email, phone_number")
          .single();

        if (createErr || !newUser) {
          logger.error({ err: createErr, phone: cleaned }, "Failed to create super admin user after OTP");
          return res.status(500).json({ error: "Failed to create user account" });
        }
        userId = (newUser as any).id;
        userPhone = (newUser as any).phone_number || cleaned;
        userEmail = (newUser as any).email || "";
      }
    }

    // Look up role + church_id from junction table (falls back to users table)
    const profile = await getUserProfileForJwt(userId, userEmail, userPhone);

    // Ensure junction rows exist for all churches this user belongs to
    await ensureJunctionRows(userId);

    // Fetch all churches this user belongs to (for frontend church picker)
    let userChurches: { church_id: string; church_name: string; role: string }[] = [];
    if (profile.role !== "super_admin") {
      const { data: ucmRows } = await db
        .from("user_church_memberships")
        .select("church_id, role, churches(name)")
        .eq("user_id", userId)
        .eq("is_active", true);
      if (ucmRows) {
        userChurches = ucmRows.map((r: any) => ({
          church_id: r.church_id,
          church_name: r.churches?.name || "",
          role: r.role || "member",
        }));
      }
    }

    // Issue a custom JWT with church_id and real role
    const tokenPayload = {
      sub: userId,
      phone: userPhone,
      email: userEmail,
      role: profile.role,
      church_id: profile.church_id,
      aud: "authenticated",
      iss: "shalom-app",
    };

    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "30m" });

    // Issue refresh token and set as httpOnly cookie (SH-008: store church_id for tenant-scoped sessions)
    const { token: refreshToken, expiresAt } = await createRefreshToken(userId, profile.church_id || undefined);
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: "/api/auth/refresh",
      expires: expiresAt,
    });

    logger.info({ phone: cleaned, userId, church_id: profile.church_id, churches_count: userChurches.length }, "OTP verified, JWT issued");
    return res.json({
      success: true,
      access_token: accessToken,
      user: { id: userId, phone: userPhone, email: userEmail },
      churches: userChurches,
    });
  } catch (err: any) {
    logger.error({ err }, "OTP verify error");
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

// ── Resend OTP via Twilio Verify ──
router.post("/resend", validate(otpSendSchema), async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    const cleaned = normalizeIndianPhone(phone);
    if (!/^\+91[6-9]\d{9}$/.test(cleaned)) {
      return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number" });
    }

    const client = getTwilioClient();
    await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: cleaned, channel: "sms" });

    logger.info({ phone: cleaned }, "OTP resent via Twilio Verify");
    return res.json({ success: true, message: "OTP resent successfully" });
  } catch (err: any) {
    logger.error({ err }, "OTP resend error");
    if (err?.code === 60203 || err?.status === 429) {
      return res.status(429).json({ error: "Too many OTP requests. Please try again later." });
    }
    const message = err?.message?.includes("credentials") || err?.message?.includes("Twilio")
      ? "OTP service is not configured"
      : "Failed to resend OTP";
    return res.status(500).json({ error: message });
  }
});

// ── Verify OTP for phone number change (does NOT issue login tokens) ──
router.post("/verify-phone-change", requireAuth, validate(otpVerifySchema), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { phone, otp } = req.body;

    const cleaned = normalizeIndianPhone(phone);
    if (!/^\+91[6-9]\d{9}$/.test(cleaned)) {
      return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number" });
    }

    const client = getTwilioClient();
    let check;
    try {
      check = await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: cleaned, code: otp.trim() });
    } catch (twilioErr: any) {
      if (twilioErr?.code === 60200) {
        return res.status(400).json({ error: "No OTP found for this number. Please request a new one." });
      }
      if (twilioErr?.code === 60203) {
        return res.status(429).json({ error: "Too many failed attempts. Please request a new OTP." });
      }
      // Twilio error 20404 = verification expired or already used
      if (twilioErr?.code === 20404) {
        return res.status(400).json({ error: "OTP has expired. Please request a new one." });
      }
      throw twilioErr;
    }

    if (check.status !== "approved") {
      return res.status(400).json({ error: "Invalid OTP. Please try again." });
    }

    // Issue a short-lived signed token proving this phone was verified
    const phoneChangeToken = jwt.sign(
      { sub: req.user.id, verified_phone: cleaned, purpose: "phone_change" },
      JWT_SECRET,
      { expiresIn: "10m" },
    );

    logger.info({ phone: cleaned, userId: req.user.id }, "Phone change OTP verified");
    return res.json({ success: true, phone_change_token: phoneChangeToken });
  } catch (err: any) {
    logger.error({ err }, "Phone change OTP verify error");
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

export default router;
