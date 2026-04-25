import { useState, useEffect } from "react";
import { Download } from "lucide-react";
import { apiRequest, apiBlobRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

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
    </article>
  );
}
