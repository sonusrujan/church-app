import { useState, useEffect, useCallback } from "react";
import { Users } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function FamilyRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, refreshAdminCounts, authContext, isSuperAdmin, churches } = useApp();

  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingRelId, setEditingRelId] = useState<string | null>(null);
  const [editRelation, setEditRelation] = useState("");
  const [addMemberId, setAddMemberId] = useState("");
  const [addMemberName, setAddMemberName] = useState("");
  const [addFamName, setAddFamName] = useState("");
  const [addFamRelation, setAddFamRelation] = useState("spouse");
  const [addFamPhone, setAddFamPhone] = useState("");
  const [addFamDob, setAddFamDob] = useState("");

  const RELATION_TYPES = ["spouse", "child", "parent", "sibling", "other"];

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "?status=all";
      const data = await apiRequest<any[]>(`/api/auth/family-requests${statusParam}`, { token });
      setRequests(data);
      setSelectedIds([]);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.familyRequests.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected") {
    await withAuthRequest("review-family-request", async () => {
      await apiRequest(`/api/auth/family-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body: { decision },
      });
      void loadRequests();
      void refreshAdminCounts();
    }, decision === "approved" ? t("adminTabs.familyRequests.successApproved") : t("adminTabs.familyRequests.successRejected"));
  }

  async function saveRelation(familyMemberId: string) {
    if (!editRelation) return;
    const result = await withAuthRequest("edit-family-relation", () =>
      apiRequest(`/api/ops/family-members/${encodeURIComponent(familyMemberId)}/relation`, {
        method: "PATCH", token, body: { relation: editRelation },
      }),
      t("adminTabs.familyRequests.successRelationUpdated"),
    );
    if (result) {
      setEditingRelId(null);
      void loadRequests();
    }
  }

  async function adminAddFamilyMember() {
    if (!addMemberId || !addFamName.trim()) {
      setNotice({ tone: "error", text: t("adminTabs.familyRequests.errorSelectMemberAndName") });
      return;
    }
    const result = await withAuthRequest("admin-add-family", () =>
      apiRequest(`/api/ops/members/${encodeURIComponent(addMemberId)}/family`, {
        method: "POST", token,
        body: { full_name: addFamName.trim(), relation: addFamRelation, phone_number: addFamPhone.trim() || undefined, dob: addFamDob || undefined },
      }),
      t("adminTabs.familyRequests.successFamilyMemberAdded"),
    );
    if (result) {
      setAddMemberId("");
      setAddMemberName("");
      setAddFamName("");
      setAddFamRelation("spouse");
      setAddFamPhone("");
      setAddFamDob("");
    }
  }

  const pendingIds = requests.filter((request) => request.status === "pending").map((request) => request.id);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedIds.includes(id));

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((value) => value !== id));
  }

  function toggleAllPending(checked: boolean) {
    setSelectedIds(checked ? pendingIds : []);
  }

  async function batchReview(decision: "approved" | "rejected") {
    if (!selectedIds.length) {
      setNotice({ tone: "error", text: t("adminTabs.familyRequests.batchSelectAtLeastOne") });
      return;
    }

    const result = await withAuthRequest(`batch-family-${decision}`, () =>
      apiRequest<{ processed: number; succeeded: number; failed: number }>("/api/auth/family-requests/batch-review", {
        method: "POST",
        token,
        body: { request_ids: selectedIds, decision },
      }),
      undefined,
    );

    if (result) {
      const failedNote = result.failed > 0 ? t("adminTabs.familyRequests.batchFailedNote", { count: result.failed }) : "";
      setSelectedIds([]);
      setNotice({
        tone: result.failed > 0 ? "info" : "success",
        text: t("adminTabs.familyRequests.batchCompleted", { succeeded: result.succeeded, decision, failedNote }),
      });
      void loadRequests();
      void refreshAdminCounts();
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.familyRequests.title")}</h3>
      <p className="muted">{t("adminTabs.familyRequests.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.familyRequests.pendingOnly")}</option>
          <option value="all">{t("adminTabs.familyRequests.allRequests")}</option>
        </select>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {pendingIds.length ? (
        <div className="actions-row" style={{ marginBottom: "1rem", gap: 8, flexWrap: "wrap" }}>
          <label className="checkbox-line">
            <input type="checkbox" checked={allPendingSelected} onChange={(e) => toggleAllPending(e.target.checked)} />
            {t("adminTabs.familyRequests.batchSelectAllPending", { count: pendingIds.length })}
          </label>
          <button className="btn btn-primary" onClick={() => void batchReview("approved")} disabled={!selectedIds.length || busyKey === "batch-family-approved"}>{t("adminTabs.familyRequests.batchApprove")}</button>
          <button className="btn" onClick={() => void batchReview("rejected")} disabled={!selectedIds.length || busyKey === "batch-family-rejected"}>{t("adminTabs.familyRequests.batchReject")}</button>
        </div>
      ) : null}
      {loading && !requests.length ? (
        <LoadingSkeleton lines={4} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 10).map((req: any) => (
            <div key={req.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", flexWrap: "wrap" }}>
                {req.status === "pending" ? (
                  <input type="checkbox" checked={selectedIds.includes(req.id)} onChange={(e) => toggleSelected(req.id, e.target.checked)} />
                ) : null}
                <strong>{req.requester_name || "Requester"}</strong>
                <span>{t("adminTabs.familyRequests.wantsToAdd")}</span>
                <strong>{req.target_name || "Target"}</strong>
                <span className="muted">{t("adminTabs.familyRequests.asRelation")} {req.relation}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: "0.85rem" }} className="muted">
                {req.requester_membership_id ? <span>{t("adminTabs.familyRequests.memberIdLabel")} {req.requester_membership_id}</span> : null}
                {req.requester_verification ? <span className={`event-badge ${req.requester_verification === "verified" ? "badge-created" : "badge-system"}`}>{req.requester_verification}</span> : null}
                <span>{t("adminTabs.familyRequests.familyCountLabel")} {req.requester_family_count ?? 0}</span>
              </div>
              {req.requester_phone ? <span className="muted">{t("adminTabs.familyRequests.requesterPhone")} {req.requester_phone}</span> : null}
              <span className="muted">{t("adminTabs.familyRequests.requestedLabel")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div className="actions-row" style={{ marginTop: 4 }}>
                  <button className="btn btn-primary" onClick={() => review(req.id, "approved")} disabled={busyKey === "review-family-request"}>{t("adminTabs.familyRequests.approve")}</button>
                  <button className="btn" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-family-request"}>{t("adminTabs.familyRequests.reject")}</button>
                </div>
              ) : req.status === "approved" && req.family_member_id ? (
                <div className="actions-row" style={{ marginTop: 4, gap: 4 }}>
                  {editingRelId === req.family_member_id ? (
                    <>
                      <select value={editRelation} onChange={(e) => setEditRelation(e.target.value)}>
                        {RELATION_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn btn-sm btn-primary" onClick={() => void saveRelation(req.family_member_id)} disabled={busyKey === "edit-family-relation"}>{t("common.save")}</button>
                      <button className="btn btn-sm" onClick={() => setEditingRelId(null)}>{t("common.cancel")}</button>
                    </>
                  ) : (
                    <button className="btn btn-sm" onClick={() => { setEditingRelId(req.family_member_id); setEditRelation(req.relation || "other"); }}>{t("adminTabs.familyRequests.editRelationButton")}</button>
                  )}
                </div>
              ) : null}
              {req.review_note ? <span className="muted">{t("adminTabs.familyRequests.noteLabel")} {req.review_note}</span> : null}
              {req.rejection_reason ? <span className="muted">{t("adminTabs.familyRequests.reasonLabel")} {req.rejection_reason}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<Users size={32} />} title={t("adminTabs.familyRequests.emptyTitle")} description={t("adminTabs.familyRequests.emptyDescription")} />
      )}

      <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--outline-variant)", paddingTop: "1rem" }}>
        <h4>{t("adminTabs.familyRequests.adminAddTitle")}</h4>
        <p className="muted" style={{ fontSize: "0.82rem" }}>{t("adminTabs.familyRequests.adminAddDescription")}</p>
        <div className="field-stack" style={{ gap: "0.4rem", marginTop: "0.5rem" }}>
          <label>{t("adminTabs.familyRequests.primaryMemberLabel")}
            <SearchSelect
              placeholder={t("adminTabs.familyRequests.searchMemberPlaceholder")}
              onSearch={searchMembers}
              value={addMemberName}
              onSelect={(opt) => { setAddMemberId(opt.id); setAddMemberName(opt.label); }}
              onClear={() => { setAddMemberId(""); setAddMemberName(""); }}
            />
          </label>
          <div className="admin-responsive-grid admin-responsive-grid-compact">
            <label>{t("adminTabs.familyRequests.familyMemberNameLabel")}
              <input value={addFamName} onChange={(e) => setAddFamName(e.target.value)} placeholder={t("adminTabs.familyRequests.familyMemberNamePlaceholder")} />
            </label>
            <label>{t("adminTabs.familyRequests.relationLabel")}
              <select value={addFamRelation} onChange={(e) => setAddFamRelation(e.target.value)}>
                {RELATION_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-responsive-grid admin-responsive-grid-compact">
            <label>{t("adminTabs.familyRequests.phoneLabel")}
              <input value={addFamPhone} onChange={(e) => setAddFamPhone(e.target.value)} placeholder="+91 …" />
            </label>
            <label>{t("adminTabs.familyRequests.dobLabel")}
              <input type="date" value={addFamDob} onChange={(e) => setAddFamDob(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" onClick={() => void adminAddFamilyMember()} disabled={busyKey === "admin-add-family" || !addMemberId}>
            {busyKey === "admin-add-family" ? t("adminTabs.familyRequests.adding") : t("adminTabs.familyRequests.addFamilyMemberButton")}
          </button>
        </div>
      </div>
    </article>
  );
}
