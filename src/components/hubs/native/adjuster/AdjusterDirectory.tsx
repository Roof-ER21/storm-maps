/**
 * Adjuster Directory tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/adjusters.html.
 *
 * Data flow:
 *   1. GET /api/intel/adjusters-summary → full adjuster list
 *   Filters: search (name/carrier/email), carrier dropdown, min jobs, min approval rate
 *   Sortable table (client-side), CSV export, KPI row.
 */
import { useState, useMemo } from "react";
import { useFetch, KpiCard, CardRow, fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface AdjusterSummaryItem {
  name: string;
  carrier: string;
  emails: string | null;
  phones: string | null;
  signed: number;
  completed: number;
  dead: number;
  approvalRate: number | null;
  avgApprovedJob: number | null;
  avgDeductible: number | null;
  completedRevenue: number;
  cities: string[];
  reps: string[];
}

interface AdjustersSummaryResponse {
  adjusters: AdjusterSummaryItem[];
}

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
  position: "sticky" as const,
  top: 0,
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid rgba(52,44,35,1)",
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

type SortKey = keyof AdjusterSummaryItem;

// Approval-rate pill color
function pillColor(rate: number | null): { bg: string; color: string } | null {
  if (rate == null) return null;
  if (rate >= 0.7) return { bg: "rgba(16,185,129,0.2)", color: "#10b981" };
  if (rate < 0.4) return { bg: "rgba(239,68,68,0.2)", color: "#ef4444" };
  return null;
}

function exportCSV(rows: AdjusterSummaryItem[]): void {
  const headers = ["Adjuster", "Carrier", "Email", "Phone", "Jobs", "Approved", "Dead",
    "ApprovalRate", "AvgApproved", "AvgDeductible", "Cities", "Reps"];
  const lines = [headers.join(",")];
  for (const a of rows) {
    const row = [
      a.name, a.carrier, a.emails ?? "", a.phones ?? "",
      a.signed, a.completed, a.dead,
      a.approvalRate != null ? (a.approvalRate * 100).toFixed(1) + "%" : "",
      Math.round(a.avgApprovedJob ?? 0),
      Math.round(a.avgDeductible ?? 0),
      a.cities.join(";"),
      a.reps.join(";"),
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-adjusters-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdjusterDirectory() {
  const { data, error, loading } = useFetch<AdjustersSummaryResponse>("/api/intel/adjusters-summary");

  const [search, setSearch] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [minJobs, setMinJobs] = useState("");
  const [minRate, setMinRate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("completed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const adjusters = data?.adjusters ?? [];

  // Build carrier list for dropdown
  const carriers = useMemo(() => {
    const set = new Set<string>();
    for (const a of adjusters) if (a.carrier) set.add(a.carrier);
    return [...set].sort();
  }, [adjusters]);

  // Filtered + sorted rows
  const filtered = useMemo(() => {
    let rows = [...adjusters];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.carrier.toLowerCase().includes(q) ||
        (a.emails ?? "").toLowerCase().includes(q)
      );
    }
    if (carrierFilter) rows = rows.filter((a) => a.carrier === carrierFilter);
    const mj = Number(minJobs || 0);
    if (mj) rows = rows.filter((a) => a.signed >= mj);
    const mr = Number(minRate || 0) / 100;
    if (mr) rows = rows.filter((a) => (a.approvalRate ?? 0) >= mr);
    rows.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
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
  }, [adjusters, search, carrierFilter, minJobs, minRate, sortKey, sortDir]);

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  // KPI aggregates
  const withEmail = adjusters.filter((a) => a.emails).length;
  const withPhone = adjusters.filter((a) => a.phones).length;
  const highApproval = adjusters.filter((a) => a.completed >= 3 && (a.approvalRate ?? 0) >= 0.8).length;

  const inputStyle: React.CSSProperties = {
    background: "rgba(52,44,35,1)",
    color: "var(--riq-text)",
    border: "1px solid var(--riq-border)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--riq-text-muted)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };

  const COLS: Array<{ k: SortKey; l: string; num?: boolean }> = [
    { k: "name", l: "Adjuster" },
    { k: "carrier", l: "Carrier" },
    { k: "emails", l: "Email" },
    { k: "phones", l: "Phone" },
    { k: "signed", l: "Jobs", num: true },
    { k: "completed", l: "Approved", num: true },
    { k: "dead", l: "Denied/Dead", num: true },
    { k: "approvalRate", l: "Approval %", num: true },
    { k: "avgApprovedJob", l: "Avg Approved $", num: true },
    { k: "avgDeductible", l: "Avg Deductible", num: true },
  ];

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}
      {error && (
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load adjusters: {error}</div>
      )}
      {!loading && !error && (
        <>
          {/* Color key */}
          <div
            style={{
              background: "#1e1a16",
              border: "1px solid var(--riq-border)",
              borderRadius: 6,
              padding: "6px 14px",
              color: "var(--riq-text-muted)",
              fontSize: 11,
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <strong>Color key:</strong>
            <span style={{ color: "#10b981" }}>● ≥75%</span>
            <span>● 50–74%</span>
            <span style={{ color: "#ef4444" }}>● &lt;50%</span>
            <span style={{ opacity: 0.6 }}>(approval rate)</span>
          </div>

          {/* KPI row */}
          <CardRow>
            <KpiCard label="Adjuster × carrier rows" value={adjusters.length.toLocaleString()} />
            <KpiCard label="With email" value={withEmail.toLocaleString()} />
            <KpiCard label="With phone" value={withPhone.toLocaleString()} />
            <KpiCard label="High-approval (3+ jobs, ≥80%)" value={highApproval.toLocaleString()} emphasis />
          </CardRow>

          {/* Main section */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
              marginTop: 16,
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
              Every adjuster we&apos;ve worked with
            </h2>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
              Sorted by jobs handled. Use this as a relationship-management tool — the warmer your adjuster relationship, the better the supplements.
            </div>

            {/* Filter bar */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
              <label style={labelStyle}>
                Search
                <input
                  style={{ ...inputStyle, width: 280 }}
                  placeholder="adjuster / carrier / email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label style={labelStyle}>
                Carrier
                <select
                  style={inputStyle}
                  value={carrierFilter}
                  onChange={(e) => setCarrierFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {carriers.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Min jobs
                <input
                  style={{ ...inputStyle, width: 80 }}
                  type="number"
                  placeholder="1"
                  value={minJobs}
                  onChange={(e) => setMinJobs(e.target.value)}
                />
              </label>
              <label style={labelStyle}>
                Min approval rate (%)
                <input
                  style={{ ...inputStyle, width: 80 }}
                  type="number"
                  placeholder="0"
                  value={minRate}
                  onChange={(e) => setMinRate(e.target.value)}
                />
              </label>
              <label style={labelStyle}>
                &nbsp;
                <button
                  style={{
                    background: "var(--riq-accent)",
                    color: "#1a1612",
                    border: "none",
                    borderRadius: 4,
                    padding: "6px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => exportCSV(filtered)}
                >
                  Export CSV
                </button>
              </label>
            </div>

            {/* Count line */}
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
              {filtered.length} adjusters &middot;{" "}
              {filtered.reduce((s, a) => s + a.signed, 0).toLocaleString()} total jobs &middot;{" "}
              <span style={{ color: "#10b981" }}>
                {fmtMoney(filtered.reduce((s, a) => s + a.completedRevenue, 0))}
              </span>{" "}
              closed revenue
            </div>

            {/* Table */}
            <div style={{ maxHeight: 760, overflowY: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    {COLS.map((c) => (
                      <th
                        key={c.k}
                        style={c.num ? thNumStyle : thStyle}
                        onClick={() => handleSort(c.k)}
                      >
                        {c.l}
                        {sortKey === c.k && (
                          <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </th>
                    ))}
                    <th style={thStyle}>Cities</th>
                    <th style={thStyle}>Reps</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 1000).map((a, i) => {
                    const pc = pillColor(a.approvalRate);
                    return (
                      <tr
                        key={`${a.name}|${a.carrier}|${i}`}
                        style={{ cursor: "default" }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = "rgba(52,44,35,1)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <td style={tdStyle}>
                          <strong>{a.name}</strong>
                        </td>
                        <td style={tdStyle}>{a.carrier}</td>
                        <td style={tdStyle}>
                          {a.emails ? (
                            <a
                              href={`mailto:${a.emails}`}
                              style={{ color: "var(--riq-accent)", textDecoration: "none" }}
                            >
                              {a.emails}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={tdStyle}>
                          {a.phones ? (
                            <a
                              href={`tel:${a.phones.replace(/\D/g, "")}`}
                              style={{ color: "var(--riq-accent)", textDecoration: "none" }}
                            >
                              {a.phones}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={tdNumStyle}>{a.signed}</td>
                        <td style={tdNumStyle}>{a.completed}</td>
                        <td style={tdNumStyle}>{a.dead}</td>
                        <td style={tdNumStyle}>
                          {a.approvalRate != null ? (
                            <span
                              style={
                                pc
                                  ? {
                                      display: "inline-block",
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      fontSize: 11,
                                      background: pc.bg,
                                      color: pc.color,
                                    }
                                  : undefined
                              }
                            >
                              {fmtPct(a.approvalRate, 1)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={{ ...tdNumStyle, color: "#10b981" }}>
                          {fmtMoney(a.avgApprovedJob)}
                        </td>
                        <td style={tdNumStyle}>{fmtMoney(a.avgDeductible)}</td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11 }}>
                            {a.cities.slice(0, 3).join(", ")}
                            {a.cities.length > 3 ? "…" : ""}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11 }}>
                            {a.reps.slice(0, 3).join(", ")}
                            {a.reps.length > 3 ? "…" : ""}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
