import { useState, useCallback } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import SearchSelect, { type SearchSelectOption } from "../../components/SearchSelect";
import type { MemberRow } from "../../types";
import { isUuid } from "../../types";
import { useI18n } from "../../i18n";

export default function RestoreTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [restoreType, setRestoreType] = useState<"member" | "church">("member");
  const [restoreId, setRestoreId] = useState("");
  const [relinkMemberId, setRelinkMemberId] = useState("");
  const [relinkIdentifier, setRelinkIdentifier] = useState("");

  const searchMembers = useCallback(async (query: string): Promise<SearchSelectOption[]> => {
    const churchId = isSuperAdmin ? (churches[0]?.id || "") : (authContext?.auth.church_id || "");
    if (!churchId) return [];
    const rows = await apiRequest<MemberRow[]>(
      `/api/members/search?church_id=${encodeURIComponent(churchId)}&query=${encodeURIComponent(query)}`,
      { token },
    );
    return rows.map((m) => ({ id: m.id, label: m.full_name || m.phone_number || m.email, sub: m.phone_number || m.email }));
  }, [token, isSuperAdmin, churches, authContext]);

  async function handleRestore() {
    if (!restoreId.trim() || !isUuid(restoreId.trim())) { setNotice({ tone: "error", text: t("adminTabs.restore.errorValidIdRequired") }); return; }
    const endpoint = restoreType === "member"
      ? `/api/ops/members/${encodeURIComponent(restoreId.trim())}/restore`
      : `/api/ops/churches/${encodeURIComponent(restoreId.trim())}/restore`;
    await withAuthRequest("restore-entity", async () => {
      await apiRequest(endpoint, { method: "POST", token });
      setRestoreId("");
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
