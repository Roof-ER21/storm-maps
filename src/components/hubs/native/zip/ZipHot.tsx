/**
 * ZIP Hub — Hot ZIPs tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/hot-zips.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/zip-stats?window=<w>&min_jobs=<n>&state=<s>
 *      → full ranked list re-fetched whenever window / min_jobs / state changes
 *   Search filter (zip/city) is client-side only — no re-fetch (same as HTML).
 *
 * Query params:
 *   window    — storm window in days (90 | 180 | 365 | 0=any); default 180
 *   min_jobs  — minimum signed jobs; default 3
 *   state     — optional state code filter
 *
 * No props — owns all state.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface ZipStatRow {
  zip: string;
  state: string | null;
  city: string | null;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  recentStorms: number;
  recentHail: number;
  closeRate: number;
  avgApprovedJob: number;
  score: number;
}

interface ZipStatsResponse {
  zips: ZipStatRow[];
  total: number;
  window: number;
  state: string | null;
  took_ms: number;
  computed_at: string;
}

// ---------------------------------------------------------------------------
// Table styles (mirrors Carrier pattern)
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
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-surface)",
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 50
      ? { background: "rgba(16,185,129,0.25)", color: "#10b981" }
      : score >= 30
      ? { background: "rgba(245,158,11,0.25)", color: "#f59e0b" }
      : { background: "rgba(94,200,255,0.15)", color: "var(--riq-accent)" };

  return (
    <span
      style={{
        ...cls,
        fontWeight: 700,
        padding: "4px 10px",
        borderRadius: 4,
        display: "inline-block",
        minWidth: 36,
        textAlign: "center",
      }}
    >
      {score}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCSV(rows: ZipStatRow[]) {
  if (!rows.length) return;
  const headers = [
    "ZIP",
    "City",
    "State",
    "JobsDone",
    "CloseRate",
    "AvgApproved",
    "RecentStorms",
    "RecentHail",
    "HotScore",
  ];
  const lines = [headers.join(",")];
  for (const z of rows) {
    const vals = [
      z.zip,
      z.city ?? "",
      z.state ?? "",
      z.signed,
      (z.closeRate * 100).toFixed(1) + "%",
      Math.round(z.avgApprovedJob),
      z.recentStorms,
      z.recentHail,
      z.score,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-hot-zips-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ZipHot() {
  // Filter state
  const [windowDays, setWindowDays] = useState<number>(180);
  const [minJobs, setMinJobs] = useState<number>(3);
  const [stateFilter, setStateFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Data state
  const [allZips, setAllZips] = useState<ZipStatRow[]>([]);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce timer ref for minJobs input
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch — re-runs when window / minJobs / stateFilter change
  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        window: String(windowDays),
        min_jobs: String(minJobs),
      });
      if (stateFilter) params.set("state", stateFilter);
      const res = await fetch(`/api/intel/zip-stats?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ZipStatsResponse = await res.json();
      const zips = json.zips ?? [];
      setAllZips(zips);
      // Populate state dropdown from the returned data
      const states = Array.from(
        new Set(zips.map((z) => z.state).filter((s): s is string => !!s))
      ).sort();
      setAvailableStates(states);
    } catch (e: unknown) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [windowDays, minJobs, stateFilter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Client-side filtering (search only — no re-fetch; matches HTML behaviour)
  // ---------------------------------------------------------------------------
  const filtered = allZips.filter((z) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return z.zip.includes(q) || (z.city ?? "").toLowerCase().includes(q);
  });

  // KPI values
  const kpiZips = allZips.length;
  const kpiWithStorms = allZips.filter((z) => z.recentStorms > 0).length;
  const kpiHighScore = allZips.filter((z) => z.score >= 50).length;
  const kpiAvgScore =
    allZips.length > 0
      ? (allZips.reduce((s, z) => s + z.score, 0) / allZips.length).toFixed(1)
      : "—";

  // Display rows (cap at 200, same as HTML)
  const displayRows = filtered.slice(0, 200);

  // ---------------------------------------------------------------------------
  // Input styles
  // ---------------------------------------------------------------------------
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

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--riq-text-muted)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };

  const btnStyle: React.CSSProperties = {
    background: "var(--riq-accent)",
    color: "#1a1612",
    border: "none",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {/* Page title */}
      <h1
        style={{
          margin: "0 0 16px",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--riq-accent)",
        }}
      >
        Hot ZIPs — Where to Knock Right Now
      </h1>

      {/* KPI row */}
      {!loading && !error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          {[
            { label: `Qualifying ZIPs (≥${minJobs} jobs)`, value: kpiZips },
            { label: "ZIPs with recent storms", value: kpiWithStorms },
            { label: "High-score ZIPs (50+)", value: kpiHighScore },
            { label: "Avg Hot Score", value: kpiAvgScore },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                background: "var(--riq-surface)",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  color: "var(--riq-text-muted)",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: "var(--riq-accent)",
                  marginTop: 4,
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main section */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
          Ranked: storm activity × historic close rate × job size × density
        </h2>
        <div
          style={{
            color: "var(--riq-text-muted)",
            fontSize: 12,
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          Hot Score = 40 × (recent storm exposure normalized) + 25 × close rate + 20 × (avg
          approved job normalized) + 15 × (Roof Docs density normalized). High score = many recent
          storms, strong historic close rate, high avg job value, and you&apos;ve already done many
          jobs there (proven canvass territory).
        </div>

        {/* Filter bar */}
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginBottom: 12,
          }}
        >
          <label style={labelStyle}>
            Search
            <input
              style={{ ...inputStyle, width: 200 }}
              placeholder="zip or city"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <label style={labelStyle}>
            State
            <select
              style={inputStyle}
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All</option>
              {availableStates.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Min jobs done
            <input
              style={{ ...inputStyle, width: 80 }}
              type="number"
              placeholder="3"
              value={minJobs}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => setMinJobs(v), 250);
              }}
            />
          </label>

          <label style={labelStyle}>
            Storm window
            <select
              style={inputStyle}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
              <option value={0}>Any time</option>
            </select>
          </label>

          <label style={labelStyle}>
            &nbsp;
            <button style={btnStyle} onClick={() => exportCSV(filtered)}>
              Export CSV
            </button>
          </label>
        </div>

        {/* Result count */}
        {!loading && !error && (
          <div
            style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}
          >
            {filtered.length.toLocaleString()} zips · top score{" "}
            {filtered[0]?.score ?? 0}
          </div>
        )}

        {/* Loading / error states */}
        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>
        )}

        {/* Table */}
        {!loading && !error && (
          <div style={{ maxHeight: 760, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>ZIP</th>
                  <th style={thStyle}>City</th>
                  <th style={thStyle}>State</th>
                  <th style={thNumStyle}>Jobs done</th>
                  <th style={thNumStyle}>Close rate</th>
                  <th style={thNumStyle}>Avg approved</th>
                  <th style={thNumStyle}>Recent storms</th>
                  <th style={thNumStyle}>Recent hail</th>
                  <th style={thNumStyle}>Hot Score</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((z) => (
                  <tr key={z.zip}>
                    <td style={tdStyle}>
                      <strong>{z.zip}</strong>
                    </td>
                    <td style={tdStyle}>{z.city ?? "—"}</td>
                    <td style={tdStyle}>{z.state ?? "—"}</td>
                    <td style={tdNumStyle}>{z.signed.toLocaleString()}</td>
                    <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>
                      {fmtPct(z.closeRate, 1)}
                    </td>
                    <td style={{ ...tdNumStyle, color: "#10b981" }}>
                      {fmtMoney(z.avgApprovedJob)}
                    </td>
                    <td style={tdNumStyle}>{z.recentStorms}</td>
                    <td style={tdNumStyle}>{z.recentHail}</td>
                    <td style={{ ...tdNumStyle, paddingRight: 8 }}>
                      <ScoreBadge score={z.score} />
                    </td>
                  </tr>
                ))}
                {displayRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      style={{ ...tdStyle, textAlign: "center", color: "var(--riq-text-muted)", padding: 20 }}
                    >
                      No ZIPs match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
