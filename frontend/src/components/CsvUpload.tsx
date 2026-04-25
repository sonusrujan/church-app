import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { useI18n } from "../i18n";

export type CsvRow = {
  full_name: string;
  email: string;
  phone_number?: string;
  address?: string;
};

type Props = {
  onDataReady: (rows: CsvRow[]) => void;
  maxRows?: number;
};

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

export default function CsvUpload({ onDataReady, maxRows = 500 }: Props) {
  const [preview, setPreview] = useState<CsvRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  function processText(text: string, source: string) {
    setFileName(source);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) {
      setErrors([t("csv.errorFileEmpty")]);
      setPreview([]);
      return;
    }

    // Detect header row
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes("name") || firstLine.includes("email");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    if (dataLines.length > maxRows) {
      setErrors([t("csv.errorTooManyRows", { count: String(dataLines.length), max: String(maxRows) })]);
      setPreview([]);
      return;
    }

    const rows: CsvRow[] = [];
    const rowErrors: string[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const parts = parseCsvLine(dataLines[i]);
      const name = parts[0] || "";
      const email = parts[1] || "";

      if (!name || !email || !email.includes("@")) {
        rowErrors.push(`Row ${i + 1}: Missing name or valid email`);
        continue;
      }

      rows.push({
        full_name: name,
        email: email.toLowerCase(),
        phone_number: parts[2] || undefined,
        address: parts[3] || undefined,
      });
    }

    setPreview(rows);
    setErrors(rowErrors);
    if (rows.length) onDataReady(rows);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        processText(reader.result, file.name);
      }
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        processText(reader.result, file.name);
      }
    };
    reader.readAsText(file);
  }

  function handleDownloadTemplate() {
    const csv = "Full Name,Email,Phone,Address\nJohn Doe,john@example.com,9876543210,123 Main St\nJane Smith,jane@example.com,9876543211,456 Oak Ave\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "member_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="csv-upload">
      <div className="actions-row" style={{ marginBottom: "1rem" }}>
        <button className="btn" onClick={handleDownloadTemplate} type="button">
          {t("csv.downloadTemplateButton")}
        </button>
      </div>

      <div
        className="csv-dropzone"
        onClick={() => fileRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
      >
        <Upload size={24} style={{ opacity: 0.4 }} />
        <p>{fileName || t("csv.dropzoneHint")}</p>
        <span className="muted">CSV format: Name, Email, Phone, Address</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>

      {errors.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          {errors.slice(0, 5).map((err, i) => (
            <p key={i} className="muted" style={{ color: "var(--danger)" }}>{err}</p>
          ))}
          {errors.length > 5 && (
            <p className="muted" style={{ color: "var(--danger)" }}>...and {errors.length - 5} more errors</p>
          )}
        </div>
      )}

      {preview.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <p className="muted" style={{ marginBottom: "0.5rem" }}>
            <strong>{preview.length}</strong> members ready to import
          </p>
          <div style={{ overflowX: "auto", maxHeight: 240 }}>
            <table className="csv-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((row, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{row.full_name}</td>
                    <td>{row.email}</td>
                    <td>{row.phone_number || "—"}</td>
                    <td>{row.address || "—"}</td>
                  </tr>
                ))}
                {preview.length > 20 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center" }}>
                      ...and {preview.length - 20} more rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
