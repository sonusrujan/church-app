import { useState, useEffect } from "react";
import { UserRound } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { PastorRow } from "../../types";
import { isUuid, normalizeIndianPhone } from "../../types";
import { useI18n } from "../../i18n";

export default function PastorsTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches, pastors, loadPastors, loadChurches } = useApp();

  // Super admin search/edit
  const [fromChurchId, setFromChurchId] = useState(churches[0]?.id || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PastorRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [superTargetChurchId, setSuperTargetChurchId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [searchPage, setSearchPage] = useState(1);

  // Pastor add form
  const [pastorChurchId, setPastorChurchId] = useState(churches[0]?.id || "");
  const [pastorName, setPastorName] = useState("");
  const [pastorPhone, setPastorPhone] = useState("");
  const [pastorEmail, setPastorEmail] = useState("");
  const [pastorDetails, setPastorDetails] = useState("");
  const [pastorTransferChurchId, setPastorTransferChurchId] = useState("");
  const [listPage, setListPage] = useState(1);

  useEffect(() => { setSearchPage(1); }, [searchResults]);
  useEffect(() => { setListPage(1); }, [pastors]);

  // ── Super admin operations ──

  async function superSearch() {
    if (!isSuperAdmin) return;
    const cid = fromChurchId.trim();
    if (!cid || !isUuid(cid)) {
      setNotice({ tone: "error", text: "Select source church for pastor operations." });
      return;
    }
    const rows = await withAuthRequest(
      "super-pastor-search",
      () => apiRequest<PastorRow[]>(
        `/api/pastors/list?church_id=${encodeURIComponent(cid)}&active_only=false`,
        { token },
      ),
      "Pastor search complete.",
    );
    if (!rows) return;
    const filtered = searchQuery.trim()
      ? rows.filter((r) => {
          const haystack = `${r.full_name} ${r.phone_number} ${r.email || ""}`.toLowerCase();
          return haystack.includes(searchQuery.trim().toLowerCase());
        })
      : rows;
    setSearchResults(filtered);
  }

  function selectPastor(pastor: PastorRow) {
    setSelectedId(pastor.id);
    setEditName(pastor.full_name || "");
    setEditPhone(pastor.phone_number || "");
    setEditEmail(pastor.email || "");
  }

  async function superUpdate() {
    if (!isSuperAdmin || !selectedId) return;
    const cid = fromChurchId.trim();
    if (!cid || !isUuid(cid)) { setNotice({ tone: "error", text: "Select source church for pastor operations." }); return; }
    const updated = await withAuthRequest(
      "super-pastor-update",
      () => apiRequest<PastorRow>(`/api/pastors/${selectedId}`, {
        method: "PATCH", token,
        body: { church_id: cid, full_name: editName.trim() || undefined, phone_number: editPhone.trim() || undefined, email: editEmail.trim() || undefined },
      }),
      "Pastor updated.",
    );
    if (updated) setSearchResults((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function superTransfer() {
    if (!isSuperAdmin || !selectedId) return;
    const from = fromChurchId.trim();
    const to = superTargetChurchId.trim();
    if (!from || !to || !isUuid(from) || !isUuid(to)) {
      setNotice({ tone: "error", text: "Select valid source and target churches for transfer." });
      return;
    }
    const transferred = await withAuthRequest(
      "super-pastor-transfer",
      () => apiRequest<PastorRow>(`/api/pastors/${selectedId}/transfer`, {
        method: "POST", token, body: { from_church_id: from, to_church_id: to },
      }),
      "Pastor transferred.",
    );
    if (!transferred) return;
    setSearchResults((cur) => cur.filter((r) => r.id !== selectedId));
    setSelectedId(""); setEditName(""); setEditPhone(""); setEditEmail("");
    await loadChurches();
  }

  async function superDelete() {
    if (!isSuperAdmin || !selectedId) return;
    const cid = fromChurchId.trim();
    if (!cid || !isUuid(cid)) { setNotice({ tone: "error", text: "Select source church for pastor operations." }); return; }
    const result = await withAuthRequest(
      "super-pastor-delete",
      () => apiRequest<{ deleted: true; id: string }>(`/api/pastors/${selectedId}`, {
        method: "DELETE", token, body: { church_id: cid },
      }),
      "Pastor deleted.",
    );
    if (!result) return;
    setSearchResults((cur) => cur.filter((r) => r.id !== selectedId));
    setSelectedId("");
  }

  // ── Shared pastor add/delete/transfer ──

  async function createPastor() {
    const cid = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";
    if (!cid) { setNotice({ tone: "error", text: "Select a church before adding a pastor." }); return; }
    if (!isUuid(cid)) { setNotice({ tone: "error", text: "Selected church is invalid." }); return; }
    if (!pastorName.trim() || !pastorPhone.trim()) { setNotice({ tone: "error", text: "Pastor name and phone are required." }); return; }
    const created = await withAuthRequest(
      "create-pastor",
      () => apiRequest<PastorRow>("/api/pastors/create", {
        method: "POST", token,
        body: { church_id: cid, full_name: pastorName.trim(), phone_number: normalizeIndianPhone(pastorPhone), email: pastorEmail.trim() || undefined, details: pastorDetails.trim() || undefined },
      }),
      "Pastor added successfully.",
    );
    if (!created) return;
    setPastorName(""); setPastorPhone(""); setPastorEmail(""); setPastorDetails("");
    await loadPastors();
  }

  async function deletePastor(pastorId: string) {
    const cid = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";
    if (!cid) { setNotice({ tone: "error", text: "Select a church before deleting a pastor." }); return; }
    await withAuthRequest(
      "delete-pastor",
      () => apiRequest<{ deleted: true; id: string }>(`/api/pastors/${pastorId}`, {
        method: "DELETE", token, body: { church_id: cid },
      }),
      "Pastor deleted successfully.",
    );
    await loadPastors();
  }

  async function transferPastor(pastorId: string) {
    if (!isSuperAdmin) { setNotice({ tone: "error", text: "Only super admin can transfer pastors." }); return; }
    const from = pastorChurchId.trim();
    const to = pastorTransferChurchId.trim();
    if (!from || !to) { setNotice({ tone: "error", text: "Select both source and target churches for transfer." }); return; }
    if (!isUuid(from) || !isUuid(to)) { setNotice({ tone: "error", text: "Selected church is invalid." }); return; }
    if (from === to) { setNotice({ tone: "error", text: "Source and target church cannot be the same." }); return; }
    await withAuthRequest(
      "transfer-pastor",
      () => apiRequest<PastorRow>(`/api/pastors/${pastorId}/transfer`, {
        method: "POST", token, body: { from_church_id: from, to_church_id: to },
      }),
      "Pastor transferred successfully.",
    );
    await loadPastors();
    await loadChurches();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.pastors.title")}</h3>
      <div className="field-stack">
        {isSuperAdmin ? (
          <>
            <label>
              {t("adminTabs.pastors.sourceChurchLabel")}
              <select value={fromChurchId} onChange={(e) => setFromChurchId(e.target.value)}>
                <option value="">{t("admin.selectChurch")}</option>
                {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
              </select>
            </label>
            <label>
              {t("adminTabs.pastors.searchPastorLabel")}
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("adminTabs.pastors.searchPlaceholder")} />
            </label>
            <div className="actions-row">
              <button className="btn" onClick={superSearch} disabled={busyKey === "super-pastor-search"}>
                {busyKey === "super-pastor-search" ? t("common.searching") : t("adminTabs.pastors.searchPastors")}
              </button>
            </div>
            <div className="list-stack">
              {searchResults.length ? (
                <>
                  {paginate(searchResults, searchPage, 8).map((p) => (
                    <div key={p.id} className="list-item">
                      <strong>{p.full_name}</strong>
                      <span>{p.phone_number}</span>
                      <span>{p.email || t("adminTabs.pastors.noEmail")}</span>
                      <div className="actions-row"><button className="btn" onClick={() => selectPastor(p)}>{t("adminTabs.pastors.selectPastor")}</button></div>
                    </div>
                  ))}
                  <Pagination page={searchPage} total={totalPages(searchResults.length, 8)} onPageChange={setSearchPage} />
                </>
              ) : <EmptyState icon={<UserRound size={32} />} title={t("adminTabs.pastors.emptySearchTitle")} description={t("adminTabs.pastors.emptySearchDescription")} />}
            </div>
            {selectedId ? (
              <>
                <label>{t("adminTabs.pastors.pastorNameLabel")}<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                <label>{t("adminTabs.pastors.pastorPhoneLabel")}<input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></label>
                <label>{t("adminTabs.pastors.pastorEmailLabel")}<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></label>
                <label>
                  {t("adminTabs.pastors.transferToChurchLabel")}
                  <select value={superTargetChurchId} onChange={(e) => setSuperTargetChurchId(e.target.value)}>
                    <option value="">{t("adminTabs.pastors.selectTargetChurch")}</option>
                    {churches.filter((c) => c.id !== fromChurchId).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
                    ))}
                  </select>
                </label>
                <div className="actions-row">
                  <button className="btn" onClick={superUpdate} disabled={busyKey === "super-pastor-update"}>
                    {busyKey === "super-pastor-update" ? t("adminTabs.pastors.updating") : t("adminTabs.pastors.updatePastor")}
                  </button>
                  <button className="btn" onClick={superTransfer} disabled={busyKey === "super-pastor-transfer"}>
                    {busyKey === "super-pastor-transfer" ? t("adminTabs.pastors.transferring") : t("adminTabs.pastors.transferPastor")}
                  </button>
                  <button className="btn btn-danger" onClick={superDelete} disabled={busyKey === "super-pastor-delete"}>
                    {busyKey === "super-pastor-delete" ? t("adminTabs.pastors.deleting") : t("adminTabs.pastors.deletePastor")}
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* Shared pastor add form */}
        <label>
          {t("adminTabs.pastors.churchRequiredLabel")}
          <select
            value={isSuperAdmin ? pastorChurchId : authContext?.auth.church_id || ""}
            onChange={(e) => { if (isSuperAdmin) setPastorChurchId(e.target.value); }}
            disabled={!isSuperAdmin}
          >
            {isSuperAdmin ? <option value="">{t("admin.selectChurch")}</option> : null}
            {(isSuperAdmin ? churches : churches.slice(0, 1)).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
            ))}
            {!isSuperAdmin && !churches.length && authContext?.auth.church_id ? (
              <option value={authContext.auth.church_id}>Current Church</option>
            ) : null}
          </select>
        </label>
        {isSuperAdmin ? (
          <label>
            {t("adminTabs.pastors.transferToChurchLabel")}
            <select value={pastorTransferChurchId} onChange={(e) => setPastorTransferChurchId(e.target.value)}>
              <option value="">{t("adminTabs.pastors.selectTargetChurch")}</option>
              {churches.filter((c) => c.id !== pastorChurchId).map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>{t("adminTabs.pastors.pastorNameLabel")}<input value={pastorName} onChange={(e) => setPastorName(e.target.value)} placeholder={t("adminTabs.pastors.namePlaceholder")} /></label>
        <label>{t("adminTabs.pastors.pastorPhoneLabel")}
          <div style={{ display: "flex", alignItems: "stretch" }}>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 0.75rem", background: "var(--surface-container)", borderRadius: "var(--radius-md) 0 0 var(--radius-md)", border: "1px solid rgba(220,208,255,0.30)", borderRight: "none", fontWeight: 600, fontSize: "0.9375rem", color: "var(--on-surface)", whiteSpace: "nowrap", userSelect: "none" }}>{t("adminTabs.pastors.phonePrefix")}</span>
            <input type="tel" inputMode="numeric" value={pastorPhone} onChange={(e) => setPastorPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t("adminTabs.pastors.phonePlaceholder")} maxLength={10} style={{ borderRadius: "0 var(--radius-md) var(--radius-md) 0" }} />
          </div>
        </label>
        <label>{t("adminTabs.pastors.pastorEmailLabel")}<input value={pastorEmail} onChange={(e) => setPastorEmail(e.target.value)} placeholder={t("adminTabs.pastors.emailPlaceholder")} /></label>
        <label>{t("adminTabs.pastors.detailsLabel")}<textarea value={pastorDetails} onChange={(e) => setPastorDetails(e.target.value)} placeholder={t("adminTabs.pastors.detailsPlaceholder")} /></label>
      </div>
      <div className="actions-row">
        <button className="btn btn-primary" onClick={createPastor} disabled={busyKey === "create-pastor"}>
          {busyKey === "create-pastor" ? t("adminTabs.pastors.adding") : t("adminTabs.pastors.addPastor")}
        </button>
        <button className="btn" onClick={() => void loadPastors()} disabled={busyKey === "pastors"}>
          {busyKey === "pastors" ? t("adminTabs.pastors.refreshing") : t("adminTabs.pastors.refreshPastors")}
        </button>
      </div>
      <div className="list-stack">
        {pastors.length ? (
          <>
            {paginate(pastors, listPage, 6).map((p) => (
              <div key={p.id} className="list-item">
                <strong>{p.full_name}</strong>
                <span>{p.phone_number}</span>
                <span>{p.email || "No email"}</span>
                <div className="actions-row">
                  {isSuperAdmin ? (
                    <button className="btn" onClick={() => void transferPastor(p.id)} disabled={busyKey === "transfer-pastor" || !pastorTransferChurchId}>
                      {busyKey === "transfer-pastor" ? t("adminTabs.pastors.transferring") : t("adminTabs.pastors.transferPastor")}
                    </button>
                  ) : null}
                  <button className="btn btn-danger" onClick={() => void deletePastor(p.id)} disabled={busyKey === "delete-pastor"}>
                    {busyKey === "delete-pastor" ? t("adminTabs.pastors.deleting") : t("adminTabs.pastors.deletePastor")}
                  </button>
                </div>
              </div>
            ))}
            <Pagination page={listPage} total={totalPages(pastors.length, 6)} onPageChange={setListPage} />
          </>
        ) : <EmptyState icon={<UserRound size={32} />} title={t("adminTabs.pastors.emptyListTitle")} description={t("adminTabs.pastors.emptyListDescription")} />}
      </div>
    </article>
  );
}
