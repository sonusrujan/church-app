import { Download } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

export default function ExportTab() {
  const { t } = useI18n();
  const { token, isSuperAdmin, busyKey, withAuthRequest } = useApp();

  async function handleExport(type: "members" | "payments" | "donations") {
    await withAuthRequest(`export-${type}`, async () => {
      const churchParam = isSuperAdmin ? "" : "";
      const resp = await fetch(
        `${API_BASE_URL}/api/admin/export/${type}${churchParam}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }, `${type} CSV exported.`);
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.export.title")}</h3>
      <p className="muted">{t("adminTabs.export.description")}</p>
      <div className="actions-row" style={{ flexWrap: "wrap", gap: 12 }}>
        <button className="btn btn-primary" onClick={() => void handleExport("members")} disabled={busyKey === "export-members"}>
          <Download size={16} /> {busyKey === "export-members" ? t("adminTabs.export.exporting") : t("adminTabs.export.membersCsv")}
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport("payments")} disabled={busyKey === "export-payments"}>
          <Download size={16} /> {busyKey === "export-payments" ? t("adminTabs.export.exporting") : t("adminTabs.export.paymentsCsv")}
        </button>
        <button className="btn btn-primary" onClick={() => void handleExport("donations")} disabled={busyKey === "export-donations"}>
          <Download size={16} /> {busyKey === "export-donations" ? t("adminTabs.export.exporting") : t("adminTabs.export.donationsCsv")}
        </button>
      </div>
    </article>
  );
}
