import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";
import { formatDate } from "../../types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type DioceseOption = { id: string; name: string };
type ChurchOption = { id: string; name: string; diocese_id: string | null };

export default function ExportTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, withAuthRequest } = useApp();

  const [dioceses, setDioceses] = useState<DioceseOption[]>([]);
  const [filteredChurches, setFilteredChurches] = useState<ChurchOption[]>([]);
  const [selectedDiocese, setSelectedDiocese] = useState("");
  const [selectedChurch, setSelectedChurch] = useState("");

  // Load dioceses on mount (SuperAdmin only)
  useEffect(() => {
    if (!isSuperAdmin) return;
    apiRequest<DioceseOption[]>("/api/push/dioceses", { token }).then(setDioceses).catch((e) => console.warn("Failed to load dioceses", e));
  }, [token, isSuperAdmin]);

  // Load churches when diocese changes
  useEffect(() => {
    if (!isSuperAdmin) return;
    const url = selectedDiocese
      ? `/api/push/churches?diocese_id=${selectedDiocese}`
      : "/api/push/churches";
    apiRequest<ChurchOption[]>(url, { token }).then(setFilteredChurches).catch((e) => console.warn("Failed to load churches", e));
    setSelectedChurch("");
  }, [selectedDiocese, token, isSuperAdmin]);

  async function handleExport(type: "members" | "payments" | "donations" | "monthly-dues") {
    if (isSuperAdmin && !selectedChurch) return;
    await withAuthRequest(`export-${type}`, async () => {
      const churchParam = isSuperAdmin ? `?church_id=${encodeURIComponent(selectedChurch)}` : "";
      const blob = await apiBlobRequest(
        `/api/admin/export/${type}${churchParam}`,
        { token, accept: "text/csv" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }, t("adminTabs.export.successExported", { type }));
  }

  const exportDisabled = isSuperAdmin && !selectedChurch;

  return (
    <article className="panel">
      <h3>{t("adminTabs.export.title")}</h3>
      <p className="muted">{t("adminTabs.export.description")}</p>

      {isSuperAdmin && (
        <div className="field-stack" style={{ marginBottom: "1.5rem", display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label style={{ flex: "1 1 220px" }}>
            {t("adminTabs.export.labelDiocese")}
            <select value={selectedDiocese} onChange={(e) => setSelectedDiocese(e.target.value)}>
              <option value="">{t("adminTabs.export.allDioceses")}</option>
              {dioceses.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 260px" }}>
            {t("admin.church")}
            <select value={selectedChurch} onChange={(e) => setSelectedChurch(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {filteredChurches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="actions-row" style={{ flexWrap: "wrap", gap: 12 }}>
        <button className="btn btn-primary" onClick={() => void handleExport("members")} disabled={exportDisabled || busyKey === "export-members"}>
          <Download size={16} /> {busyKey === "export-members" ? t("adminTabs.export.exporting") : t("adminTabs.export.membersCsv")}
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport("payments")} disabled={exportDisabled || busyKey === "export-payments"}>
          <Download size={16} /> {busyKey === "export-payments" ? t("adminTabs.export.exporting") : t("adminTabs.export.paymentsCsv")}
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport("donations")} disabled={exportDisabled || busyKey === "export-donations"}>
          <Download size={16} /> {busyKey === "export-donations" ? t("adminTabs.export.exporting") : t("adminTabs.export.donationsCsv")}
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport("monthly-dues")} disabled={exportDisabled || busyKey === "export-monthly-dues"}>
          <Download size={16} /> {busyKey === "export-monthly-dues" ? t("adminTabs.export.exporting") : t("adminTabs.export.monthlyDuesCsv")}
        </button>
      </div>

      {/* Super Admin: platform-level exports */}
      {isSuperAdmin && (
        <div style={{ marginTop: "2rem", borderTop: "1px solid var(--outline-variant)", paddingTop: "1.25rem" }}>
          <h4 style={{ marginBottom: "0.75rem" }}>{t("adminTabs.export.platformExportsTitle")}</h4>
          <SuperAdminExports token={token} busyKey={busyKey} withAuthRequest={withAuthRequest} selectedChurch={selectedChurch} />
        </div>
      )}
    </article>
  );
}

function SuperAdminExports({ token, busyKey, withAuthRequest, selectedChurch }: {
  token: string | null;
  busyKey: string | null;
  withAuthRequest: (key: string, fn: () => Promise<unknown>, successMsg?: string) => Promise<unknown>;
  selectedChurch: string;
}) {
  const { setNotice } = useApp();
  const { t } = useI18n();
  const [auditLimit, setAuditLimit] = useState("1000");

  async function downloadAdminAudit() {
    await withAuthRequest("export-audit-log", async () => {
      const params = new URLSearchParams({ limit: auditLimit });
      const blob = await apiBlobRequest(`/api/ops/audit-logs/export?${params.toString()}`, { token: token ?? undefined, accept: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
    }, t("adminTabs.export.auditDownloaded"));
  }

  async function downloadSaasBilling() {
    await withAuthRequest("export-saas-billing", async () => {
      const blob = await apiBlobRequest(`/api/ops/saas-billing/export?limit=${auditLimit}`, { token: token ?? undefined, accept: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `saas-billing-${new Date().toISOString().split("T")[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
    }, t("adminTabs.export.saasDownloaded"));
  }

  async function downloadIncomeReport() {
    if (!selectedChurch) { setNotice({ tone: "error", text: t("adminTabs.export.selectChurchFirst") }); return; }
    await withAuthRequest("export-income-report", async () => {
      const blob = await apiBlobRequest(`/api/admins/income-report?church_id=${encodeURIComponent(selectedChurch)}&period=monthly`, { token: token ?? undefined, accept: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `income-report-${new Date().toISOString().split("T")[0]}.csv`; a.click();
      URL.revokeObjectURL(url);
    }, t("adminTabs.export.incomeDownloaded"));
  }

  return (
    <div className="field-stack">
      {/* Audit Log Export */}
      <div style={{ background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "0.75rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("adminTabs.export.adminAuditTitle")}</p>
        <p className="muted" style={{ marginBottom: "0.5rem" }}>{t("adminTabs.export.adminAuditDescription")}</p>
        <div className="actions-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "0 0 auto" }}>
            {t("adminTabs.export.rowsLabel")}
            <select value={auditLimit} onChange={(e) => setAuditLimit(e.target.value)} style={{ marginLeft: 4 }}>
              {["500", "1000", "2000", "5000", "10000"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <button className="btn" onClick={() => void downloadAdminAudit()} disabled={busyKey === "export-audit-log"}>
            <Download size={14} /> {busyKey === "export-audit-log" ? t("adminTabs.export.exporting") : t("adminTabs.export.downloadAuditLog")}
          </button>
        </div>
      </div>

      {/* SaaS Billing Export */}
      <div style={{ background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "0.75rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("adminTabs.export.saasExportTitle")}</p>
        <p className="muted" style={{ marginBottom: "0.5rem" }}>{t("adminTabs.export.saasExportDescription")}</p>
        <button className="btn" onClick={() => void downloadSaasBilling()} disabled={busyKey === "export-saas-billing"}>
          <Download size={14} /> {busyKey === "export-saas-billing" ? t("adminTabs.export.exporting") : t("adminTabs.export.downloadSaasBilling")}
        </button>
      </div>

      {/* Income Report (church-scoped) */}
      <div style={{ background: "var(--surface-container)", borderRadius: "var(--radius-md)", padding: "0.75rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{t("adminTabs.export.incomeReportTitle")}</p>
        <p className="muted" style={{ marginBottom: "0.5rem" }}>{t("adminTabs.export.incomeReportDescription")}</p>
        <button className="btn" onClick={() => void downloadIncomeReport()} disabled={!selectedChurch || busyKey === "export-income-report"}>
          <Download size={14} /> {busyKey === "export-income-report" ? t("adminTabs.export.exporting") : t("adminTabs.export.downloadIncomeReport")}
        </button>
      </div>

      <p className="muted" style={{ fontSize: "0.75rem" }}>Last generated: {formatDate(new Date().toISOString())}</p>
    </div>
  );
}
