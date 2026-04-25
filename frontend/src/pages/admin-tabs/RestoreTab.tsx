import { useState, useCallback, useEffect } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow } from "../../types";
import { isUuid, formatDate } from "../../types";
import { useI18n } from "../../i18n";

type DeletedMember = { id: string; full_name: string; email?: string; phone_number?: string; membership_id?: string; deleted_at: string };

export default function RestoreTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [restoreType, setRestoreType] = useState<"member" | "church">("member");
  const [restoreId, setRestoreId] = useState("");
  const [relinkMemberId, setRelinkMemberId] = useState("");
  const [relinkIdentifier, setRelinkIdentifier] = useState("");
  const [deletedMembers, setDeletedMembers] = useState<DeletedMember[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");

  const loadDeletedMembers = useCallback(async () => {
    if (!token || !churchId) return;
    setDeletedLoading(true);
    try {
      const data = await apiRequest<DeletedMember[]>(
        `/api/ops/members/deleted?church_id=${encodeURIComponent(churchId)}`,
        { token },
      );
      setDeletedMembers(data || []);
    } catch {
      // silently ignore
    } finally {
      setDeletedLoading(false);
    }
  }, [token, churchId]);

  useEffect(() => { void loadDeletedMembers(); }, [loadDeletedMembers]);

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.phone_number || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  async function handleRestore(id?: string) {
    const targetId = id || restoreId.trim();
    if (!targetId || !isUuid(targetId)) { setNotice({ tone: "error", text: t("adminTabs.restore.errorValidIdRequired") }); return; }
    const endpoint = restoreType === "member" || id
      ? `/api/ops/members/${encodeURIComponent(targetId)}/restore`
      : `/api/ops/churches/${encodeURIComponent(targetId)}/restore`;
    await withAuthRequest("restore-entity", async () => {
      await apiRequest(endpoint, { method: "POST", token, body: { church_id: churchId } });
      setRestoreId("");
      if (id) {
        setDeletedMembers((prev) => prev.filter((m) => m.id !== id));
      }
    }, t("adminTabs.restore.successRestored"));
  }

  async function handleRelink() {
    if (!relinkMemberId.trim() || !isUuid(relinkMemberId.trim())) { setNotice({ tone: "error", text: t("adminTabs.restore.errorValidMemberId") }); return; }
    if (!relinkIdentifier.trim()) { setNotice({ tone: "error", text: t("adminTabs.restore.errorPhoneOrEmailRequired") }); return; }
    const trimmed = relinkIdentifier.trim();
    const isPhone = /^\+?\d[\d\s-]{6,14}$/.test(trimmed.replace(/[\s-]/g, ""));
    await withAuthRequest("relink-auth", async () => {
      await apiRequest(`/api/ops/members/${encodeURIComponent(relinkMemberId.trim())}/relink-auth`, {
        method: "POST", token, body: isPhone ? { new_phone: trimmed } : { new_email: trimmed },
      });
      setRelinkMemberId(""); setRelinkIdentifier("");
    }, t("adminTabs.restore.successRelinked"));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.restore.titleRestore")}</h3>
      <p className="muted">{t("adminTabs.restore.descriptionRestore")}</p>

      {/* Recently Deleted Members List */}
      {deletedMembers.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h4 style={{ marginBottom: "0.5rem" }}>{t("adminTabs.restore.recentlyDeletedTitle")}</h4>
          <div style={{ maxHeight: "300px", overflowY: "auto" }}>
            {deletedMembers.map((m) => (
              <div key={m.id} className="activity-event-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--border-color, #eee)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>{m.full_name}</strong>
                  <span className="muted" style={{ marginLeft: 8 }}>{m.phone_number || m.email || ""}</span>
                  {m.membership_id ? <span className="muted" style={{ marginLeft: 8 }}>#{m.membership_id}</span> : null}
                  <span className="muted" style={{ marginLeft: 8, fontSize: "0.8rem" }}>{t("adminTabs.restore.deletedLabel")} {formatDate(m.deleted_at)}</span>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => void handleRestore(m.id)} disabled={busyKey === "restore-entity"}>
                  {t("adminTabs.restore.restoreShort")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {deletedLoading && <p className="muted">{t("adminTabs.restore.loadingDeleted")}</p>}

      <div className="field-stack">
        <label>
          {t("adminTabs.restore.entityTypeLabel")}
          <select value={restoreType} onChange={(e) => setRestoreType(e.target.value as "member" | "church")}>
            <option value="member">{t("adminTabs.restore.entityTypeMember")}</option>
            <option value="church">{t("adminTabs.restore.entityTypeChurch")}</option>
          </select>
        </label>
        <label>
          {t("adminTabs.restore.entityIdLabel")}
          <input value={restoreId} onChange={(e) => setRestoreId(e.target.value)} placeholder={t("adminTabs.restore.entityIdPlaceholder")} />
        </label>
        <button className="btn btn-primary" onClick={() => void handleRestore()} disabled={busyKey === "restore-entity"}>
          {busyKey === "restore-entity" ? t("adminTabs.restore.restoring") : t("adminTabs.restore.restoreButton")}
        </button>
      </div>

      <hr style={{ margin: "2rem 0", opacity: 0.2 }} />

      <h3>{t("adminTabs.restore.titleRelink")}</h3>
      <p className="muted">{t("adminTabs.restore.descriptionRelink")}</p>
      <div className="field-stack">
        <label>
          {t("adminTabs.restore.entityTypeMember")}
          <SearchSelect placeholder={t("adminTabs.restore.memberSearchPlaceholder")} onSearch={searchMembers} value={relinkMemberId} onSelect={(opt) => setRelinkMemberId(opt.id)} onClear={() => setRelinkMemberId("")} />
        </label>
        <label>
          {t("adminTabs.restore.newEmailLabel")}
          <input value={relinkIdentifier} onChange={(e) => setRelinkIdentifier(e.target.value)} placeholder={t("adminTabs.restore.relinkPlaceholder")} />
        </label>
        <button className="btn btn-primary" onClick={() => void handleRelink()} disabled={busyKey === "relink-auth"}>
          {busyKey === "relink-auth" ? t("adminTabs.restore.relinking") : t("adminTabs.restore.relinkButton")}
        </button>
      </div>
    </article>
  );
}
