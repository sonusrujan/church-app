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

  const isAdmin = authContext?.auth.role === "admin";
  const canWrite = isSuperAdmin || isAdmin;

  // Search/edit
  const [fromChurchId, setFromChurchId] = useState(isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || ""));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PastorRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [superTargetChurchId, setSuperTargetChurchId] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [searchPage, setSearchPage] = useState(1);

  // Pastor add form
  const [pastorChurchId, setPastorChurchId] = useState(isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || ""));
  const [pastorName, setPastorName] = useState("");
  const [pastorPhone, setPastorPhone] = useState("");
  const [pastorEmail, setPastorEmail] = useState("");
  const [pastorDetails, setPastorDetails] = useState("");
  const [listPage, setListPage] = useState(1);

  useEffect(() => { setSearchPage(1); }, [searchResults]);
  useEffect(() => { setListPage(1); }, [pastors]);

  const scopedChurchId = isSuperAdmin ? fromChurchId.trim() : (authContext?.auth.church_id || "");

  async function searchPastors() {
    if (!canWrite) return;
    const cid = scopedChurchId;
    if (!cid || !isUuid(cid)) {
      setNotice({ tone: "error", text: t("adminTabs.pastors.errorSelectSourceChurch") });
      return;
    }
    const rows = await withAuthRequest(
      "pastor-search",
      () => apiRequest<PastorRow[]>(
        `/api/pastors/list?church_id=${encodeURIComponent(cid)}&active_only=false`,
        { token },
      ),
      t("adminTabs.pastors.successSearchComplete"),
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
    setEditDetails((pastor as Record<string, unknown>).details as string || "");
    setEditIsActive((pastor as Record<string, unknown>).is_active !== false);
  }

  function clearSelection() {
    setSelectedId(""); setEditName(""); setEditPhone(""); setEditEmail("");
    setEditDetails(""); setEditIsActive(true);
  }

  async function updatePastor() {
    if (!canWrite || !selectedId) return;
    const cid = scopedChurchId;
    if (!cid || !isUuid(cid)) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorSelectSourceChurch") }); return; }
    const updated = await withAuthRequest(
      "pastor-update",
      () => apiRequest<PastorRow>(`/api/pastors/${selectedId}`, {
        method: "PATCH", token,
        body: {
          church_id: cid,
          full_name: editName.trim() || undefined,
          phone_number: editPhone.trim() || undefined,
          email: editEmail.trim() || undefined,
          details: editDetails.trim() || undefined,
          is_active: editIsActive,
        },
      }),
      t("adminTabs.pastors.successUpdated"),
    );
    if (updated) setSearchResults((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function transferPastorById(pastorId: string, from: string, to: string) {
    if (!canWrite) return;
    if (!from || !to || !isUuid(from) || !isUuid(to)) {
      setNotice({ tone: "error", text: t("adminTabs.pastors.errorSelectBothChurches") });
      return;
    }
    if (from === to) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorSameChurch") }); return; }
    const transferred = await withAuthRequest(
      "pastor-transfer",
      () => apiRequest<PastorRow>(`/api/pastors/${pastorId}/transfer`, {
        method: "POST", token, body: { from_church_id: from, to_church_id: to },
      }),
      t("adminTabs.pastors.successTransferred"),
    );
    if (!transferred) return;
    setSearchResults((cur) => cur.filter((r) => r.id !== pastorId));
    if (pastorId === selectedId) clearSelection();
    await loadChurches();
    await loadPastors();
  }

  async function deletePastorById(pastorId: string, cid: string) {
    if (!canWrite) return;
    if (!cid || !isUuid(cid)) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorSelectSourceChurch") }); return; }
    const result = await withAuthRequest(
      "pastor-delete",
      () => apiRequest<{ deleted: true; id: string }>(`/api/pastors/${pastorId}`, {
        method: "DELETE", token, body: { church_id: cid },
      }),
      t("adminTabs.pastors.successDeleted"),
    );
    if (!result) return;
    setSearchResults((cur) => cur.filter((r) => r.id !== pastorId));
    if (pastorId === selectedId) clearSelection();
    await loadPastors();
  }

  async function createPastor() {
    const cid = isSuperAdmin ? pastorChurchId.trim() : authContext?.auth.church_id || "";
    if (!cid) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorSelectSourceChurch") }); return; }
    if (!isUuid(cid)) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorInvalidChurch") }); return; }
    if (!pastorName.trim() || !pastorPhone.trim()) { setNotice({ tone: "error", text: t("adminTabs.pastors.errorNamePhoneRequired") }); return; }
    const created = await withAuthRequest(
      "create-pastor",
      () => apiRequest<PastorRow>("/api/pastors/create", {
        method: "POST", token,
        body: { church_id: cid, full_name: pastorName.trim(), phone_number: normalizeIndianPhone(pastorPhone), email: pastorEmail.trim() || undefined, details: pastorDetails.trim() || undefined },
      }),
      t("adminTabs.pastors.successAdded"),
    );
    if (!created) return;
    setPastorName(""); setPastorPhone(""); setPastorEmail(""); setPastorDetails("");
    await loadPastors();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.pastors.title")}</h3>
      <div className="field-stack">
        {/* Church selector */}
        {isSuperAdmin ? (
          <label>
            {t("adminTabs.pastors.sourceChurchLabel")}
            <select value={fromChurchId} onChange={(e) => setFromChurchId(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        ) : null}

        {/* Search */}
        <label>
          {t("adminTabs.pastors.searchPastorLabel")}
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t("adminTabs.pastors.searchPlaceholder")}
            onKeyDown={(e) => { if (e.key === "Enter") searchPastors(); }} />
        </label>
        <div className="actions-row">
          <button className="btn" onClick={searchPastors} disabled={busyKey === "pastor-search"}>
            {busyKey === "pastor-search" ? t("common.searching") : t("adminTabs.pastors.searchPastors")}
          </button>
        </div>

        {/* Search results */}
        <div className="list-stack">
          {searchResults.length ? (
            <>
              {paginate(searchResults, searchPage, 8).map((p) => (
                <div key={p.id} className={`list-item${selectedId === p.id ? " list-item--selected" : ""}`}>
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

        {/* Edit selected pastor */}
        {selectedId && canWrite ? (
          <div style={{ borderLeft: "3px solid var(--primary)", paddingLeft: "1rem", marginTop: "0.5rem" }}>
            <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.pastors.editPastorTitle")}</h4>
            <label>{t("adminTabs.pastors.pastorNameLabel")}<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
            <label>{t("adminTabs.pastors.pastorPhoneLabel")}<input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></label>
            <label>{t("adminTabs.pastors.pastorEmailLabel")}<input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} /></label>
            <label>{t("adminTabs.pastors.detailsLabel")}<textarea value={editDetails} onChange={(e) => setEditDetails(e.target.value)} placeholder={t("adminTabs.pastors.detailsPlaceholder")} /></label>
            <label>
              {t("adminTabs.pastors.activeStatusLabel")}
              <select value={editIsActive ? "true" : "false"} onChange={(e) => setEditIsActive(e.target.value === "true")}>
                <option value="true">{t("adminTabs.pastors.statusActive")}</option>
                <option value="false">{t("adminTabs.pastors.statusInactive")}</option>
              </select>
            </label>
            {isSuperAdmin ? (
              <label>
                {t("adminTabs.pastors.transferToChurchLabel")}
                <select value={superTargetChurchId} onChange={(e) => setSuperTargetChurchId(e.target.value)}>
                  <option value="">{t("adminTabs.pastors.selectTargetChurch")}</option>
                  {churches.filter((c) => c.id !== fromChurchId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button className="btn btn-primary" onClick={updatePastor} disabled={busyKey === "pastor-update"}>
                {busyKey === "pastor-update" ? t("adminTabs.pastors.updating") : t("adminTabs.pastors.updatePastor")}
              </button>
              {isSuperAdmin ? (
                <button className="btn" onClick={() => void transferPastorById(selectedId, scopedChurchId, superTargetChurchId)} disabled={busyKey === "pastor-transfer" || !superTargetChurchId}>
                  {busyKey === "pastor-transfer" ? t("adminTabs.pastors.transferring") : t("adminTabs.pastors.transferPastor")}
                </button>
              ) : null}
              <button className="btn btn-danger" onClick={() => void deletePastorById(selectedId, scopedChurchId)} disabled={busyKey === "pastor-delete"}>
                {busyKey === "pastor-delete" ? t("adminTabs.pastors.deleting") : t("adminTabs.pastors.deletePastor")}
              </button>
              <button className="btn" onClick={clearSelection}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : null}

        <hr style={{ margin: "1.5rem 0", opacity: 0.2 }} />

        {/* Add pastor form */}
        <h4>{t("adminTabs.pastors.addPastor")}</h4>
        {isSuperAdmin ? (
          <label>
            {t("adminTabs.pastors.churchRequiredLabel")}
            <select value={pastorChurchId} onChange={(e) => setPastorChurchId(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => (
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
                <span>{p.email || t("adminTabs.pastors.noEmail")}</span>
                <div className="actions-row">
                  <button className="btn btn-danger" onClick={() => void deletePastorById(p.id, isSuperAdmin ? pastorChurchId : (authContext?.auth.church_id || ""))} disabled={busyKey === "pastor-delete"}>
                    {busyKey === "pastor-delete" ? t("adminTabs.pastors.deleting") : t("adminTabs.pastors.deletePastor")}
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
