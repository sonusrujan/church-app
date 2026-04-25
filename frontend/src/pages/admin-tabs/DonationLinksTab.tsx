import { useState, useEffect, useCallback } from "react";
import { Link2, Download, QrCode, Church, Copy, Check } from "lucide-react";
import QRCodeLib from "qrcode";
import qrLogoSrc from "../../assets/shalom-qr-logo.png";
import { useApp } from "../../context/AppContext";
import { getActiveChurchId, apiRequest } from "../../lib/api";
import { useI18n } from "../../i18n";

type Diocese = { id: string; name: string };
type ChurchItem = { id: string; name: string; location?: string | null };
type FundRaw = { name: string; description?: string | null } | string;
type FundItem = string;

const SITE_URL = "https://shalomapp.in";

export default function DonationLinksTab() {
  const { memberDashboard, isSuperAdmin } = useApp();
  const { t } = useI18n();

  // For super admin: diocese → church picker
  const [dioceses, setDioceses] = useState<Diocese[]>([]);
  const [selectedDioceseId, setSelectedDioceseId] = useState("");
  const [churches, setChurches] = useState<ChurchItem[]>([]);

  // Selected church
  const defaultChurchId = getActiveChurchId() || memberDashboard?.church?.id || "";
  const defaultChurchName = memberDashboard?.church?.name || "";
  const [selectedChurchId, setSelectedChurchId] = useState(defaultChurchId);
  const [selectedChurchName, setSelectedChurchName] = useState(defaultChurchName);

  // Funds
  const [funds, setFunds] = useState<FundItem[]>([]);
  const [selectedFund, setSelectedFund] = useState("");

  // Generated link & QR
  const [donationLink, setDonationLink] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Load dioceses for super admin
  useEffect(() => {
    if (!isSuperAdmin) return;
    apiRequest<Diocese[]>("/api/diocese/public-list")
      .then((data) => { if (Array.isArray(data)) setDioceses(data); })
      .catch((e) => console.warn("Failed to load dioceses", e));
  }, [isSuperAdmin]);

  // Load churches for selected diocese (super admin)
  useEffect(() => {
    if (!selectedDioceseId) { setChurches([]); return; }
    apiRequest<ChurchItem[]>(`/api/diocese/public-churches?diocese_id=${encodeURIComponent(selectedDioceseId)}`)
      .then((data) => { if (Array.isArray(data)) setChurches(data); })
      .catch((e) => console.warn("Failed to load churches", e));
  }, [selectedDioceseId]);

  // Load funds for selected church
  useEffect(() => {
    if (!selectedChurchId) { setFunds([]); return; }
    apiRequest<FundRaw[]>(`/api/donation-funds/public?church_id=${encodeURIComponent(selectedChurchId)}`)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const names = data.map((f) => (typeof f === "string" ? f : f.name));
          setFunds(names);
          setSelectedFund(names[0]);
        }
      })
      .catch((e) => console.warn("Failed to load funds", e));
  }, [selectedChurchId]);

  // Generate link whenever church or fund changes
  useEffect(() => {
    if (!selectedChurchId) { setDonationLink(""); return; }
    const params = new URLSearchParams({ church: selectedChurchId });
    if (selectedFund) params.set("fund", selectedFund);
    setDonationLink(`${SITE_URL}/donate?${params.toString()}`);
  }, [selectedChurchId, selectedFund]);

  // Generate QR code with logo overlay
  const generateQR = useCallback(async () => {
    if (!donationLink) return;
    try {
      // Generate QR as data URL at high resolution
      const qrUrl = await QRCodeLib.toDataURL(donationLink, {
        width: 512,
        margin: 2,
        errorCorrectionLevel: "H", // High EC to accommodate logo overlay
        color: { dark: "#041627", light: "#ffffff" },
      });

      // Create canvas and draw QR + logo
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d")!;

      // Draw QR
      const qrImg = new Image();
      qrImg.crossOrigin = "anonymous";
      qrImg.onload = () => {
        ctx.drawImage(qrImg, 0, 0, 512, 512);

        // Draw logo in center
        const logo = new Image();
        logo.crossOrigin = "anonymous";
        logo.onload = () => {
          const logoSize = 100;
          const x = (512 - logoSize) / 2;
          const y = (512 - logoSize) / 2;

          // White circle background
          ctx.beginPath();
          ctx.arc(256, 256, logoSize / 2 + 6, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          // Clip to circle for logo
          ctx.save();
          ctx.beginPath();
          ctx.arc(256, 256, logoSize / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(logo, x, y, logoSize, logoSize);
          ctx.restore();

          setQrDataUrl(canvas.toDataURL("image/png"));
        };
        logo.onerror = () => {
          // If logo fails to load, still show QR without logo
          setQrDataUrl(canvas.toDataURL("image/png"));
        };
        logo.src = qrLogoSrc;
      };
      qrImg.src = qrUrl;
    } catch {
      setQrDataUrl("");
    }
  }, [donationLink]);

  useEffect(() => { generateQR(); }, [generateQR]);

  function handleCopyLink() {
    if (!donationLink) return;
    navigator.clipboard.writeText(donationLink).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }).catch(() => {});
  }

  function handleDownloadQR() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `donation-qr-${selectedChurchName.replace(/\s+/g, "-").toLowerCase() || "church"}.png`;
    a.click();
  }

  return (
    <div className="admin-tab-content">
      <h2 style={{ marginBottom: "0.5rem" }}>
        <QrCode size={20} style={{ verticalAlign: "middle", marginRight: 6 }} />
        {t("adminTabs.donationLinks.title")}
      </h2>
      <p style={{ color: "var(--on-surface-variant)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        {t("adminTabs.donationLinks.description")}
      </p>

      {/* Super Admin: Diocese → Church picker */}
      {isSuperAdmin && (
        <div className="admin-section" style={{ marginBottom: "1.5rem" }}>
          <label className="field-label">{t("adminTabs.donationLinks.diocese")}</label>
          <select
            className="field-input"
            value={selectedDioceseId}
            onChange={(e) => {
              setSelectedDioceseId(e.target.value);
              setSelectedChurchId("");
              setSelectedChurchName("");
            }}
          >
            <option value="">{t("adminTabs.donationLinks.selectDiocese")}</option>
            {dioceses.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {selectedDioceseId && (
            <>
              <label className="field-label" style={{ marginTop: "0.75rem" }}>{t("adminTabs.donationLinks.church")}</label>
              <select
                className="field-input"
                value={selectedChurchId}
                onChange={(e) => {
                  const ch = churches.find((c) => c.id === e.target.value);
                  setSelectedChurchId(e.target.value);
                  setSelectedChurchName(ch?.name || "");
                }}
              >
                <option value="">{t("adminTabs.donationLinks.selectChurch")}</option>
                {churches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.location ? ` (${c.location})` : ""}</option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {/* Church admin sees their church name */}
      {!isSuperAdmin && selectedChurchName && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", padding: "0.75rem", background: "var(--secondary-container)", borderRadius: "var(--radius-md)" }}>
          <Church size={18} />
          <strong>{selectedChurchName}</strong>
        </div>
      )}

      {/* Fund selector */}
      {selectedChurchId && funds.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <label className="field-label">{t("adminTabs.donationLinks.fund")}</label>
          <select
            className="field-input"
            value={selectedFund}
            onChange={(e) => setSelectedFund(e.target.value)}
          >
            {funds.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      )}

      {/* Generated link */}
      {donationLink && (
        <div className="donation-link-output">
          <label className="field-label">
            <Link2 size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {t("adminTabs.donationLinks.donationLink")}
          </label>
          <div className="donation-link-row">
            <input
              type="text"
              className="field-input"
              value={donationLink}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="btn btn-primary btn-sm" onClick={handleCopyLink} style={{ whiteSpace: "nowrap" }}>
              {copiedLink ? <><Check size={14} /> {t("common.copied")}</> : <><Copy size={14} /> {t("common.copy")}</>}
            </button>
          </div>
        </div>
      )}

      {/* QR Code preview */}
      {qrDataUrl && (
        <div className="donation-qr-preview">
          <label className="field-label">
            <QrCode size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {t("adminTabs.donationLinks.qrCode")}
          </label>
          <div className="donation-qr-image-wrap">
            <img src={qrDataUrl} alt="Donation QR Code" className="donation-qr-image" />
          </div>
          <button className="btn btn-primary" onClick={handleDownloadQR} style={{ marginTop: "0.75rem" }}>
            <Download size={16} /> {t("adminTabs.donationLinks.downloadQR")}
          </button>
        </div>
      )}

      {!selectedChurchId && (
        <p style={{ color: "var(--outline)", textAlign: "center", padding: "2rem 0" }}>
          {isSuperAdmin ? "Select a diocese and church above to generate donation links." : "No church selected."}
        </p>
      )}
    </div>
  );
}
