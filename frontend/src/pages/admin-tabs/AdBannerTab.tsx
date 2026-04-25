import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, ExternalLink, GripVertical, X } from "lucide-react";
import { apiRequest, apiUploadRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { AdBannerRow, DioceseRow } from "../../types";
import { useI18n } from "../../i18n";

export default function AdBannerTab() {
  const { t } = useI18n();
  const { token, setNotice, churches } = useApp();

  // ── Scope selector ──
  const [scope, setScope] = useState<"diocese" | "church">("diocese");
  const [dioceses, setDioceses] = useState<DioceseRow[]>([]);
  const [selectedScopeId, setSelectedScopeId] = useState("");

  // ── Banners ──
  const [banners, setBanners] = useState<AdBannerRow[]>([]);
  const [loading, setLoading] = useState(false);

  // ── New banner form ──
  const [showForm, setShowForm] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [uploading, setUploading] = useState(false);

  // ── Load dioceses ──
  useEffect(() => {
    if (!token) return;
    apiRequest<DioceseRow[]>("/api/diocese", { token })
      .then(setDioceses)
      .catch((e) => console.warn("Failed to load dioceses", e));
  }, [token]);

  // ── Auto-select first scope ID ──
  useEffect(() => {
    if (scope === "diocese" && dioceses.length && !selectedScopeId) {
      setSelectedScopeId(dioceses[0].id);
    } else if (scope === "church" && churches.length && !selectedScopeId) {
      setSelectedScopeId(churches[0].id);
    }
  }, [scope, dioceses, churches, selectedScopeId]);

  // ── Load banners for selected scope ──
  const loadBanners = useCallback(async () => {
    if (!token || !selectedScopeId) return;
    setLoading(true);
    try {
      const data = await apiRequest<AdBannerRow[]>(
        `/api/ad-banners?scope=${scope}&scope_id=${encodeURIComponent(selectedScopeId)}&active_only=false`,
        { token },
      );
      setBanners(data);
    } catch {
      setNotice({ text: t("adminTabs.adBanner.errorLoadBanners"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [token, scope, selectedScopeId, setNotice]);

  useEffect(() => {
    void loadBanners();
  }, [loadBanners]);

  // ── Upload banner media ──
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token || !selectedScopeId) return;

    // Auto-detect media type from file
    let detectedType: "image" | "video" | "gif" = "image";
    if (file.type.startsWith("video/")) detectedType = "video";
    else if (file.type === "image/gif") detectedType = "gif";

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "banners");
      form.append("target_church_id", selectedScopeId);

      const uploadPath = detectedType === "video"
        ? "/api/uploads/media"
        : "/api/uploads/image";

      const data = await apiUploadRequest<{ url: string }>(uploadPath, form, { token });
      await createBanner(data.url, detectedType);
    } catch {
      setNotice({ text: t("adminTabs.adBanner.errorUploadMedia"), tone: "error" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function createBanner(imageUrl: string, detectedType: "image" | "video" | "gif") {
    if (!token) return;
    try {
      await apiRequest("/api/ad-banners", {
        token,
        method: "POST",
        body: {
          scope,
          scope_id: selectedScopeId,
          image_url: imageUrl,
          link_url: linkUrl.trim() || null,
          sort_order: banners.length,
          media_type: detectedType,
          position,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        },
      });
      setLinkUrl("");
      setShowForm(false);
      setPosition("bottom");
      setStartDate("");
      setEndDate("");
      setNotice({ text: t("adminTabs.adBanner.successBannerAdded"), tone: "success" });
      void loadBanners();
    } catch {
      setNotice({ text: t("adminTabs.adBanner.errorCreateBanner"), tone: "error" });
    }
  }

  // ── Toggle active ──
  async function toggleActive(banner: AdBannerRow) {
    if (!token) return;
    try {
      await apiRequest(`/api/ad-banners/${banner.id}`, {
        token,
        method: "PATCH",
        body: { is_active: !banner.is_active },
      });
      void loadBanners();
    } catch {
      setNotice({ text: t("adminTabs.adBanner.errorUpdateBanner"), tone: "error" });
    }
  }

  // ── Delete ──
  async function deleteBanner(id: string) {
    if (!token) return;
    try {
      await apiRequest(`/api/ad-banners/${id}`, { token, method: "DELETE" });
      setNotice({ text: t("adminTabs.adBanner.successBannerDeleted"), tone: "success" });
      void loadBanners();
    } catch {
      setNotice({ text: t("adminTabs.adBanner.errorDeleteBanner"), tone: "error" });
    }
  }

  const scopeItems = scope === "diocese" ? dioceses : churches;

  return (
    <article className="panel">
      <h3>{t("adminTabs.adBanner.title")}</h3>
      <p className="muted">{t("adminTabs.adBanner.description")}</p>

      {/* Scope selector */}
      <div className="actions-row" style={{ flexWrap: "wrap", marginBottom: "0.5rem" }}>
        <select
          value={scope}
          onChange={(e) => { setScope(e.target.value as "diocese" | "church"); setSelectedScopeId(""); setBanners([]); }}
        >
          <option value="diocese">{t("adminTabs.adBanner.scopeDiocese")}</option>
          <option value="church">{t("adminTabs.adBanner.scopeChurch")}</option>
        </select>

        <select
          value={selectedScopeId}
          onChange={(e) => setSelectedScopeId(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">{t("common.select")} {scope}...</option>
          {scopeItems.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      {/* Banner list */}
      {loading ? (
        <LoadingSkeleton lines={4} />
      ) : !selectedScopeId ? (
        <EmptyState title={t("adminTabs.adBanner.selectScopeToManage", { scope })} />
      ) : banners.length === 0 && !showForm ? (
        <EmptyState title={t("adminTabs.adBanner.emptyTitle")} action={{ label: t("adminTabs.adBanner.addBanner"), onClick: () => setShowForm(true) }} />
      ) : (
        <>
          <div className="field-stack">
            {banners.map((banner) => (
              <div
                key={banner.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  padding: "0.75rem",
                  background: "var(--surface-container-low)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "var(--radius-md)",
                  opacity: banner.is_active ? 1 : 0.5,
                }}
              >
                <GripVertical size={16} style={{ color: "var(--outline)", flexShrink: 0 }} />
                {banner.media_type === "video" ? (
                  <video
                    src={banner.image_url}
                    muted
                    style={{ width: 120, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--outline-variant)" }}
                  />
                ) : (
                  <img
                    src={banner.image_url}
                    alt={t("adminTabs.adBanner.altBanner")}
                    style={{ width: 120, height: 60, objectFit: "cover", borderRadius: 6, border: "1px solid var(--outline-variant)" }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--on-surface-variant)" }}>
                    {banner.link_url ? (
                      <a href={banner.link_url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <ExternalLink size={12} /> {banner.link_url.slice(0, 50)}{banner.link_url.length > 50 ? "..." : ""}
                      </a>
                    ) : (
                      <span>{t("adminTabs.adBanner.noLink")}</span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--outline)", marginTop: 2 }}>
                    {t("adminTabs.adBanner.orderLabel")} {banner.sort_order} &middot; {banner.is_active ? t("adminTabs.adBanner.statusActive") : t("adminTabs.adBanner.statusInactive")} &middot; {(banner.media_type || "image").toUpperCase()} &middot; {(banner.position || "bottom") === "top" ? t("adminTabs.adBanner.positionTop") : t("adminTabs.adBanner.positionBottom")}
                    {(banner.start_date || banner.end_date) && (
                      <> &middot; {banner.start_date || "∞"} → {banner.end_date || "∞"}</>
                    )}
                  </div>
                </div>
                <button
                  className={`btn btn-sm ${banner.is_active ? "btn-ghost" : "btn-primary"}`}
                  onClick={() => toggleActive(banner)}
                  style={{ fontSize: "0.78rem" }}
                >
                  {banner.is_active ? t("adminTabs.adBanner.deactivate") : t("adminTabs.adBanner.activate")}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => deleteBanner(banner.id)} title="Delete">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {!showForm ? (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> {t("adminTabs.adBanner.addBanner")}
            </button>
          ) : null}
        </>
      )}

      {/* New banner form */}
      {showForm ? (
        <div className="field-stack" style={{ padding: "1rem", background: "var(--surface-container-lowest)", border: "1px solid var(--outline-variant)", borderRadius: "var(--radius-md)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{t("adminTabs.adBanner.newBanner")}</strong>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setLinkUrl(""); setPosition("bottom"); setStartDate(""); setEndDate(""); }}>
              <X size={16} />
            </button>
          </div>
          <label>
            {t("adminTabs.adBanner.labelPosition")}
            <select value={position} onChange={(e) => setPosition(e.target.value as "top" | "bottom")}>
              <option value="top">{t("adminTabs.adBanner.optionTop")}</option>
              <option value="bottom">{t("adminTabs.adBanner.optionBottom")}</option>
            </select>
          </label>
          <label>
            {t("adminTabs.adBanner.labelLinkUrl")}
            <input
              type="url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder={t("adminTabs.adBanner.placeholderUrl")}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              {t("adminTabs.adBanner.labelStartDate")}
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              {t("adminTabs.adBanner.labelEndDate")}
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <label>
            {t("adminTabs.adBanner.labelBannerMedia")}
            <input type="file" accept="image/*,video/mp4,video/webm" onChange={handleFileUpload} disabled={uploading} />
          </label>
          {uploading ? <p className="muted">{t("adminTabs.adBanner.uploading")}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
