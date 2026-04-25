import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { TrendingUp, Clock, Repeat, Search, Receipt, Download, ChevronLeft, ChevronRight, FileText, Heart, CreditCard } from "lucide-react";
import { useApp } from "../context/AppContext";
import { paginate, totalPages } from "../components/Pagination";
import { formatAmount, formatDate, humanizePaymentMethod, isManualPayment, type ReceiptRow } from "../types";
import { useI18n } from "../i18n";

type FilterTab = "all" | "subscriptions" | "donations";

export default function HistoryPage() {
  const { token, isSuperAdmin, memberDashboard, setNotice } = useApp();
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const { t } = useI18n();

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [receiptPage, setReceiptPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const ITEMS_PER_PAGE = 8;

  const sortedReceipts = useMemo(() => {
    const receipts = [...(memberDashboard?.receipts || [])];
    receipts.sort(
      (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
    );
    return receipts;
  }, [memberDashboard?.receipts]);

  const filteredReceipts = useMemo(() => {
    let items = sortedReceipts;

    if (filterTab === "subscriptions") {
      items = items.filter((r) => r.subscription_id);
    } else if (filterTab === "donations") {
      items = items.filter((r) => !r.subscription_id);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (r) =>
          (r.receipt_number || "").toLowerCase().includes(q) ||
          (r.transaction_id || "").toLowerCase().includes(q) ||
          (r.payment_method || "").toLowerCase().includes(q) ||
          formatAmount(r.amount).toLowerCase().includes(q),
      );
    }

    return items;
  }, [sortedReceipts, filterTab, searchQuery]);

  // Reset page when filter/search changes
  useMemo(() => setReceiptPage(1), [filterTab, searchQuery]);

  // Stats
  const totalContributed = useMemo(() => {
    return sortedReceipts
      .filter((r) => (r.payment_status || "").toLowerCase() === "success")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  }, [sortedReceipts]);

  const activeSubscriptions = memberDashboard?.subscriptions?.filter(
    (s) => s.status === "active",
  ).length || 0;

  const pendingCount = sortedReceipts.filter(
    (r) => (r.payment_status || "").toLowerCase() === "pending",
  ).length;

  async function downloadReceipt(receipt: ReceiptRow) {
    if (!token) {
      setNotice({ tone: "error", text: "Please sign in again to download receipts." });
      return;
    }
    if (downloadingIds.has(receipt.id)) return;

    setDownloadingIds((prev) => new Set(prev).add(receipt.id));

    try {
      const endpoint = receipt.receipt_download_path || `/api/payments/${receipt.id}/receipt`;
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:4000"}${endpoint}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/pdf" },
        },
      );

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = `Failed to download receipt (${response.status})`;
        if (contentType.includes("application/json")) {
          const payload = await response.json();
          message = payload?.error || payload?.message || message;
        } else {
          const text = await response.text();
          if (text) message = text;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename=\"?([^\"]+)\"?/i);
      const filename =
        filenameMatch?.[1] || `receipt-${receipt.receipt_number || receipt.id}.pdf`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setNotice({ tone: "error", text: err.message || t("historyPage.errorDownloadReceiptFailed") });
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(receipt.id);
        return next;
      });
    }
  }

  if (isSuperAdmin) return <Navigate to="/dashboard" replace />;

  const paginatedReceipts = paginate(filteredReceipts, receiptPage, ITEMS_PER_PAGE);
  const receiptTotalPages = totalPages(filteredReceipts.length, ITEMS_PER_PAGE);
  const historyItems = memberDashboard?.history || [];
  const paginatedHistory = paginate(historyItems, historyPage, 10);
  const historyTotalPages = totalPages(historyItems.length, 10);

  return (
    <div className="history-page">
      {/* Page Header */}
      <div className="history-header">
        <h1 className="history-title">{t("history.heading")}</h1>
        <p className="history-subtitle">
          {t("history.subtitle")}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="history-stats-grid">
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("history.totalContributed")}</span>
            <TrendingUp size={20} className="history-stat-icon history-stat-icon--success" />
          </div>
          <div className="history-stat-value">{formatAmount(totalContributed)}</div>
          <div className="history-stat-sub history-stat-sub--success">
            {t("history.successfulPayments", { n: String(sortedReceipts.filter((r) => (r.payment_status || "").toLowerCase() === "success").length) })}
          </div>
        </div>
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("history.pending")}</span>
            <Clock size={20} className="history-stat-icon history-stat-icon--warning" />
          </div>
          <div className="history-stat-value">{pendingCount}</div>
          <div className="history-stat-sub">{t("history.processingNormally")}</div>
        </div>
        <div className="history-stat-card">
          <div className="history-stat-top">
            <span className="history-stat-label">{t("history.activeSubscriptions")}</span>
            <Repeat size={20} className="history-stat-icon history-stat-icon--success" />
          </div>
          <div className="history-stat-value">{activeSubscriptions}</div>
          <div className="history-stat-sub">{t("history.monthlyRenewals")}</div>
        </div>
      </div>

      {/* Transaction List */}
      <div className="history-table-container">
        {/* Filters Row */}
        <div className="history-filters">
          <div className="history-filter-tabs">
            <button
              className={`history-filter-btn ${filterTab === "all" ? "active" : ""}`}
              onClick={() => setFilterTab("all")}
            >
              {t("history.allTransactions")}
            </button>
            <button
              className={`history-filter-btn ${filterTab === "subscriptions" ? "active" : ""}`}
              onClick={() => setFilterTab("subscriptions")}
            >
              {t("history.subscriptions")}
            </button>
            <button
              className={`history-filter-btn ${filterTab === "donations" ? "active" : ""}`}
              onClick={() => setFilterTab("donations")}
            >
              {t("history.donations")}
            </button>
          </div>
          <div className="history-search">
            <Search size={16} className="history-search-icon" />
            <input
              type="text"
              placeholder={t("history.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="history-search-input"
            />
          </div>
        </div>

        {/* Table */}
        {paginatedReceipts.length ? (
          <>
            <div className="history-table-scroll">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>{t("history.date")}</th>
                    <th>{t("history.description")}</th>
                    <th>{t("history.amount")}</th>
                    <th>Status</th>
                    <th className="history-th-right">{t("history.action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReceipts.map((receipt) => (
                    <tr key={receipt.id} className="history-row">
                      <td className="history-cell-date">{formatDate(receipt.payment_date)}</td>
                      <td>
                        <div className="history-cell-desc">
                          <div className={`history-cell-icon ${receipt.subscription_id ? "history-cell-icon--sub" : "history-cell-icon--donation"}`}>
                            {receipt.subscription_id ? <CreditCard size={16} /> : <Heart size={16} />}
                          </div>
                          <div>
                            <span className="history-cell-title">
                              {receipt.payment_category === "subscription" || receipt.subscription_id
                                ? t("history.subscriptionPayment")
                                : receipt.payment_category === "donation"
                                  ? t("history.donation")
                                  : t("history.donation")}
                              {isManualPayment(receipt.payment_method) ? " (Manual)" : ""}
                              {receipt.person_name && receipt.member_id !== memberDashboard?.member?.id
                                ? ` — ${receipt.person_name}`
                                : ""}
                            </span>
                            <span className="history-cell-receipt-no">
                              {humanizePaymentMethod(receipt.payment_method)}
                              {receipt.receipt_number ? ` · #${receipt.receipt_number}` : ""}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="history-cell-amount">{formatAmount(receipt.amount)}</td>
                      <td>
                        <span className={`history-status-badge ${
                          (receipt.payment_status || "").toLowerCase() === "success"
                            ? "history-status--paid"
                            : (receipt.payment_status || "").toLowerCase() === "pending"
                              ? "history-status--pending"
                              : "history-status--other"
                        }`}>
                          {(receipt.payment_status || "pending").charAt(0).toUpperCase() + (receipt.payment_status || "pending").slice(1)}
                        </span>
                      </td>
                      <td className="history-cell-action">
                        <button
                          className="history-receipt-btn"
                          disabled={downloadingIds.has(receipt.id)}
                          onClick={() => downloadReceipt(receipt)}
                        >
                          <Download size={14} />
                          {downloadingIds.has(receipt.id) ? "..." : t("history.receipt")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="history-pagination">
              <span className="history-pagination-info">
                Showing {(receiptPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
                {Math.min(receiptPage * ITEMS_PER_PAGE, filteredReceipts.length)} of{" "}
                {filteredReceipts.length} transactions
              </span>
              <div className="history-pagination-btns">
                <button
                  className="history-pagination-btn"
                  disabled={receiptPage <= 1}
                  onClick={() => setReceiptPage((p) => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="history-pagination-btn"
                  disabled={receiptPage >= receiptTotalPages}
                  onClick={() => setReceiptPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="history-empty">
            <Receipt size={32} />
            <p>{t("history.noTransactions")}{searchQuery ? ` matching "${searchQuery}"` : ""}.</p>
          </div>
        )}
      </div>

      {/* Subscription History */}
      {historyItems.length ? (
        <div className="history-table-container">
          <div className="history-section-header">
            <h2>{t("history.subscriptionHistory")}</h2>
          </div>
          <div className="history-table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>{t("history.date")}</th>
                  <th>{t("history.description")}</th>
                  <th>{t("history.amount")}</th>
                  <th>{t("history.status")}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="history-row">
                    <td className="history-cell-date">{formatDate(item.date)}</td>
                    <td>
                      <div className="history-cell-desc">
                        <div className={`history-cell-icon ${item.type === "payment" ? "history-cell-icon--sub" : "history-cell-icon--event"}`}>
                          {item.type === "payment" ? <CreditCard size={16} /> : <FileText size={16} />}
                        </div>
                        <span className="history-cell-title">
                          {item.type === "payment" ? "Payment" : "Subscription"}: {item.title}
                        </span>
                      </div>
                    </td>
                    <td className="history-cell-amount">{formatAmount(item.amount)}</td>
                    <td>
                      <span className={`history-status-badge ${
                        item.status === "active" || item.status === "paid"
                          ? "history-status--paid"
                          : item.status === "cancelled"
                            ? "history-status--other"
                            : "history-status--pending"
                      }`}>
                        {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {historyTotalPages > 1 ? (
            <div className="history-pagination">
              <span className="history-pagination-info">
                Showing {(historyPage - 1) * 10 + 1} to {Math.min(historyPage * 10, historyItems.length)} of {historyItems.length}
              </span>
              <div className="history-pagination-btns">
                <button className="history-pagination-btn" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
                <button className="history-pagination-btn" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Footer CTA */}
      <div className="history-footer-cta">
        <div className="history-footer-cta-text">
          <h3>{t("history.specializedStatement")}</h3>
          <p>{t("history.exportDescription")}</p>
        </div>
        <div className="history-footer-cta-actions">
          <a href="/donate" className="btn btn-primary">{t("history.makeDonation")}</a>
        </div>
        <div className="history-footer-cta-blur" />
      </div>
    </div>
  );
}
