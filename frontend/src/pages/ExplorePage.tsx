import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, Church, Users, Bell, Heart, CreditCard, Shield, Globe, Mail, ArrowRight, CheckCircle, Smartphone, BarChart3, Download, Receipt, Lock } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";
import { useI18n } from "../i18n";
import { usePageMeta } from "../hooks/usePageMeta";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface ChurchResult {
  name: string;
  address: string | null;
  location: string | null;
}

const MEMBER_FEATURES = [
  { icon: <Users size={22} />, key: "explore.memberFeatureLeadership" },
  { icon: <Smartphone size={22} />, key: "explore.memberFeatureConnect" },
  { icon: <Mail size={22} />, key: "explore.memberFeaturePastors" },
  { icon: <Heart size={22} />, key: "explore.memberFeaturePrayer" },
  { icon: <CreditCard size={22} />, key: "explore.memberFeatureDonation" },
  { icon: <Bell size={22} />, key: "explore.memberFeatureAlerts" },
  { icon: <CheckCircle size={22} />, key: "explore.memberFeatureGreetings" },
  { icon: <Bell size={22} />, key: "explore.memberFeatureEvents" },
  { icon: <Globe size={22} />, key: "explore.memberFeatureLanguage" },
];

const MEMBER_EXTRAS = [
  "explore.memberExtraProfile",
  "explore.memberExtraTrackPay",
  "explore.memberExtraFamily",
  "explore.memberExtraReceipts",
  "explore.memberExtraSecure",
];

const CHURCH_FEATURES = [
  { icon: <Globe size={22} />, key: "explore.churchFeatureDigital" },
  { icon: <Users size={22} />, key: "explore.churchFeatureMemberProfile" },
  { icon: <Bell size={22} />, key: "explore.churchFeatureReach" },
  { icon: <Heart size={22} />, key: "explore.churchFeatureRelationships" },
  { icon: <BarChart3 size={22} />, key: "explore.churchFeatureFinance" },
  { icon: <Download size={22} />, key: "explore.churchFeatureExport" },
  { icon: <Receipt size={22} />, key: "explore.churchFeatureReceipts" },
  { icon: <Mail size={22} />, key: "explore.churchFeatureNewsletter" },
];

const CHURCH_EXTRAS = [
  "explore.churchExtraManualCollection",
  "explore.churchExtraDelayedPayments",
  "explore.churchExtraOnTime",
  "explore.churchExtraFlexiDonations",
  "explore.churchExtraFundsBank",
  "explore.churchExtraControl",
];

