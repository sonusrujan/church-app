import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import type { MemberRow, MemberDeleteImpact } from "../../types";
import { isUuid, formatAmount } from "../../types";
import { useI18n } from "../../i18n";

type DioceseOption = { id: string; name: string };

export default function MemberOpsTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches, openOperationConfirmDialog } = useApp();

  // Diocese filter (super admin only)
  const [dioceses, setDioceses] = useState<DioceseOption[]>([]);
  const [selectedDiocese, setSelectedDiocese] = useState("");
  const [filteredChurches, setFilteredChurches] = useState(churches);

  const [churchId, setChurchId] = useState(isSuperAdmin ? "" : (authContext?.auth.church_id || ""));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<MemberDeleteImpact | null>(null);
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"search" | "edit">("search");

  // Edit/Create form fields
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAltPhone, setEditAltPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editMembershipId, setEditMembershipId] = useState("");
  const [editStatus, setEditStatus] = useState("pending");
  const [editSubscriptionAmount, setEditSubscriptionAmount] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editOccupation, setEditOccupation] = useState("");
  const [editConfirmationTaken, setEditConfirmationTaken] = useState<boolean | null>(null);
  const [editAge, setEditAge] = useState("");

  const occupationOptions = [
    "Farmer", "Teacher", "Business", "Government Employee", "Private Employee",
    "Self Employed", "Student", "Retired", "Homemaker", "Pastor", "Other",
  ];

  useEffect(() => { setPage(1); }, [results]);

  // Load dioceses on mount (super admin only)
  useEffect(() => {
    if (!isSuperAdmin || !token) return;
    apiRequest<DioceseOption[]>("/api/diocese", { token }).then(setDioceses).catch((e) => console.warn("Failed to load dioceses", e));
  }, [isSuperAdmin, token]);

  // Filter churches by selected diocese
  useEffect(() => {
    if (!isSuperAdmin) {
      setFilteredChurches(churches);
      return;
    }
    if (!selectedDiocese) {
      setFilteredChurches(churches);
      return;
    }
    // Fetch churches for the selected diocese
    apiRequest<Array<{ church_id: string; church_name: string }>>(`/api/diocese/${selectedDiocese}/churches`, { token })
      .then((dioceseChurches) => {
        const ids = new Set(dioceseChurches.map((dc) => dc.church_id));
        setFilteredChurches(churches.filter((c) => ids.has(c.id)));
        // Reset church selection if current is not in list
        setChurchId((prev) => {
          if (prev && !ids.has(prev)) return "";
          return prev;
        });
      })
      .catch(() => setFilteredChurches(churches));
  }, [selectedDiocese, churches, isSuperAdmin, token]);

  const scopedChurchId = isSuperAdmin ? churchId.trim() : (authContext?.auth.church_id || "");
  const isAdmin = authContext?.auth.role === "admin";
  const canWrite = isSuperAdmin || isAdmin;

  function resetForm() {
    setEditName(""); setEditEmail(""); setEditPhone(""); setEditAltPhone("");
    setEditAddress(""); setEditMembershipId(""); setEditStatus("pending");
    setEditSubscriptionAmount(""); setEditGender(""); setEditDob("");
    setEditOccupation(""); setEditConfirmationTaken(null); setEditAge("");
    setSelectedId(""); setDeleteImpact(null);
  }

  function loadMemberIntoForm(m: MemberRow) {
    setSelectedId(m.id);
    setEditName(m.full_name || "");
    setEditEmail(m.email || "");
    setEditPhone(m.phone_number || "");
    setEditAltPhone(m.alt_phone_number || "");
    setEditAddress(m.address || "");
    setEditMembershipId(m.membership_id || "");
    setEditStatus(m.verification_status || "pending");
    setEditSubscriptionAmount(m.subscription_amount != null ? String(m.subscription_amount) : "");
    setEditGender(m.gender || "");
    setEditDob(m.dob || "");
    setEditOccupation(m.occupation || "");
    setEditConfirmationTaken(m.confirmation_taken ?? null);
    setEditAge(m.age != null ? String(m.age) : "");
    setMode("edit");
  }

  async function searchMembers() {
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: t("adminTabs.memberOps.errorSelectChurch") });
      return;
    }
    const rows = await withAuthRequest(
      "members-search",
      () => apiRequest<MemberRow[]>(
        `/api/members/search?church_id=${encodeURIComponent(scopedChurchId)}&query=${encodeURIComponent(query.trim())}`,
        { token },
      ),
      t("adminTabs.memberOps.successSearchComplete"),
    );
    if (!rows) return;
    setResults(rows);
    setMode("search");
    if (!rows.some((row) => row.id === selectedId)) {
      resetForm();
    }
  }

  async function fetchDetails(memberId: string) {
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: t("adminTabs.memberOps.errorSelectChurch") });
      return;
    }
    const member = await withAuthRequest(
      "member-detail",
      () => apiRequest<MemberRow>(`/api/members/${memberId}?church_id=${encodeURIComponent(scopedChurchId)}`, { token }),
      t("adminTabs.memberOps.successDetailsLoaded"),
    );
    if (!member) return;
    loadMemberIntoForm(member);
    setResults((cur) => {
      const rest = cur.filter((r) => r.id !== member.id);
      return [member, ...rest];
    });
  }

  async function updateMember() {
    if (!canWrite || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: t("adminTabs.memberOps.errorSelectChurch") });
      return;
    }
    const body: Record<string, unknown> = { church_id: scopedChurchId };
    if (editName.trim()) body.full_name = editName.trim();
    if (editEmail.trim()) body.email = editEmail.trim();
    if (editPhone.trim()) body.phone_number = editPhone.trim();
    if (editAltPhone.trim()) body.alt_phone_number = editAltPhone.trim();
    if (editAddress.trim()) body.address = editAddress.trim();
    if (editMembershipId.trim()) body.membership_id = editMembershipId.trim();
    if (editStatus.trim()) body.verification_status = editStatus.trim();
    if (editSubscriptionAmount.trim()) body.subscription_amount = parseFloat(editSubscriptionAmount) || 0;
    if (editGender.trim()) body.gender = editGender.trim();
    if (editDob.trim()) body.dob = editDob.trim();
    if (editOccupation) body.occupation = editOccupation;
    if (editConfirmationTaken !== null) body.confirmation_taken = editConfirmationTaken;
    if (editAge.trim()) body.age = Number(editAge);

    const updated = await withAuthRequest(
      "member-update",
      () => apiRequest<MemberRow>(`/api/members/${selectedId}`, {
        method: "PATCH", token, body,
      }),
      t("adminTabs.memberOps.successUpdated"),
    );
    if (updated) {
      loadMemberIntoForm(updated);
      setResults((cur) => cur.map((r) => (r.id === updated.id ? updated : r)));
    }
  }

  async function previewDelete() {
    if (!canWrite || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: t("adminTabs.memberOps.errorSelectChurch") });
      return;
    }
    const impact = await withAuthRequest(
      "member-impact",
      () => apiRequest<MemberDeleteImpact>(
        `/api/members/${selectedId}/delete-impact?church_id=${encodeURIComponent(scopedChurchId)}`,
        { token },
      ),
      t("adminTabs.memberOps.successImpactLoaded"),
    );
    if (impact) setDeleteImpact(impact);
  }

  async function deleteMember() {
    if (!canWrite || !selectedId) return;
    if (!scopedChurchId || !isUuid(scopedChurchId)) {
      setNotice({ tone: "error", text: t("adminTabs.memberOps.errorSelectChurch") });
      return;
    }
    const result = await withAuthRequest(
      "member-delete",
      () => apiRequest<{ deleted: true; id: string }>(`/api/members/${selectedId}`, {
        method: "DELETE", token, body: { church_id: scopedChurchId, confirm: true },
      }),
      t("adminTabs.memberOps.successDeleted"),
    );
    if (!result) return;
    setResults((cur) => cur.filter((r) => r.id !== selectedId));
    resetForm();
    setMode("search");
  }

  const formFields = (
    <div className="field-stack" style={{ gap: "0.5rem" }}>
      <label>{t("adminTabs.memberOps.labelFullName")} *
        <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("adminTabs.memberOps.placeholderFullName")} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <label>{t("adminTabs.memberOps.labelEmail")}
          <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder={t("adminTabs.memberOps.placeholderEmail")} />
        </label>
        <label>{t("adminTabs.memberOps.labelPhone")}
          <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+91 9876543210" />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: mode === "edit" ? "1fr 1fr" : "1fr", gap: "0.5rem" }}>
        {mode === "edit" && (
          <label>{t("adminTabs.memberOps.labelAltPhone")}
            <input type="tel" value={editAltPhone} onChange={(e) => setEditAltPhone(e.target.value)} placeholder="+91 9876543210" />
          </label>
        )}
        <label>{t("adminTabs.memberOps.labelMembershipId")}
          <input value={editMembershipId} onChange={(e) => setEditMembershipId(e.target.value)} placeholder="MEM-001" />
        </label>
      </div>
      <label>{t("adminTabs.memberOps.labelAddress")}
        <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder={t("adminTabs.memberOps.placeholderAddress")} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
        <label>{t("adminTabs.memberOps.labelOccupation")}
          <select value={editOccupation} onChange={(e) => setEditOccupation(e.target.value)}>
            <option value="">{t("adminTabs.memberOps.selectOccupation")}</option>
            {occupationOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>{t("adminTabs.memberOps.labelAge")}
          <input type="number" min="1" max="150" value={editAge} onChange={(e) => setEditAge(e.target.value)} placeholder={t("adminTabs.memberOps.placeholderAge")} />
        </label>
      </div>
      <label>{t("adminTabs.memberOps.labelConfirmationTaken")}
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.25rem" }}>
          <button type="button" className={`btn btn-sm ${editConfirmationTaken === true ? "btn-primary" : "btn-outline"}`} onClick={() => setEditConfirmationTaken(true)}>{t("common.yes")}</button>
          <button type="button" className={`btn btn-sm ${editConfirmationTaken === false ? "btn-primary" : "btn-outline"}`} onClick={() => setEditConfirmationTaken(false)}>{t("common.no")}</button>
        </div>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: mode === "edit" ? "1fr 1fr 1fr" : "1fr", gap: "0.5rem" }}>
        <label>{t("adminTabs.memberOps.labelSubscriptionAmount")}
          <input type="number" min="0" value={editSubscriptionAmount} onChange={(e) => setEditSubscriptionAmount(e.target.value)} placeholder="0" />
        </label>
        {mode === "edit" && (
          <>
            <label>{t("adminTabs.memberOps.labelGender")}
              <select value={editGender} onChange={(e) => setEditGender(e.target.value)}>
                <option value="">—</option>
                <option value="male">{t("adminTabs.memberOps.genderMale")}</option>
                <option value="female">{t("adminTabs.memberOps.genderFemale")}</option>
                <option value="other">{t("adminTabs.memberOps.genderOther")}</option>
              </select>
            </label>
            <label>{t("adminTabs.memberOps.labelDob")}
              <input type="date" value={editDob} onChange={(e) => setEditDob(e.target.value)} />
            </label>
          </>
        )}
      </div>
      {mode === "edit" && (
        <label>
          {t("adminTabs.memberOps.verificationStatusLabel")}
          <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
            <option value="pending">{t("adminTabs.memberOps.statusOptionPending")}</option>
            <option value="verified">{t("adminTabs.memberOps.statusOptionVerified")}</option>
            <option value="rejected">{t("adminTabs.memberOps.statusOptionRejected")}</option>
            <option value="suspended">{t("adminTabs.memberOps.statusOptionSuspended")}</option>
          </select>
        </label>
      )}
    </div>
  );

  return (
    <article className="panel">
      <h3>{t("adminTabs.memberOps.title")}</h3>
      <div className="field-stack">
        {/* Diocese + Church filters */}
        {isSuperAdmin ? (
          <>
            <label>
              {t("adminTabs.memberOps.labelDiocese")}
              <select value={selectedDiocese} onChange={(e) => setSelectedDiocese(e.target.value)}>
                <option value="">{t("adminTabs.memberOps.allDioceses")}</option>
                {dioceses.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              {t("admin.church")}
              <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
                <option value="">{t("admin.selectChurch")}</option>
                {filteredChurches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.unique_id || c.church_code || c.id.slice(0, 8)})</option>)}
              </select>
            </label>
          </>
        ) : null}

        {/* Search bar + action buttons */}
        <label>
          {t("admin.searchMember")}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.searchPlaceholder")}
            onKeyDown={(e) => { if (e.key === "Enter") searchMembers(); }} />
        </label>
        <div className="actions-row">
          <button className="btn" onClick={searchMembers} disabled={busyKey === "members-search"}>
            {busyKey === "members-search" ? t("common.searching") : t("admin.searchMembers")}
          </button>
        </div>

        {/* Results list */}
        {(
          <div className="list-stack">
            {results.length ? (
              <>
                <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "0.25rem" }}>
                  {t("adminTabs.memberOps.showingPage", { page, total: totalPages(results.length, 8), count: results.length })}
                </p>
                {paginate(results, page, 8).map((m) => (
                  <div key={m.id} className={`list-item${selectedId === m.id ? " list-item--selected" : ""}`}>
                    <strong>{m.full_name}</strong>
                    <span>{m.email || t("adminTabs.memberOps.noEmail")} · {m.phone_number || t("adminTabs.memberOps.noPhone")}</span>
                    <span>{m.membership_id || t("adminTabs.memberOps.noMembershipId")}{m.subscription_amount != null ? ` · ${formatAmount(m.subscription_amount)}` : ""}</span>
                    <span style={{ fontSize: "0.8rem" }}>
                      {t("adminTabs.memberOps.statusPrefix")}{" "}
                      <span role="status" aria-label={`${t("adminTabs.memberOps.statusPrefix")} ${m.verification_status || "pending"}`} style={{
                        fontWeight: 600, padding: "0.2rem 0.45rem", borderRadius: "4px",
                        background: m.verification_status === "verified" ? "var(--badge-success-bg, #e6f4ea)" : m.verification_status === "rejected" ? "var(--badge-error-bg, #fde8e8)" : m.verification_status === "suspended" ? "var(--badge-error-bg, #fde8e8)" : "var(--badge-warning-bg, #fff8e1)",
                        color: m.verification_status === "verified" ? "var(--badge-success-text, #1b7a3d)" : m.verification_status === "rejected" ? "var(--badge-error-text, #c0392b)" : m.verification_status === "suspended" ? "var(--badge-error-text, #c0392b)" : "var(--badge-warning-text, #b8860b)",
                      }}>
                        {m.verification_status || "pending"}
                      </span>
                    </span>
                    <div className="actions-row">
                      <button className="btn" onClick={() => void fetchDetails(m.id)}>{t("adminTabs.memberOps.editButton")}</button>
                    </div>
                  </div>
                ))}
                <Pagination page={page} total={totalPages(results.length, 8)} onPageChange={setPage} />
              </>
            ) : <EmptyState icon={<Users size={32} />} title={t("adminTabs.memberOps.emptyTitle")} description={t("adminTabs.memberOps.emptyDescription")} />}
          </div>
        )}

        {/* Edit Member Form */}
        {mode === "edit" && selectedId && canWrite ? (
          <div style={{ borderLeft: "3px solid var(--primary)", paddingLeft: "1rem", marginTop: "0.5rem" }}>
            <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.memberOps.editMemberTitle")}</h4>
            {formFields}
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button className="btn btn-primary" onClick={updateMember} disabled={busyKey === "member-update"}>
                {busyKey === "member-update" ? t("adminTabs.memberOps.updating") : t("adminTabs.memberOps.updateMember")}
              </button>
              <button className="btn" onClick={previewDelete} disabled={busyKey === "member-impact"}>
                {busyKey === "member-impact" ? t("common.loading") : t("adminTabs.memberOps.previewDeleteImpact")}
              </button>
              <button className="btn btn-danger" onClick={() => {
                const impactText = deleteImpact
                  ? `\n${t("adminTabs.memberOps.cascadingImpact")}: ${deleteImpact.family_members} family, ${deleteImpact.subscriptions} subscription(s), ${deleteImpact.payments} payment(s).`
                  : "";
                openOperationConfirmDialog(
                  t("adminTabs.memberOps.confirmDeleteTitle"),
                  t("adminTabs.memberOps.confirmDeleteMessage", { name: editName || "this member" }) + impactText,
                  t("adminTabs.memberOps.confirmDeleteKeyword"),
                  deleteMember,
                );
              }} disabled={busyKey === "member-delete"}>
                {busyKey === "member-delete" ? t("adminTabs.memberOps.deleting") : t("adminTabs.memberOps.deleteMember")}
              </button>
              <button className="btn" onClick={() => { resetForm(); setMode("search"); }}>{t("common.cancel")}</button>
            </div>
            {deleteImpact ? (
              <div className="notice notice-error" style={{ marginTop: "0.5rem" }}>
                {t("adminTabs.memberOps.cascadingImpact")}: Family {deleteImpact.family_members}, Subscriptions {deleteImpact.subscriptions}, Payments {deleteImpact.payments}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
