import { Router } from "express";
import { AuthRequest, requireAuth } from "../middleware/requireAuth";
import { requireRegisteredUser } from "../middleware/requireRegisteredUser";
import { isSuperAdminEmail } from "../middleware/requireSuperAdmin";
import { pool, rawQuery } from "../services/dbClient";
import { safeErrorMessage } from "../utils/safeError";
import { persistAuditLog } from "../utils/auditLog";
import { validate, createDonationFundSchema, updateDonationFundSchema } from "../utils/zodSchemas";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_FUNDS = [
  { name: "General Offering", description: "General church offering", sort_order: 0 },
  { name: "Building Fund", description: "Building and maintenance fund", sort_order: 1 },
  { name: "Mission & Outreach", description: "Missions and community outreach", sort_order: 2 },
  { name: "Youth Ministry", description: "Youth programs and activities", sort_order: 3 },
  { name: "Community Aid", description: "Community support and welfare", sort_order: 4 },
  { name: "Other", description: "Other donations", sort_order: 5 },
];

/** Seed default funds for a church if none exist yet */
async function seedDefaultFunds(churchId: string): Promise<void> {
  const { rows } = await rawQuery(
    `SELECT 1 FROM donation_funds WHERE church_id = $1 LIMIT 1`,
    [churchId]
  );
  if (rows.length > 0) return; // already has funds

  const values: string[] = [];
  const params: unknown[] = [churchId];
  let idx = 2;
  for (const f of DEFAULT_FUNDS) {
    values.push(`($1, $${idx}, $${idx + 1}, $${idx + 2})`);
    params.push(f.name, f.description, f.sort_order);
    idx += 3;
  }
  await rawQuery(
    `INSERT INTO donation_funds (church_id, name, description, sort_order) VALUES ${values.join(", ")} ON CONFLICT DO NOTHING`,
    params
  );
}

// MED-004: Require church_id to prevent cross-tenant fund enumeration
router.get("/public", async (req, res) => {
  try {
    const churchId = String(req.query.church_id || "").trim();
    if (!churchId || !UUID_RE.test(churchId)) {
      return res.status(400).json({ error: "church_id query parameter is required" });
    }
    const { rows } = await pool.query(
      `SELECT name, description FROM donation_funds WHERE church_id = $1 AND is_active = true ORDER BY sort_order, name LIMIT 100`,
      [churchId]
    );
    if (rows.length === 0) {
      return res.json(DEFAULT_FUNDS.map((f) => ({ name: f.name, description: f.description || "" })));
    }
    return res.json(rows.map((r: { name: string; description: string | null }) => ({ name: r.name, description: r.description || "" })));
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to list funds") });
  }
});

// ── Auth: list funds (admin → own church, super admin → by church_id query) ──
router.get("/", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const isSA = req.user && isSuperAdminEmail(req.user.email, req.user.phone);
    let churchId: string;

    if (isSA) {
      churchId = String(req.query.church_id || "").trim();
      if (!UUID_RE.test(churchId)) {
        return res.status(400).json({ error: "church_id query param is required for super admin" });
      }
    } else {
      if (!req.user?.church_id) return res.status(403).json({ error: "Not associated with a church" });
      churchId = req.user.church_id;
    }

    // Lazy-seed default funds on first access
    await seedDefaultFunds(churchId);

    const { rows } = await rawQuery(
      `SELECT id, church_id, name, description, is_active, sort_order, created_at, updated_at
       FROM donation_funds
       WHERE church_id = $1
       ORDER BY sort_order, name
       LIMIT 100`,
      [churchId]
    );
    return res.json(rows);
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to list funds") });
  }
});

