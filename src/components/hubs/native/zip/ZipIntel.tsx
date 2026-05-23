/**
 * ZIP Hub — ZIP Intel tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/zip-intel.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/zip-stats?window=0[&state=<s>]
 *      → left-pane ZIP list (re-fetched on state change; window=0 = any-time)
 *   2. On ZIP select → GET /api/intel/zip-deep?zip=<zip>
 *      → right-pane deep dive + knock script
 *
 * ZIP selection: internal picker (search + list, auto-select first item on load).
 * Left-pane client filters: search, min-jobs, sort — no re-fetch for those.
 * State filter re-fetches the list (matches HTML behaviour).
 *
 * No props — owns all state.
 */
import { useState, useEffect, useCallback } from "react";
import { fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

/** One row from /api/intel/zip-stats */
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
  took_ms: number;
}

/** Carrier row inside zip-deep response */
interface ZipCarrierRow {
  name: string;
  signed: number;
  completed: number;
  dead: number;
  rev: number;
  closeRate: number;
}

/** Trade row inside zip-deep response */
interface ZipTradeRow {
  name: string;
  count: number;
}

/** Rep row inside zip-deep response */
interface ZipRepRow {
  name: string;
  count: number;
}

/** Adjuster row inside zip-deep response */
interface ZipAdjusterRow {
  name: string;
  count: number;
}

/** Recent storm row inside zip-deep response */
interface ZipStormRow {
  stormDate: string | null;
  stormType: string | null;
  stormMagnitude: number | null;
  stormUnit: string | null;
  stormDistanceMiles: number | null;
}

interface ZipDeepSummary {
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  completedRev: number;
  closeRate: number;
  avgApprovedJob: number | null;
  medianDeductible: number | null;
  stormCount: number;
}

interface ZipDeepResponse {
  zip: string;
  city: string | null;
  summary: ZipDeepSummary;
  carriers: ZipCarrierRow[];
  trades: ZipTradeRow[];
  reps: ZipRepRow[];
  adjusters: ZipAdjusterRow[];
  recentStorms: ZipStormRow[];
  took_ms: number;
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
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--riq-surface)",
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: "6px 8px",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--riq-text-muted)",
  display: "flex",
  flexDirection: "column",
  gap: 3,
};

// ---------------------------------------------------------------------------
// Storm type pill
// ---------------------------------------------------------------------------

