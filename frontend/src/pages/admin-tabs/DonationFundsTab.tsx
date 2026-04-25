import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Edit, Save, X, GripVertical, Heart } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import { useI18n } from "../../i18n";

type DonationFund = {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export default function DonationFundsTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, churches, setNotice, busyKey, withAuthRequest, openOperationConfirmDialog } = useApp();

  // ── Church selector (super admin) ──
  const [selectedChurchId, setSelectedChurchId] = useState("");

  // ── Funds ──
  const [funds, setFunds] = useState<DonationFund[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Form state ──
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSortOrder, setFormSortOrder] = useState(0);

  // ── Auto-select church for super admin ──
  useEffect(() => {
    if (isSuperAdmin && churches.length && !selectedChurchId) {
      setSelectedChurchId(churches[0].id);
    }
  }, [isSuperAdmin, churches, selectedChurchId]);

  // ── Load funds ──
  const loadFunds = useCallback(async () => {
    if (!token) return;
    const qp = isSuperAdmin ? `?church_id=${encodeURIComponent(selectedChurchId)}` : "";
    if (isSuperAdmin && !selectedChurchId) return;
    setLoading(true);
    try {
      const data = await apiRequest<DonationFund[]>(`/api/donation-funds${qp}`, { token });
      setFunds(data);
    } catch {
      setNotice({ text: t("adminTabs.donationFunds.errorLoadFailed"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [token, isSuperAdmin, selectedChurchId, setNotice]);

  useEffect(() => { void loadFunds(); }, [loadFunds]);

  // ── Reset form ──
  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormDescription("");
    setFormSortOrder(0);
  }

  // ── Start editing ──
  function startEdit(fund: DonationFund) {
    setEditingId(fund.id);
    setFormName(fund.name);
    setFormDescription(fund.description || "");
    setFormSortOrder(fund.sort_order);
    setShowForm(true);
  }

  // ── Save (create or update) ──
  async function handleSave() {
    if (!formName.trim()) {
      setNotice({ text: t("adminTabs.donationFunds.errorNameRequired"), tone: "error" });
      return;
    }
    const key = editingId ? `update-fund-${editingId}` : "create-fund";
    await withAuthRequest(key, async () => {
      if (editingId) {
        await apiRequest(`/api/donation-funds/${editingId}`, {
          method: "PUT",
          token,
          body: { name: formName.trim(), description: formDescription.trim() || null, sort_order: formSortOrder },
        });
      } else {
        const body: Record<string, unknown> = {
          name: formName.trim(),
          description: formDescription.trim() || null,
          sort_order: formSortOrder,
        };
        if (isSuperAdmin) body.church_id = selectedChurchId;
        await apiRequest("/api/donation-funds", { method: "POST", token, body });
      }
      resetForm();
      await loadFunds();
    }, editingId ? t("adminTabs.donationFunds.successFundUpdated") : t("adminTabs.donationFunds.successFundCreated"));
  }

  // ── Toggle active ──
  async function toggleActive(fund: DonationFund) {
    await withAuthRequest(`toggle-fund-${fund.id}`, async () => {
      await apiRequest(`/api/donation-funds/${fund.id}`, {
        method: "PUT",
        token,
        body: { is_active: !fund.is_active },
      });
      await loadFunds();
    }, fund.is_active ? t("adminTabs.donationFunds.successFundDeactivated") : t("adminTabs.donationFunds.successFundActivated"));
  }

  // ── Delete ──
  async function handleDelete(fund: DonationFund) {
    openOperationConfirmDialog(
      t("adminTabs.donationFunds.confirmDeleteTitle"),
      t("adminTabs.donationFunds.confirmDeleteMessage", { name: fund.name }),
      t("adminTabs.donationFunds.confirmDeleteKeyword"),
      async () => {
        await withAuthRequest(`delete-fund-${fund.id}`, async () => {
          await apiRequest(`/api/donation-funds/${fund.id}`, { method: "DELETE", token });
          await loadFunds();
        }, t("adminTabs.donationFunds.successFundDeleted"));
      },
    );
  }

  return (
    <article className="panel">
      <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Heart size={20} /> {t("adminTabs.donationFunds.title")}
      </h3>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        {t("adminTabs.donationFunds.description")}
      </p>

      {/* ── Church selector (super admin only) ── */}
      {isSuperAdmin ? (
        <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <label style={{ fontWeight: 600 }}>{t("admin.church")}:</label>
          <select
            value={selectedChurchId}
            onChange={(e) => setSelectedChurchId(e.target.value)}
            style={{ padding: "0.4rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border, #e2e8f0)", minWidth: 200 }}
          >
            {churches.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      ) : null}

      {/* ── Add button ── */}
      <div style={{ marginBottom: "1rem" }}>
        <button
          className="btn btn-primary"
          onClick={() => { resetForm(); setShowForm(true); }}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
        >
          <Plus size={16} /> {t("adminTabs.donationFunds.addFund")}
        </button>
      </div>

      {/* ── Inline form ── */}
      {showForm ? (
        <div style={{
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 8,
          padding: "1rem",
          marginBottom: "1rem",
          background: "var(--surface-1, #f8fafc)",
        }}>
          <h4 style={{ margin: "0 0 0.75rem" }}>{editingId ? t("adminTabs.donationFunds.editFund") : t("adminTabs.donationFunds.newFund")}</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{t("adminTabs.donationFunds.labelName")}</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("adminTabs.donationFunds.placeholderName")}
                maxLength={100}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border, #e2e8f0)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{t("adminTabs.donationFunds.labelDescription")}</label>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder={t("adminTabs.donationFunds.placeholderDescription")}
                maxLength={500}
                style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border, #e2e8f0)" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: 4 }}>{t("adminTabs.donationFunds.labelSortOrder")}</label>
              <input
                type="number"
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(Number(e.target.value))}
                min={0}
                style={{ width: 100, padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border, #e2e8f0)" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={busyKey.startsWith("create-fund") || busyKey.startsWith("update-fund")}
                style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}
              >
                <Save size={14} /> {editingId ? t("adminTabs.donationFunds.buttonUpdate") : t("adminTabs.donationFunds.buttonCreate")}
              </button>
              <button className="btn btn-ghost" onClick={resetForm}>
                <X size={14} /> {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Funds list ── */}
      {loading ? (
        <LoadingSkeleton />
      ) : funds.length === 0 ? (
        <EmptyState icon={<Heart size={32} />} title={t("adminTabs.donationFunds.emptyTitle")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {funds.map((fund) => (
            <div
              key={fund.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 8,
                background: fund.is_active ? "var(--surface, #fff)" : "var(--surface-1, #f1f5f9)",
                opacity: fund.is_active ? 1 : 0.6,
              }}
            >
              <GripVertical size={16} style={{ color: "var(--on-surface-variant, #94a3b8)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  {fund.name}
                  {!fund.is_active ? (
                    <span style={{ fontSize: "0.75rem", padding: "2px 8px", borderRadius: 12, background: "#fef2f2", color: "#991b1b" }}>
                      {t("adminTabs.donationFunds.badgeInactive")}
                    </span>
                  ) : null}
                </div>
                {fund.description ? <div className="muted" style={{ fontSize: "0.85rem" }}>{fund.description}</div> : null}
              </div>
              <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  title={fund.is_active ? t("adminTabs.donationFunds.deactivate") : t("adminTabs.donationFunds.activate")}
                  onClick={() => void toggleActive(fund)}
                  disabled={busyKey === `toggle-fund-${fund.id}`}
                  style={{ fontSize: "0.8rem", padding: "4px 8px" }}
                >
                  {fund.is_active ? t("adminTabs.donationFunds.deactivate") : t("adminTabs.donationFunds.activate")}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Edit"
                  onClick={() => startEdit(fund)}
                  style={{ padding: "4px 6px" }}
                >
                  <Edit size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Delete"
                  onClick={() => void handleDelete(fund)}
                  disabled={busyKey === `delete-fund-${fund.id}`}
                  style={{ padding: "4px 6px", color: "#dc2626" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
