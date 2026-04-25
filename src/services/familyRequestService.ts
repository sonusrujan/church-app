import { db } from "./dbClient";
import { logger } from "../utils/logger";

// ── Types ──

export interface FamilyMemberRequestRow {
  id: string;
  church_id: string;
  requester_member_id: string;
  target_member_id: string;
  relation: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  rejection_reason: string | null;
  created_at: string;
  // Joined fields
  requester_name?: string;
  requester_phone?: string;
  target_name?: string;
  target_phone?: string;
}

// ── Search members within a church (for the family-add search UI) ──

export async function searchChurchMembers(
  churchId: string,
  query: string,
  requesterId: string
) {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return [];
  }

  // Search members in the same church by name
  const { data: members, error } = await db
    .from("members")
    .select("id, full_name, phone_number, email, user_id, church_id")
    .eq("church_id", churchId)
    .ilike("full_name", `%${trimmed}%`)
    .neq("id", requesterId) // exclude the requester themselves
    .limit(20);

  if (error) {
    logger.error({ err: error, churchId, query: trimmed }, "searchChurchMembers failed");
    throw error;
  }

  if (!members || !members.length) return [];

  // Get IDs of members already linked as family members (to anyone)
  const memberIds = members.map((m: any) => m.id);
  const { data: linkedRows } = await db
    .from("family_members")
    .select("linked_to_member_id")
    .in("linked_to_member_id", memberIds);

  const linkedMemberIds = new Set((linkedRows || []).map((r: any) => r.linked_to_member_id));

  // Get IDs of members that have pending requests
  const { data: pendingRows } = await db
    .from("family_member_requests")
    .select("target_member_id")
    .in("target_member_id", memberIds)
    .eq("status", "pending");

  const pendingMemberIds = new Set((pendingRows || []).map((r: any) => r.target_member_id));

  return members.map((m: any) => ({
    id: m.id,
    full_name: m.full_name,
    phone_number: m.phone_number || null,
    is_linked: linkedMemberIds.has(m.id),
    has_pending_request: pendingMemberIds.has(m.id),
    has_active_account: false,
    eligible: !linkedMemberIds.has(m.id) && !pendingMemberIds.has(m.id),
  }));
}

// ── Create a family member request ──

export async function createFamilyMemberRequest(input: {
  churchId: string;
  requesterMemberId: string;
  targetMemberId: string;
  relation: string;
}) {
  // Prevent self-linking
  if (input.requesterMemberId === input.targetMemberId) {
    throw new Error("You cannot add yourself as a family member");
  }

  // Validate target member exists and is in same church
  const { data: target, error: targetErr } = await db
    .from("members")
    .select("id, full_name, user_id, church_id")
    .eq("id", input.targetMemberId)
    .eq("church_id", input.churchId)
    .single();

  if (targetErr || !target) {
    throw new Error("Member not found in your church");
  }

  // Check: not already linked as family member
  const { data: existingLink } = await db
    .from("family_members")
    .select("id")
    .eq("linked_to_member_id", input.targetMemberId)
    .limit(1);

  if (existingLink && existingLink.length > 0) {
    throw new Error("This member is already linked to another family");
  }

  // Check: no duplicate pending request
  const { data: existingPending } = await db
    .from("family_member_requests")
    .select("id")
    .eq("target_member_id", input.targetMemberId)
    .eq("status", "pending")
    .limit(1);

  if (existingPending && existingPending.length > 0) {
    throw new Error("A pending request already exists for this member");
  }

  // Create the request
  const { data: request, error: insertErr } = await db
    .from("family_member_requests")
    .insert([{
      church_id: input.churchId,
      requester_member_id: input.requesterMemberId,
      target_member_id: input.targetMemberId,
      relation: input.relation.trim(),
      status: "pending",
    }])
    .select("id, church_id, requester_member_id, target_member_id, relation, status, created_at")
    .single();

  if (insertErr) {
    // Handle unique constraint violation (race condition)
    if (insertErr.code === "23505") {
      throw new Error("A pending request already exists for this member");
    }
    logger.error({ err: insertErr }, "createFamilyMemberRequest insert failed");
    throw insertErr;
  }

  return request;
}

// ── List family member requests (admin) ──

export async function listFamilyMemberRequests(
  churchId: string,
  status?: string
) {
  let query = db
    .from("family_member_requests")
    .select("id, church_id, requester_member_id, target_member_id, relation, status, reviewed_by, reviewed_at, review_note, rejection_reason, created_at")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    logger.error({ err: error, churchId }, "listFamilyMemberRequests failed");
    throw error;
  }

  if (!data || !data.length) return [];

  // Enrich with member names
  const memberIds = new Set<string>();
  for (const r of data) {
    memberIds.add(r.requester_member_id);
    memberIds.add(r.target_member_id);
  }

  const { data: members } = await db
    .from("members")
    .select("id, full_name, phone_number")
    .in("id", Array.from(memberIds));

  const memberMap = new Map<string, { full_name: string; phone_number: string | null }>();
  for (const m of members || []) {
    memberMap.set(m.id, { full_name: m.full_name, phone_number: m.phone_number });
  }

  return data.map((r: any) => ({
    ...r,
    requester_name: memberMap.get(r.requester_member_id)?.full_name || "Unknown",
    requester_phone: memberMap.get(r.requester_member_id)?.phone_number || null,
    target_name: memberMap.get(r.target_member_id)?.full_name || "Unknown",
    target_phone: memberMap.get(r.target_member_id)?.phone_number || null,
  }));
}