function StormPill({ type }: { type: string | null }) {
  const isHail = type === "HAIL";
  return (
    <span
      style={{
        background: isHail ? "rgba(168,139,250,0.2)" : "rgba(94,200,255,0.2)",
        color: isHail ? "#a78bfa" : "var(--riq-accent)",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      {type ?? "—"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ZIP detail pane — right side
// ---------------------------------------------------------------------------

function ZipDetail({ zipCode }: { zipCode: string }) {
  const [deep, setDeep] = useState<ZipDeepResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDeep(null);
    setLoading(true);
    setError(null);
    fetch(`/api/intel/zip-deep?zip=${encodeURIComponent(zipCode)}`, {
      credentials: "include",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ZipDeepResponse>;
      })
      .then((data) => {
        setDeep(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError((e as Error).message ?? String(e));
        setLoading(false);
      });
  }, [zipCode]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
        Loading…
      </div>
    );
  }
  if (error || !deep) {
    return (
      <div style={{ padding: 20, color: "#ef4444" }}>
        Failed: {error ?? "No data"}
      </div>
    );
  }

  const z = deep.summary;
  const carriers = deep.carriers;
  const topCarrier = carriers[0];
  const recentStorms = deep.recentStorms;
  const trades = deep.trades;
  const reps = deep.reps;
  const adjusters = deep.adjusters;

  // Knock script construction (matches HTML exactly)
  const scriptTrade = trades[0]?.name ?? "roof";
  const mostRecentStorm = recentStorms[0];
  const scriptIntro = mostRecentStorm
    ? `we've been working in your neighborhood after the ${
        (mostRecentStorm.stormDate ?? "").slice(0, 10)
      } ${mostRecentStorm.stormType ?? ""} (${mostRecentStorm.stormMagnitude ?? ""} ${
        mostRecentStorm.stormUnit ?? ""
      })`
    : "we've been working in your neighborhood";

  const subH2: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--riq-text)",
    margin: "0 0 8px",
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
        {deep.zip} — {deep.city ?? ""}
      </h2>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
        {z.signed} jobs · {z.completed} approved · {fmtMoney(z.revenue)} revenue ·{" "}
        {fmtPct(z.closeRate, 1)} close rate
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Signed", value: z.signed },
          { label: "Approved", value: z.completed },
          { label: "Close rate", value: fmtPct(z.closeRate, 1) },
          {
            label: "Avg approved $",
            value: z.avgApprovedJob != null ? fmtMoney(z.avgApprovedJob) : "—",
          },
          {
            label: "Median deductible",
            value: z.medianDeductible != null ? fmtMoney(z.medianDeductible) : "—",
          },
          { label: "Storm matches", value: z.stormCount },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: "var(--riq-bg)",
              border: "1px solid var(--riq-border)",
              borderRadius: 6,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                color: "var(--riq-text-muted)",
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: 20,
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

      {/* Knock script */}
      <div
        style={{
          background: "var(--riq-bg)",
          borderLeft: "3px solid var(--riq-accent)",
          padding: "12px 16px",
          borderRadius: "0 4px 4px 0",
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--riq-text)",
        }}
      >
        <strong>Suggested knock opener:</strong>
        <br />
        &ldquo;Hi, I&apos;m with Roof Docs — {scriptIntro}. The most common carrier in this zip
        is{" "}
        <strong>{topCarrier?.name ?? "your insurance company"}</strong>
        {topCarrier
          ? ` and we've successfully filed ${topCarrier.completed} claims with them in ${deep.zip}.`
          : "."}{" "}
        {trades[0] ? (
          <>
            Most homes here need <strong>{scriptTrade}</strong> work.
          </>
        ) : null}
        &rdquo;
      </div>

      {/* 2-column grid: carriers + trades + reps + adjusters */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* Carriers */}
        <div>
          <h3 style={subH2}>Carriers in this ZIP</h3>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Carrier</th>
                <th style={thNumStyle}>Signed</th>
                <th style={thNumStyle}>Approved</th>
                <th style={thNumStyle}>Rate</th>
                <th style={thNumStyle}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {carriers.map((c) => (
                <tr key={c.name}>
                  <td style={tdStyle}>{c.name}</td>
                  <td style={tdNumStyle}>{c.signed}</td>
                  <td style={tdNumStyle}>{c.completed}</td>
                  <td
                    style={{
                      ...tdNumStyle,
                      color: c.closeRate < 0.4 ? "#ef4444" : "var(--riq-accent)",
                    }}
                  >
                    {fmtPct(c.closeRate, 1)}
                  </td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>
                    {fmtMoney(c.rev)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top trades */}
        <div>
          <h3 style={subH2}>Top trades</h3>
          <table style={tblStyle}>
            <tbody>
              {trades.map((t) => (
                <tr key={t.name}>
                  <td style={tdStyle}>{t.name}</td>
                  <td style={tdNumStyle}>{t.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top reps */}
        <div>
          <h3 style={subH2}>Top reps in this ZIP</h3>
          <table style={tblStyle}>
            <tbody>
              {reps.map((r) => (
                <tr key={r.name}>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdNumStyle}>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top adjusters */}
        <div>
          <h3 style={subH2}>Top adjusters in this ZIP</h3>
          <table style={tblStyle}>
            <tbody>
              {adjusters.length > 0 ? (
                adjusters.map((a) => (
                  <tr key={a.name}>
                    <td style={tdStyle}>{a.name}</td>
                    <td style={tdNumStyle}>{a.count}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={2}
                    style={{ ...tdStyle, color: "var(--riq-text-muted)" }}
                  >
                    No adjuster data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent storms table */}
      <h3 style={{ ...subH2, marginTop: 20 }}>
        Recent storms in this ZIP (most recent 5)
      </h3>
      <table style={tblStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Date</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Magnitude</th>
            <th style={thStyle}>Distance</th>
          </tr>
        </thead>
        <tbody>
          {recentStorms.length > 0 ? (
            recentStorms.map((s, i) => (
              <tr key={i}>
                <td style={tdStyle}>{(s.stormDate ?? "").slice(0, 10) || "—"}</td>
                <td style={tdStyle}>
                  <StormPill type={s.stormType} />
                </td>
                <td style={tdStyle}>
                  {s.stormMagnitude ?? "—"} {s.stormUnit ?? ""}
                </td>
                <td style={tdStyle}>
                  {s.stormDistanceMiles != null
                    ? `${s.stormDistanceMiles.toFixed(2)} mi`
                    : "—"}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={4}
                style={{ ...tdStyle, color: "var(--riq-text-muted)" }}
              >
                No matched storms
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ZipIntel() {
  // List state
  const [allZips, setAllZips] = useState<ZipStatRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Picker filters (client-side for search/min/sort; re-fetch for state)
  const [stateFilter, setStateFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [minJobs, setMinJobs] = useState<number>(0);
  const [sortBy, setSortBy] = useState<keyof ZipStatRow>("revenue");

  // Selected ZIP
  const [selectedZip, setSelectedZip] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch ZIP list — window=0 (any time), re-fetch on state change
  // ---------------------------------------------------------------------------
  const fetchList = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const url =
        "/api/intel/zip-stats?window=0" +
        (stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ZipStatsResponse = await res.json();
      setAllZips(json.zips ?? []);
    } catch (e: unknown) {
      setListError((e as Error).message ?? String(e));
    } finally {
      setLoadingList(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  // Auto-select first ZIP once data loads (matches HTML's setTimeout click)
  useEffect(() => {
    if (!loadingList && allZips.length > 0 && selectedZip === null) {
      setSelectedZip(allZips[0].zip);
    }
  }, [loadingList, allZips, selectedZip]);

  // ---------------------------------------------------------------------------
  // Client-side filtering + sorting
  // ---------------------------------------------------------------------------
  const filtered = allZips
    .filter((z) => {
      if (search) {
        const q = search.toLowerCase();
        if (!z.zip.includes(q) && !(z.city ?? "").toLowerCase().includes(q)) return false;
      }
      if (minJobs > 0 && z.signed < minJobs) return false;
      return true;
    })
    .sort((a, b) => ((b[sortBy] as number) || 0) - ((a[sortBy] as number) || 0));

  const displayList = filtered.slice(0, 300);

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {loadingList && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading…
        </div>
      )}
      {listError && (
        <div style={{ padding: 20, color: "#ef4444" }}>Failed: {listError}</div>
      )}
      {!loadingList && !listError && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "360px 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Left pane — ZIP list */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "var(--riq-text)" }}>
              ZIP codes
            </h2>
            <div
              style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}
            >
              Sorted by total revenue. Pick a ZIP to see knock script.
            </div>

            {/* Filters */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-end",
                marginBottom: 12,
              }}
            >
              <input
                style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                placeholder="Search ZIP or city"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label style={labelStyle}>
                State
                <select
                  style={selectStyle}
                  value={stateFilter}
                  onChange={(e) => {
                    setStateFilter(e.target.value);
                    setSelectedZip(null); // reset selection on re-fetch
                  }}
                >
                  <option value="">All</option>
                  <option value="VA">VA</option>
                  <option value="MD">MD</option>
                  <option value="PA">PA</option>
                  <option value="DC">DC</option>
                </select>
              </label>
              <label style={labelStyle}>
                Min jobs
                <select
                  style={selectStyle}
                  value={minJobs}
                  onChange={(e) => setMinJobs(Number(e.target.value))}
                >
                  <option value={0}>All</option>
                  <option value={5}>5+</option>
                  <option value={10}>10+</option>
                  <option value={25}>25+</option>
                  <option value={50}>50+</option>
                  <option value={100}>100+</option>
                </select>
              </label>
              <label style={labelStyle}>
                Sort by
                <select
                  style={selectStyle}
                  value={sortBy as string}
                  onChange={(e) => setSortBy(e.target.value as keyof ZipStatRow)}
                >
                  <option value="revenue">Revenue</option>
                  <option value="signed">Job count</option>
                  <option value="closeRate">Close rate</option>
                  <option value="avgApprovedJob">Avg job $</option>
                  <option value="recentStorms">Hail hits</option>
                </select>
              </label>
            </div>

            <div
              style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}
            >
              {filtered.length.toLocaleString()} zips · sorted by {sortBy as string}
            </div>

            <div style={{ maxHeight: 800, overflowY: "auto" }}>
              {displayList.map((z) => (
                <div
                  key={z.zip}
                  onClick={() => setSelectedZip(z.zip)}
                  style={{
                    padding: "10px 12px",
                    border: `1px solid ${
                      selectedZip === z.zip ? "var(--riq-accent)" : "var(--riq-border)"
                    }`,
                    background:
                      selectedZip === z.zip ? "rgba(244,167,56,0.08)" : "transparent",
                    borderRadius: 6,
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{ fontWeight: 600, color: "var(--riq-accent)", fontSize: 14 }}
                  >
                    {z.zip} — {z.city ?? ""}
                  </div>
                  <div
                    style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}
                  >
                    {z.signed} jobs · {z.completed} done · {fmtMoney(z.revenue)} ·{" "}
                    {fmtPct(z.closeRate, 1)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right pane — ZIP detail */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            {!selectedZip ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "var(--riq-text-muted)",
                }}
              >
                Pick a ZIP to see knock script
              </div>
            ) : (
              <ZipDetail zipCode={selectedZip} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
