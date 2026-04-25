/**
 * Razorpay Routes Admin Routes — super admin only.
 * Manages linked accounts, transfer history, and reconciliation.
 */
import { Router } from "express";
import { requireAuth, AuthRequest } from "../middleware/requireAuth";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { safeErrorMessage } from "../utils/safeError";
import { logger } from "../utils/logger";
import { UUID_REGEX } from "../utils/validation";
import {
  createLinkedAccount,
  listLinkedAccounts,
  getLinkedAccountByChurch,
  syncLinkedAccountStatus,
  listAllTransfers,
  getTransferSummary,
  getTransfersByPayment,
  handleTransferWebhook,
} from "../services/razorpayRoutesService";
import { db } from "../services/dbClient";

const router = Router();

// All routes require super admin
router.use(requireAuth, requireSuperAdmin);

// ── Linked Accounts ──

/** List all linked accounts */
router.get("/linked-accounts", async (_req: AuthRequest, res) => {
  try {
    const accounts = await listLinkedAccounts();
    return res.json(accounts);
  } catch (err: any) {
    logger.error({ err }, "Failed to list linked accounts");
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load linked accounts") });
  }
});

/** Get linked account for a specific church */
router.get("/linked-accounts/church/:churchId", async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "");
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const account = await getLinkedAccountByChurch(churchId);
    return res.json(account);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load linked account") });
  }
});

/** Create a linked account for a church */
router.post("/linked-accounts", async (req: AuthRequest, res) => {
  try {
    const {
      church_id,
      email,
      phone,
      legal_business_name,
      business_type,
      contact_name,
      bank_account_name,
      bank_account_number,
      bank_ifsc_code,
    } = req.body;

    if (!church_id || !UUID_REGEX.test(church_id)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    if (!email?.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!phone?.trim()) {
      return res.status(400).json({ error: "Phone is required" });
    }
    if (!legal_business_name?.trim()) {
      return res.status(400).json({ error: "Legal business name is required" });
    }
    if (!contact_name?.trim()) {
      return res.status(400).json({ error: "Contact name is required" });
    }
    if (!bank_account_name?.trim()) {
      return res.status(400).json({ error: "Bank account name is required" });
    }
    if (!bank_account_number?.trim()) {
      return res.status(400).json({ error: "Bank account number is required" });
    }
    if (!bank_ifsc_code?.trim()) {
      return res.status(400).json({ error: "Bank IFSC code is required" });
    }

    // Verify church exists
    const { data: church } = await db
      .from("churches")
      .select("id, name")
      .eq("id", church_id)
      .maybeSingle<{ id: string; name: string }>();

    if (!church) {
      return res.status(404).json({ error: "Church not found" });
    }

    const account = await createLinkedAccount({
      church_id,
      email: email.trim(),
      phone: phone.trim(),
      legal_business_name: legal_business_name.trim(),
      business_type: business_type?.trim() || "not_yet_categorised",
      contact_name: contact_name.trim(),
      bank_account_name: bank_account_name.trim(),
      bank_account_number: bank_account_number.trim(),
      bank_ifsc_code: bank_ifsc_code.trim().toUpperCase(),
      onboarded_by: req.user?.email || req.user?.phone || "super_admin",
    });

    logger.info({ churchId: church_id, churchName: church.name }, "Linked account created by super admin");
    return res.status(201).json(account);
  } catch (err: any) {
    logger.error({ err }, "Failed to create linked account");
    return res.status(400).json({ error: safeErrorMessage(err, "Failed to create linked account") });
  }
});

/** Sync linked account status with Razorpay */
router.post("/linked-accounts/church/:churchId/sync", async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "");
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const account = await syncLinkedAccountStatus(churchId);
    if (!account) {
      return res.status(404).json({ error: "No linked account found for this church" });
    }
    return res.json(account);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to sync account status") });
  }
});

/** Toggle routes_enabled for a church */
router.patch("/linked-accounts/church/:churchId/toggle", async (req: AuthRequest, res) => {
  try {
    const churchId = String(req.params.churchId || "");
    if (!churchId || !UUID_REGEX.test(churchId)) {
      return res.status(400).json({ error: "Invalid church ID" });
    }
    const enabled = Boolean(req.body.routes_enabled);

    await db
      .from("churches")
      .update({ routes_enabled: enabled })
      .eq("id", churchId);

    return res.json({ routes_enabled: enabled });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to toggle routes") });
  }
});

// ── Transfers ──

/** Get transfer summary stats */
router.get("/transfers/summary", async (_req: AuthRequest, res) => {
  try {
    const summary = await getTransferSummary();
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load transfer summary") });
  }
});

/** List all transfers with filtering */
router.get("/transfers", async (req: AuthRequest, res) => {
  try {
    const { church_id, status, limit, offset } = req.query;
    const result = await listAllTransfers({
      church_id: typeof church_id === "string" ? church_id : undefined,
      status: typeof status === "string" ? status : undefined,
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
    });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load transfers") });
  }
});

/** Get transfers for a specific payment */
router.get("/transfers/payment/:paymentId", async (req: AuthRequest, res) => {
  try {
    const paymentId = String(req.params.paymentId || "");
    if (!paymentId || !UUID_REGEX.test(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
    }
    const transfers = await getTransfersByPayment(paymentId);
    return res.json(transfers);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to load payment transfers") });
  }
});

export default router;

// ── Webhook handler (exported separately) ──

export { handleTransferWebhook };
