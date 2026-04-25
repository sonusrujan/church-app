import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import Twilio from "twilio";
import { normalizeIndianPhone } from "../utils/phone";
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

// Look up user's role and church_id from the `users` table (profile)
async function getUserProfileForJwt(userId: string, email: string, phone: string) {
  let role = "member";
  let church_id = "";

  // Try by auth_user_id first
  const { data: byAuthId } = await db
    .from("users")
    .select("role, church_id")
    .eq("auth_user_id", userId)
    .limit(1)
    .maybeSingle();

  if (byAuthId) {
    return { role: byAuthId.role || "member", church_id: byAuthId.church_id || "" };
  }

  // Try by phone
  if (phone) {
    const { data: byPhone } = await db
      .from("users")
      .select("role, church_id")
      .eq("phone_number", phone)
      .limit(1)
      .maybeSingle();

    if (byPhone) {
      return { role: byPhone.role || "member", church_id: byPhone.church_id || "" };
    }
  }

  // Try by email
  if (email) {
    const { data: byEmail } = await db
      .from("users")
      .select("role, church_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (byEmail) {
      role = byEmail.role || "member";
      church_id = byEmail.church_id || "";
    }
  }

  // If still no church_id, check members table as fallback
  if (!church_id) {
    let memberChurchId: string | null = null;

    if (phone) {
      const { data: mByPhone } = await db
        .from("members")
        .select("church_id")
        .eq("phone_number", phone)
        .limit(1)
        .maybeSingle();
      if (mByPhone?.church_id) memberChurchId = mByPhone.church_id;
    }

    if (!memberChurchId && email) {
      const { data: mByEmail } = await db
        .from("members")
        .select("church_id")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      if (mByEmail?.church_id) memberChurchId = mByEmail.church_id;
    }

    if (memberChurchId) {
      church_id = memberChurchId;
      // Also update the user record so future lookups are faster
      if (userId) {
        await db.from("users").update({ church_id: memberChurchId }).or(`auth_user_id.eq.${userId},id.eq.${userId}`);
      }
    }
  }

  return { role, church_id };
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
router.post("/send", async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const cleaned = normalizeIndianPhone(phone);
    if (!/^\+91[6-9]\d{9}$/.test(cleaned)) {
      return res.status(400).json({ error: "Enter a valid 10-digit Indian mobile number" });
    }

    const client = getTwilioClient();
    await client.verify.v2.services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: cleaned, channel: "sms" });

    logger.info({ phone: cleaned }, "OTP sent via Twilio Verify");
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
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }
    if (!otp || typeof otp !== "string") {
      return res.status(400).json({ error: "OTP is required" });
    }

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
      .select("id, email, phone_number, auth_user_id")
      .eq("phone_number", cleaned)
      .limit(1)
      .maybeSingle();

    if (existingRow) {
      // Even if user exists, verify they still have a member record (unless super admin)
      const isSuperPhone = SUPER_ADMIN_PHONES.includes(cleaned);
      if (!isSuperPhone) {
        const { data: memberCheck } = await db
          .from("members")
          .select("id")
          .eq("phone_number", cleaned)
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
      const { data: memberByPhone } = await db
        .from("members")
        .select("id, user_id, email, phone_number, church_id, full_name")
        .eq("phone_number", cleaned)
        .limit(1)
        .maybeSingle();

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
        // Try to find an existing user by the member's email
        if (memberByPhone.email) {
          const { data: userByEmail } = await db
            .from("users")
            .select("id, email, phone_number, auth_user_id, church_id, full_name")
            .ilike("email", memberByPhone.email)
            .limit(1)
            .maybeSingle();

          if (userByEmail) {
            const userUpdates: Record<string, any> = {};
            if (!userByEmail.phone_number) userUpdates.phone_number = cleaned;
            if (!userByEmail.church_id && memberByPhone.church_id) userUpdates.church_id = memberByPhone.church_id;
            if (!userByEmail.full_name && memberByPhone.full_name) userUpdates.full_name = memberByPhone.full_name;
            if (Object.keys(userUpdates).length > 0) {
              await db.from("users").update(userUpdates).eq("id", userByEmail.id);
            }
            // Link member to user
            await db.from("members").update({ user_id: userByEmail.id }).eq("id", memberByPhone.id);
            userId = userByEmail.auth_user_id || userByEmail.id;
            userPhone = cleaned;
            userEmail = userByEmail.email || "";
            logger.info({ phone: cleaned, userId, email: userEmail }, "Phone-to-email user merged via member email");
          }
        }

        // No existing user found — create one using the member's data
        if (!userId) {
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
          userId = (newUser as any).id;
          userPhone = cleaned;
          userEmail = memberByPhone.email || "";
          logger.info({ phone: cleaned, userId, memberId: memberByPhone.id, church_id: memberByPhone.church_id }, "Created user from pre-registered member and linked");
        }
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

    // Look up role + church_id from users table
    const profile = await getUserProfileForJwt(userId, userEmail, userPhone);

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

    const accessToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "7d" });

    // Issue refresh token and set as httpOnly cookie
    const { token: refreshToken, expiresAt } = await createRefreshToken(userId);
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/api/auth/refresh",
      expires: expiresAt,
    });

    logger.info({ phone: cleaned, userId, church_id: profile.church_id }, "OTP verified, JWT issued");
    return res.json({
      success: true,
      access_token: accessToken,
      user: { id: userId, phone: userPhone, email: userEmail },
    });
  } catch (err: any) {
    logger.error({ err }, "OTP verify error");
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

// ── Resend OTP via Twilio Verify ──
router.post("/resend", async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }

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
router.post("/verify-phone-change", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    const { phone, otp } = req.body;
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "Phone number is required" });
    }
    if (!otp || typeof otp !== "string") {
      return res.status(400).json({ error: "OTP is required" });
    }

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
