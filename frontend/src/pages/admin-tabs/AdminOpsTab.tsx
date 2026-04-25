import { useState, useEffect } from "react";
import { ShieldCheck, Search, Zap } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { AdminRow } from "../../types";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

type GlobalMemberHit = {
  id: string;
  full_name: string;
  email?: string;
  phone_number?: string;
  church_id: string;
  church_name?: string;
  membership_id?: string;
  verification_status?: string;
};

const JOB_NAMES = [
  { key: "overdue_reconciliation", label: "Overdue Subscription Reconciliation" },
  { key: "subscription_reminders", label: "Subscription Payment Reminders" },
  { key: "grace_period_enforcement", label: "Grace Period Enforcement" },
  { key: "payment_reconciliation", label: "Pending Payment Reconciliation" },
  { key: "expired_event_cleanup", label: "Expired Event Cleanup" },
  { key: "special_date_reminders", label: "Special Date Reminders" },
  { key: "saas_enforcement", label: "SaaS Subscription Enforcement" },
];

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

  // Global member search
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<GlobalMemberHit[]>([]);
  const [globalPage, setGlobalPage] = useState(1);

  // Job trigger
  const [selectedJob, setSelectedJob] = useState(JOB_NAMES[0].key);
  const [jobResult, setJobResult] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [results]);
  useEffect(() => { setGlobalPage(1); }, [globalResults]);

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

  async function globalMemberSearch() {
    const q = globalQuery.trim();
    if (q.length < 2) { setNotice({ tone: "error", text: t("adminTabs.adminOps.minCharsError") }); return; }
    const hits = await withAuthRequest("global-member-search",
      () => apiRequest<GlobalMemberHit[]>(`/api/ops/global-member-search?q=${encodeURIComponent(q)}&limit=100`, { token }),
      undefined,
    );
    if (hits) setGlobalResults(hits);
  }

  async function triggerJob() {
    const jobLabel = JOB_NAMES.find((j) => j.key === selectedJob)?.label ?? selectedJob;
    openOperationConfirmDialog(
      t("adminTabs.adminOps.triggerJobTitle"),
      t("adminTabs.adminOps.triggerJobMessage", { label: jobLabel }),
      t("adminTabs.adminOps.triggerJobKeyword"),
      async () => {
        const res = await withAuthRequest("trigger-job",
          () => apiRequest<{ job: string; result: unknown }>(`/api/ops/jobs/${encodeURIComponent(selectedJob)}/trigger`, { method: "POST", token }),
          `Job "${selectedJob}" triggered`,
        );
        if (res) setJobResult(JSON.stringify(res.result, null, 2));
      },
    );
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

      {/* Global Cross-Church Member Search */}
      <div style={{ marginTop: "2rem", borderTop: "1px solid var(--outline-variant)", paddingTop: "1.25rem" }}>
        <h4 style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}><Search size={16} /> {t("adminTabs.adminOps.globalSearchTitle")}</h4>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>{t("adminTabs.adminOps.globalSearchDescription")}</p>
        <div className="actions-row" style={{ flexWrap: "wrap" }}>
          <input
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void globalMemberSearch(); }}
            placeholder={t("adminTabs.adminOps.globalSearchPlaceholder")}
            style={{ flex: "1 1 260px" }}
          />
          <button className="btn" onClick={() => void globalMemberSearch()} disabled={busyKey === "global-member-search"}>
            {busyKey === "global-member-search" ? t("adminTabs.adminOps.globalSearching") : t("adminTabs.adminOps.globalSearchButton")}
          </button>
          {globalResults.length > 0 && (
            <button className="btn" onClick={() => { setGlobalResults([]); setGlobalQuery(""); }}>{t("adminTabs.adminOps.clearButton")}</button>
          )}
        </div>
        {globalResults.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="muted" style={{ marginBottom: "0.5rem" }}>{t("adminTabs.adminOps.globalResultsCount", { count: globalResults.length })}</p>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("adminTabs.adminOps.columnName")}</th>
                    <th>{t("adminTabs.adminOps.columnPhone")}</th>
                    <th>{t("adminTabs.adminOps.columnEmail")}</th>
                    <th>{t("adminTabs.adminOps.columnChurch")}</th>
                    <th>{t("adminTabs.adminOps.columnMembershipId")}</th>
                    <th>{t("adminTabs.adminOps.columnStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(globalResults, globalPage, 15).map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontWeight: 600 }}>{m.full_name}</td>
                      <td>{m.phone_number || "—"}</td>
                      <td>{m.email || "—"}</td>
                      <td>{m.church_name || m.church_id.slice(0, 8)}</td>
                      <td>{m.membership_id || "—"}</td>
                      <td>
                        <span className={`event-badge ${m.verification_status === "verified" ? "badge-created" : "badge-system"}`}>{m.verification_status || "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={globalPage} total={totalPages(globalResults.length, 15)} onPageChange={setGlobalPage} />
            </div>
          </div>
        )}
      </div>

      {/* Manual Job Trigger */}
      <div style={{ marginTop: "2rem", borderTop: "1px solid var(--outline-variant)", paddingTop: "1.25rem" }}>
        <h4 style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}><Zap size={16} /> {t("adminTabs.adminOps.manualJobTitle")}</h4>
        <p className="muted" style={{ marginBottom: "0.75rem" }}>{t("adminTabs.adminOps.manualJobDescription")}</p>
        <div className="actions-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 280px" }}>
            {t("adminTabs.adminOps.jobLabel")}
            <select value={selectedJob} onChange={(e) => { setSelectedJob(e.target.value); setJobResult(null); }}>
              {JOB_NAMES.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" onClick={() => void triggerJob()} disabled={busyKey === "trigger-job"}>
            <Zap size={14} /> {busyKey === "trigger-job" ? t("adminTabs.adminOps.running") : t("adminTabs.adminOps.runNow")}
          </button>
        </div>
        {jobResult !== null && (
          <div style={{ marginTop: "0.75rem", background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "0.75rem" }}>
            <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t("adminTabs.adminOps.jobResult")}</p>
            <pre style={{ fontSize: "0.78rem", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{jobResult}</pre>
          </div>
        )}
      </div>
    </article>
  );
}
