import { useState } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import CsvUpload, { type CsvRow } from "../../components/CsvUpload";
import { useI18n } from "../../i18n";
import { normalizeIndianPhone } from "../../types";

export default function BulkImportTab() {
  const { t } = useI18n();
  const { token, authContext, isSuperAdmin, busyKey, setNotice, withAuthRequest, churches } = useApp();

  const [churchId, setChurchId] = useState(churches[0]?.id || "");
  const [text, setText] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [results, setResults] = useState<Array<{ row: number; status: string; error?: string; id?: string }> | null>(null);

  function handleCsvData(rows: CsvRow[]) {
    const lines = rows.map((r) => {
      const phone = r.phone_number?.trim() ? normalizeIndianPhone(r.phone_number) : "";
      return [r.full_name, r.email, phone, r.address || ""].join(", ");
    });
    setText(lines.join("\n"));
    setShowPreview(true);
    setResults(null);
  }

  function getParsedMembers() {
    return text.trim().split("\n").filter(Boolean).map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      const rawPhone = parts[2] || "";
      return { full_name: parts[0] || "", email: parts[1] || "", phone_number: rawPhone ? normalizeIndianPhone(rawPhone) : undefined, address: parts[3] || undefined };
    });
  }

  async function handleImport() {
    const cid = isSuperAdmin ? churchId : (authContext?.auth.church_id || "");
    if (!cid) { setNotice({ tone: "error", text: t("adminTabs.bulkImport.errorSelectChurch") }); return; }
    const members = getParsedMembers();
    if (!members.length) { setNotice({ tone: "error", text: t("adminTabs.bulkImport.errorPasteData") }); return; }
    const result = await withAuthRequest("bulk-import", () =>
      apiRequest<{ total: number; created: number; skipped: number; failed: number; results: Array<{ row: number; status: string; error?: string; id?: string }> }>(
        "/api/ops/members/bulk-import",
        { method: "POST", token, body: { church_id: cid, members }, timeout: 120_000 },
      ),
    );
    if (result) {
      setResults(result.results);
      setNotice({ tone: "success", text: t("adminTabs.bulkImport.successImportDone", { created: result.created, skipped: result.skipped, failed: result.failed }) });
    }
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.bulkImport.title")}</h3>
      <p className="muted">{t("adminTabs.bulkImport.description")}</p>
      <div className="field-stack">
        {isSuperAdmin ? (
          <label>
            {t("admin.church")}
            <select value={churchId} onChange={(e) => setChurchId(e.target.value)}>
              <option value="">{t("admin.selectChurch")}</option>
              {churches.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.church_code || c.id.slice(0, 8)})</option>)}
            </select>
          </label>
        ) : null}
        <CsvUpload onDataReady={handleCsvData} maxRows={500} />
        {text ? (
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("adminTabs.bulkImport.membersReady", { count: text.split("\n").filter(Boolean).length })}
          </p>
        ) : null}
        {showPreview && text ? (
          <div style={{ maxHeight: 300, overflow: "auto", border: "1px solid var(--border-color, #ddd)", borderRadius: 8, marginBottom: "0.5rem" }}>
            <table className="csv-preview-table" style={{ fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("common.name")}</th>
                  <th>{t("common.email")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("common.address")}</th>
                </tr>
              </thead>
              <tbody>
                {getParsedMembers().slice(0, 50).map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{m.full_name || "-"}</td>
                    <td>{m.email || "-"}</td>
                    <td>{m.phone_number || "-"}</td>
                    <td>{m.address || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {getParsedMembers().length > 50 && (
              <p className="muted" style={{ padding: "0.5rem", fontSize: "0.8rem" }}>
                {t("adminTabs.bulkImport.previewTruncated", { total: getParsedMembers().length })}
              </p>
            )}
          </div>
        ) : null}
        <button className="btn btn-primary" onClick={() => void handleImport()} disabled={busyKey === "bulk-import" || !text.trim()}>
          {busyKey === "bulk-import" ? t("adminTabs.bulkImport.importing") : t("adminTabs.bulkImport.importMembers")}
        </button>
      </div>
      {results ? (
        <div style={{ marginTop: "1rem", maxHeight: 300, overflowY: "auto" }}>
          {results.map((r) => (
            <div key={r.row} className="activity-event-row">
              <span className="event-meta">{t("adminTabs.bulkImport.rowLabel")} {r.row}</span>
              <span className={`event-badge ${r.status === "created" ? "badge-created" : r.status === "skipped" ? "badge-system" : "badge-overdue"}`}>{r.status}</span>
              {r.error ? <span className="event-meta">{r.error}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
