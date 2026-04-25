import { Router, Request, Response } from "express";
import crypto from "crypto";
import { OAuth2Client } from "google-auth-library";
import { FRONTEND_URL } from "../config";
import { db } from "../services/dbClient";
import { logger } from "../utils/logger";
import { createRefreshToken } from "../services/refreshTokenService";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const isProduction = process.env.NODE_ENV === "production";

function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth is not configured");
  }
  return new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI || `${FRONTEND_URL}/auth/google/callback`,
  );
}

// ── Initiate Google OAuth ──
router.get("/google", (_req: Request, res: Response) => {
  try {
    const client = getOAuth2Client();
    const state = crypto.randomBytes(32).toString("hex");

    // Store state in a short-lived httpOnly cookie (works across multiple servers)
    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax", // Must be lax so browser sends it on the redirect back from Google
      path: "/api/auth/google",
      maxAge: 10 * 60 * 1000, // 10 min
    });

    const nonce = crypto.randomBytes(32).toString("hex");

    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: ["openid", "email", "profile"],
      prompt: "select_account",
      state,
      nonce,
    });
    return res.redirect(url);
  } catch (err: any) {
    logger.error({ err }, "Google OAuth init error");
    return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Google sign-in is not configured")}`);
  }
});

// ── Google OAuth callback ──
router.get("/google/callback", async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Missing authorization code")}`);
    }

    // Validate OAuth state parameter (CSRF protection) using cookie
    const cookieState = req.cookies?.oauth_state;
    res.clearCookie("oauth_state", { path: "/api/auth/google" });
    if (!state || !cookieState || state !== cookieState) {
      return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Invalid or expired OAuth state. Please try again.")}`);
    }

    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Verify the ID token to get user info
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Failed to get user info from Google")}`);
    }

    const email = payload.email.toLowerCase();
    const fullName = payload.name || "";

    // Find or create user in our DB
    // Find existing user by email
    const { data: existingUser } = await db
      .from("users")
      .select("id, email, phone_number, role, church_id, full_name, auth_user_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    let userId: string;
    let role: string;
    let churchId: string;

    if (existingUser) {
      userId = existingUser.auth_user_id || existingUser.id;
      role = existingUser.role || "member";
      churchId = existingUser.church_id || "";

      // Update name if not set
      if (!existingUser.full_name && fullName) {
        await db
          .from("users")
          .update({ full_name: fullName })
          .eq("id", existingUser.id);
      }

      // If this user has no phone, check if a phone-only user exists via member record
      if (!existingUser.phone_number) {
        const { data: memberByEmail } = await db
          .from("members")
          .select("phone_number")
          .ilike("email", email)
          .not("phone_number", "is", null)
          .limit(1)
          .maybeSingle();

        if (memberByEmail?.phone_number) {
          // Check if there's a separate phone-only user that should be merged
          const { data: phoneUser } = await db
            .from("users")
            .select("id")
            .eq("phone_number", memberByEmail.phone_number)
            .neq("id", existingUser.id)
            .limit(1)
            .maybeSingle();

          if (phoneUser) {
            // Transfer any member links from the phone user to the email user, then delete the phone user
            await db.from("members").update({ user_id: existingUser.id }).eq("user_id", phoneUser.id);
            await db.from("users").delete().eq("id", phoneUser.id);
            logger.info({ email, phone: memberByEmail.phone_number }, "Merged phone-only user into email user (Google OAuth)");
          }

          // Set the phone number on the email user
          await db.from("users").update({ phone_number: memberByEmail.phone_number }).eq("id", existingUser.id);
        }
      }
    } else {
      // Check if there's a phone-only user with a member record matching this email
      const { data: memberByEmail } = await db
        .from("members")
        .select("user_id, phone_number")
        .ilike("email", email)
        .limit(1)
        .maybeSingle();

      if (memberByEmail?.user_id) {
        // Phone-only user exists — add email to merge
        const { data: updatedUser, error: mergeErr } = await db
          .from("users")
          .update({ email, full_name: fullName || undefined })
          .eq("id", memberByEmail.user_id)
          .select("id, email, phone_number, role, church_id, full_name, auth_user_id")
          .single();

        if (!mergeErr && updatedUser) {
          userId = (updatedUser as any).auth_user_id || (updatedUser as any).id;
          role = (updatedUser as any).role || "member";
          churchId = (updatedUser as any).church_id || "";
          logger.info({ email, userId }, "Merged email into existing phone user (Google OAuth)");
        } else {
          // Merge failed — fall through to create new
          userId = "";
          role = "member";
          churchId = "";
        }
      }

      // Create new user only if no merge happened
      if (!userId!) {
        const { data: newUser, error: createErr } = await db
          .from("users")
          .insert({ email, full_name: fullName, role: "member" })
          .select("id")
          .single();

        if (createErr || !newUser) {
          logger.error({ err: createErr, email }, "Failed to create user from Google OAuth");
          return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Failed to create account")}`);
        }
        userId = newUser.id;
        role = "member";
        churchId = "";
      }
    }

    // Issue refresh token as httpOnly cookie
    const { token: refreshToken, expiresAt } = await createRefreshToken(userId);
    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/api/auth/refresh",
      expires: expiresAt,
    });

    // Redirect to frontend — the refresh token cookie is now set.
    // The frontend will use the /api/auth/refresh endpoint to obtain the access token.
    return res.redirect(`${FRONTEND_URL}/auth/callback?google=1`);
  } catch (err: any) {
    logger.error({ err }, "Google OAuth callback error");
    return res.redirect(`${FRONTEND_URL}/signin?error=${encodeURIComponent("Google sign-in failed")}`);
  }
});



export default router;
