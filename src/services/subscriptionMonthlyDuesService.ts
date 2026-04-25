import { db, getClient, rawQuery } from "./dbClient";
import { logger } from "../utils/logger";
import { computeNextDueDate } from "../utils/subscriptionHelpers";

type DueStatus = "pending" | "paid" | "imported_paid" | "waived";

export type DueMonthRow = {
  id: string;
  subscription_id: string;
  member_id: string;
  church_id: string;
  due_month: string;
  status: DueStatus;
  paid_payment_id: string | null;
};

function monthStartIso(input: string | Date) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid month date");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function addMonthsIso(monthIso: string, delta: number) {
  const d = new Date(`${monthIso}T00:00:00.000Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)).toISOString().slice(0, 10);
}

export function monthLabel(monthIso: string) {
  const cleaned = monthIso.length > 10 ? monthIso.slice(0, 10) : monthIso;
  const d = new Date(`${cleaned}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return monthIso;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function buildMonthRange(startMonthIso: string, endMonthIso: string) {
  const out: string[] = [];
  let cursor = monthStartIso(startMonthIso);
  const end = monthStartIso(endMonthIso);
  while (cursor <= end) {
    out.push(cursor);
    cursor = addMonthsIso(cursor, 1);
  }
  return out;
}

export async function ensureSubscriptionMonthlyDues(
  subscription: { id: string; member_id: string; church_id: string; start_date: string },
  throughMonthIso: string,
  defaultStatus: DueStatus = "pending"
) {
  const start = monthStartIso(subscription.start_date);
  const end = monthStartIso(throughMonthIso);
  if (start > end) return;

  const months = buildMonthRange(start, end);
  if (!months.length) return;

  const payload = months.map((m) => ({
    subscription_id: subscription.id,
    member_id: subscription.member_id,
    church_id: subscription.church_id,
    due_month: m,
    status: defaultStatus,
    source: "system",
  }));

  const { data: existingRows, error: existingErr } = await db
    .from("subscription_monthly_dues")
    .select("due_month")
    .eq("subscription_id", subscription.id)
    .gte("due_month", start)
    .lte("due_month", end);

  if (existingErr) {
    logger.error({ err: existingErr, subscriptionId: subscription.id }, "ensureSubscriptionMonthlyDues existing query failed");
    throw existingErr;
  }

  const existingMonths = new Set((existingRows || []).map((r: { due_month: string }) => r.due_month));
  const missingPayload = payload.filter((p) => !existingMonths.has(p.due_month));
  if (!missingPayload.length) return;

  const { error } = await db
    .from("subscription_monthly_dues")
    .insert(missingPayload);

  if (error) {
    logger.error({ err: error, subscriptionId: subscription.id }, "ensureSubscriptionMonthlyDues failed");
    throw error;
  }
}

export async function initializeMonthlyDuesForPreRegister(input: {
  subscription_id: string;
  member_id: string;
  church_id: string;
  start_month?: string;
  pending_months?: string[];
  no_pending_payments?: boolean;
}) {
  const now = new Date();
  const endMonth = monthStartIso(now);
  const startMonth = monthStartIso(input.start_month || "2025-01-01");

  if (startMonth > endMonth) {
    throw new Error("start_month cannot be in the future");
  }

  const months = buildMonthRange(startMonth, endMonth);
  const pendingSet = new Set((input.pending_months || []).map((m) => monthStartIso(m)));
  const noPending = !!input.no_pending_payments;

  const payload = months.map((m) => ({
    subscription_id: input.subscription_id,
    member_id: input.member_id,
    church_id: input.church_id,
    due_month: m,
    status: (noPending ? "imported_paid" : pendingSet.has(m) ? "pending" : "imported_paid") as DueStatus,
    source: "pre_register",
  }));

  const { error } = await db
    .from("subscription_monthly_dues")
    .upsert(payload, { onConflict: "subscription_id,due_month" });

  if (error) {
    logger.error({ err: error, subscriptionId: input.subscription_id }, "initializeMonthlyDuesForPreRegister failed");
    throw error;
  }

  const firstPending = months.find((m) => !noPending && pendingSet.has(m));
  const nextDate = firstPending || addMonthsIso(endMonth, 1);
  const status = firstPending ? "overdue" : "active";

  const { error: subErr } = await db
    .from("subscriptions")
    .update({ next_payment_date: nextDate, status })
    .eq("id", input.subscription_id);

  if (subErr) {
    logger.error({ err: subErr, subscriptionId: input.subscription_id }, "initializeMonthlyDuesForPreRegister subscription update failed");
    throw subErr;
  }
}

export async function getPendingMonthsForSubscription(subscriptionId: string) {
  const { data, error } = await db
    .from("subscription_monthly_dues")
    .select("id, subscription_id, member_id, church_id, due_month, status, paid_payment_id")
    .eq("subscription_id", subscriptionId)
    .eq("status", "pending")
    .order("due_month", { ascending: true });

  if (error) throw error;
  return (data || []) as DueMonthRow[];
}

export async function listMonthlyHistoryForMember(input: {
  member_id: string;
  person_name?: string;
  from_date?: string;
  limit: number;
  offset: number;
}) {
  const safeLimit = Math.min(Math.max(input.limit || 10, 1), 100);
  const safeOffset = Math.max(input.offset || 0, 0);

  // Unified history: subscription dues ledger UNION donation payments.
  // Donations have no subscription_id, so they appear as standalone rows
  // keyed by their payment_date.
  try {
    const params: unknown[] = [input.member_id];
    const personFilterDues = input.person_name && input.person_name !== "all"
      ? ` AND COALESCE(fm.full_name, m.full_name) = $${params.push(input.person_name)}`
      : "";
    const fromDateFilterDues = input.from_date
      ? ` AND smd.due_month >= $${params.push(input.from_date)}`
      : "";

    // Donation rows reuse the same param array (member_id stays at $1).
    const personFilterDonations = input.person_name && input.person_name !== "all"
      ? ` AND COALESCE(m.full_name, 'Member') = $${params.push(input.person_name)}`
      : "";
    const fromDateFilterDonations = input.from_date
      ? ` AND p.payment_date >= $${params.push(input.from_date)}`
      : "";

    const limitIdx = params.push(safeLimit);
    const offsetIdx = params.push(safeOffset);

    const sql = `
      WITH dues AS (
        SELECT smd.id::text AS id,
               smd.due_month::date AS month_year,
               smd.status AS due_status,
               smd.subscription_id,
               COALESCE(fm.full_name, m.full_name, 'Member') AS person_name,
               pma.payment_id,
               COALESCE(pma.monthly_amount, s.amount)::numeric AS paid_amount,
               p.payment_date::timestamptz AS payment_date,
               p.receipt_number,
               p.payment_status,
               'subscription'::text AS kind,
               NULL::text AS fund_name
        FROM subscription_monthly_dues smd
        JOIN subscriptions s ON s.id = smd.subscription_id
        LEFT JOIN members m ON m.id = smd.member_id
        LEFT JOIN family_members fm ON fm.id = s.family_member_id
        LEFT JOIN payment_month_allocations pma ON pma.due_id = smd.id
        LEFT JOIN payments p ON p.id = pma.payment_id
        WHERE smd.member_id = $1${personFilterDues}${fromDateFilterDues}
      ),
      donations AS (
        SELECT p.id::text AS id,
               p.payment_date::date AS month_year,
               'paid'::text AS due_status,
               NULL::uuid AS subscription_id,
               COALESCE(m.full_name, 'Member') AS person_name,
               p.id AS payment_id,
               p.amount::numeric AS paid_amount,
               p.payment_date::timestamptz AS payment_date,
               p.receipt_number,
               p.payment_status,
               'donation'::text AS kind,
               p.fund_name AS fund_name
        FROM payments p
        LEFT JOIN members m ON m.id = p.member_id
        WHERE p.member_id = $1
          AND p.subscription_id IS NULL
          AND p.payment_status = 'success'${personFilterDonations}${fromDateFilterDonations}
      )
      SELECT * FROM (
        SELECT * FROM dues
        UNION ALL
        SELECT * FROM donations
      ) merged
      ORDER BY month_year DESC NULLS LAST, payment_date DESC NULLS LAST
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await rawQuery<any>(sql, params);

    return (result.rows || []).map((row: any) => ({
      id: row.id,
      payment_id: row.payment_id || null,
      subscription_id: row.subscription_id,
      month_year: row.month_year,
      paid_amount: Number(row.paid_amount || 0),
      person_name: row.person_name || "Member",
      paid_date: row.payment_date || null,
      receipt_number: row.receipt_number || null,
      payment_status: row.due_status === "paid" ? "success"
        : row.due_status === "imported_paid" ? "imported"
        : "pending",
      due_status: row.due_status || "pending",
      kind: row.kind || "subscription",
      fund_name: row.fund_name || null,
    }));
  } catch (dueErr) {
    logger.warn({ err: dueErr }, "subscription_monthly_dues ledger query failed, trying allocation fallback");
  }

  // Fallback: allocation-based query for members without dues rows
  try {
    let sql = `
      SELECT a.id, a.payment_id, a.subscription_id, a.member_id, a.church_id,
             a.covered_month, a.monthly_amount, a.person_name,
             p.payment_date, p.receipt_number, p.payment_status
      FROM payment_month_allocations a
      INNER JOIN payments p ON p.id = a.payment_id
      WHERE a.member_id = $1`;
    const params: unknown[] = [input.member_id];

    if (input.person_name && input.person_name !== "all") {
      params.push(input.person_name);
      sql += ` AND a.person_name = $${params.length}`;
    }

    if (input.from_date) {
      params.push(input.from_date);
      sql += ` AND a.covered_month >= $${params.length}`;
    }

    sql += ` ORDER BY a.covered_month DESC`;
    params.push(safeLimit, safeOffset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await rawQuery<any>(sql, params);
    return (result.rows || []).map((row: any) => ({
      id: row.id,
      payment_id: row.payment_id,
      subscription_id: row.subscription_id,
      month_year: row.covered_month,
      paid_amount: Number(row.monthly_amount || 0),
      person_name: row.person_name || "Member",
      paid_date: row.payment_date || null,
      receipt_number: row.receipt_number || null,
      payment_status: row.payment_status || null,
      due_status: "paid",
    }));
  } catch (allocErr) {
    logger.warn({ err: allocErr }, "allocation fallback also failed");
  }

  return [];
}

export async function allocateOldestPendingMonthsAtomic(input: {
  payment_id: string;
  subscription_id: string;
  member_id: string;
  church_id: string;
  monthly_amount: number;
  months_to_allocate: number;
  person_name: string;
  existingClient?: import("pg").PoolClient;
}) {
  if (!Number.isFinite(input.monthly_amount) || input.monthly_amount <= 0) {
    throw new Error("Invalid monthly amount");
  }
  if (!Number.isInteger(input.months_to_allocate) || input.months_to_allocate <= 0) {
    throw new Error("months_to_allocate must be a positive integer");
  }

  // If caller provides a client, use it (caller manages BEGIN/COMMIT/ROLLBACK/release)
  const ownClient = !input.existingClient;
  const client = input.existingClient || await getClient();
  try {
    if (ownClient) await client.query("BEGIN");

    const lockRes = await client.query(
      `SELECT id, due_month FROM subscription_monthly_dues
       WHERE subscription_id = $1 AND status = 'pending'
       ORDER BY due_month ASC
       FOR UPDATE`,
      [input.subscription_id]
    );

    const pendingRows = lockRes.rows as Array<{ id: string; due_month: string }>;
    if (pendingRows.length < input.months_to_allocate) {
      throw new Error(`Requested ${input.months_to_allocate} months but only ${pendingRows.length} pending`);
    }

    const selected = pendingRows.slice(0, input.months_to_allocate);
    const selectedIds = selected.map((r) => r.id);

    await client.query(
      `UPDATE subscription_monthly_dues
       SET status = 'paid', paid_payment_id = $1, updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [input.payment_id, selectedIds]
    );

    for (const row of selected) {
      await client.query(
        `INSERT INTO payment_month_allocations
         (payment_id, subscription_id, member_id, church_id, covered_month, monthly_amount, person_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.payment_id,
          input.subscription_id,
          input.member_id,
          input.church_id,
          row.due_month,
          input.monthly_amount,
          input.person_name,
        ]
      );
    }

    const nextPendingRes = await client.query(
      `SELECT due_month FROM subscription_monthly_dues
       WHERE subscription_id = $1 AND status = 'pending'
       ORDER BY due_month ASC
       LIMIT 1`,
      [input.subscription_id]
    );

    const nextPending = nextPendingRes.rows[0]?.due_month as string | undefined;
    if (nextPending) {
      await client.query(
        `UPDATE subscriptions SET next_payment_date = $1, status = 'overdue' WHERE id = $2`,
        [nextPending, input.subscription_id]
      );
    } else {
      const subRes = await client.query(
        `SELECT next_payment_date, billing_cycle FROM subscriptions WHERE id = $1`,
        [input.subscription_id]
      );
      const sub = subRes.rows[0] as { next_payment_date: string; billing_cycle: string } | undefined;
      if (sub) {
        const advanced = computeNextDueDate(sub.next_payment_date, sub.billing_cycle);
        await client.query(
          `UPDATE subscriptions SET next_payment_date = $1, status = 'active' WHERE id = $2`,
          [advanced, input.subscription_id]
        );
      }
    }

    if (ownClient) await client.query("COMMIT");
    return selected.map((r) => r.due_month);
  } catch (err) {
    if (ownClient) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

// ── Toggle individual due status (admin correction) ──

export async function toggleDueStatus(input: {
  due_id: string;
  new_status: DueStatus;
  church_id: string;
}) {
  const VALID_STATUSES: DueStatus[] = ["pending", "paid", "imported_paid", "waived"];
  if (!VALID_STATUSES.includes(input.new_status)) {
    throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    const res = await client.query(
      `SELECT id, subscription_id, member_id, church_id, status, paid_payment_id
       FROM subscription_monthly_dues WHERE id = $1 FOR UPDATE`,
      [input.due_id],
    );
    const due = res.rows[0] as { id: string; subscription_id: string; member_id: string; church_id: string; status: string; paid_payment_id: string | null } | undefined;
    if (!due) throw new Error("Due record not found");
    if (due.church_id !== input.church_id) throw new Error("Due record does not belong to your church");

    await client.query(
      `UPDATE subscription_monthly_dues SET status = $1, paid_payment_id = $2, updated_at = now() WHERE id = $3`,
      [input.new_status, input.new_status === "pending" || input.new_status === "waived" ? null : due.paid_payment_id, input.due_id],
    );

    // If reverting to pending, remove any payment_month_allocations for this due
    if (input.new_status === "pending" || input.new_status === "waived") {
      await client.query(`DELETE FROM payment_month_allocations WHERE due_id = $1`, [input.due_id]);
    }

    // Update subscription status based on remaining pending months
    const pendingRes = await client.query(
      `SELECT COUNT(*)::int AS cnt FROM subscription_monthly_dues WHERE subscription_id = $1 AND status = 'pending'`,
      [due.subscription_id],
    );
    const pendingCount = pendingRes.rows[0]?.cnt || 0;
    if (pendingCount > 0) {
      await client.query(`UPDATE subscriptions SET status = 'overdue' WHERE id = $1 AND status = 'active'`, [due.subscription_id]);
    }

    await client.query("COMMIT");
    return { id: due.id, new_status: input.new_status };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Reverse payment allocations (for refunds) ──

export async function reversePaymentAllocations(paymentId: string) {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // Find all dues that were allocated to this payment
    const allocRes = await client.query(
      `SELECT pma.id as alloc_id, pma.due_id
       FROM payment_month_allocations pma
       WHERE pma.payment_id = $1`,
      [paymentId],
    );

    const allocations = allocRes.rows as Array<{ alloc_id: string; due_id: string | null }>;

    // Revert each due back to pending
    for (const alloc of allocations) {
      if (alloc.due_id) {
        await client.query(
          `UPDATE subscription_monthly_dues SET status = 'pending', paid_payment_id = NULL, updated_at = now()
           WHERE id = $1 AND paid_payment_id = $2`,
          [alloc.due_id, paymentId],
        );
      }
    }

    // Also revert any dues that reference this payment directly but weren't in allocations
    await client.query(
      `UPDATE subscription_monthly_dues SET status = 'pending', paid_payment_id = NULL, updated_at = now()
       WHERE paid_payment_id = $1`,
      [paymentId],
    );

    // Delete the allocation records
    await client.query(`DELETE FROM payment_month_allocations WHERE payment_id = $1`, [paymentId]);

    await client.query("COMMIT");
    return allocations.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
