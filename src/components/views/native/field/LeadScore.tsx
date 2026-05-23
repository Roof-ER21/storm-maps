/**
 * LeadScore — native React replacement for public/lead-score.html
 *
 * Endpoints (verified against live prod):
 *   GET /api/intel/customer-leads?limit=1500
 *     → { rows: LeadRow[], total, took_ms }
 *   GET /api/intel/zip-stats?window=365
 *     → { zips: ZipStat[], total, window, state, took_ms, computed_at }
 *
 * Two tabs:
 *   "Rank" — all customers scored, filterable by text + state, sortable columns,
 *            export CSV (top 1000).
 *   "ZIP"  — enter a ZIP, score computed client-side from zip-stats data.
 */
import { useState } from "react";
import { useFetch, fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response types (verified via curl | python -c)
// ---------------------------------------------------------------------------

interface StormInfo {
  type: string;
  mag?: number | null;
}

interface LeadRow {
  customer: string;
  address: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  email: string | null;
  phone: string | null;
  jobs: number;
  completedJobs: number;
  totalRev: number;
  trades: string[];
  tradeGaps: string[];
  carriers: string[];
  reps: string[];
  stormHits: number;
  strongestStorm: StormInfo | null;
  lastDate: string | null;
  daysSinceLast: number | null;
  score: number;
  zipCarrierScore?: number;
}

interface CustomerLeadsResponse {
  rows: LeadRow[];
  total: number;
  took_ms: number;
}

interface ZipStat {
  zip: string;
  state: string;
  city: string;
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
  zips: ZipStat[];
  total: number;
  window: number;
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
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  userSelect: "none",
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

const inputStyle: React.CSSProperties = {
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "8px 12px",
  fontSize: 14,
  fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// Score badge
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 60
      ? { bg: "rgba(16,185,129,0.25)", color: "#10b981" }
      : score >= 35
      ? { bg: "rgba(245,158,11,0.25)", color: "#f59e0b" }
      : { bg: "rgba(94,200,255,0.15)", color: "var(--riq-accent)" };
  return (
    <span
      style={{
        background: cls.bg,
        color: cls.color,
        fontWeight: 700,
        padding: "4px 10px",
        borderRadius: 4,
        display: "inline-block",
        minWidth: 40,
        textAlign: "center",
      }}
    >
      {score}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CSV export — top 1000 (mirrors HTML exactly)
// ---------------------------------------------------------------------------

function exportTopCSV(rows: LeadRow[]) {
  const headers = [
    "Score","Customer","Email","Phone","Address","City","State","Zip","Lat","Lng",
    "StormHits","StrongestStormType","StrongestStormMag","TradeGaps","Carriers",
    "Reps","PriorRevenue","LastContact","DaysSinceLast",
  ];
  const lines = [headers.join(",")];
  for (const r of rows.slice(0, 1000)) {
    const row = [
      r.score, r.customer, r.email, r.phone, r.addressLine1, r.city, r.state, r.zip,
      r.lat, r.lng, r.stormHits, r.strongestStorm?.type, r.strongestStorm?.mag,
      r.tradeGaps.join(";"), r.carriers.join(";"), r.reps.join(";"),
      Math.round(r.totalRev || 0), r.lastDate, r.daysSinceLast,
    ].map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`));
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-leadscore-top1000-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// ZIP Score card
// ---------------------------------------------------------------------------

function ZipScoreCard({ zs, zip }: { zs: ZipStat; zip: string }) {
  const recentStormsCount = zs.recentStorms || 0;
  const stormScore = Math.min(100, recentStormsCount * 5);
  const closeRateScore = (zs.closeRate || 0) * 100;
  const valueScore = Math.min(100, (zs.avgApprovedJob || 0) / 500);
  const densityScore = Math.min(100, zs.signed * 2);
  const score = Math.round(
    0.4 * stormScore + 0.25 * closeRateScore + 0.2 * valueScore + 0.15 * densityScore
  );
  const scoreColor =
    score >= 60 ? "#10b981" : score >= 35 ? "#f59e0b" : "#ef4444";
  return (
    <div>
      <div
        style={{
          background: "linear-gradient(135deg, #342c23 0%, var(--riq-surface) 100%)",
          border: "1px solid var(--riq-border)",
          borderRadius: 10,
          padding: "24px",
          marginBottom: 16,
          display: "flex",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, color: scoreColor }}>
          {score}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            ZIP {zip}{zs.city ? ` — ${zs.city}` : ""}
          </div>
          <div style={{ color: "var(--riq-text-muted)", marginTop: 4, fontSize: 13 }}>
            {zs.signed} prior jobs · {zs.completed} approved · {fmtMoney(zs.revenue)} revenue
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
        {[
          { name: "Recent storms (1y)", val: stormScore.toFixed(0), ev: `${recentStormsCount} matches` },
          { name: "Historical close %", val: closeRateScore.toFixed(0), ev: fmtPct(zs.closeRate, 1) },
          { name: "Avg job size", val: valueScore.toFixed(0), ev: fmtMoney(zs.avgApprovedJob) },
          { name: "Roof Docs density", val: densityScore.toFixed(0), ev: `${zs.signed} prior` },
        ].map((f) => (
          <div
            key={f.name}
            style={{
              background: "#342c23",
              padding: "8px 12px",
              borderRadius: 4,
              borderLeft: "3px solid var(--riq-accent)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>
              {f.name}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{f.val}</div>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>{f.ev}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rank tab
// ---------------------------------------------------------------------------

type SortKey = "score" | "customer" | "address" | "stormHits" | "tradeGap" | "carrierPct" | "carriers" | "daysSince";
type SortDir = "asc" | "desc";

function sortRows(rows: LeadRow[], key: SortKey, dir: SortDir): LeadRow[] {
  return [...rows].sort((a, b) => {
    const getVal = (r: LeadRow): string | number => {
      if (key === "score") return r.score;
      if (key === "customer") return r.customer || "";
      if (key === "address") return r.address || "";
      if (key === "stormHits") return r.stormHits || 0;
      if (key === "tradeGap") return r.tradeGaps.length;
      if (key === "carrierPct") return r.zipCarrierScore || 0;
      if (key === "carriers") return r.carriers.join(",");
      if (key === "daysSince") return r.daysSinceLast == null ? -1 : r.daysSinceLast;
      return 0;
    };
    const va = getVal(a), vb = getVal(b);
    if (typeof va === "number" && typeof vb === "number") {
      return dir === "asc" ? va - vb : vb - va;
    }
    return dir === "asc"
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

function RankTab({ rows }: { rows: LeadRow[] }) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const states = [...new Set(rows.map((r) => r.state).filter(Boolean))].sort();

  const filtered = rows.filter((r) => {
    if (state && r.state !== state) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.customer || "").toLowerCase().includes(q) ||
      (r.address || "").toLowerCase().includes(q) ||
      r.carriers.some((c) => c.toLowerCase().includes(q)) ||
      r.reps.some((c) => c.toLowerCase().includes(q))
    );
  });

  const sorted = sortRows(filtered, sortKey, sortDir);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  const arrow = (k: SortKey) =>
    sortKey === k ? (
      <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>
        {sortDir === "asc" ? "▲" : "▼"}
      </span>
    ) : null;

  return (
    <div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 16 }}>
        Every customer scored 0–100 on follow-up priority. Score blends: recent storm exposure
        (40%), prior conversion rate (15%), trade-gap opportunity (15%), carrier patterns (10%),
        historic job value (10%), recency of last contact (10%).
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="Search customer / address / rep / carrier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 240 }}
        />
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          style={{ ...inputStyle, fontSize: 13 }}
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          onClick={() => exportTopCSV(sorted)}
          style={{
            background: "var(--riq-accent)",
            color: "#1a1612",
            border: "none",
            borderRadius: 4,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Export top 1000
        </button>
      </div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
        {sorted.length.toLocaleString()} customers · top score {sorted[0]?.score || 0}
      </div>
      <div style={{ maxHeight: 600, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thNumStyle} onClick={() => toggleSort("score")}>Score{arrow("score")}</th>
              <th style={thStyle} onClick={() => toggleSort("customer")}>Customer{arrow("customer")}</th>
              <th style={thStyle} onClick={() => toggleSort("address")}>Address{arrow("address")}</th>
              <th style={thNumStyle} onClick={() => toggleSort("stormHits")}>Storm{arrow("stormHits")}</th>
              <th style={thNumStyle} onClick={() => toggleSort("tradeGap")}>Trade gap{arrow("tradeGap")}</th>
              <th style={thNumStyle} onClick={() => toggleSort("carrierPct")}>Carrier %{arrow("carrierPct")}</th>
              <th style={thStyle} onClick={() => toggleSort("carriers")}>Carrier(s){arrow("carriers")}</th>
              <th style={thNumStyle} onClick={() => toggleSort("daysSince")}>Last{arrow("daysSince")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 500).map((r, i) => (
              <tr key={i}>
                <td style={tdNumStyle}><ScoreBadge score={r.score} /></td>
                <td style={tdStyle}>
                  <strong>{r.customer || "—"}</strong>
                  {r.email && <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{r.email}</div>}
                </td>
                <td style={tdStyle}>{r.address}</td>
                <td style={tdNumStyle}>
                  {r.stormHits}
                  {r.strongestStorm && (
                    <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                      {r.strongestStorm.type} {r.strongestStorm.mag || ""}
                    </div>
                  )}
                </td>
                <td style={tdNumStyle}>{r.tradeGaps.length}</td>
                <td style={tdNumStyle}>{((r.zipCarrierScore || 0)).toFixed(0)}%</td>
                <td style={tdStyle}><span style={{ fontSize: 11 }}>{r.carriers.join(", ") || "—"}</span></td>
                <td style={tdNumStyle}>
                  {r.daysSinceLast != null ? `${r.daysSinceLast}d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZIP tab
// ---------------------------------------------------------------------------

function ZipTab({ zipStats }: { zipStats: Record<string, ZipStat> }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ zip: string; stat: ZipStat } | null>(null);
  const [notFound, setNotFound] = useState(false);

  function score(z: string) {
    z = z.trim().slice(0, 5);
    if (!z) return;
    const stat = zipStats[z];
    if (!stat) { setNotFound(true); setResult(null); return; }
    setNotFound(false);
    setResult({ zip: z, stat });
  }

  return (
    <div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 16 }}>
        Pick a ZIP code to see the canvassing-priority score for that area.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          placeholder="Enter ZIP (e.g. 20170)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") score(input); }}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={() => score(input)}
          style={{
            background: "var(--riq-accent)",
            color: "#1a1612",
            border: "none",
            borderRadius: 4,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Score
        </button>
      </div>
      {notFound && (
        <div style={{ color: "var(--riq-text-muted)", padding: 20 }}>
          No data for ZIP {input.slice(0, 5)}
        </div>
      )}
      {result && <ZipScoreCard zs={result.stat} zip={result.zip} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeadScore({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const leads = useFetch<CustomerLeadsResponse>("/api/intel/customer-leads?limit=1500");
  const zipStatsResp = useFetch<ZipStatsResponse>("/api/intel/zip-stats?window=365");
  const [tab, setTab] = useState<"rank" | "zip">("rank");

  const zipStats: Record<string, ZipStat> = {};
  for (const z of zipStatsResp.data?.zips ?? []) zipStats[z.zip] = z;

  const loading = leads.loading || zipStatsResp.loading;
  const error = leads.error || zipStatsResp.error;

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 18px",
    cursor: "pointer",
    color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
    fontSize: 13,
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? "var(--riq-accent)" : "transparent"}`,
    fontFamily: "inherit",
  });

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "20px 24px", marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>
          Lead Score — Rank Any Customer or ZIP
        </h2>

        <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
          <button style={tabBtnStyle(tab === "rank")} onClick={() => setTab("rank")}>
            Rank our entire book
          </button>
          <button style={tabBtnStyle(tab === "zip")} onClick={() => setTab("zip")}>
            Score a ZIP
          </button>
        </div>

        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
            Loading projects + storms…
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>
        )}
        {!loading && !error && tab === "rank" && (
          <RankTab rows={leads.data?.rows ?? []} />
        )}
        {!loading && !error && tab === "zip" && (
          <ZipTab zipStats={zipStats} />
        )}
      </div>
    </div>
  );
}