// ── Create fund ──
router.post("/", requireAuth, requireRegisteredUser, validate(createDonationFundSchema), async (req: AuthRequest, res) => {
  try {
    const isSA = req.user && isSuperAdminEmail(req.user.email, req.user.phone);
    let churchId: string;

    if (isSA) {
      churchId = String(req.body.church_id || "").trim();
      if (!UUID_RE.test(churchId)) return res.status(400).json({ error: "church_id is required" });
    } else {
      if (!req.user?.church_id) return res.status(403).json({ error: "Not associated with a church" });
      if (!["pastor", "admin"].includes(req.user.role)) return res.status(403).json({ error: "Admin access required" });
      churchId = req.user.church_id;
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 100) : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 500) : null;
    const sortOrder = Number.isFinite(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0;

    if (!name) return res.status(400).json({ error: "Fund name is required" });

    const { rows } = await rawQuery(
      `INSERT INTO donation_funds (church_id, name, description, is_active, sort_order, created_by)
       VALUES ($1, $2, $3, true, $4, $5)
       RETURNING id, church_id, name, description, is_active, sort_order, created_at, updated_at`,
      [churchId, name, description, sortOrder, req.user!.id]
    );

    await persistAuditLog(req as AuthRequest, "donation_fund.create", "donation_fund", rows[0].id as string, { name });

    return res.status(201).json(rows[0]);
  } catch (err: any) {
    if (String(err.code) === "23505") {
      return res.status(409).json({ error: "A fund with that name already exists for this church" });
    }
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to create fund") });
  }
});

// ── Update fund ──
router.put("/:id", requireAuth, requireRegisteredUser, validate(updateDonationFundSchema), async (req: AuthRequest, res) => {
  try {
    const fundId = String(req.params.id);
    if (!UUID_RE.test(fundId)) return res.status(400).json({ error: "Invalid fund id" });

    const isSA = req.user && isSuperAdminEmail(req.user.email, req.user.phone);

    // Verify ownership
    const { rows: existing } = await rawQuery("SELECT church_id FROM donation_funds WHERE id = $1", [fundId]);
    if (existing.length === 0) return res.status(404).json({ error: "Fund not found" });

    if (!isSA) {
      if (existing[0].church_id !== req.user?.church_id) return res.status(403).json({ error: "Access denied" });
      if (!["pastor", "admin"].includes(req.user!.role)) return res.status(403).json({ error: "Admin access required" });
    }

    const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 100) : undefined;
    const description = req.body.description !== undefined
      ? (typeof req.body.description === "string" ? req.body.description.trim().slice(0, 500) : null)
      : undefined;
    const isActive = typeof req.body.is_active === "boolean" ? req.body.is_active : undefined;
    const sortOrder = Number.isFinite(Number(req.body.sort_order)) ? Number(req.body.sort_order) : undefined;

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
    if (isActive !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(isActive); }
    if (sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); vals.push(sortOrder); }
    sets.push(`updated_at = now()`);

    if (vals.length === 0) return res.status(400).json({ error: "No fields to update" });

    vals.push(fundId);
    const { rows } = await rawQuery(
      `UPDATE donation_funds SET ${sets.join(", ")} WHERE id = $${idx}
       RETURNING id, church_id, name, description, is_active, sort_order, created_at, updated_at`,
      vals
    );

    await persistAuditLog(req as AuthRequest, "donation_fund.update", "donation_fund", fundId, { name: name || rows[0].name });

    return res.json(rows[0]);
  } catch (err: any) {
    if (String(err.code) === "23505") {
      return res.status(409).json({ error: "A fund with that name already exists for this church" });
    }
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to update fund") });
  }
});

// ── Delete fund ──
router.delete("/:id", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  try {
    const fundId = String(req.params.id);
    if (!UUID_RE.test(fundId)) return res.status(400).json({ error: "Invalid fund id" });

    const isSA = req.user && isSuperAdminEmail(req.user.email, req.user.phone);

    const { rows: existing } = await rawQuery("SELECT church_id, name FROM donation_funds WHERE id = $1", [fundId]);
    if (existing.length === 0) return res.status(404).json({ error: "Fund not found" });

    if (!isSA) {
      if (existing[0].church_id !== req.user?.church_id) return res.status(403).json({ error: "Access denied" });
      if (!["pastor", "admin"].includes(req.user!.role)) return res.status(403).json({ error: "Admin access required" });
    }

    await rawQuery("DELETE FROM donation_funds WHERE id = $1", [fundId]);

    await persistAuditLog(req as AuthRequest, "donation_fund.delete", "donation_fund", fundId, { name: existing[0].name });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, "Failed to delete fund") });
  }
});

export default router;
