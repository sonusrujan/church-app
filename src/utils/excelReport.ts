export const EXCEL_HTML_MIME = "application/vnd.ms-excel; charset=utf-8";

export type ExcelReportColumn = {
  key: string;
  header: string;
  type?: "text" | "number" | "currency" | "date" | "status";
  width?: number;
};

export type ExcelReportSection = {
  title: string;
  description?: string;
  columns: ExcelReportColumn[];
  rows: Array<Record<string, unknown>>;
};

export type ExcelReportKpi = {
  label: string;
  value: string | number;
  note?: string;
};

export type ExcelReportOptions = {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  generatedAt?: Date;
  kpis?: ExcelReportKpi[];
  notes?: string[];
  sections: ExcelReportSection[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function preventFormulaInjection(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function asNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function formatExcelMoney(value: unknown) {
  return `₹${asNumber(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatExcelDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

function formatCellValue(value: unknown, type: ExcelReportColumn["type"]) {
  if (type === "currency") return formatExcelMoney(value);
  if (type === "number") return asNumber(value).toLocaleString("en-IN");
  if (type === "date") return formatExcelDate(value);
  return preventFormulaInjection(String(value ?? ""));
}

function statusClass(value: unknown) {
  const status = String(value || "").toLowerCase();
  if (["success", "paid", "active", "approved", "completed"].includes(status)) return "status-good";
  if (["pending", "processing", "overdue"].includes(status)) return "status-warn";
  if (["failed", "rejected", "void", "voided", "cancelled", "canceled"].includes(status)) return "status-bad";
  return "status-neutral";
}

function renderKpis(kpis: ExcelReportKpi[]) {
  if (!kpis.length) return "";
  const cells = kpis.map((kpi) => `
    <td class="kpi">
      <div class="kpi-label">${escapeHtml(kpi.label)}</div>
      <div class="kpi-value">${escapeHtml(kpi.value)}</div>
      ${kpi.note ? `<div class="kpi-note">${escapeHtml(kpi.note)}</div>` : ""}
    </td>
  `).join("");
  return `<table class="kpi-table"><tr>${cells}</tr></table>`;
}

function renderNotes(notes: string[]) {
  if (!notes.length) return "";
  return `
    <table class="notes-table">
      <tr><th>How to read this report</th></tr>
      ${notes.map((note) => `<tr><td>${escapeHtml(note)}</td></tr>`).join("")}
    </table>
  `;
}

function renderSection(section: ExcelReportSection) {
  const colgroup = section.columns
    .map((column) => `<col style="width:${column.width || 120}px" />`)
    .join("");
  const header = section.columns
    .map((column) => `<th>${escapeHtml(column.header)}</th>`)
    .join("");

  const body = section.rows.length
    ? section.rows.map((row) => {
      const cells = section.columns.map((column) => {
        const value = row[column.key];
        const type = column.type || "text";
        const className = type === "status" ? statusClass(value) : `cell-${type}`;
        return `<td class="${className}">${escapeHtml(formatCellValue(value, type))}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("")
    : `<tr><td class="empty-row" colspan="${section.columns.length}">No records found for this report.</td></tr>`;

  return `
    <h2>${escapeHtml(section.title)}</h2>
    ${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ""}
    <table class="report-table">
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

export function buildExcelHtmlReport(options: ExcelReportOptions) {
  const generated = options.generatedAt || new Date();
  const generatedText = generated.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });

  return `\ufeff<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1b1533; background: #ffffff; }
    .cover { border: 1px solid #d8d0ee; background: #f4f0ff; padding: 18px 20px; }
    .eyebrow { color: #7565c8; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    h1 { margin: 4px 0 6px; font-size: 24px; color: #1b1533; }
    h2 { margin: 22px 0 6px; font-size: 15px; color: #1b1533; border-bottom: 2px solid #d8d0ee; padding-bottom: 5px; }
    .subtitle, .section-description { color: #5f567a; font-size: 12px; }
    .meta { color: #5f567a; font-size: 11px; }
    .kpi-table { border-collapse: separate; border-spacing: 10px; margin: 12px 0 18px; width: 100%; }
    .kpi { border: 1px solid #d8d0ee; background: #fbf9ff; padding: 14px; vertical-align: top; }
    .kpi-label { color: #6b6387; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .kpi-value { color: #1b1533; font-size: 20px; font-weight: 700; margin-top: 4px; }
    .kpi-note { color: #6b6387; font-size: 11px; margin-top: 4px; }
    .notes-table { border-collapse: collapse; width: 100%; margin: 0 0 16px; }
    .notes-table th { background: #1b1533; color: #ffffff; text-align: left; padding: 8px; font-size: 12px; }
    .notes-table td { border: 1px solid #ded8f0; padding: 8px; color: #4e4668; font-size: 11px; }
    .report-table { border-collapse: collapse; width: 100%; margin-bottom: 18px; }
    .report-table th { background: #342866; color: #ffffff; padding: 9px 8px; text-align: left; font-size: 11px; border: 1px solid #251d4b; }
    .report-table td { padding: 8px; border: 1px solid #ded8f0; font-size: 11px; vertical-align: top; mso-number-format: "\\@"; }
    .report-table tbody tr:nth-child(even) td { background: #fbf9ff; }
    .cell-currency, .cell-number { text-align: right; font-weight: 600; color: #1b1533; }
    .cell-date { color: #4e4668; }
    .status-good { color: #1d7a3d; font-weight: 700; background: #eaf7ef; }
    .status-warn { color: #9a6100; font-weight: 700; background: #fff5df; }
    .status-bad { color: #b3261e; font-weight: 700; background: #fdecec; }
    .status-neutral { color: #4e4668; font-weight: 700; }
    .empty-row { color: #6b6387; text-align: center; padding: 18px; }
    .footer { color: #8a829f; font-size: 10px; margin-top: 18px; text-align: center; }
  </style>
</head>
<body>
  <div class="cover">
    <div class="eyebrow">Shalom Church App Report</div>
    <h1>${escapeHtml(options.title)}</h1>
    ${options.subtitle ? `<div class="subtitle">${escapeHtml(options.subtitle)}</div>` : ""}
    <div class="meta">Generated: ${escapeHtml(generatedText)}${options.periodLabel ? ` &nbsp; | &nbsp; Period: ${escapeHtml(options.periodLabel)}` : ""}</div>
  </div>
  ${renderKpis(options.kpis || [])}
  ${renderNotes(options.notes || [])}
  ${options.sections.map(renderSection).join("")}
  <div class="footer">Generated by Shalom Church App. Amounts are shown as church-facing values where platform fees are applicable.</div>
</body>
</html>`;
}

export function excelFilename(base: string) {
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return cleaned.toLowerCase().endsWith(".xls") ? cleaned : `${cleaned}.xls`;
}