export default function ExplorePage({ isLoggedIn }: { isLoggedIn?: boolean }) {
  const { t } = useI18n();
  usePageMeta({
    title: "Explore Churches on Shalom – Find Your Church",
    description: "Search and find your church on the Shalom platform. One app for your entire church community — members, donations, events, prayer requests and more.",
    canonical: "https://shalomapp.in/explore",
  });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChurchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contactEmail] = useState("support@shalomapp.in");
  const contactRef = useRef<HTMLDivElement>(null);

  async function handleSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${API}/api/churches/public-search?query=${encodeURIComponent(q)}`);
      if (res.ok) {
        setResults(await res.json());
      } else {
        setResults([]);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function scrollToContact() {
    contactRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="explore-page">
      {/* ── Sticky Nav ── */}
      <nav className="explore-nav">
        <div className="explore-nav-inner">
          <Link to={isLoggedIn ? "/home" : "/signin"} className="explore-nav-logo">
            <img src={shalomLogo} alt="Shalom" className="explore-nav-logo-img" />
            <span className="explore-nav-brand">Shalom</span>
          </Link>
          <Link to={isLoggedIn ? "/home" : "/signin"} className="btn btn-primary explore-nav-login">
            {isLoggedIn ? t("explore.goToDashboard") : t("explore.login")} <ArrowRight size={16} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="explore-hero">
        <div className="explore-hero-bg" />
        <div className="explore-hero-content">
          <p className="explore-hero-eyebrow">{t("explore.heroEyebrow")}</p>
          <h1 className="explore-hero-title">
            {t("explore.heroTitle")} <span className="explore-gradient-text">{t("explore.heroCommunity")}</span>
          </h1>
          <p className="explore-hero-sub">
            {t("explore.heroSub")}
          </p>
          <div className="explore-hero-actions">
            <Link to={isLoggedIn ? "/home" : "/signin"} className="btn btn-primary btn-lg">{isLoggedIn ? t("explore.goToDashboard") : t("explore.getStarted")}</Link>
            <button className="btn btn-outline btn-lg" onClick={scrollToContact}>{t("explore.listYourChurch")}</button>
          </div>
        </div>
      </section>

      {/* ── Church Search ── */}
      <section className="explore-search-section" id="search">
        <div className="explore-section-inner">
          <div className="explore-search-badge">
            <Search size={14} />
            <span>{t("explore.findYourChurch")}</span>
          </div>
          <h2 className="explore-section-title">{t("explore.checkChurch")}</h2>
          <p className="explore-section-sub">
            {t("explore.searchSub")}
          </p>
          <form
            className="explore-search-form"
            onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          >
            <div className="explore-search-bar">
              <Search size={20} className="explore-search-icon" />
              <input
                type="text"
                className="explore-search-input"
                placeholder={t("explore.searchChurchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary explore-search-btn" disabled={loading || query.trim().length < 2}>
                {loading ? t("common.searching") : t("common.search")}
              </button>
            </div>
          </form>

          {/* Results */}
          {searched && (
            <div className="explore-search-results">
              {results.length > 0 ? (
                <>
                  <p className="explore-results-count">{t("explore.searchResults", { count: results.length })}</p>
                  <div className="explore-results-list">
                    {results.map((c, i) => (
                      <div key={i} className="explore-result-card">
                        <div className="explore-result-icon">
                          <Church size={20} />
                        </div>
                        <div className="explore-result-info">
                          <span className="explore-result-name">{c.name}</span>
                          {(c.address || c.location) && (
                            <span className="explore-result-loc">{c.address || c.location}</span>
                          )}
                        </div>
                        <CheckCircle size={18} className="explore-result-check" />
                      </div>
                    ))}
                  </div>
                  <p className="explore-results-hint">
                    {t("explore.churchAlreadyOnShalom")}{" "}
                    {isLoggedIn ? (
                      <Link to="/home" className="explore-link">{t("explore.goToDashboard")}</Link>
                    ) : (
                      <Link to="/signin" className="explore-link">{t("explore.signInToJoin")}</Link>
                    )}
                  </p>
                </>
              ) : (
                <div className="explore-no-results">
                  <p>{t("explore.noChurchFound", { query })}</p>
                  <p className="explore-no-results-sub">
                    {t("explore.notRegisteredYet")}{" "}
                    <button className="explore-link-btn" onClick={scrollToContact}>
                      {t("explore.requestListChurch")}
                    </button>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Why Shalom ── */}
      <section className="explore-why-section">
        <div className="explore-section-inner">
          <h2 className="explore-section-title">{t("explore.whyShalom")}</h2>
          <p className="explore-section-sub explore-why-intro">
            {t("explore.whyIntro")}
          </p>
        </div>
      </section>

      {/* ── For Members ── */}
      <section className="explore-features-section">
        <div className="explore-section-inner">
          <div className="explore-features-header">
            <span className="explore-feature-badge explore-badge-members">
              <Users size={14} /> {t("explore.forMembers")}
            </span>
            <h2 className="explore-section-title">{t("explore.shalomHelpsYou")}</h2>
          </div>
          <div className="explore-features-grid">
            {MEMBER_FEATURES.map((f, i) => (
              <div key={i} className="explore-feature-card">
                <div className="explore-feature-icon explore-icon-members">{f.icon}</div>
                <span>{t(f.key)}</span>
              </div>
            ))}
          </div>
          <div className="explore-extras">
            <h4 className="explore-extras-title">
              <Shield size={16} /> {t("explore.extras")}
            </h4>
            <ul className="explore-extras-list">
              {MEMBER_EXTRAS.map((text, i) => (
                <li key={i}><CheckCircle size={14} className="explore-check" /> {t(text)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── For Churches ── */}
      <section className="explore-features-section explore-features-section--alt">
        <div className="explore-section-inner">
          <div className="explore-features-header">
            <span className="explore-feature-badge explore-badge-churches">
              <Church size={14} /> {t("explore.forChurches")}
            </span>
            <h2 className="explore-section-title">{t("explore.shalomHelpsChurches")}</h2>
          </div>
          <div className="explore-features-grid">
            {CHURCH_FEATURES.map((f, i) => (
              <div key={i} className="explore-feature-card">
                <div className="explore-feature-icon explore-icon-churches">{f.icon}</div>
                <span>{t(f.key)}</span>
              </div>
            ))}
          </div>
          <div className="explore-extras">
            <h4 className="explore-extras-title">
              <Lock size={16} /> {t("explore.extras")}
            </h4>
            <ul className="explore-extras-list">
              {CHURCH_EXTRAS.map((text, i) => (
                <li key={i}><CheckCircle size={14} className="explore-check" /> {t(text)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Contact / Register Church ── */}
      <section className="explore-contact-section" ref={contactRef} id="register">
        <div className="explore-section-inner">
          <div className="explore-contact-card">
            <h2 className="explore-contact-title">
              {t("explore.contactTitle")}
            </h2>
            <p className="explore-contact-sub">
              {t("explore.contactSub")}
            </p>
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(t("explore.mailSubject"))}&body=${encodeURIComponent(t("explore.mailBody"))}`}
              className="btn btn-primary btn-lg explore-contact-mail-btn"
            >
              <Mail size={18} />
              {t("explore.contactRegister")}
            </a>
            <p className="explore-contact-email">
              {t("explore.orEmail")} <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="explore-footer">
        <div className="explore-footer-inner">
          <div className="explore-footer-brand">
            <img src={shalomLogo} alt="Shalom" className="explore-footer-logo" />
            <span>{t("explore.shalomApp")}</span>
          </div>
          <p className="explore-footer-copy">
            {t("explore.footerCopy", { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </div>
  );
}
