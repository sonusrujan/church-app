import { randomBytes } from "crypto";
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
    const doc = new PDFDocument({ size: "A4", margin: 50 });
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

    // ── Header: tenant-branded ──
    const displayName = input.church_legal_name || input.church_name || "Church";
    doc.fontSize(18).fillColor("#2d5016").text(displayName.toUpperCase(), { align: "center" });
    if (input.church_registered_address) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#444").text(input.church_registered_address, { align: "center" });
    }

    const regInfoParts: string[] = [];
    if (input.church_pan_number) regInfoParts.push(`PAN: ${input.church_pan_number}`);
    if (input.church_gstin) regInfoParts.push(`GSTIN: ${input.church_gstin}`);
    if (input.church_tax_80g_number) regInfoParts.push(`80G Reg: ${input.church_tax_80g_number}`);
    if (regInfoParts.length > 0) {
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#555").text(regInfoParts.join("  |  "), { align: "center" });
    }

    doc.moveDown(0.5);
    doc.fontSize(14).fillColor("#111").text("Payment Receipt", { align: "center" });
    doc.moveDown(1.2);

    // ── Receipt metadata ──
    doc.fontSize(11).fillColor("#111");
    doc.text(`Receipt Number: ${input.receipt_number}`);
    doc.text(`Receipt Date: ${formatDate(input.payment_date)}`);
    doc.text(`Payment ID: ${input.payment_id}`);
    doc.moveDown();

    doc.text(`Received From: ${input.member_name}`);
    if (input.member_email) doc.text(`Contact: ${input.member_email}`);
    doc.moveDown();

    // ── Payment details ──
    doc.text(`Amount Paid: ${formatAmount(input.amount)}`);
    const words = amountInWords(input.amount);
    if (words) {
      doc.fontSize(9).fillColor("#555").text(`(Rupees ${words} only)`);
      doc.fontSize(11).fillColor("#111");
    }
    const methodLabel = (input.payment_method || "").startsWith("manual_")
      ? input.payment_method.replace(/^manual_/, "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) + " (Manual)"
      : input.payment_method;
    doc.text(`Payment Method: ${methodLabel}`);
    doc.text(`Payment Status: ${input.payment_status}`);
    doc.text(`Transaction ID: ${input.transaction_id || "-"}`);

    if (input.subscription_id || input.subscription_name) {
      doc.moveDown();
      doc.text(`Subscription: ${input.subscription_name || input.subscription_id}`);
    }

    if (input.months_covered) {
      doc.moveDown();
      doc.text(`Months Covered: ${input.months_covered}`);
    }

    // ── 80G notice ──
    if (input.church_tax_80g_number) {
      doc.moveDown(1.2);
      doc.fontSize(9).fillColor("#2d5016");
      doc.text(
        `This contribution is eligible for tax deduction under Section 80G of the Income Tax Act, 1961. ` +
        `Registration number ${input.church_tax_80g_number}.`,
        { align: "left" },
      );
    }

    // ── Signatory block ──
    doc.moveDown(2.5);
    doc.fontSize(10).fillColor("#111");
    if (input.receipt_signatory_name || input.receipt_signatory_title) {
      const sigName = input.receipt_signatory_name || "Authorized Signatory";
      const sigTitle = input.receipt_signatory_title || "Authorized Signatory";
      doc.text("_____________________________", { align: "right" });
      doc.text(sigName, { align: "right" });
      doc.fontSize(9).fillColor("#555").text(sigTitle, { align: "right" });
    } else {
      doc.fontSize(9).fillColor("#555").text("This is a system-generated receipt. No physical signature required.", { align: "right" });
    }

    // ── Footer ──
    doc.moveDown(2);
    doc.fontSize(8).fillColor("#888");
    const isManual = (input.payment_method || "").startsWith("manual_");
    doc.text(
      isManual
        ? "This receipt was issued for a manually-recorded payment."
        : "This receipt was generated after payment verification.",
      { align: "center" },
    );
    doc.text("For support, contact your church administration.", { align: "center" });

    doc.end();
  });
}
