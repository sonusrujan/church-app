import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface RegisteredUserProfile {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: string;
  church_id: string | null;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    church_id: string;
  };
  registeredProfile?: RegisteredUserProfile;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid authorization header" });
    }

    const token = authHeader.split(" ")[1];
    if (!token || token.length < 10) {
      return res.status(401).json({ error: "Invalid auth token format" });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      const isExpired = error?.message?.toLowerCase().includes("expired") || error?.status === 401;
      return res.status(401).json({
        error: isExpired ? "Session expired. Please sign in again." : "Invalid auth token",
      });
    }

  const user = data.user;
  // Support role/church_id stored in root metadata, app metadata, or user metadata.
  const role =
    (user.role as string) ||
    (user.app_metadata?.role as string) ||
    (user.user_metadata?.role as string) ||
    "member";
  const church_id =
    (user.app_metadata?.church_id as string) ||
    (user.user_metadata?.church_id as string) ||
    "";

  req.user = {
    id: user.id,
    email: user.email || "",
    role,
    church_id,
  };
  next();
  } catch (err: any) {
    console.error("requireAuth error:", err?.message || err);
    return res.status(500).json({ error: "Authentication service unavailable. Please try again." });
  }
}
