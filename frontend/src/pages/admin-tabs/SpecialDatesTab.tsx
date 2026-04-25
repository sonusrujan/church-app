import { useState } from "react";
import { Download, Gift } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

type Range = "weekly" | "monthly" | "yearly";

export default function SpecialDatesTab() {
  const { t } = useI18n();
  const { token, busyKey, withAuthRequest } = useApp();
  const [range, setRange] = useState<Range>("monthly");

  async function handleExport() {
    await withAuthRequest("export-special-dates", async () => {
      const resp = await fetch(
        `${API_BASE_URL}/api/special-dates/export?range=${range}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `special_dates_${range}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }, t("adminTabs.specialDates.exportSuccess", { range }));
  }

  return (
    <article className="panel">
      <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <Gift size={20} /> {t("adminTabs.specialDates.title")}
      </h3>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        {t("adminTabs.specialDates.description")}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {t("adminTabs.specialDates.dateRangeLabel")}
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
            style={{ padding: "0.4rem 0.8rem", borderRadius: "6px", border: "1px solid var(--border, #e2e8f0)" }}
          >
            <option value="weekly">{t("adminTabs.specialDates.rangeWeekly")}</option>
            <option value="monthly">{t("adminTabs.specialDates.rangeMonthly")}</option>
            <option value="yearly">{t("adminTabs.specialDates.rangeYearly")}</option>
          </select>
        </label>

        <button
          className="btn btn-primary"
          onClick={() => void handleExport()}
          disabled={busyKey === "export-special-dates"}
          style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
        >
          <Download size={16} />
          {busyKey === "export-special-dates" ? t("adminTabs.specialDates.exporting") : t("adminTabs.specialDates.downloadCsvButton")}
        </button>
      </div>

      <div style={{ marginTop: "1.5rem", padding: "1rem", background: "var(--surface-variant, #f8fafc)", borderRadius: "8px", border: "1px solid var(--border, #e2e8f0)" }}>
        <h4 style={{ fontSize: "0.9rem", marginBottom: "0.5rem" }}>{t("adminTabs.specialDates.whatsIncludedTitle")}</h4>
        <ul style={{ fontSize: "0.85rem", color: "var(--on-surface-variant, #64748b)", paddingLeft: "1.2rem", margin: 0 }}>
          <li>{t("adminTabs.specialDates.includedManualDates")}</li>
          <li>{t("adminTabs.specialDates.includedDobEntries")}</li>
          <li>{t("adminTabs.specialDates.includedMemberInfo")}</li>
          <li>{t("adminTabs.specialDates.includedChurchScoped")}</li>
        </ul>
      </div>
    </article>
  );
}
