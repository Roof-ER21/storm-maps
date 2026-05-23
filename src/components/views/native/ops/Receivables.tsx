/**
 * Receivables — native React (Phase 2d batch3)
 *
 * Endpoints:
 *   GET /api/intel/receivables  (eager, on mount)
 *     → { accounts: AccountRow[], downpayments: DownpaymentRow[] }
 *     AccountRow fields (verified): job{city,jobID,state,zipCode,addressLine1,completedDate,finalizedDate},
 *       proj{acv,lat,lng,stage,jobTotal,salesRep,depreciation,insuranceTotal},
 *       jobId, sentOn, status, comments, customer{email,lastName,firstName,cellPhoneNumber,homePhoneNumber},
 *       insurance{company,...}, invoiceId, assigneeId, customerId, assigneeName, finalPayment, lastModified,
 *       completionPayment, accountsReceivableID
 *     DownpaymentRow fields: job{...}, jobId, status, comments, customer{...}, dateAdded, insurance{...},
 *       customerId, lastModified, downpaymentTrackerID
 *
 *   GET /api/intel/receivables/rollup  (lazy, Carrier Friction tab)
 *     → { asOf, carrierFilter, totals{count,countWithSentOn,outstanding,depositsAwaiting,downpaymentsTotal},
 *         aging{"0-30",...,"180+": {count,outstanding}},
 *         byCarrier: [{carrier,count,outstanding,avgDays,oldestDays,aging}],
 *         byCollector: [{assigneeId,name,count,outstanding,avgDays,oldestDays,aging,statuses}],
 *         statusBreakdown, downpaymentStatus }
 *
 *   GET /api/intel/credits  (lazy, Vendor Credits tab)
 *     → { credits: CreditRow[], summary: {totalCount,totalAmount,unrequestedAmount,collectedAmount,byCreditor} }
 *     CreditRow: { job, memo, jobId, amount, status, creditor, createdAt, creditTrackerID }
 *
 *   GET /api/intel/adjustments-open  (lazy, Open PA Cases tab)
 *     → { adjustments: AdjustmentRow[] }
 *     AdjustmentRow: { job, jobId, tasks, status, assignee, comments, customer, dateAdded, insurance,
 *                      assigneeId, customerId, lastModified, photosNeeded, publicAdjustmentID }
 */
