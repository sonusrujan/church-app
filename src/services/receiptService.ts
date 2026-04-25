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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
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

    doc.fontSize(20).text("SHALOM CHURCH", { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(14).text("Payment Receipt", { align: "center" });
    doc.moveDown(1.5);

    doc.fontSize(11);
    doc.text(`Receipt Number: ${input.receipt_number}`);
    doc.text(`Receipt Date: ${formatDate(input.payment_date)}`);
    doc.text(`Payment ID: ${input.payment_id}`);
    doc.moveDown();

    doc.text(`Member Name: ${input.member_name}`);
    doc.text(`Member Email: ${input.member_email}`);
    doc.text(`Church: ${input.church_name || "-"}`);
    doc.moveDown();

    doc.text(`Amount Paid: ${formatAmount(input.amount)}`);
    const methodLabel = (input.payment_method || "").startsWith("manual_")
      ? input.payment_method.replace(/^manual_/, "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) + " (Manual)"
      : input.payment_method;
    doc.text(`Payment Method: ${methodLabel}`);
    doc.text(`Payment Status: ${input.payment_status}`);
    doc.text(`Transaction ID: ${input.transaction_id || "-"}`);
    doc.moveDown();

    doc.text(`Subscription ID: ${input.subscription_id || "-"}`);
    doc.text(`Subscription Name: ${input.subscription_name || "-"}`);

    doc.moveDown(2);
    doc.fontSize(10).fillColor("#444444");
    const isManual = (input.payment_method || "").startsWith("manual_");
    doc.text(
      isManual
        ? "This is a system-generated receipt for a manually recorded payment."
        : "This is a system-generated receipt after payment verification.",
      { align: "left" },
    );
    doc.text("For support, contact your church administration.", { align: "left" });

    doc.end();
  });
}