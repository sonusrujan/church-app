import { useState, useEffect, useCallback, useMemo } from "react";
import { FileText, Search, Filter } from "lucide-react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import Pagination, { paginate, totalPages } from "../../components/Pagination";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import EmptyState from "../../components/EmptyState";
import type { AuditLogRow } from "../../types";
import { formatDate } from "../../types";
import { useI18n } from "../../i18n";

export default function AuditLogTab() {
  const { t } = useI18n();
  const { token, setNotice } = useApp();

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadLogs = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiRequest<{ logs: AuditLogRow[] }>("/api/admin/audit-log?limit=200", { token });
      setLogs(data.logs || []);
    } catch {
      setNotice({ tone: "error", text: t("adminTabs.auditLog.errorLoadFailed") });
    } finally {
      setLoading(false);
    }
  }, [token, setNotice]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  // Unique action types for filter dropdown
  const actionTypes = useMemo(() => {
    const actions = new Set(logs.map((l) => l.action));
    return Array.from(actions).sort();
  }, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    let items = logs;
    if (actionFilter) {
      items = items.filter((l) => l.action === actionFilter);
    }
    if (dateFrom) {
      const from = new Date(dateFrom);
      items = items.filter((l) => new Date(l.created_at) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59");
      items = items.filter((l) => new Date(l.created_at) <= to);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(
        (l) =>
          l.action.toLowerCase().includes(q) ||
          (l.target_type || "").toLowerCase().includes(q) ||
          (l.target_id || "").toLowerCase().includes(q) ||
          (l.ip_address || "").toLowerCase().includes(q),
      );
    }
    return items;
  }, [logs, actionFilter, dateFrom, dateTo, searchQuery]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [actionFilter, dateFrom, dateTo, searchQuery]);

  return (
    <article className="panel">
      <h3>{t("adminTabs.auditLog.title")}</h3>
      <p className="muted">{t("adminTabs.auditLog.description")}</p>
      <div className="actions-row" style={{ marginBottom: "0.75rem" }}>
        <button className="btn" onClick={() => void loadLogs()} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem", alignItems: "flex-end" }}>
        <label style={{ fontSize: "0.82rem", flex: "1 1 180px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}><Search size={12} /> {t("common.search")}</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("adminTabs.auditLog.placeholderSearch")}
            className="auth-input"
            style={{ fontSize: "0.85rem" }}
          />
        </label>
        <label style={{ fontSize: "0.82rem", flex: "1 1 140px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}><Filter size={12} /> {t("adminTabs.auditLog.labelAction")}</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="settings-select"
            style={{ fontSize: "0.85rem", width: "100%" }}
          >
            <option value="">{t("adminTabs.auditLog.optionAllActions")}</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.82rem", flex: "1 1 130px" }}>
          <span style={{ marginBottom: 2, display: "block" }}>{t("adminTabs.auditLog.labelFrom")}</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="auth-input"
            style={{ fontSize: "0.85rem" }}
          />
        </label>
        <label style={{ fontSize: "0.82rem", flex: "1 1 130px" }}>
          <span style={{ marginBottom: 2, display: "block" }}>{t("adminTabs.auditLog.labelTo")}</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="auth-input"
            style={{ fontSize: "0.85rem" }}
          />
        </label>
      </div>

      {filteredLogs.length !== logs.length && logs.length > 0 ? (
        <p style={{ fontSize: "0.82rem", color: "var(--outline)", marginBottom: "0.5rem" }}>
          {t("adminTabs.auditLog.showingFiltered", { filtered: filteredLogs.length, total: logs.length })}
        </p>
      ) : null}
      {loading && !logs.length ? (
        <LoadingSkeleton lines={6} />
      ) : filteredLogs.length ? (
        <>
          {paginate(filteredLogs, page, 15).map((log) => (
            <div key={log.id} className="activity-event-row">
              <span className="event-badge badge-system">{log.action}</span>
              <span className="event-meta">{formatDate(log.created_at)}</span>
              {log.target_type ? <span className="event-meta">{log.target_type}:{log.target_id?.slice(0, 8)}</span> : null}
              {log.ip_address ? <span className="event-meta">{log.ip_address}</span> : null}
            </div>
          ))}
          <Pagination page={page} total={totalPages(filteredLogs.length, 15)} onPageChange={setPage} />
        </>
      ) : (
        <EmptyState icon={<FileText size={32} />} title={t("adminTabs.auditLog.emptyTitle")} description={t("adminTabs.auditLog.emptyDescription")} />
      )}
    </article>
  );
}
