import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, Users, Eye, Award, ArrowLeft } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";
import { useI18n } from "../i18n";
import { isValidEmail } from "../types";
import { API_BASE_URL } from "../lib/api";

const PRESET_AMOUNTS = [100, 500, 1000, 2500, 5000, 10000];
const DEFAULT_FUND_OPTIONS = [
  "General Offering",
  "Building Fund",
  "Mission & Outreach",
  "Youth Ministry",
  "Community Aid",
  "Other",
];

export default function PublicDonationPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const [fundOptions, setFundOptions] = useState<string[]>(DEFAULT_FUND_OPTIONS);
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [fund, setFund] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [emailWarning, setEmailWarning] = useState("");
  const [message, setMessage] = useState("");

  // Fetch dynamic fund options
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/donation-funds/public`)
      .then((r) => (r.ok ? r.json() : DEFAULT_FUND_OPTIONS))
      .then((data: string[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setFundOptions(data);
          setFund(data[0]);
        }
      })
      .catch(() => {
        setFund(DEFAULT_FUND_OPTIONS[0]);
      });
  }, []);

  const selectedAmount = customAmount ? Number(customAmount) : Number(amount);
  const isValidAmount = Number.isFinite(selectedAmount) && selectedAmount > 0;

  function handlePresetClick(value: number) {
    setAmount(String(value));
    setCustomAmount("");
  }

  function handleCustomAmountChange(value: string) {
    // Allow only numbers and one decimal point
    const cleaned = value.replace(/[^0-9.]/g, "").replace(/(\..*?)\..*/g, "$1");
    setCustomAmount(cleaned);
    setAmount("");
  }

  function handleContinue() {
    if (!isValidAmount) return;
    const trimmedEmail = donorEmail.trim();
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      setEmailWarning("Invalid email address");
      return;
    }
    navigate("/donate/checkout", {
      state: {
        amount: selectedAmount,
        fund,
        donorName: donorName.trim(),
        donorEmail: donorEmail.trim(),
        message: message.trim(),
      },
    });
  }

  return (
    <div className="public-donation-shell">
      {/* Nav bar */}
      <nav className="public-donation-nav">
        <div className="public-donation-nav-inner">
          <div className="public-donation-brand">
            {isLoggedIn ? (
              <button
                className="public-donation-back-btn"
                onClick={() => navigate("/dashboard")}
                aria-label="Back to Dashboard"
              >
                <ArrowLeft size={20} />
              </button>
            ) : null}
            <img src={shalomLogo} alt="Shalom" className="public-donation-logo" />
            <span className="public-donation-brand-name">Shalom</span>
          </div>
          <a href={isLoggedIn ? "/dashboard" : "/signin"} className="btn btn-ghost public-donation-signin-link">
            {isLoggedIn ? t("donation.backToDashboard") : t("donation.signIn")}
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="public-donation-hero">
        <div className="public-donation-hero-badge">
          <Heart size={16} />
          <span>{t("donation.giveWithPurpose")}</span>
        </div>
        <h1>{t("donation.supportMission")}</h1>
        <p>
          {t("donation.heroDescription")}
        </p>
      </section>

      {/* Donation Form */}
      <section className="public-donation-form-section">
        {/* Step 1: Amount */}
        <div className="public-donation-step">
          <div className="public-donation-step-header">
            <span className="public-donation-step-number">1</span>
            <h2>{t("donation.chooseAmount")}</h2>
          </div>
          <div className="public-donation-amount-grid">
            {PRESET_AMOUNTS.map((val) => (
              <button
                key={val}
                className={`public-donation-amount-btn ${amount === String(val) && !customAmount ? "selected" : ""}`}
                onClick={() => handlePresetClick(val)}
                type="button"
              >
                ₹{val.toLocaleString("en-IN")}
              </button>
            ))}
          </div>
          <div className="public-donation-custom-amount">
            <span className="public-donation-currency-symbol">₹</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder={t("donation.enterCustomAmount")}
              value={customAmount}
              onChange={(e) => handleCustomAmountChange(e.target.value)}
              maxLength={10}
            />
          </div>
        </div>

        {/* Step 2: Fund */}
        <div className="public-donation-step">
          <div className="public-donation-step-header">
            <span className="public-donation-step-number">2</span>
            <h2>{t("donation.selectFund")}</h2>
          </div>
          <select
            className="public-donation-select"
            value={fund}
            onChange={(e) => setFund(e.target.value)}
          >
            {fundOptions.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Step 3: Donor Info */}
        <div className="public-donation-step">
          <div className="public-donation-step-header">
            <span className="public-donation-step-number">3</span>
            <h2>{t("donation.yourInfo")} <span className="public-donation-optional">({t("common.optional")})</span></h2>
          </div>
          <div className="public-donation-fields">
            <input
              type="text"
              placeholder={t("donation.fullName")}
              value={donorName}
              onChange={(e) => setDonorName(e.target.value)}
              maxLength={200}
            />
            <input
              type="email"
              placeholder={t("donation.emailAddress")}
              value={donorEmail}
              onChange={(e) => { setDonorEmail(e.target.value); if (emailWarning) setEmailWarning(""); }}
              onBlur={() => { const v = donorEmail.trim(); if (v && !isValidEmail(v)) setEmailWarning("Invalid email address"); else setEmailWarning(""); }}
              maxLength={254}
            />
            {emailWarning && <span className="field-error">{emailWarning}</span>}
            <textarea
              placeholder={t("donation.leaveMsgPlaceholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
        </div>

        {/* Continue Button */}
        <button
          className="btn btn-primary public-donation-continue-btn"
          onClick={handleContinue}
          disabled={!isValidAmount}
        >
          {t("donation.continueToPayment")} — ₹{isValidAmount ? selectedAmount.toLocaleString("en-IN") : "0"}
        </button>
      </section>

      {/* Trust Badges */}
      <section className="public-donation-trust">
        <div className="public-donation-trust-item">
          <Users size={20} />
          <div>
            <strong>{t("donation.communityFirst")}</strong>
            <p>{t("donation.communityFirstDesc")}</p>
          </div>
        </div>
        <div className="public-donation-trust-item">
          <Eye size={20} />
          <div>
            <strong>{t("donation.fullTransparency")}</strong>
            <p>{t("donation.fullTransparencyDesc")}</p>
          </div>
        </div>
        <div className="public-donation-trust-item">
          <Award size={20} />
          <div>
            <strong>{t("donation.verifiedImpact")}</strong>
            <p>{t("donation.verifiedImpactDesc")}</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="public-donation-footer">
        <p>{t("donation.footer")}</p>
      </footer>
    </div>
  );
}
