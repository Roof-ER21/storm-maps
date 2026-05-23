/**
 * Rep Hub — Response tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/rep-response.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/rep-response               → initial load + year list
 *   2. On year filter change → GET /api/intel/rep-response?year=<year>
 *
 * Filters: minJobs (client-side) + year (re-fetches from server).
 * No props — owns all state.
 */
import { useState, useEffect, useRef } from "react";
import { fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface RepResponseRow {
  name: string;
  jobs: number;
  completed: number;
  revenue: number;
  medianDays: number | null;
  p25: number | null;
  p75: number | null;
  pctFast30: number;
}

interface RepResponseResponse {
  reps: RepResponseRow[];
  years: string[];
  year: string | null;
  total: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Speed pill component
// ---------------------------------------------------------------------------

function SpeedPill({ days }: { days: number | null }) {
  if (days == null) return <span style={{ color: "var(--riq-text-muted)" }}>—</span>;

  const isfast = days <= 30;
  const ismed = days > 30 && days <= 90;
  const background = isfast
    ? "rgba(16,185,129,0.25)"
    : ismed
    ? "rgba(245,158,11,0.25)"
    : "rgba(239,68,68,0.25)";
  const color = isfast ? "#10b981" : ismed ? "#f59e0b" : "#ef4444";

  return (
    <span
      style={{
        fontWeight: 700,
        padding: "4px 10px",
        borderRadius: 4,
        display: "inline-block",
        background,
        color,
      }}
    >
      {days}d
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RepResponse() {
  const [year, setYear] = useState<string>("");
  const [minJobs, setMinJobs] = useState<number>(5);
  const [allReps, setAllReps] = useState<RepResponseRow[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch from server when `year` changes (re-fetch semantics match the HTML)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const url =
      "/api/intel/rep-response" + (year ? `?year=${encodeURIComponent(year)}` : "");
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RepResponseResponse>;
      })
      .then((json) => {
        setAllReps(json.reps ?? []);
        // Only seed years on first load (they won't change on subsequent fetches)
        if (years.length === 0 && json.years?.length) {
          setYears(json.years);
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError((e as Error).message ?? String(e));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  // Client-side minJobs filter
  const rows = allReps.filter((r) => r.jobs >= (minJobs || 0));
  const avg =
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + (r.medianDays ?? 0), 0) / rows.length)
      : 0;

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
    padding: "8px 6px",
    borderBottom: "1px solid var(--riq-border)",
    position: "sticky",
    top: 0,
    background: "var(--riq-surface)",
  };
  const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
  const tdStyle: React.CSSProperties = {
    padding: "6px",
    borderBottom: "1px solid var(--riq-surface)",
    fontSize: 13,
  };
  const tdNumStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };

  const handleMinJobsChange = (val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setMinJobs(Number(val) || 0);
    }, 200);
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
      {/* Panel */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
          Median days from storm-of-record to signed agreement
        </div>
        <div
          style={{
            color: "var(--riq-text-muted)",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          For each rep: of their storm-matched jobs (loss within ±30 days of a real
          storm), how fast did they get the signature? Lower = faster responder.
          Excludes jobs with no storm match or with daysLossToSign &lt; 0.
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
          <label
            style={{
              fontSize: 12,
              color: "var(--riq-text-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            Min jobs
            <input
              type="number"
              defaultValue={5}
              style={{
                background: "var(--riq-bg)",
                color: "var(--riq-text)",
                border: "1px solid var(--riq-border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 13,
                width: 80,
                fontFamily: "inherit",
              }}
              onChange={(e) => handleMinJobsChange(e.target.value)}
            />
          </label>
          <label
            style={{
              fontSize: 12,
              color: "var(--riq-text-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            Year
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              style={{
                background: "var(--riq-bg)",
                color: "var(--riq-text)",
                border: "1px solid var(--riq-border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            >
              <option value="">All</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Count / status */}
        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: 20, color: "#ef4444" }}>
            Failed to load rep response data: {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <div
              style={{
                fontSize: 12,
                color: "var(--riq-text-muted)",
                marginBottom: 8,
              }}
            >
              {rows.length} reps · avg of per-rep medians: {avg}d
            </div>

            {/* Table */}
            <div style={{ maxHeight: 760, overflowY: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Rep</th>
                    <th style={thNumStyle}>Storm-matched jobs</th>
                    <th style={thNumStyle}>Completed</th>
                    <th style={thNumStyle}>Median days loss→sign</th>
                    <th style={thNumStyle}>25th pct</th>
                    <th style={thNumStyle}>75th pct</th>
                    <th style={thNumStyle}>% signed within 30d</th>
                    <th style={thNumStyle}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name}>
                      <td style={tdStyle}>
                        <strong>{r.name}</strong>
                      </td>
                      <td style={tdNumStyle}>{r.jobs}</td>
                      <td style={tdNumStyle}>{r.completed}</td>
                      <td style={tdNumStyle}>
                        <SpeedPill days={r.medianDays} />
                      </td>
                      <td style={tdNumStyle}>
                        {r.p25 != null ? `${r.p25}d` : "—"}
                      </td>
                      <td style={tdNumStyle}>
                        {r.p75 != null ? `${r.p75}d` : "—"}
                      </td>
                      <td style={tdNumStyle}>
                        {(r.pctFast30 * 100).toFixed(1)}%
                      </td>
                      <td style={{ ...tdNumStyle, color: "#10b981" }}>
                        {fmtMoney(r.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
