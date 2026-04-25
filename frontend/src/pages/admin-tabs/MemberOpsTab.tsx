import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { MemberRow, MemberDeleteImpact } from "../../types";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

export default function MemberOpsTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches, openOperationConfirmDialog } = useApp();

  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<MemberDeleteImpact | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [results]);

  const scopedChurchId = isSuperAdmin ? churchId.trim() : (authContext?.auth.church_id || "");

  async function searchMembers() {
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }
    const rows = await withAuthRequest(
      "super-members-search",
      () => apiRequest<MemberRow[]>(
        `/api/members/search?church_id=${encodeURIComponent(scopedChurchId)}&query=${encodeURIComponent(query.trim())}`,
        { token },
      ),
      "Member search complete.",
    );
    if (!rows) return;
    setResults(rows);
    if (!rows.some((row) => row.id === selectedId)) {
      setSelectedId("");
      setDeleteImpact(null);
    }
  }

  async function fetchDetails(memberId: string) {
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }
    const member = await withAuthRequest(
      "super-member-detail",
      () => apiRequest<MemberRow>(`/api/members/${memberId}?church_id=${encodeURIComponent(scopedChurchId)}`, { token }),
      "Member details loaded.",
    );
    if (!member) return;
    setSelectedId(member.id);
    setEditName(member.full_name || "");
    setEditStatus(member.verification_status || "pending");
    setResults((cur) => {
      const rest = cur.filter((r) => r.id !== member.id);
      return [member, ...rest];
    });
  }

  async function updateMember() {
    if (!isSuperAdmin || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }
    const updated = await withAuthRequest(
      "super-member-update",
      () => apiRequest<MemberRow>(`/api/members/${selectedId}`, {
        method: "PATCH", token,
        body: { church_id: scopedChurchId, full_name: editName.trim() || undefined, verification_status: editStatus.trim() || undefined },
      }),
      "Member updated.",
    );
    if (updated) setResults((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function previewDelete() {
    if (!isSuperAdmin || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }
    const impact = await withAuthRequest(
      "super-member-impact",
      () => apiRequest<MemberDeleteImpact>(
        `/api/members/${selectedId}/delete-impact?church_id=${encodeURIComponent(scopedChurchId)}`,
        { token },
      ),
      "Delete impact loaded.",
    );
    if (impact) setDeleteImpact(impact);
  }

  async function deleteMember() {
    if (!isSuperAdmin || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: "Select a valid church for member operations." });
      return;
    }
    const result = await withAuthRequest(
      "super-member-delete",
      () => apiRequest<{ deleted: true; id: string }>(`/api/members/${selectedId}`, {
        method: "DELETE", token, body: { church_id: scopedChurchId, confirm: true },
      }),
      "Member deleted.",
    );
    if (!result) return;
    setResults((cur) => cur.filter((r) => r.id !== selectedId));
    setSelectedId("");
    setEditName("");
    setEditStatus("");
    setDeleteImpact(null);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.memberOps.title")}</h3>
      <div className="field-stack">
        {isSuperAdmin ? (
          <label>
            {t("admin.church")}
            <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        ) : null}
        <label>
          {t("admin.searchMember")}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.searchPlaceholder")} />
        </label>
        <div className="actions-row">
          <button className="btn" onClick={searchMembers} disabled={busyKey === "super-members-search"}>
            {busyKey === "super-members-search" ? t("common.searching") : t("admin.searchMembers")}
          </button>
        </div>
        <div className="list-stack">
          {results.length ? (
            <>
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                {t("adminTabs.memberOps.showingPage", { page, total: totalPages(results.length, 8), count: results.length })}
              </p>
              {paginate(results, page, 8).map((m) => (
                <div key={m.id} className="list-item">
                  <strong>{m.full_name}</strong>
                  <span>{m.email}</span>
                  <span>{m.phone_number || t("adminTabs.memberOps.noPhone")} · {m.membership_id || t("adminTabs.memberOps.noMembershipId")}</span>
                  <span style={{ fontSize: "0.8rem" }}>
                    {t("adminTabs.memberOps.statusPrefix")}{" "}
                    <span style={{
                      fontWeight: 600, padding: "0.1rem 0.35rem", borderRadius: "4px",
                      background: m.verification_status === "verified" ? "#e6f4ea" : m.verification_status === "rejected" ? "#fde8e8" : m.verification_status === "suspended" ? "#fde8e8" : "#fff8e1",
                      color: m.verification_status === "verified" ? "#1b7a3d" : m.verification_status === "rejected" ? "#c0392b" : m.verification_status === "suspended" ? "#c0392b" : "#b8860b",
                    }}>
                      {m.verification_status || "pending"}
                    </span>
                  </span>
                  <div className="actions-row">
                    <button className="btn" onClick={() => void fetchDetails(m.id)}>{t("adminTabs.memberOps.fetchDetails")}</button>
                  </div>
                </div>
              ))}
              <Pagination page={page} total={totalPages(results.length, 8)} onPageChange={setPage} />
            </>
          ) : <EmptyState icon={<Users size={32} />} title={t("adminTabs.memberOps.emptyTitle")} description={t("adminTabs.memberOps.emptyDescription")} />}
        </div>
        {selectedId ? (
          <>
            <label>{t("adminTabs.memberOps.memberNameLabel")}<input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("adminTabs.memberOps.memberNamePlaceholder")} /></label>
            <label>
              {t("adminTabs.memberOps.verificationStatusLabel")}
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="pending">{t("adminTabs.memberOps.statusOptionPending")}</option>
                <option value="verified">{t("adminTabs.memberOps.statusOptionVerified")}</option>
                <option value="rejected">{t("adminTabs.memberOps.statusOptionRejected")}</option>
                <option value="suspended">{t("adminTabs.memberOps.statusOptionSuspended")}</option>
              </select>
              <span className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem", display: "block" }}>
                {t("adminTabs.memberOps.verificationHint")}
              </span>
            </label>
            <div className="actions-row">
              <button className="btn" onClick={updateMember} disabled={busyKey === "super-member-update"}>
                {busyKey === "super-member-update" ? t("adminTabs.memberOps.updating") : t("adminTabs.memberOps.updateMember")}
              </button>
              <button className="btn" onClick={previewDelete} disabled={busyKey === "super-member-impact"}>
                {busyKey === "super-member-impact" ? t("common.loading") : t("adminTabs.memberOps.previewDeleteImpact")}
              </button>
              <button className="btn btn-danger" onClick={() => {
                const impactText = deleteImpact
                  ? `\nCascading impact: ${deleteImpact.family_members} family link(s), ${deleteImpact.subscriptions} subscription(s), ${deleteImpact.payments} payment(s).`
                  : "";
                openOperationConfirmDialog(
                  t("adminTabs.memberOps.confirmDeleteTitle"),
                  t("adminTabs.memberOps.confirmDeleteMessage", { name: editName || "this member" }) + impactText,
                  t("adminTabs.memberOps.confirmDeleteKeyword"),
                  deleteMember,
                );
              }} disabled={busyKey === "super-member-delete"}>
                {busyKey === "super-member-delete" ? t("adminTabs.memberOps.deleting") : t("adminTabs.memberOps.deleteMember")}
              </button>
            </div>
            {deleteImpact ? (
              <div className="notice notice-error">
                Cascading impact: Family {deleteImpact.family_members}, Subscriptions {deleteImpact.subscriptions}, Payments {deleteImpact.payments}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}
