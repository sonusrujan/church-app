import { useState, useEffect, useCallback } from "react";
import { Link2, Download, QrCode, Church, Copy, Check } from "lucide-react";
import QRCodeLib from "qrcode";
import qrLogoSrc from "../../assets/shalom-qr-logo.png";
import { useApp } from "../../context/AppContext";
import { getActiveChurchId, apiRequest } from "../../lib/api";
import { useI18n } from "../../i18n";

type Diocese = { id: string; name: string };
type ChurchItem = { id: string; name: string; location?: string | null };
type FundItem = string;

const SITE_URL = "https://shalomapp.in";
const QR_POSTER_WIDTH = 900;
const QR_POSTER_HEIGHT = 1180;
const QR_SIZE = 560;

function sanitizeFilePart(value: string) {
  return (value || "church")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "church";
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawCenteredLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 2,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = visible[visible.length - 1] || "";
    while (ctx.measureText(`${last}...`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1);
    }
    visible[visible.length - 1] = `${last}...`;
  }

  visible.forEach((line, index) => {
    ctx.fillText(line, centerX, y + index * lineHeight);
  });
  return y + visible.length * lineHeight;
}

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

  useEffect(() => {
    if (isSuperAdmin || selectedChurchId) return;
    const nextChurchId = getActiveChurchId() || memberDashboard?.church?.id || "";
    if (!nextChurchId) return;
    setSelectedChurchId(nextChurchId);
    setSelectedChurchName(memberDashboard?.church?.name || selectedChurchName);
  }, [isSuperAdmin, memberDashboard?.church?.id, memberDashboard?.church?.name, selectedChurchId, selectedChurchName]);

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
    apiRequest<FundItem[]>(`/api/donation-funds/public?church_id=${encodeURIComponent(selectedChurchId)}`)
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setFunds(data);
          setSelectedFund(data[0]);
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

  // Generate print/share-ready QR poster.
  const generateQR = useCallback(async () => {
    if (!donationLink) return;
    try {
      const qrUrl = await QRCodeLib.toDataURL(donationLink, {
        width: QR_SIZE,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#241d53", light: "#ffffff" },
      });

      const canvas = document.createElement("canvas");
      canvas.width = QR_POSTER_WIDTH;
      canvas.height = QR_POSTER_HEIGHT;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.fillStyle = "#f5f1ff";
      ctx.fillRect(0, 0, QR_POSTER_WIDTH, QR_POSTER_HEIGHT);

      ctx.fillStyle = "#241d53";
      ctx.fillRect(0, 0, QR_POSTER_WIDTH, 250);

      ctx.fillStyle = "#ffffff";
      ctx.font = "700 30px Arial, Helvetica, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("SHALOM CHURCH APP", QR_POSTER_WIDTH / 2, 78);

      ctx.font = "800 64px Arial, Helvetica, sans-serif";
      ctx.fillText("SCAN TO DONATE", QR_POSTER_WIDTH / 2, 160);

      ctx.font = "500 24px Arial, Helvetica, sans-serif";
      ctx.fillStyle = "#ded7ff";
      ctx.fillText("Secure church donation link", QR_POSTER_WIDTH / 2, 208);

      ctx.save();
      ctx.shadowColor = "rgba(36, 29, 83, 0.16)";
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 14;
      drawRoundRect(ctx, 70, 286, 760, 770, 36);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();

      ctx.textAlign = "center";
      ctx.fillStyle = "#241d53";
      ctx.font = "800 36px Arial, Helvetica, sans-serif";
      const titleY = drawCenteredLines(ctx, selectedChurchName || "Church Donation", QR_POSTER_WIDTH / 2, 350, 650, 42, 2);

      if (selectedFund) {
        ctx.font = "700 23px Arial, Helvetica, sans-serif";
        ctx.fillStyle = "#6b5fb4";
        drawCenteredLines(ctx, `Fund: ${selectedFund}`, QR_POSTER_WIDTH / 2, titleY + 18, 620, 30, 2);
      }

      const qrX = (QR_POSTER_WIDTH - QR_SIZE) / 2;
      const qrY = 480;
      const qrImage = await loadCanvasImage(qrUrl);
      ctx.save();
      ctx.shadowColor = "rgba(36, 29, 83, 0.10)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      drawRoundRect(ctx, qrX - 24, qrY - 24, QR_SIZE + 48, QR_SIZE + 48, 28);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
      ctx.drawImage(qrImage, qrX, qrY, QR_SIZE, QR_SIZE);

      try {
        const logo = await loadCanvasImage(qrLogoSrc);
        const logoSize = 112;
        const logoX = QR_POSTER_WIDTH / 2 - logoSize / 2;
        const logoY = qrY + QR_SIZE / 2 - logoSize / 2;
        ctx.beginPath();
        ctx.arc(QR_POSTER_WIDTH / 2, qrY + QR_SIZE / 2, logoSize / 2 + 12, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(QR_POSTER_WIDTH / 2, qrY + QR_SIZE / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        ctx.restore();
      } catch {
        // QR still remains usable if the optional logo cannot be loaded.
      }

      ctx.fillStyle = "#241d53";
      ctx.font = "800 29px Arial, Helvetica, sans-serif";
      ctx.fillText("Open camera, scan, and complete the payment", QR_POSTER_WIDTH / 2, 1110);

      ctx.fillStyle = "#6b6387";
      ctx.font = "500 20px Arial, Helvetica, sans-serif";
      drawCenteredLines(ctx, donationLink, QR_POSTER_WIDTH / 2, 1144, 760, 24, 2);

      setQrDataUrl(canvas.toDataURL("image/png"));
    } catch {
      setQrDataUrl("");
    }
  }, [donationLink, selectedChurchName, selectedFund]);

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
    a.download = `donation-qr-poster-${sanitizeFilePart(selectedChurchName)}.png`;
    a.click();
  }

  return (
    <article className="panel">
      <h3 style={{ marginBottom: "0.5rem" }}>
        <QrCode size={20} style={{ verticalAlign: "middle", marginRight: 6 }} />
        {t("adminTabs.donationLinks.title")}
      </h3>
      <p className="muted" style={{ fontSize: "0.875rem", marginBottom: "1.5rem" }}>
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
        <p className="muted" style={{ textAlign: "center", padding: "2rem 0" }}>
          {isSuperAdmin ? t("adminTabs.donationLinks.selectScopeHint") : t("adminTabs.donationLinks.noChurchSelected")}
        </p>
      )}
    </article>
  );
}
