/**
 * Storm Hub — Exposure tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/storm-exposure.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/storm-exposure → ExposureCustomer[] (all data in one shot)
 *
 * No entity picker — this is a flat list view with filter controls and KPI row.
 * No props — owns all state.
 */
import { useState, useMemo } from "react";
import { useFetch, KpiCard, CardRow, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface StormRef {
  type: string;
  mag: number | null;
  unit: string | null;
  valid: string | null;
}

interface ExposureCustomer {
  customer: string | null;
  customerEmail: string | null;
  customerCell: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  stormCount: number;
  strongestStorm: StormRef;
  mostRecentStorm: StormRef;
  trades: string[];
  tradeGaps: string[];
  carriers: string[];
  reps: string[];
  totalRev: number;
}

// The endpoint returns an array directly
type ExposureResponse = ExposureCustomer[];

// ---------------------------------------------------------------------------
// Sort key type
// ---------------------------------------------------------------------------

type SortKey = keyof ExposureCustomer | "strongestStorm" | "mostRecentStorm";

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  userSelect: "none",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--riq-surface)",
  fontSize: 12,
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Pill helpers
// ---------------------------------------------------------------------------

const pillDone: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(16,185,129,0.2)",
  color: "#10b981",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 11,
  marginRight: 3,
  marginBottom: 2,
};

const pillGap: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(245,158,11,0.2)",
  color: "#f59e0b",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 11,
  marginRight: 3,
  marginBottom: 2,
};

const pillHail: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(168,139,250,0.2)",
  color: "#a78bfa",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 11,
  marginRight: 3,
};

