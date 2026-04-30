import { randomBytes } from "crypto";
import { existsSync, readdirSync } from "fs";
import path from "path";
import PDFDocument from "pdfkit";

export type ReceiptDocumentInput = {
  receipt_number: string;
  payment_id: string;
  payment_date: string;
  amount: number;
  payment_method: string;
  payment_status: string;
  transaction_id: string | null;
  member_name: string;
  member_email: string;
  church_name: string | null;
  subscription_id: string | null;
  subscription_name: string | null;
  months_covered: string | null;
  // Tenant branding / legal info (optional — omitted gracefully)
  church_legal_name?: string | null;
  church_registered_address?: string | null;
  church_pan_number?: string | null;
  church_gstin?: string | null;
  church_tax_80g_number?: string | null;
  receipt_signatory_name?: string | null;
  receipt_signatory_title?: string | null;
};

type ReceiptNumberInput = {
  member_id: string;
  payment_date: string;
  transaction_id?: string | null;
};

function sanitizeToken(value: string, fallback = "NA") {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleaned || fallback;
}

function formatAmount(amount: number) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return "INR 0.00";
  }
  return `INR ${numeric.toFixed(2)}`;
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPaymentMethod(value: string) {
  const method = value || "Payment";
  if (method.startsWith("manual_")) {
    return `${titleCase(method.replace(/^manual_/, ""))} (Manual)`;
  }
  return titleCase(method);
}

function formatStatus(value: string) {
  return titleCase(value || "Success");
}

let cachedShalomLogoPath: string | null | undefined;

function findShalomLogoPath() {
  if (cachedShalomLogoPath !== undefined) return cachedShalomLogoPath;

  const directCandidates = [
    path.resolve(process.cwd(), "frontend", "src", "assets", "shalom-logo.png"),
    path.resolve(process.cwd(), "public", "shalom-logo.png"),
    path.resolve(process.cwd(), "public", "assets", "shalom-logo.png"),
  ];

  for (const candidate of directCandidates) {
    if (existsSync(candidate)) {
      cachedShalomLogoPath = candidate;
      return cachedShalomLogoPath;
    }
  }

  const assetDirs = [
    path.resolve(process.cwd(), "public", "assets"),
    path.resolve(process.cwd(), "frontend", "dist", "assets"),
  ];

  for (const dir of assetDirs) {
    try {
      if (!existsSync(dir)) continue;
      const logo = readdirSync(dir).find((file) => /^shalom-logo.*\.png$/i.test(file));
      if (logo) {
        cachedShalomLogoPath = path.join(dir, logo);
        return cachedShalomLogoPath;
      }
    } catch {
      // Ignore missing or unreadable asset folders; receipts still render.
    }
  }

  cachedShalomLogoPath = null;
  return cachedShalomLogoPath;
}

function amountInWords(amount: number): string {
  const n = Math.round(amount);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function twoDigits(num: number): string {
    if (num < 20) return ones[num];
    const t = Math.floor(num / 10);
    const o = num % 10;
    return tens[t] + (o ? " " + ones[o] : "");
  }
  function threeDigits(num: number): string {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    return (h ? ones[h] + " Hundred " : "") + (rest ? twoDigits(rest) : "");
  }
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundreds = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (hundreds) parts.push(threeDigits(hundreds));
  return parts.join(" ").trim();
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
}

type PdfDoc = InstanceType<typeof PDFDocument>;
type TableRow = [string, string | null | undefined];

const receiptColors = {
  ink: "#1b1533",
  muted: "#6b6387",
  line: "#ded8f0",
  lavender: "#f4f0ff",
  accent: "#7565c8",
  success: "#1d7a3d",
  successSoft: "#eaf7ef",
};

function nonEmptyRows(rows: TableRow[]) {
  return rows.filter(([, value]) => String(value || "").trim().length > 0) as Array<[string, string]>;
}

function textHeight(doc: PdfDoc, text: string, width: number, fontSize = 9.5) {
  doc.font("Helvetica").fontSize(fontSize);
  return doc.heightOfString(text || "-", { width });
}

function drawCard(doc: PdfDoc, x: number, y: number, width: number, height: number, options?: { fill?: string; stroke?: string; radius?: number }) {
  doc
    .save()
    .roundedRect(x, y, width, height, options?.radius ?? 10)
    .fillAndStroke(options?.fill || "#ffffff", options?.stroke || receiptColors.line)
    .restore();
}

