import { useState, useEffect, useCallback } from "react";
import { Clock } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { ScheduledReportRow } from "../../types";
import { formatDate } from "../../types";

export default function ScheduledReportsTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [reports, setReports] = useState<ScheduledReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportType, setReportType] = useState("members");
  const [frequency, setFrequency] = useState("weekly");
  const [emails, setEmails] = useState("");
  const [churchId, setChurchId] = useState(churches[0]?.id || "");

  const loadReports = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const churchParam = isSuperAdmin && churchId ? `?church_id=${encodeURIComponent(churchId)}` : "";
      const data = await apiRequest<ScheduledReportRow[]>(`/api/admin/scheduled-reports${churchParam}`, { token });
      setReports(data);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.scheduledReports.loadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice, isSuperAdmin, churchId]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  async function createReport() {
    const cid = isSuperAdmin ? churchId : (authContext?.auth.church_id || "");
    if (!cid) { setNotice({ tone: "error", text: t("adminTabs.scheduledReports.selectChurchFirst") }); return; }
    const list = emails.split(",").map((e) => e.trim()).filter(Boolean);
    if (!list.length) { setNotice({ tone: "error", text: t("adminTabs.scheduledReports.recipientRequired") }); return; }
    // Split into emails and phone numbers
    const emailList = list.filter((e) => e.includes("@"));
    const phoneList = list.filter((e) => !e.includes("@") && /^\+?\d[\d\s-]{6,14}$/.test(e.replace(/[\s-]/g, "")));
    if (!emailList.length && !phoneList.length) { setNotice({ tone: "error", text: "Enter valid emails or phone numbers separated by commas." }); return; }
    await withAuthRequest("create-report", async () => {
      await apiRequest("/api/admin/scheduled-reports", {
        method: "POST", token,
        body: { church_id: cid, report_type: reportType, frequency, recipient_emails: emailList.length ? emailList : undefined, recipient_phones: phoneList.length ? phoneList : undefined },
      });
      setEmails("");
      void loadReports();
    }, t("adminTabs.scheduledReports.createSuccess"));
  }

  async function deleteReport(id: string) {
    await withAuthRequest("delete-report", async () => {
      await apiRequest(`/api/admin/scheduled-reports/${encodeURIComponent(id)}`, { method: "DELETE", token });
      void loadReports();
    }, t("adminTabs.scheduledReports.deleteSuccess"));
  }

  async function toggleReport(id: string, enabled: boolean) {
    await withAuthRequest("toggle-report", async () => {
      await apiRequest(`/api/admin/scheduled-reports/${encodeURIComponent(id)}`, { method: "PATCH", token, body: { enabled } });
      void loadReports();
    }, t(`adminTabs.scheduledReports.${enabled ? "reportEnabled" : "reportDisabled"}`));
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.scheduledReports.title")}</h3>
      <p className="muted">{t("adminTabs.scheduledReports.description")}</p>
      <div className="field-stack">
        {isSuperAdmin ? (
          <label>
            Church
            <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        ) : null}
        <label>
          {t("adminTabs.scheduledReports.reportTypeLabel")}
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            <option value="members">{t("adminTabs.scheduledReports.reportTypeMembers")}</option>
            <option value="payments">{t("adminTabs.scheduledReports.reportTypePayments")}</option>
            <option value="donations">{t("adminTabs.scheduledReports.reportTypeDonations")}</option>
          </select>
        </label>
        <label>
          {t("adminTabs.scheduledReports.frequencyLabel")}
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="daily">{t("adminTabs.scheduledReports.frequencyDaily")}</option>
            <option value="weekly">{t("adminTabs.scheduledReports.frequencyWeekly")}</option>
            <option value="monthly">{t("adminTabs.scheduledReports.frequencyMonthly")}</option>
          </select>
        </label>
        <label>
          Recipients (emails or phones, comma-separated)
          <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="email@example.com, +919876543210" />
        </label>
        <button className="btn btn-primary" onClick={() => void createReport()} disabled={busyKey === "create-report"}>
          {busyKey === "create-report" ? t("adminTabs.scheduledReports.creating") : t("adminTabs.scheduledReports.createButton")}
        </button>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <div className="actions-row" style={{ marginBottom: "1rem" }}>
          <button className="btn" onClick={() => void loadReports()} disabled={loading}>
            {loading ? t("common.loading") : t("common.refresh")}
          </button>
        </div>
        {loading && !reports.length ? (
          <LoadingSkeleton lines={3} />
        ) : reports.length ? (
          reports.map((r) => (
            <div key={r.id} className="activity-event-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6, padding: "12px 0", borderBottom: "1px solid var(--border-color, #eee)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
                <strong>{r.report_type}</strong>
                <span className={`event-badge ${r.enabled ? "badge-created" : "badge-overdue"}`}>{r.enabled ? t("adminTabs.scheduledReports.badgeActive") : t("adminTabs.scheduledReports.badgePaused")}</span>
                <span className="event-meta">{r.frequency}</span>
              </div>
              <span className="muted">{t("adminTabs.scheduledReports.recipientsLabel")} {[...(r.recipient_emails || []), ...(r.recipient_phones || [])].join(", ")}</span>
              {r.last_sent_at ? <span className="muted">{t("adminTabs.scheduledReports.lastSentLabel")} {formatDate(r.last_sent_at)}</span> : <span className="muted">{t("adminTabs.scheduledReports.neverSent")}</span>}
              <div className="actions-row" style={{ marginTop: 4 }}>
                <button className="btn" onClick={() => void toggleReport(r.id, !r.enabled)} disabled={busyKey === "toggle-report"}>
                  {r.enabled ? t("adminTabs.scheduledReports.pauseButton") : t("adminTabs.scheduledReports.enableButton")}
                </button>
                <button className="btn" onClick={() => void deleteReport(r.id)} disabled={busyKey === "delete-report"}>
                  {t("adminTabs.scheduledReports.deleteReport")}
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState icon={<Clock size={32} />} title={t("adminTabs.scheduledReports.emptyTitle")} description={t("adminTabs.scheduledReports.emptyDescription")} />
        )}
      </div>
    </article>
  );
}
