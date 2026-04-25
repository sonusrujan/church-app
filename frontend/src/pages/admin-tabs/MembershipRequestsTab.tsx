import { useState, useEffect, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { MembershipRequestRow } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function MembershipRequestsTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, refreshAdminCounts } = useApp();

  const [requests, setRequests] = useState<MembershipRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadRequests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const statusParam = filter === "pending" ? "?status=pending" : "";
      const data = await apiRequest<MembershipRequestRow[]>(`/api/requests/membership-requests${statusParam}`, { token });
      setRequests(data);
      setSelectedIds([]);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.membershipRequests.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, filter]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  async function review(id: string, decision: "approved" | "rejected") {
    const body: Record<string, string> = { decision };
    if (decision === "rejected" && rejectReasons[id]?.trim()) {
      body.review_note = rejectReasons[id].trim();
    }
    await withAuthRequest("review-membership", async () => {
      await apiRequest(`/api/requests/membership-requests/${encodeURIComponent(id)}/review`, {
        method: "POST", token, body,
      });
      setRejectingId(null);
      setRejectReasons((prev) => { const next = { ...prev }; delete next[id]; return next; });
      void loadRequests();
      void refreshAdminCounts();
    }, decision === "approved" ? t("adminTabs.membershipRequests.successApproved") : t("adminTabs.membershipRequests.successRejected"));
  }

  function startEdit(req: MembershipRequestRow) {
    setEditingId(req.id);
    setEditFields({
      full_name: req.full_name || "",
      phone_number: req.phone_number || "",
      email: req.email || "",
      address: req.address || "",
    });
  }

  async function saveEdit(id: string) {
    const body: Record<string, string> = {};
    if (editFields.full_name?.trim()) body.full_name = editFields.full_name.trim();
    if (editFields.phone_number?.trim()) body.phone_number = editFields.phone_number.trim();
    if (typeof editFields.email === "string") body.email = editFields.email.trim();
    if (typeof editFields.address === "string") body.address = editFields.address.trim();
    if (!Object.keys(body).length) { setNotice({ tone: "error", text: t("adminTabs.membershipRequests.noFieldsToUpdate") }); return; }
    await withAuthRequest("edit-membership-request", async () => {
      await apiRequest(`/api/ops/membership-requests/${encodeURIComponent(id)}`, {
        method: "PATCH", token, body,
      });
      setEditingId(null);
      void loadRequests();
    }, t("adminTabs.membershipRequests.requestUpdated"));
  }

  async function reopenRequest(id: string) {
    await withAuthRequest("reopen-membership-request", async () => {
      await apiRequest(`/api/ops/membership-requests/${encodeURIComponent(id)}/reopen`, {
        method: "POST", token,
      });
      void loadRequests();
      void refreshAdminCounts();
    }, t("adminTabs.membershipRequests.requestReopened"));
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
      setNotice({ tone: "error", text: t("adminTabs.membershipRequests.batchSelectAtLeastOne") });
      return;
    }

    const result = await withAuthRequest(`batch-membership-${decision}`, () =>
      apiRequest<{ processed: number; succeeded: number; failed: number }>("/api/requests/membership-requests/batch-review", {
        method: "POST",
        token,
        body: { request_ids: selectedIds, decision },
      }),
    );

    if (result) {
      setSelectedIds([]);
      const failedNote = result.failed > 0 ? t("adminTabs.membershipRequests.batchFailedNote", { count: result.failed }) : "";
      setNotice({
        tone: result.failed > 0 ? "info" : "success",
        text: t("adminTabs.membershipRequests.batchCompleted", { succeeded: result.succeeded, decision, failedNote }),
      });
      void loadRequests();
      void refreshAdminCounts();
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.membershipRequests.title")}</h3>
      <p className="muted">{t("adminTabs.membershipRequests.description")}</p>
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value as "pending" | "all")}>
          <option value="pending">{t("adminTabs.membershipRequests.pendingOnly")}</option>
          <option value="all">{t("adminTabs.membershipRequests.allRequests")}</option>
        </select>
        <button className="btn" onClick={() => void loadRequests()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
      {pendingIds.length ? (
        <div className="actions-row" style={{ marginBottom: "1rem", gap: 8, flexWrap: "wrap" }}>
          <label className="checkbox-line">
            <input type="checkbox" checked={allPendingSelected} onChange={(e) => toggleAllPending(e.target.checked)} />
            {t("adminTabs.membershipRequests.batchSelectAllPending", { count: pendingIds.length })}
          </label>
          <button className="btn btn-primary" onClick={() => void batchReview("approved")} disabled={!selectedIds.length || busyKey === "batch-membership-approved"}>{t("adminTabs.membershipRequests.batchApprove")}</button>
          <button className="btn" onClick={() => void batchReview("rejected")} disabled={!selectedIds.length || busyKey === "batch-membership-rejected"}>{t("adminTabs.membershipRequests.batchReject")}</button>
        </div>
      ) : null}
      {loading && !requests.length ? (
        <LoadingSkeleton lines={4} />
      ) : requests.length ? (
        <>
          {paginate(requests, page, 10).map((req) => (
            <div key={req.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
                {req.status === "pending" ? (
                  <input type="checkbox" checked={selectedIds.includes(req.id)} onChange={(e) => toggleSelected(req.id, e.target.checked)} />
                ) : null}
                <strong>{req.full_name}</strong>
                <span className="muted">{req.phone_number || req.email}</span>
                <span className={`event-badge ${req.status === "pending" ? "badge-system" : req.status === "approved" ? "badge-created" : "badge-overdue"}`}>{req.status}</span>
              </div>
              {req.phone_number ? <span className="muted">{t("adminTabs.membershipRequests.phoneLabel")} {req.phone_number}</span> : null}
              {req.address ? <span className="muted">{t("adminTabs.membershipRequests.addressLabel")} {req.address}</span> : null}
              <span className="muted">{t("adminTabs.membershipRequests.requestedLabel")} {formatDate(req.created_at)}</span>
              {req.status === "pending" ? (
                <div style={{ width: "100%" }}>
                  {editingId === req.id ? (
                    <div className="field-stack" style={{ gap: "0.4rem", marginBottom: "0.5rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                        <input value={editFields.full_name || ""} onChange={(e) => setEditFields((p) => ({ ...p, full_name: e.target.value }))} placeholder={t("adminTabs.membershipRequests.fullNamePlaceholder")} />
                        <input value={editFields.phone_number || ""} onChange={(e) => setEditFields((p) => ({ ...p, phone_number: e.target.value }))} placeholder={t("adminTabs.membershipRequests.phonePlaceholder")} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                        <input value={editFields.email || ""} onChange={(e) => setEditFields((p) => ({ ...p, email: e.target.value }))} placeholder={t("adminTabs.membershipRequests.emailPlaceholder")} />
                        <input value={editFields.address || ""} onChange={(e) => setEditFields((p) => ({ ...p, address: e.target.value }))} placeholder={t("adminTabs.membershipRequests.addressPlaceholder")} />
                      </div>
                      <div className="actions-row" style={{ marginTop: 2 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => void saveEdit(req.id)} disabled={busyKey === "edit-membership-request"}>{t("common.save")}</button>
                        <button className="btn btn-sm" onClick={() => setEditingId(null)}>{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : null}
                  <div className="actions-row" style={{ marginTop: 4, flexWrap: "wrap" }}>
                    {editingId !== req.id && <button className="btn btn-sm" onClick={() => startEdit(req)} title={t("adminTabs.membershipRequests.editButton")}>{t("adminTabs.membershipRequests.editButton")}</button>}
                    <button className="btn btn-primary" onClick={() => review(req.id, "approved")} disabled={busyKey === "review-membership"}>{t("adminTabs.membershipRequests.approve")}</button>
                  {rejectingId === req.id ? (
                    <>
                      <input
                        value={rejectReasons[req.id] || ""}
                        onChange={(e) => setRejectReasons((prev) => ({ ...prev, [req.id]: e.target.value }))}
                        placeholder={t("adminTabs.membershipRequests.rejectReasonPlaceholder")}
                        style={{ flex: 1, minWidth: 160 }}
                      />
                      <button className="btn btn-danger" onClick={() => review(req.id, "rejected")} disabled={busyKey === "review-membership"}>{t("adminTabs.membershipRequests.confirmReject")}</button>
                      <button className="btn" onClick={() => setRejectingId(null)}>{t("common.cancel")}</button>
                    </>
                  ) : (
                    <button className="btn" onClick={() => setRejectingId(req.id)} disabled={busyKey === "review-membership"}>{t("adminTabs.membershipRequests.reject")}</button>
                  )}
                </div>
              </div>
              ) : (
                <div className="actions-row" style={{ marginTop: 4 }}>
                  {req.status === "rejected" && (
                    <button className="btn btn-sm" onClick={() => void reopenRequest(req.id)} disabled={busyKey === "reopen-membership-request"}>{t("adminTabs.membershipRequests.reopenAsPending")}</button>
                  )}
                </div>
              )}
              {req.review_note ? <span className="muted">{t("adminTabs.membershipRequests.noteLabel")} {req.review_note}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(requests.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<ClipboardList size={32} />} title={t("adminTabs.membershipRequests.emptyTitle")} description={t("adminTabs.membershipRequests.emptyDescription")} />
      )}
    </article>
  );
}