// ── List requests for a specific requester (member view) ──

export async function listMyFamilyMemberRequests(requesterMemberId: string) {
  const { data, error } = await db
    .from("family_member_requests")
    .select("id, church_id, requester_member_id, target_member_id, relation, status, reviewed_at, review_note, rejection_reason, created_at")
    .eq("requester_member_id", requesterMemberId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error, requesterMemberId }, "listMyFamilyMemberRequests failed");
    throw error;
  }

  if (!data || !data.length) return [];

  // Enrich with target member names
  const targetIds = data.map((r: any) => r.target_member_id);
  const { data: members } = await db
    .from("members")
    .select("id, full_name")
    .in("id", targetIds);

  const nameMap = new Map<string, string>();
  for (const m of members || []) {
    nameMap.set(m.id, m.full_name);
  }

  return data.map((r: any) => ({
    ...r,
    target_name: nameMap.get(r.target_member_id) || "Unknown",
  }));
}

// ── Review (approve/reject) a family member request ──

export async function reviewFamilyMemberRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewerUserId: string,
  reviewNote?: string,
  callerChurchId?: string
) {
  // Fetch the request
  const { data: req, error: fetchErr } = await db
    .from("family_member_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchErr || !req) {
    throw new Error("Request not found");
  }

  // Church-scoping: non-super-admins can only review requests for their own church
  if (callerChurchId && req.church_id !== callerChurchId) {
    throw new Error("You cannot review requests for another church.");
  }

  if (req.status !== "pending") {
    throw new Error(`Request has already been ${req.status}`);
  }

  if (decision === "approved") {
    // Re-validate: target member still eligible
    const { data: existingLink } = await db
      .from("family_members")
      .select("id")
      .eq("linked_to_member_id", req.target_member_id)
      .limit(1);

    if (existingLink && existingLink.length > 0) {
      // Auto-reject - member already linked
      await db
        .from("family_member_requests")
        .update({
          status: "auto_rejected",
          reviewed_by: reviewerUserId,
          reviewed_at: new Date().toISOString(),
          rejection_reason: "Member was already linked to another family",
        })
        .eq("id", requestId);

      throw new Error("Cannot approve: member is already linked to another family");
    }

    // Fetch target member details
    const { data: targetMember } = await db
      .from("members")
      .select("user_id, full_name, subscription_amount")
      .eq("id", req.target_member_id)
      .single();

    // Create the family_members link
    const subscriptionAmount = Number(targetMember?.subscription_amount ?? 0);
    const wantsSubscription = Number.isFinite(subscriptionAmount) && subscriptionAmount > 0;

    const { data: familyLink, error: linkErr } = await db
      .from("family_members")
      .insert([{
        member_id: req.requester_member_id,
        linked_to_member_id: req.target_member_id,
        full_name: targetMember?.full_name || "Unknown",
        relation: req.relation,
        has_subscription: wantsSubscription,
      }])
      .select("id, full_name")
      .single();

    if (linkErr) {
      // Unique constraint violation = someone else approved a competing request
      if (linkErr.code === "23505") {
        await db
          .from("family_member_requests")
          .update({
            status: "auto_rejected",
            reviewed_by: reviewerUserId,
            reviewed_at: new Date().toISOString(),
            rejection_reason: "Member was linked to another family (race condition)",
          })
          .eq("id", requestId);
        throw new Error("Cannot approve: member was just linked to another family");
      }
      logger.error({ err: linkErr, requestId }, "reviewFamilyMemberRequest link insert failed");
      throw linkErr;
    }

    // Auto-create subscription for the family member if they have a subscription amount
    if (wantsSubscription && familyLink) {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const startDate = now.getDate() <= 5
        ? new Date(year, month, 5)
        : new Date(year, month + 1, 5);
      const nextDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 5);

      const { error: subErr } = await db
        .from("subscriptions")
        .insert([{
          member_id: req.requester_member_id,
          family_member_id: familyLink.id,
          plan_name: `${familyLink.full_name} Individual Subscription`,
          amount: subscriptionAmount,
          billing_cycle: "monthly",
          start_date: startDate.toISOString().slice(0, 10),
          next_payment_date: nextDate.toISOString().slice(0, 10),
          status: "pending_first_payment",
        }]);

      if (subErr) {
        logger.error({ err: subErr, requestId, familyMemberId: familyLink.id }, "Auto-create subscription for approved family member failed");
        // Non-fatal: family link was created, subscription can be added later
      } else {
        logger.info({ requestId, familyMemberId: familyLink.id, amount: subscriptionAmount }, "Auto-created subscription for approved family member");
      }
    }

    // Reject any other pending requests for the same target member
    await db
      .from("family_member_requests")
      .update({
        status: "auto_rejected",
        reviewed_at: new Date().toISOString(),
        rejection_reason: "Another request for this member was approved",
      })
      .eq("target_member_id", req.target_member_id)
      .eq("status", "pending")
      .neq("id", requestId);
  }

  // Update the request status
  const { data: updated, error: updateErr } = await db
    .from("family_member_requests")
    .update({
      status: decision,
      reviewed_by: reviewerUserId,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    })
    .eq("id", requestId)
    .select("*")
    .single();

  if (updateErr) {
    logger.error({ err: updateErr, requestId }, "reviewFamilyMemberRequest update failed");
    throw updateErr;
  }

  return updated;
}
