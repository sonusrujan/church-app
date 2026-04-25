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
    if (accts) setAccounts(accts);
    if (sum) setSummary(sum);
    setLoaded(true);
  }, [token, withAuthRequest]);

  useEffect(() => {
    void loadAll();
    // load churches for the dropdown
    void (async () => {
      const data = await apiRequest<ChurchOption[]>("/api/churches", { token });
      if (data) setChurches(data);
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
      "Linked account created successfully",
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
      "Account synced",
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
      `Routes ${currentEnabled ? "disabled" : "enabled"}`,
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
      <h3>Razorpay Routes — Fund Splitting</h3>
      <p className="muted">
        Manage linked accounts for automatic fund splitting between the platform and churches.
        Churches with activated linked accounts will have payments automatically routed.
      </p>

      {/* ── Linked Accounts ── */}
      <section style={{ marginTop: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h4 style={{ margin: 0 }}>Linked Accounts ({accounts.length})</h4>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Onboard Church"}
          </button>
        </div>

        {showForm && (
          <form onSubmit={(e) => void onCreateAccount(e)} style={{ marginTop: "1rem", padding: "1rem", borderRadius: 8, background: "var(--bg-secondary, #f9fafb)" }}>
            <div className="field-stack">
              <label>
                Church
                <select value={form.church_id} onChange={(e) => setForm({ ...form, church_id: e.target.value })} required>
                  <option value="">Select a church...</option>
                  {availableChurches.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Legal Business Name
                <input value={form.legal_business_name} onChange={(e) => setForm({ ...form, legal_business_name: e.target.value })} required />
              </label>
              <label>
                Contact Name
                <input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} required />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <label>
                  Email
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </label>
                <label>
                  Phone
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="+91..." />
                </label>
              </div>
              <label>
                Business Type
                <select value={form.business_type} onChange={(e) => setForm({ ...form, business_type: e.target.value })}>
                  <option value="not_yet_categorised">Not Yet Categorised</option>
                  <option value="trust">Trust</option>
                  <option value="society">Society</option>
                  <option value="ngo">NGO</option>
                  <option value="individual">Individual</option>
                </select>
              </label>
              <h5 style={{ margin: "0.75rem 0 0.25rem" }}>Bank Details</h5>
              <label>
                Account Holder Name
                <input value={form.bank_account_name} onChange={(e) => setForm({ ...form, bank_account_name: e.target.value })} required />
              </label>
              <label>
                Account Number
                <input value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} required />
              </label>
              <label>
                IFSC Code
                <input value={form.bank_ifsc_code} onChange={(e) => setForm({ ...form, bank_ifsc_code: e.target.value.toUpperCase() })} required placeholder="e.g. SBIN0001234" />
              </label>
            </div>
            <div className="actions-row" style={{ marginTop: "0.75rem" }}>
              <button type="submit" className="btn btn-primary" disabled={busyKey === "create-linked-account"}>
                {busyKey === "create-linked-account" ? "Creating..." : "Create Linked Account"}
              </button>
            </div>
          </form>
        )}

        {accounts.length === 0 ? (
          <p style={{ marginTop: "0.75rem", color: "var(--text-secondary)" }}>No linked accounts yet. Onboard a church to get started.</p>
        ) : (
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {accounts.map((account) => (
              <div key={account.id} style={{ padding: "0.75rem", borderRadius: 8, background: "var(--bg-secondary, #f9fafb)", border: "1px solid var(--border, #e5e7eb)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <strong>{account.church_name || account.church_id}</strong>
                    <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
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
                      Sync
                    </button>
                    <button
                      className="btn btn-sm"
                      onClick={() => void toggleRoutes(account.church_id, account.account_status === "activated")}
                      disabled={busyKey === `toggle-${account.church_id}`}
                    >
                      {account.account_status === "activated" ? "Disable" : "Enable"}
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
        <h4>Transfer Summary by Church</h4>
        {summary.length === 0 ? (
          <p style={{ color: "var(--text-secondary)" }}>No transfers recorded yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem" }}>Church</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>Transfers</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>Amount (₹)</th>
                  <th style={{ padding: "0.5rem", textAlign: "right" }}>Platform Fee (₹)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row) => (
                  <tr key={row.church_id} style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <td style={{ padding: "0.5rem" }}>{row.church_name}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>{row.total_transfers}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>{Number(row.total_amount).toLocaleString("en-IN")}</td>
                    <td style={{ padding: "0.5rem", textAlign: "right" }}>{Number(row.total_platform_fee).toLocaleString("en-IN")}</td>
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
