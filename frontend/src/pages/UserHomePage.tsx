import { useEffect, useState, useCallback } from "react";
import { Crown, Church, User, Phone, ExternalLink } from "lucide-react";
import { useApp } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import LoadingSkeleton from "../components/LoadingSkeleton";
import { useI18n } from "../i18n";
import type {
  DioceseRow,
  DioceseLeaderRow,
  ChurchLeadershipRow,
  AdBannerRow,
} from "../types";

export default function UserHomePage() {
  const { token, memberDashboard } = useApp();
  const { t } = useI18n();

  const churchId = memberDashboard?.church?.id;
  const church = memberDashboard?.church;

  // ── State ──
  const [diocese, setDiocese] = useState<DioceseRow | null>(null);
  const [dioceseLeaders, setDioceseLeaders] = useState<DioceseLeaderRow[]>([]);
  const [churchLeaders, setChurchLeaders] = useState<ChurchLeadershipRow[]>([]);
  const [adBanners, setAdBanners] = useState<AdBannerRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Data fetching ──
  const loadData = useCallback(async () => {
    if (!token || !churchId) { setLoading(false); return; }
    setLoading(true);
    try {
      // Fetch diocese info for this church
      const dioceseData = await apiRequest<DioceseRow | null>(
        `/api/diocese/by-church/${encodeURIComponent(churchId)}`,
        { token },
      ).catch(() => null);
      setDiocese(dioceseData);

      // Parallel fetches
      const promises: Promise<void>[] = [];

      // Diocese leaders
      if (dioceseData?.id) {
        promises.push(
          apiRequest<DioceseLeaderRow[]>(
            `/api/diocese/${encodeURIComponent(dioceseData.id)}/leaders`,
            { token },
          ).then((data) => setDioceseLeaders(Array.isArray(data) ? data : [])).catch(() => {}),
        );
        // Ad banners (diocese scope)
        promises.push(
          apiRequest<AdBannerRow[]>(
            `/api/ad-banners?scope=diocese&scope_id=${encodeURIComponent(dioceseData.id)}`,
            { token },
          ).then((data) => setAdBanners((prev) => [...prev, ...data])).catch(() => {}),
        );
      }

      // Church leaders
      promises.push(
        apiRequest<ChurchLeadershipRow[]>(
          `/api/leadership/church/${encodeURIComponent(churchId)}`,
          { token },
        ).then((data) => setChurchLeaders(Array.isArray(data) ? data : [])).catch(() => {}),
      );

      // Ad banners (church scope)
      promises.push(
        apiRequest<AdBannerRow[]>(
          `/api/ad-banners?scope=church&scope_id=${encodeURIComponent(churchId)}`,
          { token },
        ).then((data) => setAdBanners((prev) => [...prev, ...data])).catch(() => {}),
      );

      await Promise.all(promises);
    } finally {
      setLoading(false);
    }
  }, [token, churchId]);

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

  if (loading) {
    return (
      <div className="home-page">
        <LoadingSkeleton lines={8} />
      </div>
    );
  }

  return (
    <div className="home-page">
      {/* ── Top Ad Banners (above diocese) ── */}
      {topBanners.length > 0 ? (
        <section className="home-ad-banners">
          <div className="home-ad-track">
            {topBanners.map((banner) => {
              const inner = banner.media_type === "video" ? (
                <video src={banner.image_url} autoPlay muted loop playsInline className="home-ad-media" />
              ) : (
                <img src={banner.image_url} alt="Ad" />
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
              <img src={diocese.banner_url} alt={diocese.name} />
            </div>
          ) : null}

          <div className="home-diocese-header">
            {/* Diocese logos (max 3) — positioned by count */}
            {logoUrls.length > 0 ? (
              <div className={`home-diocese-logos home-diocese-logos-${logoCount}`}>
                {logoCount === 2 ? (
                  <>
                    <img src={logoUrls[0]} alt={`${diocese.name} logo 1`} className="home-diocese-logo" />
                    <div className="home-diocese-header-text">
                      <h3 className="home-diocese-name">{diocese.name}</h3>
                    </div>
                    <img src={logoUrls[1]} alt={`${diocese.name} logo 2`} className="home-diocese-logo" />
                  </>
                ) : logoCount === 3 ? (
                  <>
                    <img src={logoUrls[0]} alt={`${diocese.name} logo 1`} className="home-diocese-logo" />
                    <div className="home-diocese-center-group">
                      <img src={logoUrls[1]} alt={`${diocese.name} logo 2`} className="home-diocese-logo" />
                      <h3 className="home-diocese-name">{diocese.name}</h3>
                    </div>
                    <img src={logoUrls[2]} alt={`${diocese.name} logo 3`} className="home-diocese-logo" />
                  </>
                ) : (
                  <>
                    {logoUrls.map((url, i) => (
                      <img key={i} src={url} alt={`${diocese.name} logo ${i + 1}`} className="home-diocese-logo" />
                    ))}
                  </>
                )}
              </div>
            ) : diocese.logo_url ? (
              <img src={diocese.logo_url} alt={diocese.name} className="home-diocese-logo" />
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
                    <img src={bishop.photo_url} alt={bishop.full_name} />
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
                    <img src={leader.photo_url} alt={leader.full_name} />
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
              <img src={church.logo_url} alt={church.name} className="home-church-logo" />
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
                    <img src={leader.photo_url} alt={leader.full_name} />
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
            {committeeMembers.map((m) => (
              <div key={m.id} className="home-committee-row">
                <div className="home-committee-photo">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt={m.full_name} />
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
            {sextons.map((m) => (
              <div key={m.id} className="home-committee-row">
                <div className="home-committee-photo">
                  {m.photo_url ? (
                    <img src={m.photo_url} alt={m.full_name} />
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
                <img src={banner.image_url} alt="Ad" />
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
    </div>
  );
}
