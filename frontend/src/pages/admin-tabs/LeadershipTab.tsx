import { useState, useEffect, useCallback } from "react";
import { Crown } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import PhotoUpload from "../../components/PhotoUpload";
import ValidatedInput, { validatePhone, validateEmail } from "../../components/ValidatedInput";
import type { LeadershipRoleRow, ChurchLeadershipRow, ChurchRow } from "../../types";
import { normalizeIndianPhone, stripIndianPrefix } from "../../types";
import { useI18n } from "../../i18n";

export default function LeadershipTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [leadershipRoles, setLeadershipRoles] = useState<LeadershipRoleRow[]>([]);
  const [churchLeaders, setChurchLeaders] = useState<ChurchLeadershipRow[]>([]);
  const [leadershipLoading, setLeadershipLoading] = useState(false);
  const [leadershipChurchId, setLeadershipChurchId] = useState("");

  // New leader form
  const [newLeaderRoleId, setNewLeaderRoleId] = useState("");
  const [newLeaderName, setNewLeaderName] = useState("");
  const [newLeaderPhone, setNewLeaderPhone] = useState("");
  const [newLeaderEmail, setNewLeaderEmail] = useState("");
  const [newLeaderBio, setNewLeaderBio] = useState("");
  const [newLeaderPhotoUrl, setNewLeaderPhotoUrl] = useState("");
  const [newCustomRoleName, setNewCustomRoleName] = useState("");
  const [newCustomHierarchyLevel, setNewCustomHierarchyLevel] = useState<number | "">("");

  // Edit leader form
  const [editingLeaderId, setEditingLeaderId] = useState<string | null>(null);
  const [editLeaderName, setEditLeaderName] = useState("");
  const [editLeaderPhone, setEditLeaderPhone] = useState("");
  const [editLeaderEmail, setEditLeaderEmail] = useState("");
  const [editLeaderBio, setEditLeaderBio] = useState("");
  const [editLeaderPhotoUrl, setEditLeaderPhotoUrl] = useState("");
  const [editCustomRoleName, setEditCustomRoleName] = useState("");
  const [editCustomHierarchyLevel, setEditCustomHierarchyLevel] = useState<number | "">("");

  const isNewOtherRole = leadershipRoles.find((r) => r.id === newLeaderRoleId)?.name === "Other";

  const resolvedChurchId = leadershipChurchId || authContext?.profile?.church_id || "";

  const loadData = useCallback(async () => {
    if (!token || !resolvedChurchId) return;
    setLeadershipLoading(true);
    try {
      const [roles, leaders] = await Promise.all([
        apiRequest<LeadershipRoleRow[]>("/api/leadership/roles", { token }),
        apiRequest<ChurchLeadershipRow[]>(`/api/leadership/church/${encodeURIComponent(resolvedChurchId)}`, { token }),
      ]);
      setLeadershipRoles(roles);
      setChurchLeaders(leaders);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.leadership.errorLoadFailed") });
    } finally {
      setLeadershipLoading(false);
    }
  }, [token, resolvedChurchId, setNotice]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function assignLeader() {
    if (!newLeaderName.trim() || !newLeaderRoleId) {
      setNotice({ tone: "error", text: t("adminTabs.leadership.errorNameRoleRequired") });
      return;
    }
    if (isNewOtherRole && (!newCustomRoleName.trim() || newCustomHierarchyLevel === "")) {
      setNotice({ tone: "error", text: t("adminTabs.leadership.errorCustomRoleRequired") });
      return;
    }
    const phoneErr = validatePhone(newLeaderPhone);
    if (phoneErr) { setNotice({ tone: "error", text: phoneErr }); return; }
    const emailErr = validateEmail(newLeaderEmail);
    if (emailErr) { setNotice({ tone: "error", text: emailErr }); return; }
    await withAuthRequest("assign-leader", async () => {
      await apiRequest("/api/leadership/assign", {
        method: "POST", token,
        body: {
          church_id: resolvedChurchId,
          role_id: newLeaderRoleId,
          full_name: newLeaderName.trim(),
          phone_number: newLeaderPhone.trim() ? normalizeIndianPhone(newLeaderPhone) : undefined,
          email: newLeaderEmail.trim() || undefined,
          bio: newLeaderBio.trim() || undefined,
          photo_url: newLeaderPhotoUrl.trim() || undefined,
          custom_role_name: isNewOtherRole ? newCustomRoleName.trim() : undefined,
          custom_hierarchy_level: isNewOtherRole && newCustomHierarchyLevel !== "" ? Number(newCustomHierarchyLevel) : undefined,
        },
      });
      setNewLeaderName(""); setNewLeaderPhone(""); setNewLeaderEmail("");
      setNewLeaderBio(""); setNewLeaderPhotoUrl(""); setNewLeaderRoleId("");
      setNewCustomRoleName(""); setNewCustomHierarchyLevel("");
      void loadData();
    }, t("adminTabs.leadership.successAssigned"));
  }

  function startEdit(leader: ChurchLeadershipRow) {
    setEditingLeaderId(leader.id);
    setEditLeaderName(leader.full_name);
    setEditLeaderPhone(stripIndianPrefix(leader.phone_number || ""));
    setEditLeaderEmail(leader.email || "");
    setEditLeaderBio(leader.bio || "");
    setEditLeaderPhotoUrl(leader.photo_url || "");
    setEditCustomRoleName(leader.custom_role_name || "");
    setEditCustomHierarchyLevel(leader.custom_hierarchy_level ?? "");
  }

  const editingLeader = churchLeaders.find((l) => l.id === editingLeaderId);
  const isEditOtherRole = editingLeader ? leadershipRoles.find((r) => r.id === editingLeader.role_id)?.name === "Other" : false;

  async function saveEdit() {
    if (!editingLeaderId || !editLeaderName.trim()) return;
    const phoneErr = validatePhone(editLeaderPhone);
    if (phoneErr) { setNotice({ tone: "error", text: phoneErr }); return; }
    const emailErr = validateEmail(editLeaderEmail);
    if (emailErr) { setNotice({ tone: "error", text: emailErr }); return; }
    await withAuthRequest("update-leader", async () => {
      await apiRequest(`/api/leadership/${encodeURIComponent(editingLeaderId!)}`, {
        method: "PATCH", token,
        body: {
          church_id: resolvedChurchId,
          full_name: editLeaderName.trim(),
          phone_number: editLeaderPhone.trim() ? normalizeIndianPhone(editLeaderPhone) : undefined,
          email: editLeaderEmail.trim() || undefined,
          bio: editLeaderBio.trim() || undefined,
          photo_url: editLeaderPhotoUrl.trim() || "",
          custom_role_name: isEditOtherRole ? editCustomRoleName.trim() : undefined,
          custom_hierarchy_level: isEditOtherRole && editCustomHierarchyLevel !== "" ? Number(editCustomHierarchyLevel) : undefined,
        },
      });
      setEditingLeaderId(null);
      void loadData();
    }, t("adminTabs.leadership.successUpdated"));
  }

  async function remove(id: string) {
    await withAuthRequest("remove-leader", async () => {
      await apiRequest(`/api/leadership/${encodeURIComponent(id)}`, {
        method: "DELETE", token,
        body: { church_id: resolvedChurchId },
      });
      void loadData();
    }, t("adminTabs.leadership.successRemoved"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.leadership.title")}</h3>
      <p className="muted">{t("adminTabs.leadership.description")}</p>

      {isSuperAdmin ? (
        <div className="field-stack" style={{ marginBottom: "1.5rem" }}>
          <label>
            Church
            <select value={leadershipChurchId} onChange={(e) => setLeadershipChurchId(e.target.value)}>
              <option value="">{t("adminTabs.leadership.selectChurchOption")}</option>
              {churches.map((c: ChurchRow) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {resolvedChurchId ? (
        <>
          <div className="field-stack" style={{ borderBottom: "1px solid var(--border, #e5e7eb)", paddingBottom: "1.25rem", marginBottom: "1.25rem" }}>
            <h4 style={{ margin: 0 }}>{t("adminTabs.leadership.assignNewLeader")}</h4>
            <label>{t("adminTabs.leadership.roleLabel")} <select value={newLeaderRoleId} onChange={(e) => setNewLeaderRoleId(e.target.value)}>
              <option value="">{t("adminTabs.leadership.selectRoleOption")}</option>
              {leadershipRoles.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({t("adminTabs.leadership.levelPrefix")} {r.hierarchy_level}){r.is_pastor_role ? " — Pastoral" : ""}</option>
              ))}
            </select></label>
            {isNewOtherRole ? (
              <>
                <label>{t("adminTabs.leadership.customRoleNameLabel")} <input type="text" value={newCustomRoleName} onChange={(e) => setNewCustomRoleName(e.target.value)} placeholder={t("adminTabs.leadership.customRoleNamePlaceholder")} /></label>
                <label>{t("adminTabs.leadership.hierarchyLevelLabel")} <input type="number" min={1} max={20} value={newCustomHierarchyLevel} onChange={(e) => setNewCustomHierarchyLevel(e.target.value ? Number(e.target.value) : "")} placeholder={t("adminTabs.leadership.hierarchyLevelPlaceholder")} /></label>
              </>
            ) : null}
            <label>{t("adminTabs.leadership.fullNameLabel")} <input type="text" value={newLeaderName} onChange={(e) => setNewLeaderName(e.target.value)} placeholder={t("adminTabs.leadership.fullNamePlaceholder")} /></label>
            <ValidatedInput type="phone" value={newLeaderPhone} onChange={setNewLeaderPhone} placeholder="+91..." label={t("adminTabs.leadership.phoneLabel")} />
            <ValidatedInput type="email" value={newLeaderEmail} onChange={setNewLeaderEmail} placeholder="name@example.com" label={t("adminTabs.leadership.emailLabel")} />
            <div><span className="field-label">{t("adminTabs.leadership.photoLabel")}</span>
              <PhotoUpload
                currentUrl={newLeaderPhotoUrl}
                onUploaded={(url) => { setNewLeaderPhotoUrl(url); setNotice({ tone: "success", text: "Photo uploaded successfully" }); }}
                onDeleted={() => setNewLeaderPhotoUrl("")}
                onError={(msg) => setNotice({ tone: "error", text: msg })}
                token={token || ""}
                folder="leaders"
                targetChurchId={isSuperAdmin ? resolvedChurchId : undefined}
                size={64}
                fallback={<span style={{ fontSize: "0.9rem", opacity: 0.5 }}>📷</span>}
              />
            </div>
            <label>{t("adminTabs.leadership.bioLabel")} <textarea value={newLeaderBio} onChange={(e) => setNewLeaderBio(e.target.value)} placeholder={t("adminTabs.leadership.bioPlaceholder")} rows={2} /></label>
            <div className="actions-row">
              <button className="btn btn-primary" onClick={assignLeader} disabled={busyKey === "assign-leader"}>
                {busyKey === "assign-leader" ? t("adminTabs.leadership.assigning") : t("adminTabs.leadership.assignLeader")}
              </button>
            </div>
          </div>

          <div className="actions-row" style={{ marginBottom: "1rem" }}>
            <button className="btn" onClick={() => void loadData()} disabled={leadershipLoading}>
              {leadershipLoading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>

          {leadershipLoading && !churchLeaders.length ? (
            <LoadingSkeleton lines={4} />
          ) : churchLeaders.length ? (
            <div className="list-stack">
              {churchLeaders.map((leader) => (
                <div key={leader.id} className="list-item" style={{ position: "relative" }}>
                  {editingLeaderId === leader.id ? (
                    <div className="field-stack" style={{ width: "100%" }}>
                      <label>Name <input type="text" value={editLeaderName} onChange={(e) => setEditLeaderName(e.target.value)} /></label>
                      <ValidatedInput type="phone" value={editLeaderPhone} onChange={setEditLeaderPhone} label={t("adminTabs.leadership.phoneLabel")} />
                      <ValidatedInput type="email" value={editLeaderEmail} onChange={setEditLeaderEmail} label={t("adminTabs.leadership.emailLabel")} />
                      <div><span className="field-label">{t("adminTabs.leadership.photoLabel")}</span>
                        <PhotoUpload
                          currentUrl={editLeaderPhotoUrl}
                          onUploaded={(url) => { setEditLeaderPhotoUrl(url); setNotice({ tone: "success", text: "Photo updated successfully" }); }}
                          onDeleted={() => setEditLeaderPhotoUrl("")}
                          onError={(msg) => setNotice({ tone: "error", text: msg })}
                          token={token || ""}
                          folder="leaders"
                          targetChurchId={isSuperAdmin ? resolvedChurchId : undefined}
                          size={64}
                          fallback={<span style={{ fontSize: "0.9rem", opacity: 0.5 }}>📷</span>}
                        />
                      </div>
                      <label>{t("adminTabs.leadership.bioLabel")} <textarea value={editLeaderBio} onChange={(e) => setEditLeaderBio(e.target.value)} rows={2} /></label>
                      {isEditOtherRole ? (
                        <>
                          <label>Custom Role Name <input type="text" value={editCustomRoleName} onChange={(e) => setEditCustomRoleName(e.target.value)} placeholder={t("adminTabs.leadership.customRoleNamePlaceholder")} /></label>
                          <label>Hierarchy Level <input type="number" min={1} max={20} value={editCustomHierarchyLevel} onChange={(e) => setEditCustomHierarchyLevel(e.target.value ? Number(e.target.value) : "")} placeholder={t("adminTabs.leadership.hierarchyLevelPlaceholder")} /></label>
                        </>
                      ) : null}
                      <div className="actions-row">
                        <button className="btn btn-primary" onClick={saveEdit} disabled={busyKey === "update-leader"}>
                          {busyKey === "update-leader" ? t("adminTabs.diocese.saving") : t("common.save")}
                        </button>
                        <button className="btn" onClick={() => setEditingLeaderId(null)}>{t("common.cancel")}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <div className="leadership-avatar-sm">
                          {leader.photo_url ? (
                            <img src={leader.photo_url} alt={leader.full_name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--primary)", color: "var(--on-primary)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem", fontWeight: 600 }}>
                              {leader.full_name.charAt(0)}
                            </span>
                          )}
                        </div>
                        <div>
                          <strong>{leader.full_name}</strong>
                          <span className="muted" style={{ display: "block", fontSize: "0.82rem" }}>
                            {leader.role_name || "—"} {leader.is_pastor_role ? "🙏" : ""} · {t("adminTabs.leadership.levelPrefix")} {leader.hierarchy_level ?? "—"}
                          </span>
                          {leader.phone_number ? <span className="muted" style={{ fontSize: "0.8rem" }}>{leader.phone_number}</span> : null}
                          {leader.bio ? <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>{leader.bio}</span> : null}
                        </div>
                      </div>
                      <div className="actions-row" style={{ marginTop: "0.5rem" }}>
                        <button className="btn" onClick={() => startEdit(leader)}>{t("common.edit")}</button>
                        <button className="btn btn-danger" onClick={() => remove(leader.id)} disabled={busyKey === "remove-leader"}>
                          {busyKey === "remove-leader" ? t("adminTabs.leadership.removing") : t("common.remove")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Crown size={32} />} title={t("adminTabs.leadership.emptyTitle")} description={t("adminTabs.leadership.emptyDescription")} />
          )}
        </>
      ) : (
        <p className="muted">{t("adminTabs.leadership.selectChurchPrompt")}</p>
      )}
    </article>
  );
}
