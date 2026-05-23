/**
 * SmsReminders — native React replacement for public/sms-reminders.html
 *
 * Endpoints (verified against live prod — read-only, no side effects):
 *   GET /api/intel/receivables
 *     → { accounts: ARAccount[], downpayments: Downpayment[] }
 *   GET /api/intel/resurrection
 *     → ResurrectionRow[] (bare array)
 *
 * Downpayment keys: job, jobId, status, comments, customer{firstName, lastName,
 *   cellPhoneNumber, homePhoneNumber}, dateAdded, insurance{company}, customerId,
 *   lastModified, downpaymentTrackerID
 *
 * ARAccount keys: job, proj, jobId, sentOn, status, comments, customer, insurance,
 *   invoiceId, assigneeId, customerId, assigneeName, finalPayment, lastModified,
 *   completionPayment, accountsReceivableID
 *   (job has addressLine1/city/state; proj/job have jobTotal)
 *
 * ResurrectionRow keys: lat, lng, zip, city, jobId, stage, state, trades, address,
 *   jobType, customer, salesRep, allStorms, claimType, insurance, deductible,
 *   signedDate, adjusterName, daysSinceDead, lastTouchDate, newStormCount,
 *   strongestStorm{stormType, ...}
 *
 * 3 tabs: Downpayment Reminders | AR / Balance Pending | Resurrection (storm hook)
 * Editable template with {name}, {addr}, {amount}, {carrier} tokens.
 * Filter by search + status. Copy-to-clipboard per row. CSV export.
 */
import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface CustomerInfo {
  firstName?: string;
  lastName?: string;
  cellPhoneNumber?: string;
  homePhoneNumber?: string;
}

interface InsuranceInfo {
  company?: string;
}

interface JobInfo {
  addressLine1?: string;
  city?: string;
  state?: string;
  jobTotal?: number;
}

interface ProjInfo {
  jobTotal?: number;
}

interface Downpayment {
  jobId: string;
  status: string;
  customer: CustomerInfo;
  insurance: InsuranceInfo;
  job: JobInfo;
  customerId: string;
  downpaymentTrackerID: string;
  dateAdded: string | null;
}

interface ARAccount {
  jobId: string;
  status: string;
  customer: CustomerInfo;
  insurance: InsuranceInfo;
  job: JobInfo;
  proj: ProjInfo | null;
  customerId: string;
  accountsReceivableID: string;
}

interface ReceivablesResponse {
  downpayments: Downpayment[];
  accounts: ARAccount[];
}

interface ResurrectionRow {
  customer: string;
  address: string;
  insurance: string;
  adjusterName: string | null;
  strongestStorm: { stormType?: string } | null;
}

// ---------------------------------------------------------------------------
// Internal normalized row shape for display
// ---------------------------------------------------------------------------

