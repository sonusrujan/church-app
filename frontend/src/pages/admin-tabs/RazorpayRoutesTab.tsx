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
};

type ChurchOption = { id: string; name: string };
type ChurchOptionsResponse = ChurchOption[] | { churches: ChurchOption[] };

function normalizeChurchOptions(data: ChurchOptionsResponse): ChurchOption[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data.churches) ? data.churches : [];
}

export default function RazorpayRoutesTab() {
  const { t } = useI18n();
  const { token, busyKey, withAuthRequest } = useApp();

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [summary, setSummary] = useState<TransferSummaryRow[]>([]);
  const [churches, setChurches] = useState<ChurchOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form fields
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
    const [accts, sum] = await Promise.all([
      withAuthRequest(
        "load-linked-accounts",
        () => apiRequest<LinkedAccount[]>("/api/razorpay-routes/linked-accounts", { token }),
      ),
      withAuthRequest(
        "load-transfer-summary",
        () => apiRequest<TransferSummaryRow[]>("/api/razorpay-routes/transfers/summary", { token }),
      ),
    ]);
    if (accts && Array.isArray(accts)) setAccounts(accts);
    if (sum && Array.isArray(sum)) setSummary(sum);
    setLoaded(true);
  }, [token, withAuthRequest]);

  useEffect(() => {
    void Promise.resolve().then(loadAll);
    // load churches for the dropdown
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
      setForm({ church_id: "", email: "", phone: "", legal_business_name: "", business_type: "not_yet_categorised", contact_name: "", bank_account_name: "", bank_account_number: "", bank_ifsc_code: "" });
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

  // Filter churches that already have linked accounts
  const linkedChurchIds = new Set(accounts.map((a) => a.church_id));
  const availableChurches = churches.filter((c) => !linkedChurchIds.has(c.id));

  const statusColor = (status: string) => {
    if (status === "activated") return "var(--color-success, #16a34a)";
    if (status === "created" || status === "needs_clarification") return "var(--color-warning, #d97706)";
    return "var(--color-danger, #dc2626)";
  };

  if (!loaded) {
    return <article className="panel"><p>{t("common.loading")}...</p></article>;
  }

  return (
    <article className="panel">
      <h3>{t("adminTabs.razorpayRoutes.title")}</h3>
      <p className="muted">{t("adminTabs.razorpayRoutes.description")}</p>

      {/* ── Linked Accounts ── */}
      <section style={{ marginTop: "1.25rem" }}>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>{account.church_name || account.church_id}</strong>
                    <div className="muted" style={{ fontSize: "0.85rem" }}>
                      {account.business_name} — {account.contact_name}
                    </div>
                    <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                      <span style={{ color: statusColor(account.account_status), fontWeight: 600 }}>
                        {account.account_status.toUpperCase()}
                      </span>
                      {" · "}RZP: {account.razorpay_account_id}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
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

      {/* ── Transfer Summary ── */}
      <section style={{ marginTop: "1.5rem" }}>
        <h4>{t("adminTabs.razorpayRoutes.transferSummaryTitle")}</h4>
        {summary.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.church_id}>
                    <td>{row.church_name}</td>
                    <td style={{ textAlign: "right" }}>{row.total_transfers}</td>
                    <td style={{ textAlign: "right" }}>{Number(row.total_amount).toLocaleString("en-IN")}</td>
                    <td style={{ textAlign: "right" }}>{Number(row.total_platform_fee).toLocaleString("en-IN")}</td>
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