const pillWind: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(94,200,255,0.2)",
  color: "var(--riq-accent)",
  padding: "2px 6px",
  borderRadius: 4,
  fontSize: 11,
  marginRight: 3,
};

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCSV(rows: ExposureCustomer[]) {
  if (!rows.length) return;
  const headers = [
    "Customer", "Email", "Phone", "Address", "City", "State", "Zip",
    "StormHits", "StrongestType", "StrongestMag", "StrongestDate", "MostRecentDate",
    "TradesDone", "TradeGaps", "Carriers", "Reps", "PriorRevenue", "Lat", "Lng",
  ];
  const lines = [headers.join(",")];
  for (const c of rows) {
    const ss = c.strongestStorm;
    const ms = c.mostRecentStorm;
    const row = [
      c.customer, c.customerEmail, c.customerCell,
      c.addressLine1, c.city, c.state, c.zip,
      c.stormCount, ss.type, ss.mag, (ss.valid ?? "").slice(0, 10),
      (ms.valid ?? "").slice(0, 10),
      c.trades.join(";"), c.tradeGaps.join(";"),
      c.carriers.join(";"), c.reps.join(";"),
      Math.round(c.totalRev ?? 0), c.lat, c.lng,
    ].map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`));
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-storm-exposure-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sort value extractor
// ---------------------------------------------------------------------------

function sortVal(c: ExposureCustomer, key: SortKey): number | string | null {
  if (key === "strongestStorm") {
    const m = c.strongestStorm.mag ?? 0;
    return c.strongestStorm.type === "HAIL" ? m * 10 : m;
  }
  if (key === "mostRecentStorm") {
    const v = c.mostRecentStorm.valid;
    return v ? new Date(v).getTime() : null;
  }
  const val = c[key as keyof ExposureCustomer];
  if (typeof val === "number" || typeof val === "string" || val === null || val === undefined) {
    return val as number | string | null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StormExposure() {
  const { data: rawData, loading, error } = useFetch<ExposureResponse>("/api/intel/storm-exposure");

  const all = rawData ?? [];

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [minHits, setMinHits] = useState("");
  const [strongestFilter, setStrongestFilter] = useState("");
  const [minHail, setMinHail] = useState("");
  const [gapFilter, setGapFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("strongestStorm");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  // Derive unique filter options from data
  const { states, gaps, carriers } = useMemo(() => {
    const s = new Set<string>();
    const g = new Set<string>();
    const c = new Set<string>();
    for (const row of all) {
      if (row.state) s.add(row.state);
      for (const x of row.tradeGaps) g.add(x);
      for (const x of row.carriers) c.add(x);
    }
    return {
      states: [...s].sort(),
      gaps: [...g].sort(),
      carriers: [...c].sort(),
    };
  }, [all]);

  // KPI stats (from full unfiltered data)
  const hailHits = all.filter((c) => c.strongestStorm.type === "HAIL").length;
  const recentlyHit = all.filter((c) => {
    const d = c.mostRecentStorm.valid;
    if (!d) return false;
    return (Date.now() - new Date(d).getTime()) / 86_400_000 < 90;
  }).length;
  const multi = all.filter((c) => c.stormCount >= 3).length;
  const totalRev = all.reduce((s, c) => s + (c.totalRev ?? 0), 0);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let rows = all;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          (c.customer ?? "").toLowerCase().includes(q) ||
          (c.addressLine1 ?? "").toLowerCase().includes(q) ||
          c.carriers.some((x) => x.toLowerCase().includes(q)) ||
          c.reps.some((x) => x.toLowerCase().includes(q)) ||
          c.trades.some((x) => x.toLowerCase().includes(q)),
      );
    }
    if (stateFilter) rows = rows.filter((c) => c.state === stateFilter);
    if (minHits) rows = rows.filter((c) => c.stormCount >= Number(minHits));
    if (strongestFilter === "HAIL") rows = rows.filter((c) => c.strongestStorm.type === "HAIL");
    if (strongestFilter === "WND")
      rows = rows.filter((c) => (c.strongestStorm.type ?? "").includes("WND"));
    if (minHail)
      rows = rows.filter(
        (c) => c.strongestStorm.type === "HAIL" && (c.strongestStorm.mag ?? 0) >= Number(minHail),
      );
    if (gapFilter) rows = rows.filter((c) => c.tradeGaps.includes(gapFilter));
    if (carrierFilter) rows = rows.filter((c) => c.carriers.includes(carrierFilter));

    return [...rows].sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [all, search, stateFilter, minHits, strongestFilter, minHail, gapFilter, carrierFilter, sortKey, sortDir]);

  const filteredRev = filtered.reduce((s, c) => s + (c.totalRev ?? 0), 0);

  const inputStyle: React.CSSProperties = {
    background: "var(--riq-bg)",
    color: "var(--riq-text)",
    border: "1px solid var(--riq-border)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
  };

  const COLS: Array<{ k: SortKey; l: string; num?: boolean }> = [
    { k: "customer", l: "Customer" },
    { k: "addressLine1" as SortKey, l: "Address" },
    { k: "state" as SortKey, l: "St" },
    { k: "stormCount" as SortKey, l: "Storm hits", num: true },
    { k: "strongestStorm", l: "Strongest", num: true },
    { k: "mostRecentStorm", l: "Most recent", num: true },
    { k: "trades" as SortKey, l: "Trades done" },
    { k: "tradeGaps" as SortKey, l: "Trade gaps" },
    { k: "carriers" as SortKey, l: "Carrier(s)" },
    { k: "reps" as SortKey, l: "Rep(s)" },
    { k: "totalRev" as SortKey, l: "Prior $", num: true },
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
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load storm exposure: {error}</div>
      )}
      {!loading && !error && (
        <>
          {/* KPI row */}
          <CardRow>
            <KpiCard label="Customers exposed" value={all.length.toLocaleString()} />
            <KpiCard label="Hail strongest" value={hailHits.toLocaleString()} />
            <KpiCard label="Hit in last 90d" value={recentlyHit.toLocaleString()} emphasis />
            <KpiCard label="3+ storm hits" value={multi.toLocaleString()} />
            <KpiCard label="Total prior revenue" value={fmtMoney(totalRev)} />
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
              Customers hit by strong storms since first contact
            </h2>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
              Every customer in our book whose home has been hit by hail ≥0.75" or wind ≥55mph within 2
              miles since they first signed. Warm leads with possible new damage — perfect for follow-up
              call/email/text.
            </div>

            {/* Filter bar */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Search
                <input
                  type="text"
                  placeholder="customer / address / carrier / rep"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inputStyle, width: 280 }}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                State
                <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={inputStyle}>
                  <option value="">All</option>
                  {states.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min storm hits
                <input
                  type="number"
                  placeholder="1"
                  value={minHits}
                  style={{ ...inputStyle, width: 80 }}
                  onChange={(e) => setMinHits(e.target.value)}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Strongest storm
                <select value={strongestFilter} onChange={(e) => setStrongestFilter(e.target.value)} style={inputStyle}>
                  <option value="">Any</option>
                  <option value="HAIL">Hail</option>
                  <option value="WND">Wind</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min hail (in)
                <input
                  type="number"
                  step={0.25}
                  placeholder="0.75"
                  value={minHail}
                  style={{ ...inputStyle, width: 80 }}
                  onChange={(e) => setMinHail(e.target.value)}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Trade gap
                <select value={gapFilter} onChange={(e) => setGapFilter(e.target.value)} style={inputStyle}>
                  <option value="">Any</option>
                  {gaps.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Has carrier
                <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} style={inputStyle}>
                  <option value="">Any</option>
                  {carriers.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                &nbsp;
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
                  }}
                >
                  Export CSV
                </button>
              </label>
            </div>

            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
              {filtered.length.toLocaleString()} customers · {fmtMoney(filteredRev)} prior revenue
            </div>

            <div style={{ maxHeight: 760, overflowY: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    {COLS.map((c) => (
                      <th
                        key={c.k}
                        style={c.num ? thNumStyle : thStyle}
                        onClick={() => toggleSort(c.k)}
                      >
                        {c.l}
                        {sortKey === c.k && (
                          <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 1000).map((c, i) => {
                    const ss = c.strongestStorm;
                    const ms = c.mostRecentStorm;
                    const ssIsHail = ss.type === "HAIL";
                    return (
                      <tr key={i}>
                        <td style={tdStyle}>
                          <strong>{c.customer ?? "—"}</strong>
                          <br />
                          <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                            {c.customerEmail ?? ""}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          {[c.addressLine1, c.city].filter(Boolean).join(", ")}
                        </td>
                        <td style={tdStyle}>{c.state ?? "—"}</td>
                        <td style={tdNumStyle}>{c.stormCount}</td>
                        <td style={tdNumStyle}>
                          <span style={ssIsHail ? pillHail : pillWind}>{ss.type}</span>
                          <br />
                          {ss.mag} {ss.unit ?? ""}
                          <br />
                          <span style={{ color: "var(--riq-text-muted)", fontSize: 10 }}>
                            {(ss.valid ?? "").slice(0, 10)}
                          </span>
                        </td>
                        <td style={tdNumStyle}>
                          {(ms.valid ?? "").slice(0, 10)}
                          <br />
                          <span style={{ color: "var(--riq-text-muted)", fontSize: 10 }}>
                            {ms.type} {ms.mag} {ms.unit ?? ""}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          {c.trades.map((t) => (
                            <span key={t} style={pillDone}>{t}</span>
                          ))}
                        </td>
                        <td style={tdStyle}>
                          {c.tradeGaps.slice(0, 4).map((t) => (
                            <span key={t} style={pillGap}>{t}</span>
                          ))}
                          {c.tradeGaps.length > 4 && (
                            <span
                              style={{
                                display: "inline-block",
                                background: "var(--riq-surface)",
                                color: "var(--riq-text-muted)",
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontSize: 11,
                              }}
                            >
                              +{c.tradeGaps.length - 4}
                            </span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11 }}>{c.carriers.join(", ") || "—"}</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11 }}>{c.reps.join(", ") || "—"}</span>
                        </td>
                        <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(c.totalRev)}</td>
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