interface SmsRow {
  id: string;
  name: string;
  firstName: string;
  phone: string | null;
  address: string;
  carrier: string;
  amount: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Template defaults (match HTML exactly)
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, string> = {
  dp: "Hi {name}, this is Roof Docs — just a quick check on the down payment for your {addr} project. Let us know if you have any questions or need help making the payment. Thanks!",
  ar: "Hi {name}, Roof Docs here — we have a balance pending on your {addr} project for {amount}. Could you let us know when you can take care of that? Thank you!",
  res: "Hi {name}, Roof Docs — there was a recent storm near your {addr} home and your {carrier} policy may cover damage. Want us to swing by for a free no-obligation inspection? — Roof Docs",
};

function buildSMS(tpl: string, r: SmsRow): string {
  return tpl
    .replace(/\{name\}/g, r.firstName || r.name || "there")
    .replace(/\{addr\}/g, r.address || "your project")
    .replace(/\{amount\}/g, r.amount || "")
    .replace(/\{carrier\}/g, r.carrier || "insurance");
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: SmsRow[], tpl: string, tabId: string) {
  const headers = ["Name","Phone","Address","Carrier","Amount","Status","SMS"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const row = [r.name, r.phone, r.address, r.carrier, r.amount, r.status, buildSMS(tpl, r)]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-sms-${tabId}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 11,
  textTransform: "uppercase", padding: "8px 6px", borderBottom: "1px solid var(--riq-border)",
};
const tdStyle: React.CSSProperties = { padding: "6px", borderBottom: "1px solid var(--riq-surface)", verticalAlign: "top" };
const inputStyle: React.CSSProperties = {
  background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
  borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        background: "transparent", color: "var(--riq-accent)",
        border: "1px solid var(--riq-accent)", borderRadius: 3,
        padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabId = "dp" | "ar" | "res";

export function SmsReminders({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allData, setAllData] = useState<Record<TabId, SmsRow[]>>({ dp: [], ar: [], res: [] });
  const [tab, setTab] = useState<TabId>("dp");
  const [tpl, setTpl] = useState(TEMPLATES.dp);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/intel/receivables", { credentials: "include" }).then((r) => r.json() as Promise<ReceivablesResponse>),
      fetch("/api/intel/resurrection", { credentials: "include" }).then((r) => r.json() as Promise<ResurrectionRow[]>).catch(() => [] as ResurrectionRow[]),
    ]).then(([rec, resData]) => {
      const dp: SmsRow[] = (rec.downpayments || []).map((d) => ({
        id: d.downpaymentTrackerID,
        name: `${d.customer?.firstName || ""} ${d.customer?.lastName || ""}`.trim(),
        firstName: d.customer?.firstName || "",
        phone: d.customer?.cellPhoneNumber || d.customer?.homePhoneNumber || null,
        address: [d.job?.addressLine1, d.job?.city, d.job?.state].filter(Boolean).join(", "),
        carrier: d.insurance?.company || "",
        amount: "",
        status: d.status || "",
      }));

      const ar: SmsRow[] = (rec.accounts || [])
        .filter((a) => a.status && a.status !== "CF Received")
        .map((a) => ({
          id: a.accountsReceivableID,
          name: `${a.customer?.firstName || ""} ${a.customer?.lastName || ""}`.trim(),
          firstName: a.customer?.firstName || "",
          phone: a.customer?.cellPhoneNumber || a.customer?.homePhoneNumber || null,
          address: [a.job?.addressLine1, a.job?.city, a.job?.state].filter(Boolean).join(", "),
          carrier: a.insurance?.company || "",
          amount: (a.proj?.jobTotal || a.job?.jobTotal) ? `$${Math.round(a.proj?.jobTotal || a.job?.jobTotal || 0).toLocaleString()}` : "",
          status: a.status || "",
        }));

      const res: SmsRow[] = (Array.isArray(resData) ? resData : [])
        .filter((r) => r.adjusterName || r.customer)
        .map((r, i) => ({
          id: String(i),
          name: r.customer || "",
          firstName: (r.customer || "").split(" ")[0],
          phone: null, // resurrection rows don't include phone per HTML comment
          address: r.address || "",
          carrier: r.insurance || "",
          amount: "",
          status: r.strongestStorm?.stormType || "",
        }));

      setAllData({ dp, ar, res });
      setLoading(false);
    }).catch((e: unknown) => {
      setError((e as Error).message);
      setLoading(false);
    });
  }, []);

  function switchTab(t: TabId) {
    setTab(t);
    setTpl(TEMPLATES[t]);
    setSearch("");
    setStatus("");
  }

  const rows = allData[tab];
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))].sort();

  const filtered = rows.filter((r) => r.phone).filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (![r.name, r.address, r.carrier].join(" ").toLowerCase().includes(q)) return false;
    }
    if (status && r.status !== status) return false;
    return true;
  });

  const tabInfo = {
    dp: { title: "Downpayment Reminders", desc: "Active downpayments pending collection — auto-generated SMS." },
    ar: { title: "AR / Balance Pending Reminders", desc: "Open AR with Balance Pending status — polite collection nudge." },
    res: { title: "Resurrection — Re-engage with storm hook", desc: "Dead insurance jobs with new strong storms — storm-anchored re-engagement." },
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>;

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 18px", cursor: "pointer",
    color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
    borderBottom: `2px solid ${active ? "var(--riq-accent)" : "transparent"}`,
    fontSize: 13, background: "none", border: "none",
    fontFamily: "inherit",
  });

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "16px 20px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
          <button style={tabBtnStyle(tab === "dp")} onClick={() => switchTab("dp")}>Downpayment Reminders</button>
          <button style={tabBtnStyle(tab === "ar")} onClick={() => switchTab("ar")}>AR / Balance Pending</button>
          <button style={tabBtnStyle(tab === "res")} onClick={() => switchTab("res")}>Resurrection (with storm hook)</button>
        </div>

        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>{tabInfo[tab].title}</h2>
        <p style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>{tabInfo[tab].desc}</p>

        {/* Template editor */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>
            Template (use &#123;name&#125;, &#123;addr&#125;, &#123;amount&#125;, &#123;carrier&#125;)
          </label>
          <textarea
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            style={{
              background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
              borderRadius: 4, padding: "8px 12px", fontSize: 13, width: "100%", minHeight: 70,
              fontFamily: "inherit", marginTop: 4, display: "block",
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="customer / city / carrier"
              style={{ ...inputStyle, width: 280 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
              <option value="">All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button
            onClick={() => exportCSV(filtered, tpl, tab)}
            style={{ background: "var(--riq-accent)", color: "#1a1612", border: "none", borderRadius: 4, padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            Export CSV
          </button>
        </div>

        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
          {filtered.length} customers with phone numbers
        </div>

        {/* Table */}
        <div style={{ maxHeight: 700, overflowY: "auto" }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Address</th>
                <th style={thStyle}>Carrier</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>SMS Preview</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => {
                const sms = buildSMS(tpl, r);
                const smsHref = `sms:${(r.phone || "").replace(/\D/g, "")}&body=${encodeURIComponent(sms)}`;
                return (
                  <tr key={r.id}>
                    <td style={tdStyle}><strong>{r.name || "—"}</strong></td>
                    <td style={tdStyle}>
                      {r.phone ? (
                        <a href={smsHref} style={{ color: "var(--riq-accent)", textDecoration: "none" }}>{r.phone}</a>
                      ) : (
                        <span style={{ color: "var(--riq-text-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={tdStyle}>{r.address || "—"}</td>
                    <td style={tdStyle}>{r.carrier || "—"}</td>
                    <td style={tdStyle}>{r.status || "—"}</td>
                    <td style={tdStyle}>
                      <div style={{ background: "#342c23", padding: "8px 12px", borderRadius: 6, fontSize: 12, lineHeight: 1.4, maxWidth: 380 }}>
                        {sms}
                      </div>
                    </td>
                    <td style={tdStyle}><CopyBtn text={sms} /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>No customers match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
