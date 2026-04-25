import { useState, useEffect, useCallback } from "react";
import { Megaphone, Plus, Pencil, Trash2, X, Eraser } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

interface AnnouncementRow {
  id: string;
  church_id: string;
  title: string;
  message: string;
  created_by: string | null;
  created_at: string;
}

export default function AnnouncementsTab() {
  const { t } = useI18n();
  const { token, setNotice, openOperationConfirmDialog } = useApp();

  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const loadItems = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<AnnouncementRow[]>("/api/announcements/list?limit=200", { token });
      setItems(data || []);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.announcements.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  function openCreate() {
    setEditingId(null);
    setFormTitle("");
    setFormMessage("");
    setShowForm(true);
  }

  function openEdit(item: AnnouncementRow) {
    setEditingId(item.id);
    setFormTitle(item.title);
    setFormMessage(item.message);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormTitle("");
    setFormMessage("");
  }

  async function handleSave() {
    if (!formTitle.trim() || !formMessage.trim()) {
      setNotice({ tone: "error", text: t("adminTabs.announcements.errorTitleMessageRequired") });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiRequest(`/api/ops/announcements/${editingId}`, {
          method: "PATCH",
          token,
          body: { title: formTitle.trim(), message: formMessage.trim() },
        });
        setNotice({ tone: "success", text: t("adminTabs.announcements.successUpdated") });
      } else {
        await apiRequest("/api/announcements/post", {
          method: "POST",
          token,
          body: { title: formTitle.trim(), message: formMessage.trim() },
        });
        setNotice({ tone: "success", text: t("adminTabs.announcements.successPosted") });
      }
      closeForm();
      void loadItems();
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.announcements.errorSaveFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!token) return;
    try {
      await apiRequest(`/api/ops/announcements/${id}`, { method: "DELETE", token });
      setNotice({ tone: "success", text: t("adminTabs.announcements.successDeleted") });
      void loadItems();
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.announcements.errorDeleteFailed") });
    }
  }

  async function handleClearAll() {
    if (!token || !items.length) return;
    openOperationConfirmDialog(
      t("adminTabs.announcements.clearAllTitle"),
      t("adminTabs.announcements.clearAllMessage"),
      t("adminTabs.announcements.clearAllConfirmWord"),
      async () => {
        try {
          await apiRequest("/api/ops/announcements", { method: "DELETE", token });
          setNotice({ tone: "success", text: t("adminTabs.announcements.successCleared") });
          setItems([]);
          setPage(1);
        } catch {
          setNotice({ tone: "error", text: t("adminTabs.announcements.errorClearFailed") });
        }
      },
    );
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.announcements.title")}</h3>
      <p className="muted">{t("adminTabs.announcements.description")}</p>

      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <button className="btn" onClick={() => void loadItems()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={16} /> {t("adminTabs.announcements.newAnnouncement")}
        </button>
        {items.length > 0 && (
          <button className="btn btn-danger" onClick={handleClearAll}>
            <Eraser size={16} /> {t("adminTabs.announcements.clearAll")}
          </button>
        )}
      </div>

      {showForm ? (
        <div style={{
          padding: "1rem",
          background: "var(--surface-container-lowest)",
          border: "1px solid var(--outline-variant)",
          borderRadius: "var(--radius-md)",
          marginBottom: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{editingId ? t("adminTabs.announcements.editAnnouncement") : t("adminTabs.announcements.newAnnouncement")}</strong>
            <button className="btn btn-ghost btn-sm" onClick={closeForm}><X size={16} /></button>
          </div>
          <label style={{ fontSize: "0.88rem" }}>
            {t("adminTabs.announcements.labelTitle")}
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder={t("adminTabs.announcements.placeholderTitle")}
              className="auth-input"
              style={{ marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: "0.88rem" }}>
            {t("adminTabs.announcements.labelMessage")}
            <textarea
              value={formMessage}
              onChange={(e) => setFormMessage(e.target.value)}
              placeholder={t("adminTabs.announcements.placeholderMessage")}
              rows={4}
              style={{ marginTop: 4, width: "100%", resize: "vertical" }}
            />
          </label>
          <div className="actions-row">
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t("common.saving") : editingId ? t("adminTabs.announcements.buttonUpdate") : t("adminTabs.announcements.buttonPost")}
            </button>
            <button className="btn" onClick={closeForm}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}

      {loading && !items.length ? (
        <LoadingSkeleton lines={4} />
      ) : items.length ? (
        <>
          {paginate(items, page, 10).map((item) => (
            <div key={item.id} className="activity-event-row" style={{ flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{item.title}</strong>
                <p style={{ margin: "0.25rem 0", fontSize: "0.88rem", color: "var(--on-surface-variant)" }}>{item.message}</p>
                <span className="event-meta">{formatDate(item.created_at)}</span>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(item)} title={t("common.edit")}>
                  <Pencil size={14} />
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item.id)} title={t("common.delete")}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          <Pagination page={page} total={totalPages(items.length, 10)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<Megaphone size={32} />} title={t("adminTabs.announcements.emptyTitle")} description={t("adminTabs.announcements.emptyDescription")} />
      )}
    </article>
  );
}
