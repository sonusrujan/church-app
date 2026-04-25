import { useState, useEffect, useCallback } from "react";
import { Crown, Plus, Trash2, Edit, X, Check, ChevronDown, ChevronUp, Church, Users, Search, ImagePlus } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import PhotoUpload from "../../components/PhotoUpload";
import ValidatedInput, { validatePhone, validateEmail } from "../../components/ValidatedInput";
import type { DioceseRow, DioceseLeaderRow, DioceseChurchRow, ChurchRow } from "../../types";
import { normalizeIndianPhone, stripIndianPrefix } from "../../types";
import { useI18n } from "../../i18n";

const DIOCESE_ROLES = ["Bishop", "Vice President", "Secretary", "Treasurer", "Assistant Secretary", "Associate Treasurer"];

export default function DioceseTab() {
  const { t } = useI18n();
  const { token, busyKey, setNotice, withAuthRequest, churches } = useApp();

  // ── Diocese list ──
  const [dioceses, setDioceses] = useState<DioceseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newDioceseName, setNewDioceseName] = useState("");

  // ── Expanded diocese (selected for management) ──
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Edit diocese name ──
  const [editingDioceseId, setEditingDioceseId] = useState<string | null>(null);
  const [editDioceseName, setEditDioceseName] = useState("");

  // ── Diocese churches ──
  const [dioceseChurches, setDioceseChurches] = useState<DioceseChurchRow[]>([]);
  const [churchesLoading, setChurchesLoading] = useState(false);
  const [addChurchIds, setAddChurchIds] = useState<string[]>([]);

  // ── Diocese leaders ──
  const [leaders, setLeaders] = useState<DioceseLeaderRow[]>([]);
  const [leadersLoading, setLeadersLoading] = useState(false);

  // ── New leader form ──
  const [newRole, setNewRole] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newBio, setNewBio] = useState("");
  const [newPhoto, setNewPhoto] = useState("");

  // ── Church search ──
  const [churchSearch, setChurchSearch] = useState("");

  // ── Edit leader ──
  const [editLeaderId, setEditLeaderId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [editRole, setEditRole] = useState("");

  // ── Load dioceses ──
  const loadDioceses = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<DioceseRow[]>("/api/diocese", { token });
      setDioceses(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.diocese.errorLoadDioceses") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice]);

  useEffect(() => { void loadDioceses(); }, [loadDioceses]);

  // ── Load churches + leaders for expanded diocese ──
  const loadDioceseDetail = useCallback(async (dId: string) => {
    if (!token) return;
    setChurchesLoading(true);
    setLeadersLoading(true);
    try {
      const [c, l] = await Promise.all([
        apiRequest<DioceseChurchRow[]>(`/api/diocese/${encodeURIComponent(dId)}/churches`, { token }),
        apiRequest<DioceseLeaderRow[]>(`/api/diocese/${encodeURIComponent(dId)}/leaders`, { token }),
      ]);
      setDioceseChurches(c);
      setLeaders(l);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.diocese.errorLoadDetails") });
    } finally {
      setChurchesLoading(false);
      setLeadersLoading(false);
    }
  }, [token, setNotice]);

  useEffect(() => {
    if (expandedId) void loadDioceseDetail(expandedId);
    else { setDioceseChurches([]); setLeaders([]); }
  }, [expandedId, loadDioceseDetail]);

  // ── Create diocese ──
  async function createDiocese() {
    if (!newDioceseName.trim()) { setNotice({ tone: "error", text: t("adminTabs.diocese.errorNameRequired") }); return; }
    await withAuthRequest("create-diocese", async () => {
      await apiRequest("/api/diocese", { method: "POST", token, body: { name: newDioceseName.trim() } });
      setNewDioceseName("");
      void loadDioceses();
    }, t("adminTabs.diocese.successDioceseCreated"));
  }

  // ── Update diocese name ──
  async function saveDioceseName() {
    if (!editingDioceseId || !editDioceseName.trim()) return;
    await withAuthRequest("update-diocese", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(editingDioceseId!)}`, { method: "PATCH", token, body: { name: editDioceseName.trim() } });
      setEditingDioceseId(null);
      void loadDioceses();
    }, t("adminTabs.diocese.successDioceseUpdated"));
  }

  // ── Delete diocese ──
  async function removeDiocese(id: string) {
    await withAuthRequest("delete-diocese", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(id)}`, { method: "DELETE", token });
      if (expandedId === id) setExpandedId(null);
      void loadDioceses();
    }, t("adminTabs.diocese.successDioceseDeleted"));
  }

  // ── Add churches ──
  async function addChurches() {
    if (!expandedId || !addChurchIds.length) return;
    await withAuthRequest("add-churches", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(expandedId!)}/churches`, { method: "POST", token, body: { church_ids: addChurchIds } });
      setAddChurchIds([]);
      void loadDioceseDetail(expandedId!);
      void loadDioceses();
    }, t("adminTabs.diocese.successChurchesAdded"));
  }

  // ── Remove church ──
  async function removeChurch(churchId: string) {
    if (!expandedId) return;
    await withAuthRequest("remove-church", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(expandedId!)}/churches/${encodeURIComponent(churchId)}`, { method: "DELETE", token });
      void loadDioceseDetail(expandedId!);
      void loadDioceses();
    }, t("adminTabs.diocese.successChurchRemoved"));
  }

  // ── Add diocese logo ──
  async function addLogo(dId: string, url: string) {
    await withAuthRequest("add-diocese-logo", async () => {
      const updated = await apiRequest<DioceseRow>(`/api/diocese/${encodeURIComponent(dId)}/logos`, {
        method: "POST", token, body: { logo_url: url },
      });
      setDioceses((prev) => prev.map((d) => d.id === dId ? { ...d, logo_urls: updated.logo_urls } : d));
    }, t("adminTabs.diocese.successLogoAdded"));
  }

  // ── Remove diocese logo ──
  async function removeLogo(dId: string, url: string) {
    await withAuthRequest("remove-diocese-logo", async () => {
      const updated = await apiRequest<DioceseRow>(`/api/diocese/${encodeURIComponent(dId)}/logos`, {
        method: "DELETE", token, body: { logo_url: url },
      });
      setDioceses((prev) => prev.map((d) => d.id === dId ? { ...d, logo_urls: updated.logo_urls } : d));
    }, t("adminTabs.diocese.successLogoRemoved"));
  }

  // ── Assign leader ──
  async function assignLeader() {
    if (!expandedId || !newRole || !newName.trim()) { setNotice({ tone: "error", text: t("adminTabs.diocese.errorRoleNameRequired") }); return; }
    const phoneErr = validatePhone(newPhone);
    if (phoneErr) { setNotice({ tone: "error", text: phoneErr }); return; }
    const emailErr = validateEmail(newEmail);
    if (emailErr) { setNotice({ tone: "error", text: emailErr }); return; }
    await withAuthRequest("assign-diocese-leader", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(expandedId!)}/leaders`, {
        method: "POST", token,
        body: {
          role: newRole,
          full_name: newName.trim(),
          phone_number: newPhone.trim() ? normalizeIndianPhone(newPhone) : undefined,
          email: newEmail.trim() || undefined,
          bio: newBio.trim() || undefined,
          photo_url: newPhoto.trim() || undefined,
        },
      });
      setNewRole(""); setNewName(""); setNewPhone(""); setNewEmail(""); setNewBio(""); setNewPhoto("");
      void loadDioceseDetail(expandedId!);
    }, t("adminTabs.diocese.successLeaderAssigned"));
  }

  // ── Edit leader ──
  function startEditLeader(l: DioceseLeaderRow) {
    setEditLeaderId(l.id);
    setEditName(l.full_name);
    setEditPhone(stripIndianPrefix(l.phone_number || ""));
    setEditEmail(l.email || "");
    setEditBio(l.bio || "");
    setEditPhoto(l.photo_url || "");
    setEditRole(l.role);
  }

  async function saveLeaderEdit() {
    if (!expandedId || !editLeaderId || !editName.trim()) return;
    const phoneErr = validatePhone(editPhone);
    if (phoneErr) { setNotice({ tone: "error", text: phoneErr }); return; }
    const emailErr = validateEmail(editEmail);
    if (emailErr) { setNotice({ tone: "error", text: emailErr }); return; }
    await withAuthRequest("update-diocese-leader", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(expandedId!)}/leaders/${encodeURIComponent(editLeaderId!)}`, {
        method: "PATCH", token,
        body: {
          role: editRole,
          full_name: editName.trim(),
          phone_number: editPhone.trim() ? normalizeIndianPhone(editPhone) : undefined,
          email: editEmail.trim() || undefined,
          bio: editBio.trim() || undefined,
          photo_url: editPhoto.trim() || "",
        },
      });
      setEditLeaderId(null);
      void loadDioceseDetail(expandedId!);
    }, t("adminTabs.diocese.successLeaderUpdated"));
  }

  // ── Remove leader ──
  async function removeLeader(leaderId: string) {
    if (!expandedId) return;
    await withAuthRequest("remove-diocese-leader", async () => {
      await apiRequest(`/api/diocese/${encodeURIComponent(expandedId!)}/leaders/${encodeURIComponent(leaderId)}`, { method: "DELETE", token });
      void loadDioceseDetail(expandedId!);
    }, t("adminTabs.diocese.successLeaderRemoved"));
  }

  // Available churches = all churches minus those already in this diocese
  const assignedChurchIds = new Set(dioceseChurches.map((dc) => dc.church_id));
  const availableChurches = churches.filter((c: ChurchRow) => !assignedChurchIds.has(c.id));
  const searchTerm = churchSearch.trim().toLowerCase();
  const filteredChurches = searchTerm
    ? availableChurches.filter((c: ChurchRow) =>
        c.name.toLowerCase().includes(searchTerm) ||
        (c.location && c.location.toLowerCase().includes(searchTerm))
      )
    : availableChurches;

  function toggleChurchSelection(id: string) {
    setAddChurchIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.diocese.title")}</h3>
      <p className="muted">{t("adminTabs.diocese.description")}</p>

      {/* ── Create Diocese ── */}
      <div className="field-stack" style={{ borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "1.25rem", marginBottom: "1.25rem" }}>
        <h4 style={{ margin: 0 }}>{t("adminTabs.diocese.createNewDiocese")}</h4>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <label style={{ flex: 1 }}>
            {t("adminTabs.diocese.labelDioceseName")}
            <input type="text" value={newDioceseName} onChange={(e) => setNewDioceseName(e.target.value)} placeholder={t("adminTabs.diocese.placeholderDioceseName")} />
          </label>
          <button className="btn btn-primary" onClick={createDiocese} disabled={busyKey === "create-diocese"} style={{ whiteSpace: "nowrap" }}>
            <Plus size={16} /> {busyKey === "create-diocese" ? t("adminTabs.diocese.creating") : t("adminTabs.diocese.createDiocese")}
          </button>
        </div>
      </div>

      {/* ── Diocese List ── */}
      {loading && !dioceses.length ? (
        <LoadingSkeleton lines={4} />
      ) : dioceses.length ? (
        <div className="list-stack">
          {dioceses.map((d) => {
            const isExpanded = expandedId === d.id;
            return (
              <div key={d.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
                {/* Diocese header row */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}
                     onClick={() => setExpandedId(isExpanded ? null : d.id)}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", fontWeight: 600 }}>
                    {d.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    {editingDioceseId === d.id ? (
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input type="text" value={editDioceseName} onChange={(e) => setEditDioceseName(e.target.value)} style={{ flex: 1 }} />
                        <button className="btn btn-primary" onClick={saveDioceseName} disabled={busyKey === "update-diocese"} title="Save">
                          <Check size={14} />
                        </button>
                        <button className="btn" onClick={() => setEditingDioceseId(null)} title="Cancel">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <strong>{d.name}</strong>
                        <span className="muted" style={{ display: "block", fontSize: "0.82rem" }}>
                          {t("adminTabs.diocese.churchCount", { count: d.church_count ?? 0 })}
                        </span>
                      </>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                    <button className="btn" onClick={() => { setEditingDioceseId(d.id); setEditDioceseName(d.name); }} title="Rename">
                      <Edit size={14} />
                    </button>
                    <button className="btn btn-danger" onClick={() => removeDiocese(d.id)} disabled={busyKey === "delete-diocese"} title="Delete Diocese">
                      <Trash2 size={14} />
                    </button>
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>

                {/* ── Expanded detail ── */}
                {isExpanded ? (
                  <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border, #e5e7eb)" }}>
                    {/* ── Churches Section ── */}
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h4 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Church size={18} /> {t("adminTabs.diocese.churchesInDiocese")}
                      </h4>

                      {churchesLoading ? (
                        <LoadingSkeleton lines={2} />
                      ) : dioceseChurches.length ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "1rem" }}>
                          {dioceseChurches.map((dc) => (
                            <div key={dc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem", background: "var(--surface, #f9fafb)", borderRadius: "0.4rem" }}>
                              <span>{dc.church_name || dc.church_id}{dc.church_location ? ` — ${dc.church_location}` : ""}</span>
                              <button className="btn btn-danger" onClick={() => removeChurch(dc.church_id)} disabled={busyKey === "remove-church"} title="Remove from diocese" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}>
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>{t("adminTabs.diocese.noChurchesAssigned")}</p>
                      )}

                      {/* Add churches */}
                      {availableChurches.length ? (
                        <div className="field-stack">
                          <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t("adminTabs.diocese.addChurches")}</label>
                          <div style={{ position: "relative", marginBottom: "0.25rem" }}>
                            <Search size={14} style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", opacity: 0.45, pointerEvents: "none" }} />
                            <input
                              type="text"
                              value={churchSearch}
                              onChange={(e) => setChurchSearch(e.target.value)}
                              placeholder={t("adminTabs.diocese.placeholderSearchChurches")}
                              style={{ paddingLeft: "2rem", width: "100%", boxSizing: "border-box" }}
                            />
                          </div>
                          <div style={{ maxHeight: "180px", overflow: "auto", border: "1px solid var(--border, #e5e7eb)", borderRadius: "0.4rem", padding: "0.25rem" }}>
                            {filteredChurches.length ? filteredChurches.map((c: ChurchRow) => (
                              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 0.5rem", cursor: "pointer", borderRadius: "0.25rem", lineHeight: 1.4 }}>
                                <input type="checkbox" checked={addChurchIds.includes(c.id)} onChange={() => toggleChurchSelection(c.id)} style={{ flexShrink: 0 }} />
                                <span style={{ fontSize: "0.85rem", lineHeight: 1.4 }}>{c.name}{c.location ? <span className="muted"> — {c.location}</span> : ""}</span>
                              </label>
                            )) : (
                              <p className="muted" style={{ fontSize: "0.82rem", textAlign: "center", padding: "0.75rem 0", margin: 0 }}>{t("adminTabs.diocese.noChurchesMatch", { search: churchSearch })}</p>
                            )}
                          </div>
                          {addChurchIds.length > 0 && (
                            <button className="btn btn-primary" onClick={addChurches} disabled={busyKey === "add-churches"} style={{ marginTop: "0.4rem" }}>
                              {busyKey === "add-churches" ? t("common.adding") : t("adminTabs.diocese.addCountChurches", { count: addChurchIds.length })}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: "0.8rem" }}>{t("adminTabs.diocese.allChurchesAssigned")}</p>
                      )}
                    </div>

                    {/* ── Diocese Logos Section (max 3) ── */}
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h4 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <ImagePlus size={18} /> {t("adminTabs.diocese.dioceseLogos")}
                        <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>
                          ({(d.logo_urls || []).length}/3)
                        </span>
                      </h4>

                      {/* Existing logos */}
                      {(d.logo_urls || []).length > 0 ? (
                        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                          {(d.logo_urls || []).map((url, idx) => (
                            <div key={idx} style={{ position: "relative", width: 80, height: 80 }}>
                              <img
                                src={url}
                                alt={`Logo ${idx + 1}`}
                                style={{
                                  width: 80, height: 80, objectFit: "contain",
                                  borderRadius: "var(--radius-md)", border: "1px solid var(--border-light)",
                                  background: "var(--surface-container-lowest)",
                                }}
                              />
                              <button
                                className="btn btn-danger"
                                onClick={() => removeLogo(d.id, url)}
                                disabled={busyKey === "remove-diocese-logo"}
                                title="Remove logo"
                                style={{
                                  position: "absolute", top: -6, right: -6,
                                  width: 22, height: 22, borderRadius: "50%",
                                  padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: "0.7rem", minWidth: 0,
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>{t("adminTabs.diocese.noLogosUploaded")}</p>
                      )}

                      {/* Upload new logo (if under 3) */}
                      {(d.logo_urls || []).length < 3 ? (
                        <div>
                          <span className="field-label">{t("adminTabs.diocese.uploadLogo")}</span>
                          <PhotoUpload
                            currentUrl=""
                            onUploaded={(url) => { void addLogo(d.id, url); }}
                            onError={(msg) => setNotice({ tone: "error", text: msg })}
                            token={token || ""}
                            folder="logos"
                            targetChurchId={dioceseChurches[0]?.church_id || expandedId || undefined}
                            size={64}
                            fallback={<ImagePlus size={24} style={{ opacity: 0.4 }} />}
                          />
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: "0.82rem" }}>{t("adminTabs.diocese.maxLogosReached")}</p>
                      )}
                    </div>

                    {/* ── Leadership Section ── */}
                    <div>
                      <h4 style={{ margin: "0 0 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <Users size={18} /> {t("adminTabs.diocese.dioceseLeadership")}
                      </h4>

                      {/* Assign new leader */}
                      <div className="field-stack" style={{ borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "1rem", marginBottom: "1rem" }}>
                        <label>{t("adminTabs.diocese.labelRole")} <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                          <option value="">{t("adminTabs.diocese.selectRole")}</option>
                          {DIOCESE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select></label>
                        <label>{t("adminTabs.diocese.labelFullName")} <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("adminTabs.diocese.placeholderFullName")} /></label>
                        <ValidatedInput type="phone" value={newPhone} onChange={setNewPhone} placeholder="+91..." label={t("adminTabs.diocese.labelPhone")} />
                        <ValidatedInput type="email" value={newEmail} onChange={setNewEmail} placeholder="name@example.com" label={t("adminTabs.diocese.labelEmail")} />
                        <div><span className="field-label">{t("adminTabs.diocese.labelPhoto")}</span>
                          <PhotoUpload
                            currentUrl={newPhoto}
                            onUploaded={(url) => { setNewPhoto(url); setNotice({ tone: "success", text: "Photo uploaded" }); }}
                            onDeleted={() => setNewPhoto("")}
                            onError={(msg) => setNotice({ tone: "error", text: msg })}
                            token={token || ""}
                            folder="leaders"
                            targetChurchId={dioceseChurches[0]?.church_id || expandedId || undefined}
                            size={64}
                            fallback={<span style={{ fontSize: "0.9rem", opacity: 0.5 }}>📷</span>}
                          />
                        </div>
                        <label>{t("adminTabs.diocese.labelBio")} <textarea value={newBio} onChange={(e) => setNewBio(e.target.value)} placeholder={t("adminTabs.diocese.placeholderBio")} rows={2} /></label>
                        <div className="actions-row">
                          <button className="btn btn-primary" onClick={assignLeader} disabled={busyKey === "assign-diocese-leader"}>
                            {busyKey === "assign-diocese-leader" ? t("adminTabs.diocese.assigning") : t("adminTabs.diocese.assignLeader")}
                          </button>
                        </div>
                      </div>

                      {/* Leaders list */}
                      {leadersLoading && !leaders.length ? (
                        <LoadingSkeleton lines={3} />
                      ) : leaders.length ? (
                        <div className="list-stack">
                          {leaders.map((l) => (
                            <div key={l.id} className="list-item" style={{ position: "relative" }}>
                              {editLeaderId === l.id ? (
                                <div className="field-stack" style={{ width: "100%" }}>
                                  <label>Role <select value={editRole} onChange={(e) => setEditRole(e.target.value)}>
                                    {DIOCESE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                  </select></label>
                                  <label>Name <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
                                  <ValidatedInput type="phone" value={editPhone} onChange={setEditPhone} label="Phone" />
                                  <ValidatedInput type="email" value={editEmail} onChange={setEditEmail} label="Email" />
                                  <div><span className="field-label">Photo</span>
                                    <PhotoUpload
                                      currentUrl={editPhoto}
                                      onUploaded={(url) => { setEditPhoto(url); setNotice({ tone: "success", text: "Photo updated" }); }}
                                      onDeleted={() => setEditPhoto("")}
                                      onError={(msg) => setNotice({ tone: "error", text: msg })}
                                      token={token || ""}
                                      folder="leaders"
                                      targetChurchId={dioceseChurches[0]?.church_id || expandedId || undefined}
                                      size={64}
                                      fallback={<span style={{ fontSize: "0.9rem", opacity: 0.5 }}>📷</span>}
                                    />
                                  </div>
                                  <label>Bio <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} rows={2} /></label>
                                  <div className="actions-row">
                                    <button className="btn btn-primary" onClick={saveLeaderEdit} disabled={busyKey === "update-diocese-leader"}>
                                      {busyKey === "update-diocese-leader" ? t("adminTabs.diocese.saving") : t("common.save")}
                                    </button>
                                    <button className="btn" onClick={() => setEditLeaderId(null)}>{t("common.cancel")}</button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                                    <div className="leadership-avatar-sm">
                                      {l.photo_url ? (
                                        <img src={l.photo_url} alt={l.full_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                                      ) : (
                                        <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", fontWeight: 600 }}>
                                          {l.full_name.charAt(0)}
                                        </span>
                                      )}
                                    </div>
                                    <div>
                                      <strong>{l.full_name}</strong>
                                      <span className="muted" style={{ display: "block", fontSize: "0.82rem" }}>{l.role}</span>
                                      {l.phone_number ? <span className="muted" style={{ fontSize: "0.8rem" }}>{l.phone_number}</span> : null}
                                      {l.email ? <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>{l.email}</span> : null}
                                      {l.bio ? <span className="muted" style={{ display: "block", fontSize: "0.8rem", marginTop: "0.2rem" }}>{l.bio}</span> : null}
                                    </div>
                                  </div>
                                  <div className="actions-row" style={{ marginTop: "0.5rem" }}>
                                    <button className="btn" onClick={() => startEditLeader(l)}>{t("common.edit")}</button>
                                    <button className="btn btn-danger" onClick={() => removeLeader(l.id)} disabled={busyKey === "remove-diocese-leader"}>
                                      {busyKey === "remove-diocese-leader" ? t("adminTabs.diocese.removing") : t("common.remove")}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState icon={<Crown size={32} />} title={t("adminTabs.diocese.emptyLeadersTitle")} description={t("adminTabs.diocese.emptyLeadersDescription")} />
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<Crown size={32} />} title={t("adminTabs.diocese.emptyDioceseTitle")} description={t("adminTabs.diocese.emptyDioceseDescription")} />
      )}
    </article>
  );
}
