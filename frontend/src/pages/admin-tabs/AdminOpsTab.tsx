import { useState, useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { AdminRow } from "../../types";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

export default function AdminOpsTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches, loadAdmins, openOperationConfirmDialog } = useApp();

  const [churchId, setChurchId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [targetChurchId, setTargetChurchId] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [results]);

  async function searchAdmins() {
    if (!isSuperAdmin) return;
    const params = new URLSearchParams();
    if (churchId.trim()) params.set("church_id", churchId.trim());
    if (query.trim()) params.set("query", query.trim());
    const rows = await withAuthRequest(
      "super-admin-search",
      () => apiRequest<AdminRow[]>(`/api/admins/search?${params.toString()}`, { token }),
      t("adminTabs.adminOps.noticeSearchComplete"),
    );
    if (rows) setResults(rows);
  }

  function selectAdmin(admin: AdminRow) {
    setSelectedId(admin.id);
    setEditName(admin.full_name || "");
    setTargetChurchId(admin.church_id || "");
  }

  async function updateAdmin() {
    if (!isSuperAdmin || !selectedId) return;
    if (!targetChurchId.trim() || !isUuid(targetChurchId.trim())) {
      setNotice({ tone: "error", text: t("adminTabs.adminOps.errorSelectValidChurch") });
      return;
    }
    const updated = await withAuthRequest(
      "super-admin-update",
      () => apiRequest<AdminRow>(`/api/admins/id/${selectedId}`, {
        method: "PATCH", token,
        body: { full_name: editName.trim() || undefined, church_id: targetChurchId.trim() },
      }),
      t("adminTabs.adminOps.noticeAdminUpdated"),
    );
    if (updated) setResults((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function deleteAdmin() {
    if (!isSuperAdmin || !selectedId) return;
    const removed = await withAuthRequest(
      "super-admin-delete",
      () => apiRequest<AdminRow>(`/api/admins/id/${selectedId}`, { method: "DELETE", token }),
      t("adminTabs.adminOps.noticeAdminRemoved"),
    );
    if (!removed) return;
    setResults((cur) => cur.filter((r) => r.id !== selectedId));
    setSelectedId("");
    await loadAdmins();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.adminOps.title")}</h3>
      <div className="field-stack">
        <label>
          {t("adminTabs.adminOps.labelChurchFilter")}
          <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
            <option value="">{t("adminTabs.adminOps.optionAllChurches")}</option>
            {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
          </select>
        </label>
        <label>{t("adminTabs.adminOps.labelSearchAdmin")}<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("adminTabs.adminOps.placeholderNameOrEmail")} /></label>
        <div className="actions-row">
          <button className="btn" onClick={searchAdmins} disabled={busyKey === "super-admin-search"}>
            {busyKey === "super-admin-search" ? t("common.searching") : t("adminTabs.adminOps.searchAdmins")}
          </button>
        </div>
        <div className="list-stack">
          {results.length ? (
            <>
              {paginate(results, page, 8).map((a) => (
                <div key={a.id} className="list-item">
                  <strong>{a.full_name || a.email}</strong>
                  <span>{a.email}</span>
                  <span>{a.church_id || t("adminTabs.adminOps.noChurch")}</span>
                  <div className="actions-row"><button className="btn" onClick={() => selectAdmin(a)}>{t("adminTabs.adminOps.selectAdmin")}</button></div>
                </div>
              ))}
              <Pagination page={page} total={totalPages(results.length, 8)} onPageChange={setPage} />
            </>
          ) : <EmptyState icon={<ShieldCheck size={32} />} title={t("adminTabs.adminOps.emptyTitle")} description={t("adminTabs.adminOps.emptyDescription")} />}
        </div>
        {selectedId ? (
          <>
            <label>{t("adminTabs.adminOps.labelAdminName")}<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
            <label>
              {t("adminTabs.adminOps.labelAssignChurch")}
              <select value={targetChurchId} onChange={(e) => setTargetChurchId(e.target.value)}>
                <option value="">{t("admin.selectChurch")}</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
              </select>
            </label>
            <div className="actions-row">
              <button className="btn" onClick={updateAdmin} disabled={busyKey === "super-admin-update"}>
                {busyKey === "super-admin-update" ? t("adminTabs.adminOps.updating") : t("adminTabs.adminOps.updateAdmin")}
              </button>
              <button className="btn btn-danger" onClick={() => {
                const admin = results.find((r) => r.id === selectedId);
                openOperationConfirmDialog(
                  t("adminTabs.adminOps.removeAdminRole"),
                  t("adminTabs.adminOps.confirmRemoveMessage", { name: admin?.full_name || admin?.email || "this user" }),
                  t("adminTabs.adminOps.confirmRemoveKeyword"),
                  deleteAdmin,
                );
              }} disabled={busyKey === "super-admin-delete"}>
                {busyKey === "super-admin-delete" ? t("adminTabs.adminOps.removing") : t("adminTabs.adminOps.removeAdminRole")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