function drawSectionTitle(doc: PdfDoc, title: string, x: number, y: number, width: number) {
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor(receiptColors.ink)
    .text(title.toUpperCase(), x, y, { width });
  doc
    .moveTo(x, y + 18)
    .lineTo(x + width, y + 18)
    .strokeColor(receiptColors.line)
    .lineWidth(1)
    .stroke();
}

function drawKeyValueTable(doc: PdfDoc, rows: Array<[string, string]>, x: number, y: number, width: number, title?: string) {
  const labelWidth = Math.min(138, width * 0.38);
  const valueWidth = width - labelWidth - 24;
  const rowPaddingY = 6;
  const startY = title ? y + 31 : y;
  let cursorY = startY;

  if (title) {
    drawSectionTitle(doc, title, x, y, width);
  }

  rows.forEach(([label, value], index) => {
    const labelHeight = textHeight(doc, label, labelWidth, 9);
    const valueHeight = textHeight(doc, value, valueWidth, 9.5);
    const rowHeight = Math.max(22, labelHeight, valueHeight) + rowPaddingY;

    if (index % 2 === 0) {
      doc.save().roundedRect(x, cursorY, width, rowHeight, 5).fill("#fbf9ff").restore();
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(receiptColors.muted)
      .text(label.toUpperCase(), x + 12, cursorY + rowPaddingY, { width: labelWidth });

    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(receiptColors.ink)
      .text(value || "-", x + labelWidth + 18, cursorY + rowPaddingY - 1, { width: valueWidth });

    cursorY += rowHeight;
  });

  return cursorY;
}

function keyValueTableHeight(doc: PdfDoc, rows: Array<[string, string]>, width: number, title?: string) {
  const labelWidth = Math.min(138, width * 0.38);
  const valueWidth = width - labelWidth - 24;
  const rowPaddingY = 6;
  return rows.reduce((total, [label, value]) => {
    const labelHeight = textHeight(doc, label, labelWidth, 9);
    const valueHeight = textHeight(doc, value, valueWidth, 9.5);
    return total + Math.max(22, labelHeight, valueHeight) + rowPaddingY;
  }, title ? 31 : 0);
}

export function buildPaymentReceiptDownloadPath(paymentId: string) {
  return `/api/payments/${paymentId}/receipt`;
}

export function createReceiptNumber(input: ReceiptNumberInput) {
  const paymentDate = new Date(input.payment_date);
  const datePart = Number.isNaN(paymentDate.getTime())
    ? new Date().toISOString().slice(0, 10).replace(/-/g, "")
    : paymentDate.toISOString().slice(0, 10).replace(/-/g, "");

  const memberToken = sanitizeToken(input.member_id).slice(0, 6).padEnd(6, "X");
  const transactionToken = sanitizeToken(input.transaction_id || "").slice(-6).padStart(6, "0");
  const randomToken = randomBytes(2).toString("hex").toUpperCase();

  return `RCPT-${datePart}-${memberToken}-${transactionToken}-${randomToken}`;
}

export function generateReceiptPdfBuffer(input: ReceiptDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `Payment Receipt ${input.receipt_number}`,
        Author: "Shalom",
        Subject: "Payment Receipt",
      },
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", (err) => {
      reject(err);
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 42;
    const contentWidth = pageWidth - margin * 2;
    const displayName = input.church_legal_name || input.church_name || "Church";
    const words = amountInWords(input.amount);
    const methodLabel = formatPaymentMethod(input.payment_method);
    const statusLabel = formatStatus(input.payment_status);

    doc.rect(0, 0, pageWidth, pageHeight).fill("#ffffff");
    doc
      .roundedRect(24, 24, pageWidth - 48, pageHeight - 48, 16)
      .strokeColor("#ebe6f8")
      .lineWidth(1)
      .stroke();

    // Branded header
    const headerY = 42;
    const headerHeight = 128;
    drawCard(doc, margin, headerY, contentWidth, headerHeight, { fill: receiptColors.lavender, stroke: receiptColors.line, radius: 14 });
    doc
      .save()
      .roundedRect(margin, headerY, contentWidth, headerHeight, 14)
      .clip()
      .rect(margin, headerY, contentWidth, 8)
      .fill(receiptColors.accent)
      .restore();

    const logoPath = findShalomLogoPath();
    const logoSize = 66;
    const logoX = margin + 22;
    const logoY = headerY + 30;
    if (logoPath) {
      try {
        doc.image(logoPath, logoX, logoY, { fit: [logoSize, logoSize] });
      } catch {
        doc
          .circle(logoX + logoSize / 2, logoY + logoSize / 2, 31)
          .fillAndStroke("#ffffff", receiptColors.line);
        doc
          .font("Helvetica-Bold")
          .fontSize(17)
          .fillColor(receiptColors.accent)
          .text("S", logoX, logoY + 22, { width: logoSize, align: "center" });
      }
    } else {
      doc
        .circle(logoX + logoSize / 2, logoY + logoSize / 2, 31)
        .fillAndStroke("#ffffff", receiptColors.line);
      doc
        .font("Helvetica-Bold")
        .fontSize(17)
        .fillColor(receiptColors.accent)
        .text("S", logoX, logoY + 22, { width: logoSize, align: "center" });
    }

    const headerTextX = logoX + logoSize + 18;
    const headerTextWidth = contentWidth - 230;
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(receiptColors.ink)
      .text(displayName.toUpperCase(), headerTextX, headerY + 30, {
        width: headerTextWidth,
        lineGap: 2,
      });

    if (input.church_registered_address) {
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(receiptColors.muted)
        .text(input.church_registered_address, headerTextX, headerY + 66, {
          width: headerTextWidth,
          lineGap: 1.5,
        });
    }

    const regInfoParts: string[] = [];
    if (input.church_pan_number) regInfoParts.push(`PAN: ${input.church_pan_number}`);
    if (input.church_gstin) regInfoParts.push(`GSTIN: ${input.church_gstin}`);
    if (input.church_tax_80g_number) regInfoParts.push(`80G Reg: ${input.church_tax_80g_number}`);
    if (regInfoParts.length > 0) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(receiptColors.muted)
        .text(regInfoParts.join("  |  "), headerTextX, headerY + 100, { width: headerTextWidth });
    }

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(receiptColors.muted)
      .text("OFFICIAL RECEIPT", margin + contentWidth - 142, headerY + 32, { width: 118, align: "right" });
    doc
      .font("Helvetica-Bold")
      .fontSize(17)
      .fillColor(receiptColors.ink)
      .text("Payment Receipt", margin + contentWidth - 168, headerY + 48, { width: 144, align: "right" });
    doc
      .roundedRect(margin + contentWidth - 102, headerY + 82, 78, 28, 14)
      .fill(receiptColors.successSoft);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(receiptColors.success)
      .text("PAID", margin + contentWidth - 102, headerY + 91, { width: 78, align: "center" });

    // Top summary cards
    const summaryY = headerY + headerHeight + 20;
    const amountCardWidth = 238;
    const payerCardX = margin + amountCardWidth + 18;
    const payerCardWidth = contentWidth - amountCardWidth - 18;
    drawCard(doc, margin, summaryY, amountCardWidth, 96, { fill: receiptColors.ink, stroke: receiptColors.ink, radius: 14 });
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#cfc7ff")
      .text("AMOUNT RECEIVED", margin + 18, summaryY + 18, { width: amountCardWidth - 36 });
    doc
      .font("Helvetica-Bold")
      .fontSize(23)
      .fillColor("#ffffff")
      .text(formatAmount(input.amount), margin + 18, summaryY + 36, { width: amountCardWidth - 36 });
    doc
      .font("Helvetica")
      .fontSize(8.3)
      .fillColor("#d8d2f4")
      .text(words ? `Rupees ${words} only` : "Amount received toward church records", margin + 18, summaryY + 67, {
        width: amountCardWidth - 36,
        lineGap: 1,
      });

    drawCard(doc, payerCardX, summaryY, payerCardWidth, 96, { fill: "#ffffff", stroke: receiptColors.line, radius: 14 });
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(receiptColors.muted)
      .text("RECEIVED FROM", payerCardX + 18, summaryY + 18, { width: payerCardWidth - 36 });
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor(receiptColors.ink)
      .text(input.member_name || "Public donor", payerCardX + 18, summaryY + 36, {
        width: payerCardWidth - 36,
        lineGap: 1,
      });
    if (input.member_email) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(receiptColors.muted)
        .text(input.member_email, payerCardX + 18, summaryY + 71, { width: payerCardWidth - 36 });
    }

    // Tabular receipt body
    const detailRows = nonEmptyRows([
      ["Receipt Number", input.receipt_number],
      ["Receipt Date", formatDate(input.payment_date)],
      ["Payment ID", input.payment_id],
      ["Transaction ID", input.transaction_id || "-"],
      ["Payment Method", methodLabel],
      ["Payment Status", statusLabel],
      ["Subscription", input.subscription_name || input.subscription_id],
      ["Months Covered", input.months_covered],
    ]);
    const detailsCardY = summaryY + 116;
    const detailsInnerX = margin + 18;
    const detailsInnerY = detailsCardY + 16;
    const detailsInnerWidth = contentWidth - 36;
    const detailsTableHeight = keyValueTableHeight(doc, detailRows, detailsInnerWidth, "Receipt Details");
    const detailsCardHeight = detailsTableHeight + 32;
    drawCard(doc, margin, detailsCardY, contentWidth, detailsCardHeight, { fill: "#ffffff", stroke: receiptColors.line, radius: 14 });
    drawKeyValueTable(doc, detailRows, detailsInnerX, detailsInnerY, detailsInnerWidth, "Receipt Details");

    let footerY = pageHeight - 142;

    // 80G notice
    const noticeY = detailsCardY + detailsCardHeight + 16;
    if (input.church_tax_80g_number) {
      const noticeHeight = 58;
      if (noticeY + noticeHeight < footerY - 12) {
        drawCard(doc, margin, noticeY, contentWidth, noticeHeight, { fill: receiptColors.successSoft, stroke: "#bfe6ca", radius: 12 });
        doc
          .font("Helvetica-Bold")
          .fontSize(9.5)
          .fillColor(receiptColors.success)
          .text("80G TAX RECEIPT NOTE", margin + 18, noticeY + 13, { width: contentWidth - 36 });
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor("#285b39")
          .text(
            `This contribution is eligible for tax deduction under Section 80G of the Income Tax Act, 1961. Registration number ${input.church_tax_80g_number}.`,
            margin + 18,
            noticeY + 30,
            { width: contentWidth - 36, lineGap: 1.5 },
          );
      }
    } else if (noticeY < footerY - 18) {
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(receiptColors.muted)
        .text("This receipt records the church-facing amount received. Platform fees, where applicable, are excluded from church income receipts.", margin + 6, noticeY, {
          width: contentWidth - 12,
          align: "center",
        });
    }

    // Footer and signatory block
    footerY = pageHeight - 128;
    doc
      .moveTo(margin, footerY)
      .lineTo(margin + contentWidth, footerY)
      .strokeColor(receiptColors.line)
      .lineWidth(1)
      .stroke();

    const isManual = (input.payment_method || "").startsWith("manual_");
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(receiptColors.muted)
      .text(
        isManual
          ? "This receipt was issued for a manually-recorded payment."
          : "This receipt was generated after payment verification.",
        margin,
        footerY + 18,
        { width: contentWidth * 0.52, lineGap: 1.5 },
      );
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(receiptColors.muted)
      .text("For support, contact your church administration.", margin, footerY + 42, {
        width: contentWidth * 0.52,
      });

    if (input.receipt_signatory_name || input.receipt_signatory_title) {
      const sigName = input.receipt_signatory_name || "Authorized Signatory";
      const sigTitle = input.receipt_signatory_title || "Authorized Signatory";
      const sigX = margin + contentWidth * 0.58;
      const sigWidth = contentWidth * 0.42;
      doc
        .moveTo(sigX + 18, footerY + 42)
        .lineTo(sigX + sigWidth, footerY + 42)
        .strokeColor(receiptColors.muted)
        .lineWidth(1)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(receiptColors.ink)
        .text(sigName, sigX, footerY + 50, { width: sigWidth, align: "right" });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(receiptColors.muted)
        .text(sigTitle, sigX, footerY + 64, { width: sigWidth, align: "right" });
    } else {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(receiptColors.ink)
        .text("System-generated receipt", margin + contentWidth * 0.56, footerY + 30, {
          width: contentWidth * 0.44,
          align: "right",
        });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(receiptColors.muted)
        .text("No physical signature required.", margin + contentWidth * 0.56, footerY + 46, {
          width: contentWidth * 0.44,
          align: "right",
        });
    }

    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#9b93ad")
      .text("Generated by Shalom Church App", margin, pageHeight - 52, { width: contentWidth, align: "center" });

    doc.end();
  });
}
