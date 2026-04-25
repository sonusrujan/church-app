import { useEffect, useState, useCallback } from "react";
import { Crown, Church, User, Phone, ExternalLink, Filter, AlertCircle, UserCheck } from "lucide-react";
import { useApp } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import { SkeletonList } from "../components/LoadingSkeleton";
import { useI18n } from "../i18n";
import { useNavigate } from "react-router-dom";
import type {
  DioceseRow,
  DioceseChurchRow,
  DioceseLeaderRow,
  ChurchLeadershipRow,
  AdBannerRow,
  ChurchRow,
} from "../types";

export default function UserHomePage() {
  const { token, memberDashboard, isSuperAdmin, churches: globalChurches, loadChurches } = useApp();
  const { t } = useI18n();
  const navigate = useNavigate();

  // ── Superadmin filter state ──
  const [allDioceses, setAllDioceses] = useState<DioceseRow[]>([]);
  const [selectedDioceseId, setSelectedDioceseId] = useState("");
  const [dioceseChurches, setDioceseChurches] = useState<DioceseChurchRow[]>([]);
  const [selectedChurchId, setSelectedChurchId] = useState("");
  const [previewChurch, setPreviewChurch] = useState<ChurchRow | null>(null);

  // Resolve the active church — superadmin's selected or the user's own
  const activeChurchId = isSuperAdmin ? selectedChurchId : memberDashboard?.church?.id;
  const church = isSuperAdmin
    ? (previewChurch ? { ...previewChurch, church_code: previewChurch.church_code || null, contact_phone: previewChurch.contact_phone || null } : null)
    : memberDashboard?.church;

  // ── Superadmin: load dioceses + churches on mount ──
  useEffect(() => {
    if (!isSuperAdmin || !token) return;
    // Load dioceses
    apiRequest<DioceseRow[]>("/api/diocese", { token })
      .then((data) => setAllDioceses(Array.isArray(data) ? data : []))
      .catch((e) => console.warn("Failed to load dioceses", e));
    // Ensure churches are loaded
    if (!globalChurches.length) void loadChurches();
  }, [isSuperAdmin, token]);

  // When diocese selected, load churches in that diocese
  useEffect(() => {
    if (!isSuperAdmin || !token || !selectedDioceseId) {
      setDioceseChurches([]);
      return;
    }
    apiRequest<DioceseChurchRow[]>(`/api/diocese/${encodeURIComponent(selectedDioceseId)}/churches`, { token })
      .then((data) => setDioceseChurches(Array.isArray(data) ? data : []))
      .catch(() => setDioceseChurches([]));
  }, [isSuperAdmin, token, selectedDioceseId]);

  // When church selected, set preview church object
  useEffect(() => {
    if (!selectedChurchId) { setPreviewChurch(null); return; }
    const found = globalChurches.find((c) => c.id === selectedChurchId);
    if (found) {
      setPreviewChurch(found);
    } else {
      // Also check diocese churches list
      const dc = dioceseChurches.find((c) => c.church_id === selectedChurchId);
      if (dc) {
        setPreviewChurch({ id: dc.church_id, name: dc.church_name || "", location: dc.church_location || null, church_code: dc.church_code || null } as ChurchRow);
      }
    }
  }, [selectedChurchId, globalChurches, dioceseChurches]);

  // Compute the filtered church list for the dropdown
  const filteredChurches = selectedDioceseId
    ? globalChurches.filter((c) => dioceseChurches.some((dc) => dc.church_id === c.id))
    : globalChurches;

  // ── State ──
  const [diocese, setDiocese] = useState<DioceseRow | null>(null);
  const [dioceseLeaders, setDioceseLeaders] = useState<DioceseLeaderRow[]>([]);
  const [churchLeaders, setChurchLeaders] = useState<ChurchLeadershipRow[]>([]);
  const [adBanners, setAdBanners] = useState<AdBannerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllCommittee, setShowAllCommittee] = useState(false);
  const [showAllSextons, setShowAllSextons] = useState(false);
  const COLLAPSE_LIMIT = 4;

  // ── Data fetching ──
  const loadData = useCallback(async () => {
    if (!token || !activeChurchId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Fetch diocese info for this church
      const dioceseData = await apiRequest<DioceseRow | null>(
        `/api/diocese/by-church/${encodeURIComponent(activeChurchId)}`,
        { token },
      ).catch(() => null);
      setDiocese(dioceseData);

      // Parallel fetches
      const promises: Promise<void>[] = [];
      const collectedBanners: AdBannerRow[] = [];

      // Diocese leaders
      if (dioceseData?.id) {
        promises.push(
          apiRequest<DioceseLeaderRow[]>(
            `/api/diocese/${encodeURIComponent(dioceseData.id)}/leaders`,
            { token },
          ).then((data) => setDioceseLeaders(Array.isArray(data) ? data : [])).catch((e) => console.warn("Failed to load diocese leaders", e)),
        );
        // Ad banners (diocese scope)
        promises.push(
          apiRequest<AdBannerRow[]>(
            `/api/ad-banners?scope=diocese&scope_id=${encodeURIComponent(dioceseData.id)}`,
            { token },
          ).then((data) => { if (Array.isArray(data)) collectedBanners.push(...data); }).catch((e) => console.warn("Failed to load diocese banners", e)),
        );
      }

      // Church leaders
      promises.push(
        apiRequest<ChurchLeadershipRow[]>(
          `/api/leadership/church/${encodeURIComponent(activeChurchId)}`,
          { token },
        ).then((data) => setChurchLeaders(Array.isArray(data) ? data : [])).catch((e) => console.warn("Failed to load church leaders", e)),
      );

      // Ad banners (church scope)
      promises.push(
        apiRequest<AdBannerRow[]>(
          `/api/ad-banners?scope=church&scope_id=${encodeURIComponent(activeChurchId)}`,
          { token },
        ).then((data) => { if (Array.isArray(data)) collectedBanners.push(...data); }).catch(() => {}),
      );

      await Promise.all(promises);
      // Deduplicate and set banners once (prevents accumulation on re-render)
      const unique = Array.from(new Map(collectedBanners.map(b => [b.id, b])).values());
      setAdBanners(unique);
    } finally {
      setLoading(false);
    }
  }, [token, activeChurchId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Derived ──
  const bishop = dioceseLeaders.find(
    (l) => l.role.toLowerCase().includes("bishop"),
  );
  const otherDioceseLeaders = dioceseLeaders.filter((l) => l.id !== bishop?.id);

  // Separate main leaders, committee members, and sextons
  const mainChurchLeaders = churchLeaders.filter(
    (l) => (l.hierarchy_level ?? 99) < 8,
  );
  const committeeMembers = churchLeaders.filter(
    (l) => (l.hierarchy_level ?? 99) === 8,
  );
  const sextons = churchLeaders.filter(
    (l) => (l.role_name ?? "").toLowerCase() === "sexton" || (l.hierarchy_level ?? 99) === 9,
  );

  /** Abbreviate long leadership prefix words */
  function shortTitle(title: string): string {
    return title
      .replace(/\bAssistant\b/gi, "Astnt.")
      .replace(/\bAssociate\b/gi, "Asst.");
  }

  // Deduplicate ad banners (diocese + church fetched separately)
  const uniqueBanners = adBanners.filter(
    (b, i, arr) => arr.findIndex((x) => x.id === b.id) === i,
  );
  const topBanners = uniqueBanners.filter((b) => b.position === "top");
  const bottomBanners = uniqueBanners.filter((b) => (b.position || "bottom") !== "top");

  // Diocese logo count for layout
  const logoUrls = diocese?.logo_urls ?? [];
  const logoCount = logoUrls.length || (diocese?.logo_url ? 1 : 0);

  if (loading && !isSuperAdmin) {
    return (
      <div className="home-page route-enter">
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <div className="skeleton-line" style={{ width: "60%", height: "1.25rem" }} />
          <div className="skeleton-line" style={{ width: "40%", height: "0.85rem", marginTop: "0.5rem" }} />
        </div>
        <SkeletonList rows={4} withAvatar />
      </div>
    );
  }

  return (
    <div className="home-page">
      {/* ── Superadmin: Diocese & Church filter ── */}
      {isSuperAdmin ? (
        <section className="sa-church-filter">
          <div className="sa-filter-header">
            <Filter size={18} strokeWidth={1.5} />
            <h3>{t("home.previewChurchHome")}</h3>
          </div>
          <p className="sa-filter-desc">{t("home.previewChurchHomeDesc")}</p>
          <div className="sa-filter-row">
            <label className="sa-filter-field">
              <span>{t("home.filterDiocese")}</span>
              <select
                value={selectedDioceseId}
                onChange={(e) => { setSelectedDioceseId(e.target.value); setSelectedChurchId(""); }}
              >
                <option value="">{t("home.allDioceses")}</option>
                {allDioceses.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.church_count ?? 0})</option>
                ))}
              </select>
            </label>
            <label className="sa-filter-field">
              <span>{t("home.filterChurch")}</span>
              <select
                value={selectedChurchId}
                onChange={(e) => setSelectedChurchId(e.target.value)}
              >
                <option value="">{t("home.selectChurch")}</option>
                {filteredChurches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.location ? ` — ${c.location}` : ""}</option>
                ))}
              </select>
            </label>
          </div>
          {!selectedChurchId ? (
            <p className="sa-filter-hint">{t("home.selectChurchToPreview")}</p>
          ) : null}
        </section>
      ) : null}

      {/* If superadmin hasn't selected a church yet, show prompt */}
      {isSuperAdmin && !activeChurchId ? null : (
      <>
      {loading ? <SkeletonList rows={6} withAvatar /> : (
      <>
      {/* ── Contextual Action Cards (members only) ── */}
      {!isSuperAdmin && memberDashboard && (
        <div className="home-action-cards">
          {(memberDashboard.due_subscriptions?.length ?? 0) > 0 && (
            <button className="home-action-card home-action-dues" onClick={() => navigate("/dashboard")}>
              <AlertCircle size={18} strokeWidth={1.5} />
              <span>{t("home.duesOutstanding", { count: memberDashboard.due_subscriptions.length })}</span>
            </button>
          )}
          {memberDashboard.member && (!memberDashboard.member.full_name || !memberDashboard.member.phone_number || !memberDashboard.member.address) && (
            <button className="home-action-card home-action-profile" onClick={() => navigate("/profile")}>
              <UserCheck size={18} strokeWidth={1.5} />
              <span>{t("home.completeProfile")}</span>
            </button>
          )}
        </div>
      )}

      {/* ── Top Ad Banners (above diocese) ── */}
      {topBanners.length > 0 ? (
        <section className="home-ad-banners">
          <div className="home-ad-track">
            {topBanners.map((banner) => {
              const inner = banner.media_type === "video" ? (
                <video src={banner.image_url} autoPlay muted loop playsInline className="home-ad-media" />
              ) : (
                <img src={banner.image_url} alt="" />
              );
              return banner.link_url ? (
                <a key={banner.id} href={banner.link_url} target="_blank" rel="noopener noreferrer" className="home-ad-item">
                  {inner}
                  <ExternalLink size={12} strokeWidth={1.5} className="home-ad-link-icon" />
                </a>
              ) : (
                <div key={banner.id} className="home-ad-item">{inner}</div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Section 1: Diocese Hero ── */}
      {diocese ? (
        <section className="home-diocese-hero">
          {diocese.banner_url ? (
            <div className="home-diocese-banner">
              <img src={diocese.banner_url} alt={diocese.name} loading="lazy" decoding="async" />
            </div>
          ) : null}

          <div className="home-diocese-header">
            {/* Diocese logos (max 3) — positioned by count */}
            {logoUrls.length > 0 ? (
              <div className={`home-diocese-logos home-diocese-logos-${logoCount}`}>
                {logoCount === 2 ? (
                  <>
                    <img src={logoUrls[0]} alt={`${diocese.name} logo 1`} className="home-diocese-logo" loading="lazy" decoding="async" />
                    <div className="home-diocese-header-text">
                      <h3 className="home-diocese-name">{diocese.name}</h3>
                    </div>
                    <img src={logoUrls[1]} alt={`${diocese.name} logo 2`} className="home-diocese-logo" loading="lazy" decoding="async" />
                  </>
                ) : logoCount === 3 ? (
                  <>
                    <img src={logoUrls[0]} alt={`${diocese.name} logo 1`} className="home-diocese-logo" loading="lazy" decoding="async" />
                    <div className="home-diocese-center-group">
                      <img src={logoUrls[1]} alt={`${diocese.name} logo 2`} className="home-diocese-logo" loading="lazy" decoding="async" />
                      <h3 className="home-diocese-name">{diocese.name}</h3>
                    </div>
                    <img src={logoUrls[2]} alt={`${diocese.name} logo 3`} className="home-diocese-logo" loading="lazy" decoding="async" />
                  </>
                ) : (
                  <>
                    {logoUrls.map((url, i) => (
                      <img key={i} src={url} alt={`${diocese.name} logo ${i + 1}`} className="home-diocese-logo" loading="lazy" decoding="async" />
                    ))}
                  </>
                )}
              </div>
            ) : diocese.logo_url ? (
              <img src={diocese.logo_url} alt={diocese.name} className="home-diocese-logo" loading="lazy" decoding="async" />
            ) : null}
            {/* Text shown inline for 0 or 1 logo only */}
            {logoCount <= 1 ? (
              <div>
                <h3 className="home-diocese-name">{diocese.name}</h3>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Section 2: Diocese Leadership (below diocese name, above church) ── */}
      {dioceseLeaders.length > 0 ? (
        <section className="home-leadership-section">
          <div className="home-section-head">
            <Crown size={20} strokeWidth={1.5} />
            <h3>{t("home.dioceseLeadership")}</h3>
          </div>
          <div className="home-diocese-leaders-grid">
            {bishop ? (
              <div className="home-leader-card home-leader-bishop">
                <div className="home-leader-badge">{t("home.bishop")}</div>
                <div className="home-leader-avatar home-avatar-lg">
                  {bishop.photo_url ? (
                    <img src={bishop.photo_url} alt={bishop.full_name} loading="lazy" decoding="async" />
                  ) : (
                    <User size={52} />
                  )}
                </div>
                <h4 className="home-leader-name">{bishop.full_name}</h4>
              </div>
            ) : null}
            {otherDioceseLeaders.map((leader) => (
              <div key={leader.id} className="home-leader-card home-leader-diocese">
                <div className="home-leader-badge">{shortTitle(leader.role)}</div>
                <div className="home-leader-avatar home-avatar-md">
                  {leader.photo_url ? (
                    <img src={leader.photo_url} alt={leader.full_name} loading="lazy" decoding="async" />
                  ) : (
                    <User size={40} />
                  )}
                </div>
                <h4 className="home-leader-name">{leader.full_name}</h4>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Section 3: My Church ── */}
      {church ? (
        <section className="home-church-card">
          <div className="home-church-header">
            {church.logo_url ? (
              <img src={church.logo_url} alt={church.name} className="home-church-logo" loading="lazy" decoding="async" />
            ) : (
              <div className="home-church-logo-placeholder">
                <Church size={36} strokeWidth={1.5} />
              </div>
            )}
            <div className="home-church-info">
              <h3 className="home-church-name">{church.name}</h3>
              {church.church_code ? (
                <span className="home-church-code">{t("home.churchCode")} {church.church_code}</span>
              ) : null}
            </div>
          </div>
          {church.contact_phone ? (
            <div className="home-church-details">
              <span className="home-church-detail">
                <Phone size={14} strokeWidth={1.5} />
                {church.contact_phone}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Section 5: Church Leadership ── */}
      {mainChurchLeaders.length > 0 ? (
        <section className="home-leadership-section">
          <div className="home-section-head">
            <Crown size={20} strokeWidth={1.5} />
            <h3>{t("dashboard.churchLeadership")}</h3>
          </div>
          <div className="home-church-leaders-grid">
            {mainChurchLeaders.map((leader) => (
              <div key={leader.id} className="home-leader-card home-leader-member">
                <div className="home-leader-badge">{shortTitle(leader.role_name || "Leader")}</div>
                <div className="home-leader-avatar home-avatar-md">
                  {leader.photo_url ? (
                    <img src={leader.photo_url} alt={leader.full_name} loading="lazy" decoding="async" />
                  ) : (
                    <User size={40} />
                  )}
                </div>
                <h4 className="home-leader-name">{leader.full_name}</h4>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Section 5b: Committee Members ── */}
      {committeeMembers.length > 0 ? (
        <section className="home-leadership-section">
          <div className="home-section-head">
            <Crown size={20} strokeWidth={1.5} />
            <h3>{t("home.committeeMembers")}</h3>
          </div>
          <div className="home-committee-list">
            {(showAllCommittee ? committeeMembers : committeeMembers.slice(0, COLLAPSE_LIMIT)).map((m) => (
              <div key={m.id} className="home-committee-row">
                <div className="home-committee-photo">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt={m.full_name} loading="lazy" decoding="async" />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <span className="home-committee-name">{m.full_name}</span>
                {m.phone_number ? (
                  <a href={`tel:${m.phone_number}`} className="home-committee-role home-committee-phone">{m.phone_number}</a>
                ) : null}
              </div>
            ))}
          </div>
          {committeeMembers.length > COLLAPSE_LIMIT && (
            <button className="btn btn-ghost show-all-toggle" onClick={() => setShowAllCommittee((v) => !v)}>
              {showAllCommittee ? t("home.showLess") : t("home.showAll", { count: committeeMembers.length })}
            </button>
          )}
        </section>
      ) : null}

      {/* ── Section 5c: Sextons ── */}
      {sextons.length > 0 ? (
        <section className="home-leadership-section">
          <div className="home-section-head">
            <Crown size={20} strokeWidth={1.5} />
            <h3>{t("home.sextons")}</h3>
          </div>
          <div className="home-committee-list">
            {(showAllSextons ? sextons : sextons.slice(0, COLLAPSE_LIMIT)).map((m) => (
              <div key={m.id} className="home-committee-row">
                <div className="home-committee-photo">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt={m.full_name} loading="lazy" decoding="async" />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <span className="home-committee-name">{m.full_name}</span>
                {m.phone_number ? (
                  <a href={`tel:${m.phone_number}`} className="home-committee-role home-committee-phone">{m.phone_number}</a>
                ) : null}
              </div>
            ))}
          </div>
          {sextons.length > COLLAPSE_LIMIT && (
            <button className="btn btn-ghost show-all-toggle" onClick={() => setShowAllSextons((v) => !v)}>
              {showAllSextons ? t("home.showLess") : t("home.showAll", { count: sextons.length })}
            </button>
          )}
        </section>
      ) : null}

      {/* ── Section 6: Footer Ad Banners ── */}
      {bottomBanners.length > 0 ? (
        <section className="home-ad-banners">
          <div className="home-ad-track">
            {bottomBanners.map((banner) => {
              const inner = banner.media_type === "video" ? (
                <video src={banner.image_url} autoPlay muted loop playsInline className="home-ad-media" />
              ) : (
                <img src={banner.image_url} alt="Ad" loading="lazy" decoding="async" />
              );
              return banner.link_url ? (
                <a key={banner.id} href={banner.link_url} target="_blank" rel="noopener noreferrer" className="home-ad-item">
                  {inner}
                  <ExternalLink size={12} strokeWidth={1.5} className="home-ad-link-icon" />
                </a>
              ) : (
                <div key={banner.id} className="home-ad-item">{inner}</div>
              );
            })}
          </div>
        </section>
      ) : null}
      </>
      )}
      </>
      )}
    </div>
  );
}
