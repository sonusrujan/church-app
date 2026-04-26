import { useState, useEffect, useCallback } from "react";
import { Church, QrCode, Download } from "lucide-react";
import QRCodeLib from "qrcode";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import PhotoUpload from "../../components/PhotoUpload";
import type { ChurchRow, ChurchDeleteImpact, IncomeSummary } from "../../types";
import { formatAmount, emptyWeeklyIncome } from "../../types";
import { useI18n } from "../../i18n";

export default function ChurchOpsTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, withAuthRequest, loadChurches, loadAdmins } = useApp();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChurchRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editLogoUrl, setEditLogoUrl] = useState("");
  const [editChurchCode, setEditChurchCode] = useState("");
  const [deleteImpact, setDeleteImpact] = useState<ChurchDeleteImpact | null>(null);
  const [income, setIncome] = useState<IncomeSummary | null>(null);
  const [page, setPage] = useState(1);
  const [joinQrUrl, setJoinQrUrl] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [results]);

  const generateJoinQr = useCallback(async (code: string) => {
    if (!code || !/^\d{8}$/.test(code)) return;
    try {
      const joinUrl = `${window.location.origin}/join?code=${code}`;
      const dataUrl = await QRCodeLib.toDataURL(joinUrl, { width: 400, margin: 2, errorCorrectionLevel: "H" });
      setJoinQrUrl(dataUrl);
    } catch { setJoinQrUrl(null); }
  }, []);

  function downloadJoinQr() {
    if (!joinQrUrl) return;
    const a = document.createElement("a");
    a.href = joinQrUrl;
    a.download = `church-join-qr-${editChurchCode}.png`;
    a.click();
  }

  async function searchChurches() {
    if (!isSuperAdmin) return;
    const rows = await withAuthRequest(
      "super-church-search",
      () => apiRequest<ChurchRow[]>(
        `/api/churches/search?query=${encodeURIComponent(query.trim())}`,
        { token },
      ),
      t("adminTabs.churchOps.successSearchComplete"),
    );
    if (rows) setResults(rows);
  }

  function selectChurch(church: ChurchRow) {
    setSelectedId(church.id);
    setEditName(church.name || "");
    setEditAddress(church.address || "");
    setEditLocation(church.location || "");
    setEditPhone(church.contact_phone || "");
    setEditLogoUrl(church.logo_url || "");
    setEditChurchCode(church.church_code || "");
    setDeleteImpact(null);
    setIncome(null);
    loadChurchIncome(church.id);
  }

  async function loadChurchIncome(churchId: string) {
    if (!isSuperAdmin || !churchId) return;
    const summary = await withAuthRequest(
      "super-church-income",
      () => apiRequest<IncomeSummary>(`/api/admins/income?church_id=${encodeURIComponent(churchId)}`, { token }),
      t("adminTabs.churchOps.successIncomeLoaded"),
    );
    if (summary) setIncome(summary);
  }

  async function updateChurch() {
    if (!isSuperAdmin || !selectedId) return;
    const updated = await withAuthRequest(
      "super-church-update",
      () => apiRequest<ChurchRow>(`/api/churches/id/${selectedId}`, {
        method: "PATCH", token,
        body: {
          name: editName.trim() || undefined,
          address: editAddress.trim() || null,
          location: editLocation.trim() || null,
          contact_phone: editPhone.trim() || null,
          church_code: editChurchCode.trim() || null,
          logo_url: editLogoUrl.trim() || null,
        },
      }),
      t("adminTabs.churchOps.successUpdated"),
    );
    if (!updated) return;
    setResults((cur) => cur.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    await loadChurches();
  }

  async function previewDelete() {
    if (!isSuperAdmin || !selectedId) return;
    const impact = await withAuthRequest(
      "super-church-impact",
      () => apiRequest<ChurchDeleteImpact>(`/api/churches/id/${selectedId}/delete-impact`, { token }),
      t("adminTabs.churchOps.successImpactLoaded"),
    );
    if (impact) setDeleteImpact(impact);
  }

  async function deleteChurch() {
    if (!isSuperAdmin || !selectedId) return;
    const result = await withAuthRequest(
      "super-church-delete",
      () => apiRequest<{ deleted: true; id: string }>(`/api/churches/id/${selectedId}?force=true`, {
        method: "DELETE", token, body: { force: true },
      }),
      t("adminTabs.churchOps.successDeleted"),
    );
    if (!result) return;
    setResults((cur) => cur.filter((r) => r.id !== selectedId));
    setSelectedId("");
    setDeleteImpact(null);
    await loadChurches();
    await loadAdmins();
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.churchOps.title")}</h3>
      <div className="field-stack">
        <label>{t("adminTabs.churchOps.labelSearchChurch")}<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("adminTabs.churchOps.placeholderSearch")} /></label>
        <div className="actions-row">
          <button className="btn" onClick={searchChurches} disabled={busyKey === "super-church-search"}>
            {busyKey === "super-church-search" ? t("common.searching") : t("adminTabs.churchOps.searchChurches")}
          </button>
        </div>
        <div className="list-stack">
          {results.length ? (
            <>
              {paginate(results, page, 8).map((c) => (
                <div key={c.id} className="list-item">
                  <strong>{c.name}</strong>
                  <span>{c.unique_id || c.church_code || t("adminTabs.churchOps.noCode")}</span>
                  <span>{c.location || t("adminTabs.churchOps.locationNotSet")}</span>
                  <div className="actions-row"><button className="btn" onClick={() => selectChurch(c)}>{t("adminTabs.churchOps.selectChurch")}</button></div>
                </div>
              ))}
              <Pagination page={page} total={totalPages(results.length, 8)} onPageChange={setPage} />
            </>
          ) : <EmptyState icon={<Church size={32} />} title={t("adminTabs.churchOps.emptyTitle")} description={t("adminTabs.churchOps.emptyDescription")} />}
        </div>
        {selectedId ? (
          <>
            <label>{t("adminTabs.churchOps.labelChurchName")}<input value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
            <label>{t("adminTabs.churchOps.labelAddress")}<input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} /></label>
            <label>{t("adminTabs.churchOps.labelLocation")}<input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} /></label>
            <label>{t("adminTabs.churchOps.labelContactPhone")}<input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} /></label>
            <label>{t("adminTabs.churchOps.labelChurchCode")}<input value={editChurchCode} onChange={(e) => setEditChurchCode(e.target.value)} /></label>
            {editChurchCode && /^\d{8}$/.test(editChurchCode) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
                <button className="btn btn-sm" onClick={() => generateJoinQr(editChurchCode)}>
                  <QrCode size={14} /> {t("adminTabs.churchOps.generateJoinQr")}
                </button>
                {joinQrUrl && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "white" }}>
                    <img src={joinQrUrl} alt="Join QR Code" style={{ width: 200, height: 200 }} />
                    <p style={{ fontSize: "0.8rem", color: "var(--secondary)", margin: 0 }}>{t("adminTabs.churchOps.joinQrHint")}</p>
                    <button className="btn btn-sm" onClick={downloadJoinQr}><Download size={14} /> {t("adminTabs.churchOps.downloadQr")}</button>
                  </div>
                )}
              </div>
            )}
            <div className="field-label">{t("adminTabs.churchOps.labelChurchLogo")}</div>
            <PhotoUpload
              currentUrl={editLogoUrl}
              onUploaded={(url) => setEditLogoUrl(url)}
              onDeleted={() => setEditLogoUrl("")}
              token={token}
              folder="logos"
              targetChurchId={selectedId}
              size={80}
              fallback={<Church size={32} />}
            />
            <div className="actions-row">
              <button className="btn" onClick={updateChurch} disabled={busyKey === "super-church-update"}>
                {busyKey === "super-church-update" ? t("adminTabs.churchOps.updating") : t("adminTabs.churchOps.updateChurch")}
              </button>
              <button className="btn" onClick={previewDelete} disabled={busyKey === "super-church-impact"}>
                {busyKey === "super-church-impact" ? t("common.loading") : t("adminTabs.churchOps.previewDeleteImpact")}
              </button>
              <button className="btn btn-danger" onClick={deleteChurch} disabled={busyKey === "super-church-delete"}>
                {busyKey === "super-church-delete" ? t("adminTabs.churchOps.deleting") : t("adminTabs.churchOps.deleteChurch")}
              </button>
            </div>
            {deleteImpact ? (
              <div className="notice notice-error">
                {t("adminTabs.churchOps.impactLabel")}: {t("adminTabs.churchOps.impactUsers")} {deleteImpact.users}, {t("adminTabs.churchOps.impactMembers")} {deleteImpact.members}, {t("adminTabs.churchOps.impactPastors")} {deleteImpact.pastors}, {t("adminTabs.churchOps.impactEvents")} {deleteImpact.church_events}, {t("adminTabs.churchOps.impactNotifications")} {deleteImpact.church_notifications}, {t("adminTabs.churchOps.impactPrayerRequests")} {deleteImpact.prayer_requests}, {t("adminTabs.churchOps.impactPayments")} {deleteImpact.payments}
              </div>
            ) : null}

            <h3 style={{ marginTop: '1.5rem' }}>{t("adminTabs.churchOps.churchIncomeTitle")}</h3>
            {income ? (
              <>
                <div className="stats-grid">
                  <div className="stat"><span>{t("adminTabs.churchOps.statDaily")}</span><strong>{formatAmount(income.daily_income)}</strong></div>
                  <div className="stat"><span>{t("adminTabs.churchOps.statMonthly")}</span><strong>{formatAmount(income.monthly_income)}</strong></div>
                  <div className="stat"><span>{t("adminTabs.churchOps.statYearly")}</span><strong>{formatAmount(income.yearly_income)}</strong></div>
                  <div className="stat"><span>{t("adminTabs.churchOps.statSuccessfulPayments")}</span><strong>{income.successful_payments_count || 0}</strong></div>
                </div>
                <div style={{ width: '100%', height: 260, marginTop: '1rem' }}>
                  <ResponsiveContainer>
                    <BarChart data={income?.weekly_income_breakdown || emptyWeeklyIncome} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--outline-variant)" opacity={0.5} />
                      <XAxis dataKey="day" stroke="var(--outline)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--outline)" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: 'rgba(0, 0, 0, 0.02)' }}
                        contentStyle={{ backgroundColor: 'var(--surface-container-lowest)', borderRadius: '8px', border: '1px solid var(--outline-variant)', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
                      />
                      <Bar dataKey="income" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <p className="muted">{t("adminTabs.churchOps.loadingIncome")}</p>
            )}
            <div className="actions-row">
              <button className="btn" onClick={() => loadChurchIncome(selectedId)} disabled={busyKey === "super-church-income"}>
                {busyKey === "super-church-income" ? t("adminTabs.churchOps.refreshing") : t("adminTabs.churchOps.refreshIncome")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </article>
  );
}
