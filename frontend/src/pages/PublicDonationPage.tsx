import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Heart, Users, Eye, Award, ChevronRight, MapPin, Church, ExternalLink } from "lucide-react";
import shalomLogo from "../assets/shalom-logo.png";
import { useI18n } from "../i18n";
import { isValidEmail } from "../types";
import { apiRequest } from "../lib/api";

const PRESET_AMOUNTS = [100, 500, 1000, 2500, 5000, 10000];

type FundOption = { name: string; description: string };

type Diocese = { id: string; name: string };
type ChurchItem = { id: string; name: string; location?: string | null };
type PublicPaymentConfig = {
  payments_enabled: boolean;
  public_donation_fee_percent: number;
};

type Props = {
  isLoggedIn?: boolean;
  userChurch?: { id: string; name: string };
};

export default function PublicDonationPage({ isLoggedIn = false, userChurch }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();

  // URL params for QR/link pre-fill
  const urlChurchId = searchParams.get("church") || "";
  const urlFund = searchParams.get("fund") || "";

  // Diocese → Church browsing state
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [selectedDioceseId, setSelectedDioceseId] = useState("");
  const [churches, setChurches] = useState<ChurchItem[]>([]);
  const [loadingChurches, setLoadingChurches] = useState(false);

  // Selected church
  const [selectedChurchId, setSelectedChurchId] = useState(urlChurchId || userChurch?.id || "");
  const [selectedChurchName, setSelectedChurchName] = useState(userChurch?.name || "");

  const DEFAULT_FUND_OPTIONS: FundOption[] = useMemo(() => [
    { name: t("donation.fundGeneralOffering"), description: "" },
    { name: t("donation.fundBuildingFund"), description: "" },
    { name: t("donation.fundMissionOutreach"), description: "" },
    { name: t("donation.fundYouthMinistry"), description: "" },
    { name: t("donation.fundCommunityAid"), description: "" },
    { name: t("donation.fundOther"), description: "" },
  ], [t]);

  // Fund selection
  const [fundOptions, setFundOptions] = useState<FundOption[]>([]);
  const [fund, setFund] = useState(urlFund || t("donation.fundGeneralOffering"));

  // Amount
  const [amount, setAmount] = useState("");
  const [customAmount, setCustomAmount] = useState("");

  // Donor info (all mandatory)
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [donorPhone, setDonorPhone] = useState("");
  const [emailWarning, setEmailWarning] = useState("");
  const [message, setMessage] = useState("");
  const [paymentConfig, setPaymentConfig] = useState<PublicPaymentConfig>({
    payments_enabled: true,
    public_donation_fee_percent: 0,
  });

  // Whether user pre-selected a church via URL or login
  const isChurchPreSelected = !!(urlChurchId || userChurch?.id);
  const [loadError, setLoadError] = useState("");

  // Initialize fund options from translated defaults
  useEffect(() => {
    if (!fundOptions.length) setFundOptions(DEFAULT_FUND_OPTIONS);
  }, [DEFAULT_FUND_OPTIONS]);

  useEffect(() => {
    if (!urlChurchId && userChurch?.id && !selectedChurchId) {
      setSelectedChurchId(userChurch.id);
      setSelectedChurchName(userChurch.name);
    }
  }, [selectedChurchId, urlChurchId, userChurch?.id, userChurch?.name]);

  // Fetch dioceses on mount (only if no pre-selected church)
  useEffect(() => {
    if (isChurchPreSelected) return;
    apiRequest<Diocese[]>("/api/diocese/public-list")
      .then((data) => {
        if (Array.isArray(data)) setDioceses(data);
      })
      .catch(() => { setLoadError(t("errors.loadFailed") || "Failed to load. Please refresh."); });
  }, [isChurchPreSelected]);

  // Fetch churches when diocese is selected
  useEffect(() => {
    if (!selectedDioceseId) { setChurches([]); return; }
    setLoadingChurches(true);
    apiRequest<ChurchItem[]>(`/api/diocese/public-churches?diocese_id=${encodeURIComponent(selectedDioceseId)}`)
      .then((data) => {
        if (Array.isArray(data)) setChurches(data);
      })
      .catch(() => { setLoadError(t("errors.loadFailed") || "Failed to load. Please refresh."); })
      .finally(() => setLoadingChurches(false));
  }, [selectedDioceseId]);

  // When URL has church param, resolve the actual church name from the API
  useEffect(() => {
    if (!urlChurchId || selectedChurchName) return;
    // Set temporary placeholder while loading
    setSelectedChurchName("...");
    apiRequest<{ name: string }>(`/api/churches/public-info?church_id=${encodeURIComponent(urlChurchId)}`)
      .then((data) => { if (data?.name) setSelectedChurchName(data.name); })
      .catch(() => { setSelectedChurchName(t("donation.selectedChurch")); });
  }, [urlChurchId, selectedChurchName]);

  // Fetch funds when church is selected
  useEffect(() => {
    if (!selectedChurchId) return;
    apiRequest<FundOption[]>(`/api/donation-funds/public?church_id=${encodeURIComponent(selectedChurchId)}`)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setFundOptions(data);
          const names = data.map((d) => d.name);
          if (urlFund && names.includes(urlFund)) {
            setFund(urlFund);
          } else if (!fund || !names.includes(fund)) {
            setFund(data[0].name);
          }
        }
      })
      .catch(() => {
        setFundOptions(DEFAULT_FUND_OPTIONS);
        if (!fund) setFund(DEFAULT_FUND_OPTIONS[0].name);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChurchId]);

  useEffect(() => {
    if (!selectedChurchId) {
      setPaymentConfig({ payments_enabled: true, public_donation_fee_percent: 0 });
      return;
    }
    apiRequest<PublicPaymentConfig>(`/api/payments/public/config?church_id=${encodeURIComponent(selectedChurchId)}`)
      .then((data) => {
        setPaymentConfig({
          payments_enabled: Boolean(data.payments_enabled),
          public_donation_fee_percent: Number(data.public_donation_fee_percent || 0),
        });
      })
      .catch(() => {
        setPaymentConfig({ payments_enabled: false, public_donation_fee_percent: 0 });
      });
  }, [selectedChurchId]);

  const selectedAmount = customAmount ? Number(customAmount) : Number(amount);
  const publicDonationFeePercent = Number(paymentConfig.public_donation_fee_percent || 0);
  const publicDonationFeeAmount =
    paymentConfig.payments_enabled && publicDonationFeePercent > 0 && Number.isFinite(selectedAmount)
      ? Math.round(selectedAmount * publicDonationFeePercent) / 100
      : 0;
  const paymentTotalAmount = selectedAmount + publicDonationFeeAmount;
  const isValidAmount = Number.isFinite(selectedAmount) && selectedAmount > 0;
  const isFormValid = useMemo(() => {
    return (
      !!selectedChurchId &&
      isValidAmount &&
      !!fund &&
      !!donorName.trim() &&
      !!donorEmail.trim() &&
      isValidEmail(donorEmail.trim()) &&
      !!donorPhone.trim() &&
      donorPhone.trim().length >= 10
    );
  }, [selectedChurchId, isValidAmount, fund, donorName, donorEmail, donorPhone]);

  function handlePresetClick(value: number) {
    setAmount(String(value));
    setCustomAmount("");
  }

  function handleCustomAmountChange(value: string) {
    const cleaned = value.replace(/[^0-9.]/g, "").replace(/(\..*?)\..*/g, "$1");
    setCustomAmount(cleaned);
    setAmount("");
  }

  function handleSelectChurch(church: ChurchItem) {
    setSelectedChurchId(church.id);
    setSelectedChurchName(church.name);
  }

  function handleChangeChurch() {
    setSelectedChurchId("");
    setSelectedChurchName("");
    setSelectedDioceseId("");
    setFundOptions(DEFAULT_FUND_OPTIONS);
    setFund("");
  }

  function handleContinue() {
    if (!isFormValid) return;
    const trimmedEmail = donorEmail.trim();
    if (!isValidEmail(trimmedEmail)) {
      setEmailWarning(t("donation.invalidEmail"));
      return;
    }
    navigate("/donate/checkout", {
      state: {
        amount: selectedAmount,
        fund,
        churchId: selectedChurchId,
        churchName: selectedChurchName,
        donorName: donorName.trim(),
        donorEmail: trimmedEmail,
        donorPhone: donorPhone.trim(),
        message: message.trim(),
        platformFeeEnabled: paymentConfig.payments_enabled && paymentConfig.public_donation_fee_percent > 0,
        platformFeePercent: paymentConfig.public_donation_fee_percent,
      },
    });
  }

  // Whether the user is in their own church context (not public browsing)
  const isOwnChurchDonation = isLoggedIn && !!userChurch;

  return (
    <div className={`public-donation-shell ${isOwnChurchDonation ? "church-donation-mode" : ""}`}>
      {/* Nav bar — only for non-logged-in users */}
      {!isLoggedIn && (
      <nav className="public-donation-nav">
        <div className="public-donation-nav-inner">
          <div className="public-donation-brand">
            <img src={shalomLogo} alt="Shalom" className="public-donation-logo" />
            <span className="public-donation-brand-name">Shalom</span>
          </div>
          <a href="/signin" className="btn btn-ghost public-donation-signin-link">
            {t("donation.signIn")}
          </a>
        </div>
      </nav>
      )}

      {/* Hero — only for public (non-logged-in) users */}
      {!isOwnChurchDonation && (
      <section className="public-donation-hero">
        <div className="public-donation-hero-badge">
          <Heart size={16} />
          <span>{t("donation.giveWithPurpose")}</span>
        </div>
        <h1>{t("donation.supportMission")}</h1>
        <p>{t("donation.heroDescription")}</p>
      </section>
      )}

      {/* Church header for logged-in users */}
      {isOwnChurchDonation && (
        <section className="church-donation-header">
          <Church size={22} />
          <div>
            <h2>{t("donation.donateToYourChurch")}</h2>
            <p className="muted">{selectedChurchName}</p>
          </div>
        </section>
      )}

      {/* Donation Form */}
      <section className="public-donation-form-section">

        {loadError && (
          <div className="notice notice-error" style={{ marginBottom: 16 }}>
            {loadError}
            <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>{t("common.retry")}</button>
          </div>
        )}

        {/* Step 1: Select Church (skip if pre-selected) */}
        {!selectedChurchId ? (
          <div className="public-donation-step">
            <div className="public-donation-step-header">
              <span className="public-donation-step-number">1</span>
              <h2>{t("donation.selectChurch")}</h2>
            </div>

            {/* Diocese selector */}
            <label className="public-donation-label">{t("donation.chooseDiocese")}</label>
            <select
              className="public-donation-select"
              value={selectedDioceseId}
              onChange={(e) => { setSelectedDioceseId(e.target.value); setSelectedChurchId(""); setSelectedChurchName(""); }}
            >
              <option value="">{t("donation.selectDiocesePlaceholder")}</option>
              {dioceses.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            {/* Churches list */}
            {selectedDioceseId && (
              <div className="public-donation-church-list">
                {loadingChurches ? (
                  <p className="public-donation-loading">{t("common.loading")}...</p>
                ) : churches.length === 0 ? (
                  <p className="public-donation-empty">{t("donation.noChurchesInDiocese")}</p>
                ) : (
                  churches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="public-donation-church-card"
                      onClick={() => handleSelectChurch(c)}
                    >
                      <div className="public-donation-church-info">
                        <Church size={18} />
                        <div>
                          <strong>{c.name}</strong>
                          {c.location && <span className="public-donation-church-loc"><MapPin size={12} /> {c.location}</span>}
                        </div>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          /* Church selected — show summary with change option */
          <div className="public-donation-step public-donation-step-done">
            <div className="public-donation-step-header">
              <span className="public-donation-step-number public-donation-step-check">✓</span>
              <h2>{t("donation.churchSelected")}</h2>
            </div>
            <div className="public-donation-selected-church">
              <Church size={18} />
              <strong>{selectedChurchName}</strong>
              {!isChurchPreSelected && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleChangeChurch}>
                  {t("common.change")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Fund */}
        {selectedChurchId && (
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
                <option key={f.name} value={f.name}>{f.name}</option>
              ))}
            </select>
            {(() => { const sel = fundOptions.find((f) => f.name === fund); return sel?.description ? <p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>{sel.description}</p> : null; })()}
          </div>
        )}

        {/* Step 3: Amount */}
        {selectedChurchId && fund && (
          <div className="public-donation-step">
            <div className="public-donation-step-header">
              <span className="public-donation-step-number">3</span>
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
        )}

        {/* Step 4: Donor Info (all mandatory) */}
        {selectedChurchId && fund && isValidAmount && (
          <div className="public-donation-step">
            <div className="public-donation-step-header">
              <span className="public-donation-step-number">4</span>
              <h2>{t("donation.yourInfo")} <span style={{ color: "#e53e3e", fontSize: "0.85em" }}>*</span></h2>
            </div>
            <div className="public-donation-fields">
              <input
                type="text"
                placeholder={t("donation.fullName") + " *"}
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                maxLength={200}
                required
              />
              <input
                type="email"
                placeholder={t("donation.emailAddress") + " *"}
                value={donorEmail}
                onChange={(e) => { setDonorEmail(e.target.value); if (emailWarning) setEmailWarning(""); }}
                onBlur={() => { const v = donorEmail.trim(); if (v && !isValidEmail(v)) setEmailWarning(t("donation.invalidEmail")); else setEmailWarning(""); }}
                maxLength={254}
                required
              />
              {emailWarning && <span className="field-error">{emailWarning}</span>}
              <input
                type="tel"
                placeholder={t("donation.phoneNumber") + " *"}
                value={donorPhone}
                onChange={(e) => setDonorPhone(e.target.value.replace(/[^0-9+\- ]/g, ""))}
                maxLength={20}
                required
              />
              <textarea
                placeholder={t("donation.leaveMsgPlaceholder")}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Continue Button */}
        {selectedChurchId && (
          <button
            className="btn btn-primary public-donation-continue-btn"
            onClick={handleContinue}
            disabled={!isFormValid || !paymentConfig.payments_enabled}
          >
            {t("donation.continueToPayment")} — ₹{isValidAmount ? paymentTotalAmount.toLocaleString("en-IN") : "0"}
          </button>
        )}
        {selectedChurchId && !paymentConfig.payments_enabled ? (
          <div className="notice notice-warning" style={{ marginTop: "0.75rem" }}>
            {t("dashboard.errorPaymentsDisabled")}
          </div>
        ) : null}
      </section>

      {/* Trust Badges — only for public users */}
      {!isOwnChurchDonation && (
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
      )}

      {/* Link to public donation page for logged-in users */}
      {isOwnChurchDonation && (
        <section className="church-donation-public-link">
          <Link to="/donate/public" className="btn btn-ghost">
            <ExternalLink size={16} />
            {t("donation.donateToAnotherChurch")}
          </Link>
        </section>
      )}

      {/* Footer */}
      <footer className="public-donation-footer">
        <p>{t("donation.footer")}</p>
      </footer>
    </div>
  );
}