import { useState, useEffect } from "react";
import { Panel, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Shared types (verified against live prod)
// ---------------------------------------------------------------------------

interface CustomerInfo {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  cellPhoneNumber: string | null;
  homePhoneNumber: string | null;
}

interface JobInfo {
  jobID?: number;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zipCode?: string | null;
  completedDate?: string | null;
  finalizedDate?: string | null;
}

interface InsuranceInfo {
  company: string | null;
  claimNumber?: string | null;
  adjusterName?: string | null;
}

interface ProjInfo {
  jobTotal: number | null;
  salesRep: string | null;
  stage?: string | null;
}

interface AccountRow {
  accountsReceivableID: number;
  status: string | null;
  lastModified: string | null;
  customer: CustomerInfo | null;
  job: JobInfo | null;
  proj: ProjInfo | null;
  insurance: InsuranceInfo | null;
  sentOn?: string | null;
  assigneeName?: string | null;
}

interface DownpaymentRow {
  downpaymentTrackerID: number;
  status: string | null;
  dateAdded: string | null;
  lastModified: string | null;
  customer: CustomerInfo | null;
  job: JobInfo | null;
  insurance: InsuranceInfo | null;
}

interface AgingBucket {
  count: number;
  outstanding: number;
}

interface RollupCarrierRow {
  carrier: string;
  count: number;
  outstanding: number;
  avgDays: number | null;
  oldestDays: number | null;
  aging: Record<string, number>;
}

interface CollectorRow {
  name: string;
  count: number;
  outstanding: number;
  avgDays: number | null;
  oldestDays: number | null;
  aging: Record<string, number>;
}

interface RollupResponse {
  asOf: string;
  totals: {
    count: number;
    outstanding: number;
    depositsAwaiting?: number;
    downpaymentsTotal?: number;
  };
  aging: Record<string, AgingBucket>;
  byCarrier: RollupCarrierRow[];
  byCollector?: CollectorRow[];
}

interface CreditRow {
  creditTrackerID: number;
  creditor: string | null;
  amount: number | null;
  status: string | null;
  createdAt: string | null;
  memo: string | null;
  job?: { customer?: { firstName: string; lastName: string } } | null;
}

interface CreditsResponse {
  credits: CreditRow[];
  summary: {
    totalCount: number;
    totalAmount: number;
    unrequestedAmount: number;
    collectedAmount: number;
    byCreditor: { creditor: string; count: number; amount: number }[];
  };
}

interface AdjustmentRow {
  publicAdjustmentID: number;
  status: string | null;
  dateAdded: string | null;
  customer: CustomerInfo | null;
  insurance: InsuranceInfo | null;
  assignee: { firstName: string; lastName: string } | null;
  job: JobInfo | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString();
}

function custName(c: CustomerInfo | null): string {
  if (!c) return "—";
  return `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "—";
}

function custPhone(c: CustomerInfo | null): string {
  return c?.cellPhoneNumber ?? c?.homePhoneNumber ?? "—";
}

function jobAddr(j: JobInfo | null): string {
  return [j?.addressLine1, j?.city, j?.state, j?.zipCode].filter(Boolean).join(", ");
}

function slugClass(s: string | null): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z]+/g, "-");
}

function pillStyle(slug: string): React.CSSProperties {
  const base: React.CSSProperties = { display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11 };
  const map: Record<string, React.CSSProperties> = {
    "cf-pending":       { background: "rgba(245,158,11,0.2)",   color: "#f59e0b" },
    "balance-pending":  { background: "rgba(94,200,255,0.2)",   color: "var(--riq-accent)" },
    "cf-received":      { background: "rgba(16,185,129,0.2)",   color: "#10b981" },
    "cf-sent":          { background: "rgba(168,139,250,0.2)",  color: "#a78bfa" },
    "paying-online":    { background: "rgba(94,200,255,0.2)",   color: "var(--riq-accent)" },
    "pending-acv":      { background: "rgba(245,158,11,0.2)",   color: "#f59e0b" },
    "pending-mortgage": { background: "rgba(239,68,68,0.2)",    color: "#ef4444" },
    "collected":        { background: "rgba(16,185,129,0.2)",   color: "#10b981" },
  };
  return { ...base, ...(map[slug] ?? { background: "var(--riq-surface)", color: "var(--riq-text-muted)" }) };
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  userSelect: "none" as const,
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "6px", borderBottom: "1px solid #342c23", verticalAlign: "top" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#10b981" };

// ---------------------------------------------------------------------------
// Export CSV
// ---------------------------------------------------------------------------

function exportARCsv(rows: AccountRow[]) {
  const lines = ["Customer,Email,Phone,Address,City,State,Zip,Carrier,Status,LastModified,SalesRep,JobTotal"];
  for (const a of rows) {
    const row = [
      custName(a.customer),
      a.customer?.email ?? "",
      custPhone(a.customer),
      a.job?.addressLine1 ?? "",
      a.job?.city ?? "",
      a.job?.state ?? "",
      a.job?.zipCode ?? "",
      a.insurance?.company ?? "",
      a.status ?? "",
      a.lastModified ?? "",
      a.proj?.salesRep ?? "",
      a.proj?.jobTotal ?? "",
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  download(lines.join("\n"), `roofdocs-AR-${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportDPCsv(rows: DownpaymentRow[]) {
  const lines = ["Customer,Email,Phone,Address,City,State,Carrier,Status,DateAdded,LastModified,JobTotal"];
  for (const d of rows) {
    const row = [
      custName(d.customer),
      d.customer?.email ?? "",
      custPhone(d.customer),
      d.job?.addressLine1 ?? "",
      d.job?.city ?? "",
      d.job?.state ?? "",
      d.insurance?.company ?? "",
      d.status ?? "",
      d.dateAdded ?? "",
      d.lastModified ?? "",
      "",
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  download(lines.join("\n"), `roofdocs-downpayments-${new Date().toISOString().slice(0, 10)}.csv`);
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sort state helper
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabId = "ar" | "dp" | "friction" | "pa" | "credits";

export function Receivables({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [downpayments, setDownpayments] = useState<DownpaymentRow[]>([]);
  const [mainLoading, setMainLoading] = useState(true);
  const [mainError, setMainError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("ar");

  // AR filter state
  const [arSearch, setArSearch] = useState("");
  const [arStatus, setArStatus] = useState("");
  const [arState, setArState] = useState("");
  const [arMin, setArMin] = useState("");
  const [arSortKey, setArSortKey] = useState("jobTotal");
  const [arSortDir, setArSortDir] = useState<SortDir>("desc");

  // DP filter state
  const [dpSearch, setDpSearch] = useState("");
  const [dpStatus, setDpStatus] = useState("");
  const [dpSortKey, setDpSortKey] = useState("jobTotal");
  const [dpSortDir, setDpSortDir] = useState<SortDir>("desc");

  // Lazy sections
  const [rollup, setRollup] = useState<RollupResponse | null>(null);
  const [rollupLoaded, setRollupLoaded] = useState(false);
  const [credits, setCredits] = useState<CreditsResponse | null>(null);
  const [creditsLoaded, setCreditsLoaded] = useState(false);
  const [paList, setPaList] = useState<AdjustmentRow[]>([]);
  const [paLoaded, setPaLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/intel/receivables", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ accounts: AccountRow[]; downpayments: DownpaymentRow[] }>;
      })
      .then((d) => {
        setAccounts(d.accounts ?? []);
        setDownpayments(d.downpayments ?? []);
        setMainLoading(false);
      })
      .catch((e: unknown) => { setMainError((e as Error).message); setMainLoading(false); });
  }, []);

  useEffect(() => {
    if (tab === "friction" && !rollupLoaded) {
      setRollupLoaded(true);
      fetch("/api/intel/receivables/rollup", { credentials: "include" })
        .then((r) => r.json() as Promise<RollupResponse>)
        .then(setRollup)
        .catch(() => {/* show empty */});
    }
    if (tab === "credits" && !creditsLoaded) {
      setCreditsLoaded(true);
      fetch("/api/intel/credits", { credentials: "include" })
        .then((r) => r.json() as Promise<CreditsResponse>)
        .then(setCredits)
        .catch(() => {/* show empty */});
    }
    if (tab === "pa" && !paLoaded) {
      setPaLoaded(true);
      fetch("/api/intel/adjustments-open", { credentials: "include" })
        .then((r) => r.json() as Promise<{ adjustments: AdjustmentRow[] }>)
        .then((d) => {
          const today = new Date();
          const withAge = (d.adjustments ?? []).map((a) => ({
            ...a,
            _daysOpen: a.dateAdded ? Math.floor((today.getTime() - new Date(a.dateAdded).getTime()) / 86400000) : null,
          })) as (AdjustmentRow & { _daysOpen: number | null })[];
          withAge.sort((a, b) => (b._daysOpen ?? 0) - (a._daysOpen ?? 0));
          setPaList(withAge);
        })
        .catch(() => {/* show empty */});
    }
  }, [tab, rollupLoaded, creditsLoaded, paLoaded]);

  if (mainLoading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      </div>
    );
  }
  if (mainError) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed: {mainError}</div>
      </div>
    );
  }

  // KPI values
  const arTotal = accounts.reduce((s, a) => s + (a.proj?.jobTotal ?? 0), 0);
  const cfPending = accounts.filter((a) => a.status === "CF Pending" || a.status === "CF Sent");
  const balPending = accounts.filter((a) => a.status === "Balance Pending");
  const dpNotCollected = downpayments.filter((d) => d.status !== "Collected");

  // Unique filter options
  const arStatuses = [...new Set(accounts.map((a) => a.status).filter(Boolean) as string[])].sort();
  const arStates = [...new Set(accounts.map((a) => a.job?.state).filter(Boolean) as string[])].sort();
  const dpStatuses = [...new Set(downpayments.map((d) => d.status).filter(Boolean) as string[])].sort();

  // AR filtered
  function arSortVal(a: AccountRow, k: string): string | number {
    if (k === "customer") return custName(a.customer);
    if (k === "phone") return custPhone(a.customer);
    if (k === "address") return a.job?.addressLine1 ?? "";
    if (k === "carrier") return a.insurance?.company ?? "";
    if (k === "status") return a.status ?? "";
    if (k === "lastModified") return a.lastModified ?? "";
    if (k === "rep") return a.proj?.salesRep ?? "";
    if (k === "jobTotal") return a.proj?.jobTotal ?? 0;
    return "";
  }

  let arFiltered = [...accounts];
  const q = arSearch.trim().toLowerCase();
  if (q) arFiltered = arFiltered.filter((a) =>
    [custName(a.customer), a.job?.addressLine1, a.insurance?.company, a.proj?.salesRep].some((f) => String(f ?? "").toLowerCase().includes(q))
  );
  if (arStatus) arFiltered = arFiltered.filter((a) => a.status === arStatus);
  if (arState) arFiltered = arFiltered.filter((a) => a.job?.state === arState);
  const minV = Number(arMin || 0);
  if (minV) arFiltered = arFiltered.filter((a) => (a.proj?.jobTotal ?? 0) >= minV);
  arFiltered.sort((a, b) => {
    const va = arSortVal(a, arSortKey), vb = arSortVal(b, arSortKey);
    if (typeof va === "number") return arSortDir === "asc" ? va - Number(vb) : Number(vb) - va;
    return arSortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });
  const arFilteredTotal = arFiltered.reduce((s, a) => s + (a.proj?.jobTotal ?? 0), 0);

  // DP filtered
  function dpSortVal(d: DownpaymentRow, k: string): string | number {
    if (k === "customer") return custName(d.customer);
    if (k === "phone") return custPhone(d.customer);
    if (k === "address") return d.job?.addressLine1 ?? "";
    if (k === "carrier") return d.insurance?.company ?? "";
    if (k === "status") return d.status ?? "";
    if (k === "dateAdded") return d.dateAdded ?? "";
    if (k === "lastModified") return d.lastModified ?? "";
    return "";
  }

  let dpFiltered = [...downpayments];
  const dq = dpSearch.trim().toLowerCase();
  if (dq) dpFiltered = dpFiltered.filter((d) =>
    [custName(d.customer), d.job?.addressLine1, d.insurance?.company].some((f) => String(f ?? "").toLowerCase().includes(dq))
  );
  if (dpStatus) dpFiltered = dpFiltered.filter((d) => d.status === dpStatus);
  dpFiltered.sort((a, b) => {
    const va = dpSortVal(a, dpSortKey), vb = dpSortVal(b, dpSortKey);
    if (typeof va === "number") return dpSortDir === "asc" ? va - Number(vb) : Number(vb) - va;
    return dpSortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  function toggleARSort(k: string) {
    if (arSortKey === k) setArSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setArSortKey(k); setArSortDir("desc"); }
  }
  function toggleDPSort(k: string) {
    if (dpSortKey === k) setDpSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setDpSortKey(k); setDpSortDir("desc"); }
  }

  const arArrow = (k: string) => arSortKey === k ? (arSortDir === "asc" ? " ▲" : " ▼") : "";
  const dpArrow = (k: string) => dpSortKey === k ? (dpSortDir === "asc" ? " ▲" : " ▼") : "";

  const inputStyle: React.CSSProperties = {
    background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
    borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit", outline: "none",
  };
  const selectStyle: React.CSSProperties = { ...inputStyle };
  const btnStyle: React.CSSProperties = {
    background: "var(--riq-accent)", color: "#1a1612", border: "none",
    borderRadius: 4, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 18px", cursor: "pointer",
    color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
    borderBottom: active ? "2px solid var(--riq-accent)" : "2px solid transparent",
    fontSize: 13,
    userSelect: "none" as const,
  });

  const bucketKeys = ["0-30", "31-60", "61-90", "91-180", "180+"] as const;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Open AR accounts",           value: accounts.length,    sub: "Completion + Final payment side" },
          { label: "Total job value (AR)",        value: fmtMoney(arTotal),  sub: null },
          { label: "CF Pending/Sent",             value: cfPending.length,   sub: fmtMoney(cfPending.reduce((s, a) => s + (a.proj?.jobTotal ?? 0), 0)) },
          { label: "Balance Pending",             value: balPending.length,  sub: fmtMoney(balPending.reduce((s, a) => s + (a.proj?.jobTotal ?? 0), 0)) },
          { label: "Downpayments tracked",        value: downpayments.length,sub: null },
          { label: "Downpayments not collected",  value: dpNotCollected.length, sub: null },
        ].map(({ label, value, sub }) => (
          <div key={label} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{value}</div>
            {sub && <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 2 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
        {([
          ["ar",       "Open AR (Completion + Final)"],
          ["dp",       "Pending Downpayments"],
          ["friction", "Carrier Friction"],
          ["pa",       "Open PA Cases"],
          ["credits",  "Vendor Credits"],
        ] as [TabId, string][]).map(([id, label]) => (
          <div key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {/* AR TAB */}
      {tab === "ar" && (
        <Panel title="Open AR">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "flex-end", marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              Search
              <input value={arSearch} onChange={(e) => setArSearch(e.target.value)} placeholder="customer / address / carrier / rep" style={{ ...inputStyle, width: 280 }} />
            </label>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              Status
              <select value={arStatus} onChange={(e) => setArStatus(e.target.value)} style={selectStyle}>
                <option value="">All</option>
                {arStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              State
              <select value={arState} onChange={(e) => setArState(e.target.value)} style={selectStyle}>
                <option value="">All</option>
                {arStates.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              Min $
              <input type="number" value={arMin} onChange={(e) => setArMin(e.target.value)} placeholder="0" style={{ ...inputStyle, width: 100 }} />
            </label>
            <button onClick={() => exportARCsv(arFiltered)} style={btnStyle}>Export CSV</button>
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
            {arFiltered.length} accounts · {fmtMoney(arFilteredTotal)} on the table
          </div>
          <div style={{ maxHeight: 760, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  {[["customer","Customer"],["phone","Phone"],["address","Address"],["carrier","Carrier"],["status","Status"],["lastModified","Last Modified"],["rep","Sales Rep"]].map(([k,l]) => (
                    <th key={k} style={thStyle} onClick={() => toggleARSort(k)}>{l}{arArrow(k)}</th>
                  ))}
                  <th style={thNumStyle} onClick={() => toggleARSort("jobTotal")}>Job Total{arArrow("jobTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {arFiltered.map((a) => (
                  <tr key={a.accountsReceivableID} style={{ cursor: "default" }}>
                    <td style={tdStyle}>
                      {custName(a.customer)}
                      <br />
                      <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{a.customer?.email ?? ""}</span>
                    </td>
                    <td style={tdStyle}>{custPhone(a.customer)}</td>
                    <td style={tdStyle}>{jobAddr(a.job)}</td>
                    <td style={tdStyle}>{a.insurance?.company ?? "—"}</td>
                    <td style={tdStyle}><span style={pillStyle(slugClass(a.status))}>{a.status ?? "—"}</span></td>
                    <td style={tdStyle}>{a.lastModified ?? "—"}</td>
                    <td style={tdStyle}>{a.proj?.salesRep ?? "—"}</td>
                    <td style={tdNumStyle}>{fmtMoney(a.proj?.jobTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* DP TAB */}
      {tab === "dp" && (
        <Panel title="Pending Downpayments">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, alignItems: "flex-end", marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              Search
              <input value={dpSearch} onChange={(e) => setDpSearch(e.target.value)} placeholder="customer / address / carrier" style={{ ...inputStyle, width: 280 }} />
            </label>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column" as const, gap: 4 }}>
              Status
              <select value={dpStatus} onChange={(e) => setDpStatus(e.target.value)} style={selectStyle}>
                <option value="">All</option>
                {dpStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button onClick={() => exportDPCsv(dpFiltered)} style={btnStyle}>Export CSV</button>
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
            {dpFiltered.length} downpayments tracked
          </div>
          <div style={{ maxHeight: 760, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  {[["customer","Customer"],["phone","Phone"],["address","Address"],["carrier","Carrier"],["status","Status"],["dateAdded","Date Added"],["lastModified","Last Modified"]].map(([k,l]) => (
                    <th key={k} style={thStyle} onClick={() => toggleDPSort(k)}>{l}{dpArrow(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dpFiltered.map((d) => (
                  <tr key={d.downpaymentTrackerID}>
                    <td style={tdStyle}>
                      {custName(d.customer)}
                      <br />
                      <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{d.customer?.email ?? ""}</span>
                    </td>
                    <td style={tdStyle}>{custPhone(d.customer)}</td>
                    <td style={tdStyle}>{[d.job?.addressLine1, d.job?.city, d.job?.state].filter(Boolean).join(", ")}</td>
                    <td style={tdStyle}>{d.insurance?.company ?? "—"}</td>
                    <td style={tdStyle}><span style={pillStyle(slugClass(d.status))}>{d.status ?? "—"}</span></td>
                    <td style={tdStyle}>{d.dateAdded ?? "—"}</td>
                    <td style={tdStyle}>{d.lastModified ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* FRICTION TAB */}
      {tab === "friction" && (
        <Panel title="Carrier Friction">
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}>
            Which carriers actually pay vs. drag. Ranked by outstanding dollars. Avg days is mean across the carrier's open accounts.
          </div>
          {!rollup ? (
            <div style={{ color: "var(--riq-text-muted)", padding: 20 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
                {[
                  { l: "Open accounts",   v: fmt(rollup.totals.count) },
                  { l: "Outstanding",     v: fmtMoney(rollup.totals.outstanding) },
                  { l: "91–180 days",     v: `${fmtMoney(rollup.aging["91-180"]?.outstanding)} (${rollup.aging["91-180"]?.count ?? 0})` },
                  { l: "180+ days",       v: `${fmtMoney(rollup.aging["180+"]?.outstanding)} (${rollup.aging["180+"]?.count ?? 0})` },
                  { l: "Pending deposits",v: fmt(rollup.totals.depositsAwaiting) },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }} dangerouslySetInnerHTML={{ __html: v }} />
                  </div>
                ))}
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Carrier</th>
                      <th style={thNumStyle}>Open</th>
                      <th style={thNumStyle}>Outstanding</th>
                      <th style={thNumStyle}>Avg days</th>
                      <th style={thNumStyle}>Oldest</th>
                      {bucketKeys.map((b) => (
                        <th key={b} style={{ ...thNumStyle, color: b === "180+" ? "#ef4444" : "var(--riq-text-muted)" }}>{b}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(rollup.byCarrier ?? []).map((c) => (
                      <tr key={c.carrier}>
                        <td style={{ ...tdStyle, color: "var(--riq-accent)" }}>{c.carrier}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{c.count}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: "#10b981" }}>{fmtMoney(c.outstanding)}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{c.avgDays ?? "—"}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>{c.oldestDays != null ? `${c.oldestDays}d` : "—"}</td>
                        {bucketKeys.map((b) => (
                          <td key={b} style={{ ...tdStyle, textAlign: "right" }}>{c.aging[b] ?? 0}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Collector table */}
              {(rollup.byCollector ?? []).length > 0 && (
                <div style={{ marginTop: 20, borderTop: "1px solid var(--riq-border)", paddingTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--riq-accent)", marginBottom: 6 }}>Collector performance</div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginBottom: 10, lineHeight: 1.5 }}>
                    AR assignees and what's on their plate.
                  </div>
                  <div style={{ maxHeight: 300, overflowY: "auto" }}>
                    <table style={tblStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Collector</th>
                          <th style={thNumStyle}>Accounts</th>
                          <th style={thNumStyle}>Outstanding</th>
                          <th style={thNumStyle}>Avg days</th>
                          <th style={thNumStyle}>Oldest</th>
                          {bucketKeys.map((b) => (
                            <th key={b} style={{ ...thNumStyle, color: b === "180+" ? "#ef4444" : "var(--riq-text-muted)" }}>{b}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(rollup.byCollector ?? []).map((c) => (
                          <tr key={c.name}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{c.name}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{c.count}</td>
                            <td style={{ ...tdStyle, textAlign: "right", color: "#10b981" }}>{fmtMoney(c.outstanding)}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{c.avgDays ?? "—"}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{c.oldestDays != null ? `${c.oldestDays}d` : "—"}</td>
                            {bucketKeys.map((b) => (
                              <td key={b} style={{ ...tdStyle, textAlign: "right" }}>{c.aging[b] ?? 0}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 8 }}>
                As of {rollup.asOf}.
              </div>
            </>
          )}
        </Panel>
      )}

      {/* PA TAB */}
      {tab === "pa" && (
        <Panel title="Open PA Cases">
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}>
            Open public-adjuster cases (homeowner has a PA representing them). Oldest cases may be 5+ years stale — backlog to triage.
          </div>
          {paList.length === 0 ? (
            <div style={{ color: "var(--riq-text-muted)", padding: 20 }}>Loading or no open PA cases…</div>
          ) : (
            <>
              {/* PA KPIs */}
              {(() => {
                const withAge = paList as (AdjustmentRow & { _daysOpen: number | null })[];
                const oldest = withAge.reduce((m, a) => (a._daysOpen != null && a._daysOpen > m ? a._daysOpen : m), 0);
                const newest = withAge.reduce((m, a) => (a._daysOpen != null && a._daysOpen < m ? a._daysOpen : m), Infinity);
                const over1y = withAge.filter((a) => (a._daysOpen ?? 0) > 365).length;
                const byCarrier: Record<string, number> = {};
                for (const a of withAge) {
                  const c = a.insurance?.company ?? "(unknown)";
                  byCarrier[c] = (byCarrier[c] ?? 0) + 1;
                }
                const topCarrier = Object.entries(byCarrier).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 10, marginBottom: 14 }}>
                    {[
                      { l: "Open cases",   v: fmt(paList.length) },
                      { l: "Oldest",       v: `${oldest}d (${(oldest / 365).toFixed(1)}y)` },
                      { l: "Newest",       v: Number.isFinite(newest) ? `${newest}d` : "—" },
                      { l: "Over 1 year",  v: `${fmt(over1y)} (${Math.round(100 * over1y / paList.length)}%)` },
                      { l: "Top carrier",  v: topCarrier },
                    ].map(({ l, v }) => (
                      <div key={l} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 12px" }}>
                        <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase" }}>{l}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={{ maxHeight: 500, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Customer</th>
                      <th style={thStyle}>Carrier</th>
                      <th style={thStyle}>Claim #</th>
                      <th style={thStyle}>Adjuster</th>
                      <th style={thStyle}>Assignee</th>
                      <th style={thNumStyle}>Days open</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(paList as (AdjustmentRow & { _daysOpen: number | null })[]).map((a) => (
                      <tr key={a.publicAdjustmentID}>
                        <td style={tdStyle}>{a.customer ? custName(a.customer) : "—"}</td>
                        <td style={tdStyle}>{a.insurance?.company ?? "—"}</td>
                        <td style={tdStyle}>{a.insurance?.claimNumber ?? "—"}</td>
                        <td style={tdStyle}>{a.insurance?.adjusterName ?? "—"}</td>
                        <td style={tdStyle}>{a.assignee ? `${a.assignee.firstName} ${a.assignee.lastName}` : <span style={{ color: "var(--riq-text-muted)" }}>unassigned</span>}</td>
                        <td style={{ ...tdStyle, textAlign: "right", color: (a._daysOpen ?? 0) > 730 ? "#ef4444" : (a._daysOpen ?? 0) > 365 ? "#f59e0b" : "var(--riq-text)" }}>
                          {a._daysOpen ?? "—"}
                        </td>
                        <td style={tdStyle}>{a.status ?? "—"}</td>
                        <td style={tdStyle}>{a.job ? `${a.job.addressLine1 ?? ""}, ${a.job.city ?? ""} ${a.job.state ?? ""}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      )}

      {/* CREDITS TAB */}
      {tab === "credits" && (
        <Panel title="Vendor Credits">
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}>
            Vendor credits sitting unrequested. Every dollar here is money Roof Docs has already earned with the supplier but hasn't pulled back yet.
          </div>
          {!credits ? (
            <div style={{ color: "var(--riq-text-muted)", padding: 20 }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12, marginBottom: 14 }}>
                {[
                  { l: "Open credits",    v: fmt(credits.summary.totalCount) },
                  { l: "Total $",         v: fmtMoney(credits.summary.totalAmount) },
                  { l: "Unrequested $",   v: fmtMoney(credits.summary.unrequestedAmount) },
                  { l: "Collected $",     v: fmtMoney(credits.summary.collectedAmount) },
                ].map(({ l, v }) => (
                  <div key={l} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 12px" }}>
                    <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>By creditor</div>
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table style={tblStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Creditor</th>
                          <th style={thNumStyle}>Count</th>
                          <th style={thNumStyle}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(credits.summary.byCreditor ?? []).map((c) => (
                          <tr key={c.creditor}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>{c.creditor}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>{c.count}</td>
                            <td style={tdNumStyle}>{fmtMoney(c.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>All credits (newest first)</div>
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table style={tblStyle}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Creditor</th>
                          <th style={thNumStyle}>Amount</th>
                          <th style={thStyle}>Customer</th>
                          <th style={thStyle}>Memo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...credits.credits].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")).map((c) => (
                          <tr key={c.creditTrackerID}>
                            <td style={tdStyle}>{(c.createdAt ?? "").slice(0, 10)}</td>
                            <td style={tdStyle}>{c.creditor ?? "—"}</td>
                            <td style={tdNumStyle}>{fmtMoney(c.amount)}</td>
                            <td style={tdStyle}>
                              {c.job?.customer ? `${c.job.customer.firstName} ${c.job.customer.lastName}` : "—"}
                            </td>
                            <td style={{ ...tdStyle, color: "var(--riq-text-muted)", fontSize: 11, maxWidth: 340 }}>
                              {(c.memo ?? "").slice(0, 120)}{(c.memo?.length ?? 0) > 120 ? "…" : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </Panel>
      )}

    </div>
  );
}
