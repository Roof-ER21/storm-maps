/**
 * Customer Hub — List tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/customers.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/customers-list  → full customer array (no server-side filters used;
 *      all filtering done client-side to match the HTML behavior)
 *
 * Features: sortable columns, search, state/trade/minJobs/minRev filters, CSV export.
 * No props — owns all state.
 */
import { useState, useEffect, useMemo } from "react";
import {
  useFetch,
  KpiCard,
  CardRow,
  fmtMoney,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface CustomerRow {
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  jobCount: number;
  completedJobs: number;
  deadJobs: number;
  openJobs: number;
  totalRev: number;
  completedRev: number;
  firstDate: string | null;
  lastDate: string | null;
  daysSince: number | null;
  trades: string[];
  tradeCount: number;
  carriers: string[];
  reps: string[];
  hasCompletedRoof: boolean;
  lastCompletedRoofDate: string | null;
  maxDeductible: number | null;
}

interface CustomersListResponse {
  customers: CustomerRow[];
  total: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Table column definitions
// ---------------------------------------------------------------------------

interface ColDef {
  key: keyof CustomerRow;
  label: string;
  num?: boolean;
  money?: boolean;
}

const COLUMNS: ColDef[] = [
  { key: "name", label: "Customer" },
  { key: "addressLine1", label: "Address" },
  { key: "state", label: "State" },
  { key: "jobCount", label: "Jobs", num: true },
  { key: "completedJobs", label: "Completed", num: true },
  { key: "deadJobs", label: "Dead", num: true },
  { key: "openJobs", label: "Open", num: true },
  { key: "tradeCount", label: "Trades", num: true },
  { key: "completedRev", label: "Lifetime earned $", num: true, money: true },
  { key: "lastDate", label: "Last contact" },
  { key: "daysSince", label: "Days since", num: true },
];

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

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
  userSelect: "none",
  background: "var(--riq-surface)",
  position: "sticky",
  top: 0,
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-bg)",
  verticalAlign: "top",
  fontSize: 13,
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const inputStyle: React.CSSProperties = {
  background: "var(--riq-bg)",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 8,
  fontSize: 10,
  background: "var(--riq-bg)",
  color: "var(--riq-text)",
  marginRight: 3,
  marginBottom: 2,
};

// ---------------------------------------------------------------------------
// Helper: format int
// ---------------------------------------------------------------------------

function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: CustomerRow[]): void {
  if (!rows.length) return;
  const headers = [
    "Customer", "Address", "City", "State", "Zip", "Jobs", "Completed",
    "Dead", "Open", "Trades", "Carriers", "Reps",
    "Lifetime Earned $", "Lifetime Signed $", "First Contact", "Last Contact",
  ];
  const lines = [headers.join(",")];
  for (const c of rows) {
    const row = [
      c.name, c.addressLine1, c.city, c.state, c.zip,
      c.jobCount, c.completedJobs, c.deadJobs, c.openJobs,
      [...c.trades].sort().join(";"), [...c.carriers].sort().join(";"), [...c.reps].sort().join(";"),
      Math.round(c.completedRev ?? 0), Math.round(c.totalRev ?? 0), c.firstDate, c.lastDate,
    ].map((v) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-customers-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CustomerList() {
  const list = useFetch<CustomersListResponse>("/api/intel/customers-list");

  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState("");
  const [minJobs, setMinJobs] = useState("");
  const [minRev, setMinRev] = useState("");
  const [filterTrade, setFilterTrade] = useState("");
  const [sortKey, setSortKey] = useState<keyof CustomerRow>("completedRev");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Debounce state for text fields
  const [searchDebounced, setSearchDebounced] = useState("");
  const [minJobsDebounced, setMinJobsDebounced] = useState("");
  const [minRevDebounced, setMinRevDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setMinJobsDebounced(minJobs), 250);
    return () => clearTimeout(t);
  }, [minJobs]);

  useEffect(() => {
    const t = setTimeout(() => setMinRevDebounced(minRev), 250);
    return () => clearTimeout(t);
  }, [minRev]);

  const customers = list.data?.customers ?? [];

  // Derive filter option lists
  const allStates = useMemo(() => {
    const s = new Set<string>();
    for (const c of customers) if (c.state) s.add(c.state);
    return [...s].sort();
  }, [customers]);

  const allTrades = useMemo(() => {
    const s = new Set<string>();
    for (const c of customers) for (const t of c.trades) s.add(t);
    return [...s].sort();
  }, [customers]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let rows = customers;
    const q = searchDebounced.trim().toLowerCase();
    if (q) {
      rows = rows.filter((c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.addressLine1 || "").toLowerCase().includes(q) ||
        (c.city || "").toLowerCase().includes(q) ||
        c.reps.some((r) => r.toLowerCase().includes(q)) ||
        c.carriers.some((cr) => cr.toLowerCase().includes(q)) ||
        c.trades.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filterState) rows = rows.filter((c) => c.state === filterState);
    const mj = Number(minJobsDebounced || 0);
    if (mj) rows = rows.filter((c) => c.jobCount >= mj);
    const mr = Number(minRevDebounced || 0);
    if (mr) rows = rows.filter((c) => c.totalRev >= mr);
    if (filterTrade) rows = rows.filter((c) => c.trades.includes(filterTrade));

    rows = [...rows].sort((a, b) => {
      const va = a[sortKey] as number | string | null;
      const vb = b[sortKey] as number | string | null;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number")
        return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
    return rows;
  }, [customers, searchDebounced, filterState, minJobsDebounced, minRevDebounced, filterTrade, sortKey, sortDir]);

  function handleColClick(key: keyof CustomerRow) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // KPI summary values
  const multi = customers.filter((c) => c.jobCount > 1).length;
  const ever = customers.filter((c) => c.completedJobs > 0).length;
  const rev = customers.reduce((s, c) => s + (c.completedRev ?? 0), 0);
  const stale = customers.filter((c) => c.daysSince != null && c.daysSince > 730).length;

  const filteredRev = filtered.reduce((s, c) => s + (c.completedRev ?? 0), 0);

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {list.loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading…
        </div>
      )}
      {list.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load customers: {list.error}
        </div>
      )}
      {!list.loading && !list.error && (
        <>
          {/* KPI row */}
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600 }}>
              Customer Rollup — 7-Year Lifetime View
            </h2>
            <CardRow>
              <KpiCard label="Unique customers" value={fmtInt(customers.length)} />
              <KpiCard
                label="Multi-job customers"
                value={fmtInt(multi)}
                hint={`${((multi / (customers.length || 1)) * 100).toFixed(1)}%`}
              />
              <KpiCard label="Customers ever completed" value={fmtInt(ever)} />
              <KpiCard label="Stale (>2y no contact)" value={fmtInt(stale)} />
              <KpiCard
                label="Lifetime earned"
                value={fmtMoney(rev)}
                hint="completed jobs only"
                emphasis
              />
            </CardRow>
          </div>

          {/* Filter bar */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              All Customers
            </div>
            <div
              style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}
            >
              Deduped by name + address. Sort by any column. Multi-job customers float to top
              when sorting by job count.
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "flex-end",
                marginBottom: 10,
              }}
            >
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Search
                <input
                  type="text"
                  placeholder="name / address / rep / carrier / trade"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inputStyle, width: 320 }}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                State
                <select
                  value={filterState}
                  onChange={(e) => setFilterState(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">All</option>
                  {allStates.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min jobs
                <input
                  type="number"
                  value={minJobs}
                  placeholder="1"
                  onChange={(e) => setMinJobs(e.target.value)}
                  style={{ ...inputStyle, width: 80 }}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min total revenue
                <input
                  type="number"
                  value={minRev}
                  placeholder="0"
                  onChange={(e) => setMinRev(e.target.value)}
                  style={{ ...inputStyle, width: 120 }}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Has trade
                <select
                  value={filterTrade}
                  onChange={(e) => setFilterTrade(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Any</option>
                  {allTrades.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => exportCSV(filtered)}
                style={{
                  background: "var(--riq-accent)",
                  color: "#1a1612",
                  border: "none",
                  borderRadius: 4,
                  padding: "6px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  alignSelf: "flex-end",
                }}
              >
                Export CSV
              </button>
            </div>

            {/* Count line */}
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
              {filtered.length.toLocaleString()} of {customers.length.toLocaleString()} customers
              {" · "}{fmtMoney(filteredRev)} lifetime earned
            </div>

            {/* Table */}
            <div style={{ maxHeight: 720, overflowY: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        style={col.num ? thNumStyle : thStyle}
                        onClick={() => handleColClick(col.key)}
                      >
                        {col.label}
                        {sortKey === col.key && (
                          <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </th>
                    ))}
                    <th style={thStyle}>Trades on file</th>
                    <th style={thStyle}>Carriers</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 1500).map((c, i) => (
                    <tr key={i}>
                      {COLUMNS.map((col) => {
                        const raw = c[col.key];
                        let display: string;
                        if (col.money) display = fmtMoney(raw as number | null);
                        else if (col.num) display = raw == null ? "—" : fmtInt(raw as number);
                        else display = raw == null ? "—" : String(raw);
                        return (
                          <td
                            key={col.key}
                            style={
                              col.money
                                ? { ...tdNumStyle, color: "#10b981" }
                                : col.num
                                ? tdNumStyle
                                : tdStyle
                            }
                          >
                            {display}
                          </td>
                        );
                      })}
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11 }}>
                          {[...c.trades].sort().map((t) => (
                            <span key={t} style={pillStyle}>{t}</span>
                          ))}
                          {c.trades.length === 0 && "—"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11 }}>
                          {[...c.carriers].sort().map((t) => (
                            <span key={t} style={pillStyle}>{t}</span>
                          ))}
                          {c.carriers.length === 0 && "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
