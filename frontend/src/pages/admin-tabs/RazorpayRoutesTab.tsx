import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { useI18n } from "../../i18n";

type LinkedAccount = {
  id: string;
  church_id: string;
  church_name?: string;
  razorpay_account_id: string;
  account_status: string;
  routes_enabled: boolean;
  business_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  bank_ifsc_code: string | null;
  activated_at: string | null;
  created_at: string;
};

type TransferSummaryRow = {
  church_id: string;
  church_name: string;
  total_transfers: number;
  total_amount: number;
  total_platform_fee: number;
  pending_count: number;
  settled_count: number;
  failed_count: number;
};

type TransferSummary = {
  total_transfers: number;
  total_transferred: number;
  total_platform_fees: number;
  pending_count: number;
  settled_count: number;
  failed_count: number;
  by_church: TransferSummaryRow[];
};

type PaymentTransfer = {
  id: string;
  payment_id: string;
  church_id: string;
  church_name: string;
  linked_account_id: string;
  razorpay_transfer_id: string | null;
  transfer_amount: number;
  platform_fee_amount: number;
  transfer_status: string;
  razorpay_order_id: string | null;
  settled_at: string | null;
  failure_reason: string | null;
  created_at: string;
};

type TransferListResponse = {
  transfers: PaymentTransfer[];
  total: number;
};

type ChurchOption = { id: string; name: string };
type ChurchOptionsResponse = ChurchOption[] | { churches: ChurchOption[] };

function normalizeChurchOptions(data: ChurchOptionsResponse): ChurchOption[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data.churches) ? data.churches : [];
}

function formatMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function RazorpayRoutesTab() {
  const { t } = useI18n();
  const { token, busyKey, withAuthRequest } = useApp();

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [transfers, setTransfers] = useState<PaymentTransfer[]>([]);
  const [transferTotal, setTransferTotal] = useState(0);
  const [churches, setChurches] = useState<ChurchOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    church_id: "",
    email: "",
    phone: "",
    legal_business_name: "",
    business_type: "not_yet_categorised",
    contact_name: "",
    bank_account_name: "",
    bank_account_number: "",
    bank_ifsc_code: "",
  });

  const loadAll = useCallback(async () => {
    const [accts, transferSummary, transferList] = await Promise.all([
      withAuthRequest(
        "load-linked-accounts",
        () => apiRequest<LinkedAccount[]>("/api/razorpay-routes/linked-accounts", { token }),
      ),
      withAuthRequest(
        "load-transfer-summary",
        () => apiRequest<TransferSummary>("/api/razorpay-routes/transfers/summary", { token }),
      ),
      withAuthRequest(
        "load-transfers",
        () => apiRequest<TransferListResponse>("/api/razorpay-routes/transfers?limit=10", { token }),
      ),
    ]);

    if (Array.isArray(accts)) setAccounts(accts);
    if (transferSummary && !Array.isArray(transferSummary)) setSummary(transferSummary);
    if (transferList && Array.isArray(transferList.transfers)) {
      setTransfers(transferList.transfers);
      setTransferTotal(Number(transferList.total || transferList.transfers.length));
    }
    setLoaded(true);
  }, [token, withAuthRequest]);

  useEffect(() => {
    void Promise.resolve().then(loadAll);
    void (async () => {
      const data = await apiRequest<ChurchOptionsResponse>("/api/churches/summary", { token });
      setChurches(normalizeChurchOptions(data));
    })();
  }, [loadAll, token]);

  async function onCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    const result = await withAuthRequest(
      "create-linked-account",
      () => apiRequest<LinkedAccount>("/api/razorpay-routes/linked-accounts", {
        method: "POST",
        token,
        body: form,
      }),
      t("adminTabs.razorpayRoutes.successAccountCreated"),
    );
    if (result) {
      setShowForm(false);
      setForm({
        church_id: "",
        email: "",
        phone: "",
        legal_business_name: "",
        business_type: "not_yet_categorised",
        contact_name: "",
        bank_account_name: "",
        bank_account_number: "",
        bank_ifsc_code: "",
      });
      void loadAll();
    }
  }

  async function syncAccount(churchId: string) {
    await withAuthRequest(
      `sync-${churchId}`,
      () => apiRequest<LinkedAccount>(`/api/razorpay-routes/linked-accounts/church/${churchId}/sync`, {
        method: "POST",
        token,
      }),
      t("adminTabs.razorpayRoutes.successSynced"),
    );
    void loadAll();
  }

  async function toggleRoutes(churchId: string, currentEnabled: boolean) {
    await withAuthRequest(
      `toggle-${churchId}`,
      () => apiRequest<{ routes_enabled: boolean }>(`/api/razorpay-routes/linked-accounts/church/${churchId}/toggle`, {
        method: "PATCH",
        token,
        body: { routes_enabled: !currentEnabled },
      }),
      currentEnabled ? t("adminTabs.razorpayRoutes.successRoutesDisabled") : t("adminTabs.razorpayRoutes.successRoutesEnabled"),
    );
    void loadAll();
  }

  const linkedChurchIds = new Set(accounts.map((a) => a.church_id));
  const availableChurches = churches.filter((c) => !linkedChurchIds.has(c.id));

  const statusColor = (status: string) => {
    if (status === "activated" || status === "settled" || status === "processed") return "var(--color-success, #16a34a)";
    if (status === "created" || status === "pending" || status === "needs_clarification" || status === "under_review") return "var(--color-warning, #d97706)";
    return "var(--color-danger, #dc2626)";
  };

  if (!loaded) {
    return <article className="panel"><p>{t("common.loading")}...</p></article>;
  }

  return (
    <article className="panel">
      <div className="actions-row" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
        <div>
          <h3>{t("adminTabs.razorpayRoutes.title")}</h3>
          <p className="muted">{t("adminTabs.razorpayRoutes.description")}</p>
        </div>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => void loadAll()}>
          {t("common.refresh")}
        </button>
      </div>

      <section style={{ marginTop: "1.25rem" }}>
        <h4>{t("adminTabs.razorpayRoutes.transferOverviewTitle")}</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.totalTransfers")}</span>
            <strong>{summary?.total_transfers || 0}</strong>
          </div>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.totalTransferred")}</span>
            <strong>{formatMoney(summary?.total_transferred)}</strong>
          </div>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.totalPlatformFees")}</span>
            <strong>{formatMoney(summary?.total_platform_fees)}</strong>
          </div>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.pendingTransfers")}</span>
            <strong>{summary?.pending_count || 0}</strong>
          </div>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.settledTransfers")}</span>
            <strong>{summary?.settled_count || 0}</strong>
          </div>
          <div className="list-item">
            <span className="muted">{t("adminTabs.razorpayRoutes.failedTransfers")}</span>
            <strong>{summary?.failed_count || 0}</strong>
          </div>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <div className="actions-row" style={{ marginBottom: "0.75rem" }}>
          <h4 style={{ margin: 0 }}>{t("adminTabs.razorpayRoutes.linkedAccountsTitle", { count: accounts.length })}</h4>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={() => setShowForm(!showForm)}>
            {showForm ? t("adminTabs.razorpayRoutes.cancelButton") : t("adminTabs.razorpayRoutes.onboardChurch")}
          </button>
        </div>

        {showForm && (
          <form onSubmit={(e) => void onCreateAccount(e)} style={{ marginBottom: "1rem", padding: "1rem", borderRadius: "var(--radius-md)", background: "var(--surface-container)" }}>
            <div className="field-stack">
              <label>
                {t("adminTabs.razorpayRoutes.churchLabel")}
                <select value={form.church_id} onChange={(e) => setForm({ ...form, church_id: e.target.value })} required>
                  <option value="">{t("adminTabs.razorpayRoutes.selectChurchPlaceholder")}</option>
                  {availableChurches.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("adminTabs.razorpayRoutes.legalBusinessNameLabel")}
                <input value={form.legal_business_name} onChange={(e) => setForm({ ...form, legal_business_name: e.target.value })} required />
              </label>
              <label>
                {t("adminTabs.razorpayRoutes.contactNameLabel")}
                <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} required />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem" }}>
                <label>
                  {t("adminTabs.razorpayRoutes.emailLabel")}
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </label>
                <label>
                  {t("adminTabs.razorpayRoutes.phoneLabel")}
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder={t("adminTabs.razorpayRoutes.phonePlaceholder")} />
                </label>
              </div>
              <label>
                {t("adminTabs.razorpayRoutes.businessTypeLabel")}
                <select value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                  <option value="not_yet_categorised">{t("adminTabs.razorpayRoutes.typeNotCategorised")}</option>
                  <option value="trust">{t("adminTabs.razorpayRoutes.typeTrust")}</option>
                  <option value="society">{t("adminTabs.razorpayRoutes.typeSociety")}</option>
                  <option value="ngo">{t("adminTabs.razorpayRoutes.typeNgo")}</option>
                  <option value="individual">{t("adminTabs.razorpayRoutes.typeIndividual")}</option>
                </select>
              </label>
              <h5 style={{ margin: "0.25rem 0" }}>{t("adminTabs.razorpayRoutes.bankDetailsTitle")}</h5>
              <label>
                {t("adminTabs.razorpayRoutes.accountHolderNameLabel")}
                <input value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} required />
              </label>
              <label>
                {t("adminTabs.razorpayRoutes.accountNumberLabel")}
                <input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} required />
              </label>
              <label>
                {t("adminTabs.razorpayRoutes.ifscLabel")}
                <input value={form.bank_ifsc_code} onChange={(e) => setForm({ ...form, bank_ifsc_code: e.target.value.toUpperCase() })} required placeholder={t("adminTabs.razorpayRoutes.ifscPlaceholder")} />
              </label>
            </div>
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button type="submit" className="btn btn-primary" disabled={busyKey === "create-linked-account"}>
                {busyKey === "create-linked-account" ? t("adminTabs.razorpayRoutes.creatingAccount") : t("adminTabs.razorpayRoutes.createLinkedAccount")}
              </button>
            </div>
          </form>
        )}

        {accounts.length === 0 ? (
          <p className="muted">{t("adminTabs.razorpayRoutes.noLinkedAccounts")}</p>
        ) : (
          <div className="list-stack">
            {accounts.map((account) => (
              <div key={account.id} className="list-item">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <strong>{account.church_name || account.church_id}</strong>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {account.business_name || "-"} - {account.contact_name || "-"}
                    </div>
                    <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                      <span style={{ color: statusColor(account.account_status), fontWeight: 600 }}>
                        {account.account_status.toUpperCase()}
                      </span>
                      {" | "}RZP: {account.razorpay_account_id}
                    </div>
                  </div>
                  <div className="actions-row">
                    <button
                      className="btn btn-sm"
                      onClick={() => void syncAccount(account.church_id)}
                      disabled={busyKey === `sync-${account.church_id}`}
                    >
                      {t("adminTabs.razorpayRoutes.syncButton")}
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => void toggleRoutes(account.church_id, account.routes_enabled)}
                      disabled={busyKey === `toggle-${account.church_id}`}
                    >
                      {account.routes_enabled ? t("adminTabs.razorpayRoutes.disableButton") : t("adminTabs.razorpayRoutes.enableButton")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h4>{t("adminTabs.razorpayRoutes.churchSummaryTitle")}</h4>
        {!summary?.by_church?.length ? (
          <p className="muted">{t("adminTabs.razorpayRoutes.noTransfers")}</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("adminTabs.razorpayRoutes.columnChurch")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnTransfers")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnAmount")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnPlatformFee")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnPending")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnSettled")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnFailed")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.by_church.map((row) => (
                  <tr key={row.church_id}>
                    <td>{row.church_name}</td>
                    <td style={{ textAlign: "right" }}>{row.total_transfers}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.total_amount)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.total_platform_fee)}</td>
                    <td style={{ textAlign: "right" }}>{row.pending_count}</td>
                    <td style={{ textAlign: "right" }}>{row.settled_count}</td>
                    <td style={{ textAlign: "right" }}>{row.failed_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h4>{t("adminTabs.razorpayRoutes.recentTransfersTitle", { count: transferTotal })}</h4>
        {!transfers.length ? (
          <p className="muted">{t("adminTabs.razorpayRoutes.noRecentTransfers")}</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("adminTabs.razorpayRoutes.columnChurch")}</th>
                  <th>{t("adminTabs.razorpayRoutes.columnStatus")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnAmount")}</th>
                  <th style={{ textAlign: "right" }}>{t("adminTabs.razorpayRoutes.columnPlatformFee")}</th>
                  <th>{t("adminTabs.razorpayRoutes.columnOrder")}</th>
                  <th>{t("adminTabs.razorpayRoutes.columnCreated")}</th>
                  <th>{t("adminTabs.razorpayRoutes.columnFailure")}</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((row) => (
                  <tr key={row.id}>
                    <td>{row.church_name}</td>
                    <td>
                      <span style={{ color: statusColor(row.transfer_status), fontWeight: 700 }}>
                        {row.transfer_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.transfer_amount)}</td>
                    <td style={{ textAlign: "right" }}>{formatMoney(row.platform_fee_amount)}</td>
                    <td>{row.razorpay_order_id || "-"}</td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>{row.failure_reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
