import { db, rawQuery, getClient } from "./dbClient";
import { logger } from "../utils/logger";

// ── Types ──

export interface AccountDeletionRequestRow {
  id: string;
  member_id: string;
  user_id: string | null;
  church_id: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  member_full_name?: string;
  member_email?: string;
  member_phone?: string;
  family_member_count?: number;
}

// ── Create ──

export async function createAccountDeletionRequest(
  memberId: string,
  userId: string,
  churchId: string,
  reason?: string
): Promise<AccountDeletionRequestRow> {
  // Verify member exists and belongs to user
  const { data: member, error: memberErr } = await db
    .from("members")
    .select("id, church_id, user_id")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .is("deleted_at", null)
    .maybeSingle();

  if (memberErr || !member) {
    throw new Error("Member profile not found.");
  }

  if (member.user_id !== userId) {
    throw new Error("You can only request deletion of your own account.");
  }

  // Check for existing pending request
  const { data: existing } = await db
    .from("account_deletion_requests")
    .select("id")
    .eq("member_id", memberId)
    .eq("status", "pending")
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error("A deletion request is already pending for your account.");
  }

  const { data, error } = await db
    .from("account_deletion_requests")
    .insert([{
      member_id: memberId,
      user_id: userId,
      church_id: churchId,
      reason: reason?.trim().replace(/<[^>]*>/g, "") || null,
    }])
    .select("*")
    .single<AccountDeletionRequestRow>();

  if (error) {
    logger.error({ err: error }, "createAccountDeletionRequest failed");
    throw new Error("Failed to submit account deletion request.");
  }

  return data;
}

// ── List (admin) ──

export async function listAccountDeletionRequests(
  churchId: string,
  status?: string
): Promise<AccountDeletionRequestRow[]> {
  const params: unknown[] = [churchId];
  let sql = `
    SELECT adr.*,
      m.full_name    AS member_full_name,
      m.email        AS member_email,
      m.phone_number AS member_phone,
      (SELECT COUNT(*) FROM family_members fm WHERE fm.member_id = adr.member_id)::int AS family_member_count
    FROM account_deletion_requests adr
    LEFT JOIN members m ON m.id = adr.member_id
    WHERE adr.church_id = $1`;

  if (status) {
    params.push(status);
    sql += ` AND adr.status = $${params.length}`;
  }

  sql += ` ORDER BY adr.created_at DESC LIMIT 200`;

  try {
    const { rows } = await rawQuery(sql, params);
    return rows as unknown as AccountDeletionRequestRow[];
  } catch (err) {
    logger.error({ err, churchId }, "listAccountDeletionRequests failed");
    throw new Error("Failed to load account deletion requests.");
  }
}

// ── Review (admin approve/reject) ──

export async function reviewAccountDeletionRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  reviewNote?: string,
  callerChurchId?: string
): Promise<{ success: boolean; message: string }> {
  // Load the request
  const { data: request, error: reqErr } = await db
    .from("account_deletion_requests")
    .select("id, member_id, user_id, church_id, status")
    .eq("id", requestId)
    .single();

  if (reqErr || !request) {
    throw new Error("Deletion request not found.");
  }

  if (request.status !== "pending") {
    throw new Error("This request has already been reviewed.");
  }

  // Church isolation
  if (callerChurchId && request.church_id !== callerChurchId) {
    throw new Error("Access denied.");
  }

  // Update the request status
  const { error: updateErr } = await db
    .from("account_deletion_requests")
    .update({
      status: decision,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote?.trim().replace(/<[^>]*>/g, "") || null,
    })
    .eq("id", requestId);

  if (updateErr) {
    logger.error({ err: updateErr }, "reviewAccountDeletionRequest update failed");
    throw new Error("Failed to review deletion request.");
  }

  // If approved, perform the actual deletion with family unlinking
  if (decision === "approved") {
    await performAccountDeletion(request.member_id, request.user_id, request.church_id);
    return { success: true, message: "Account deletion approved and processed." };
  }

  return { success: true, message: "Deletion request rejected." };
}

// ── Perform Deletion ──
// 1. Unlink all family members (set linked_to_member_id = NULL so they get own dashboard access)
// 2. Cancel active subscriptions
// 3. Soft-delete the member
// 4. Unlink user from member

async function performAccountDeletion(
  memberId: string,
  userId: string | null,
  churchId: string
) {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    // 1. Unlink family members — set linked_to_member_id to NULL
    await client.query(
      `UPDATE family_members SET linked_to_member_id = NULL WHERE linked_to_member_id = $1`,
      [memberId]
    );

    // 2. Cancel active subscriptions
    await client.query(
      `UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 AND status IN ('active', 'pending_first_payment', 'overdue')`,
      [memberId]
    );

    // 3. Soft-delete the member
    const deleteRes = await client.query(
      `UPDATE members SET deleted_at = NOW(), user_id = NULL WHERE id = $1 AND church_id = $2`,
      [memberId, churchId]
    );

    if (deleteRes.rowCount === 0) {
      throw new Error("Failed to delete member account — member not found.");
    }

    // 4. If user exists, unlink from church (set church_id to null, role to 'user')
    if (userId) {
      await client.query(
        `UPDATE users SET church_id = NULL, role = 'user' WHERE id = $1`,
        [userId]
      );
    }

    await client.query("COMMIT");
    logger.info({ memberId, userId, churchId }, "Account deletion completed (atomic)");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err, memberId }, "performAccountDeletion transaction failed");
    throw new Error("Failed to delete member account.");
  } finally {
    client.release();
  }
}
