import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, Church, Users, Bell, Heart, CreditCard, Shield, Globe, Mail, ArrowRight, CheckCircle, Smartphone, BarChart3, Download, Receipt, Lock } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

interface ChurchResult {
  name: string;
  address: string | null;
  location: string | null;
}

const MEMBER_FEATURES = [
  { icon: <Users size={22} />, text: "Know your church and diocese leadership." },
  { icon: <Smartphone size={22} />, text: "Connect with church leaders instantly." },
  { icon: <Mail size={22} />, text: "Reach your pastors anytime with ease." },
  { icon: <Heart size={22} />, text: "Send prayer requests privately and quickly." },
  { icon: <CreditCard size={22} />, text: "Give offerings and donations in seconds." },
  { icon: <Bell size={22} />, text: "Get regular alerts of your church programs." },
  { icon: <CheckCircle size={22} />, text: "Receive greetings on your special occasions." },
  { icon: <Bell size={22} />, text: "Never miss a church event or announcement." },
  { icon: <Globe size={22} />, text: "Use the app in your own language." },
];

const MEMBER_EXTRAS = [
  "Access your profile and subscriptions easily.",
  "Track & Pay your subscription status anytime.",
  "Pay your entire family's subscription together.",
  "Get instant receipts for every payment.",
  "Keep your profile fully secure and private.",
];

const CHURCH_FEATURES = [
  { icon: <Globe size={22} />, text: "Turn your church into a fully digital organization." },
  { icon: <Users size={22} />, text: "Access any member profile with one click." },
  { icon: <Bell size={22} />, text: "Reach your congregation effectively." },
  { icon: <Heart size={22} />, text: "Build stronger relationships." },
  { icon: <BarChart3 size={22} />, text: "Get financial reports through powerful visual dashboards." },
  { icon: <Download size={22} />, text: "Download complete member details in Excel." },
  { icon: <Receipt size={22} />, text: "Stop printing receipts manually." },
  { icon: <Mail size={22} />, text: "Send info and updates with a single click." },
];

const CHURCH_EXTRAS = [
  "Reduce manual subscription collection.",
  "Prevent delayed payments and subscriptions.",
  "Receive subscriptions on time, every time.",
  "Get donations easier with flexi payments.",
  "Get 100% of funds directly to your bank.",
  "Maintain complete control over member accounts.",
];

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChurchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contactEmail] = useState("sonusrujan76@gmail.com");
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
          <Link to="/signin" className="explore-nav-logo">
            <img src={shalomLogo} alt="Shalom" className="explore-nav-logo-img" />
            <span className="explore-nav-brand">Shalom</span>
          </Link>
          <Link to="/signin" className="btn btn-primary explore-nav-login">
            Login <ArrowRight size={16} />
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="explore-hero">
        <div className="explore-hero-bg" />
        <div className="explore-hero-content">
          <p className="explore-hero-eyebrow">Church Management, Reimagined</p>
          <h1 className="explore-hero-title">
            One App for Your Entire <span className="explore-gradient-text">Church Community</span>
          </h1>
          <p className="explore-hero-sub">
            From members and donations to events, subscriptions, and prayer requests — everything
            your church needs lives in one place. Simple for members, powerful for churches.
          </p>
          <div className="explore-hero-actions">
            <Link to="/signin" className="btn btn-primary btn-lg">Get Started</Link>
            <button className="btn btn-outline btn-lg" onClick={scrollToContact}>List Your Church</button>
          </div>
        </div>
      </section>

      {/* ── Church Search ── */}
      <section className="explore-search-section" id="search">
        <div className="explore-section-inner">
          <div className="explore-search-badge">
            <Search size={14} />
            <span>Find Your Church</span>
          </div>
          <h2 className="explore-section-title">Check if your church is on Shalom</h2>
          <p className="explore-section-sub">
            Search by church name to see if your congregation has already joined the Shalom platform.
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
                placeholder="Enter your church name..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-primary explore-search-btn" disabled={loading || query.trim().length < 2}>
                {loading ? "Searching..." : "Search"}
              </button>
            </div>
          </form>

          {/* Results */}
          {searched && (
            <div className="explore-search-results">
              {results.length > 0 ? (
                <>
                  <p className="explore-results-count">{results.length} church{results.length > 1 ? "es" : ""} found</p>
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
                    Your church is already on Shalom!{" "}
                    <Link to="/signin" className="explore-link">Sign in to join &rarr;</Link>
                  </p>
                </>
              ) : (
                <div className="explore-no-results">
                  <p>No churches found matching "<strong>{query}</strong>"</p>
                  <p className="explore-no-results-sub">
                    Your church might not be registered yet.{" "}
                    <button className="explore-link-btn" onClick={scrollToContact}>
                      Request to list your church &rarr;
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
          <h2 className="explore-section-title">Why Shalom?</h2>
          <p className="explore-section-sub explore-why-intro">
            Shalom is an all-in-one church management app that helps your church stay connected,
            organized, and future-ready. Built to bring your entire congregation closer together.
          </p>
        </div>
      </section>

      {/* ── For Members ── */}
      <section className="explore-features-section">
        <div className="explore-section-inner">
          <div className="explore-features-header">
            <span className="explore-feature-badge explore-badge-members">
              <Users size={14} /> For Members
            </span>
            <h2 className="explore-section-title">Shalom helps you to</h2>
          </div>
          <div className="explore-features-grid">
            {MEMBER_FEATURES.map((f, i) => (
              <div key={i} className="explore-feature-card">
                <div className="explore-feature-icon explore-icon-members">{f.icon}</div>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
          <div className="explore-extras">
            <h4 className="explore-extras-title">
              <Shield size={16} /> Extras
            </h4>
            <ul className="explore-extras-list">
              {MEMBER_EXTRAS.map((text, i) => (
                <li key={i}><CheckCircle size={14} className="explore-check" /> {text}</li>
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
              <Church size={14} /> For Churches
            </span>
            <h2 className="explore-section-title">Shalom helps churches to</h2>
          </div>
          <div className="explore-features-grid">
            {CHURCH_FEATURES.map((f, i) => (
              <div key={i} className="explore-feature-card">
                <div className="explore-feature-icon explore-icon-churches">{f.icon}</div>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
          <div className="explore-extras">
            <h4 className="explore-extras-title">
              <Lock size={16} /> Extras
            </h4>
            <ul className="explore-extras-list">
              {CHURCH_EXTRAS.map((text, i) => (
                <li key={i}><CheckCircle size={14} className="explore-check" /> {text}</li>
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
              Want your church listed on Shalom?
            </h2>
            <p className="explore-contact-sub">
              If your church isn't on Shalom yet, we'd love to help you get started.
              Reach out to us and we'll guide you through the simple onboarding process.
            </p>
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent("Register our church on Shalom App")}&body=${encodeURIComponent("Hello Shalom Team,\n\nWe would like to register our church on the Shalom App.\n\nChurch Name: \nLocation: \nContact Person: \nPhone: \n\nThank you!")}`}
              className="btn btn-primary btn-lg explore-contact-mail-btn"
            >
              <Mail size={18} />
              Contact Us to Register
            </a>
            <p className="explore-contact-email">
              Or email us directly at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="explore-footer">
        <div className="explore-footer-inner">
          <div className="explore-footer-brand">
            <img src={shalomLogo} alt="Shalom" className="explore-footer-logo" />
            <span>Shalom App</span>
          </div>
          <p className="explore-footer-copy">
            &copy; {new Date().getFullYear()} Shalom. Built with &hearts; for churches everywhere.
          </p>
        </div>
      </footer>
    </div>
  );
}
