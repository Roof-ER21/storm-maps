/**
 * Scheduling Intelligence — native React (Phase 2d batch3)
 *
 * Endpoint:
 *   GET /api/intel/scheduling
 *   → {
 *       summary: { staleCount, next30Count, overdueCount, thisWeekCount,
 *                  activeSignedCount, unscheduledReadyCount },
 *       benchmarks: { p25, p50, p75, p90, sampleSize },
 *       ageBuckets: Record<string, number>,   // "0-30d","31-60d","61-90d","91-180d","181-365d","365d+"
 *       thisWeek:         ScheduleRow[],
 *       overdue:          ScheduleRow[],
 *       unscheduledReady: ScheduleRow[],
 *       stale:            ScheduleRow[],
 *       next30:           ScheduleRow[],
 *       byRep:            RepRow[],
 *       overdueStages:    Record<string, number>,
 *     }
 */
import { useState, useEffect } from "react";
import { Panel } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response shapes (verified against live prod)
// ---------------------------------------------------------------------------

interface ScheduleSummary {
  staleCount: number;
  next30Count: number;
  overdueCount: number;
  thisWeekCount: number;
  activeSignedCount: number;
  unscheduledReadyCount: number;
}

interface Benchmarks {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  sampleSize: number;
}

interface ScheduleRow {
  id: number;
  customer: string | null;
  address: string | null;
  carrier: string | null;
  stage: string | null;
  salesRep: string | null;
  signedDate: string | null;
  trades: string[];
  daysOverdue?: number;
  daysSinceSigned?: number;
  daysUntilStart?: number;
  expectedWorkStartDate: string | null;
  ageNote?: string;
  readyForInstall?: boolean;
  projectCoordinator?: string | null;
}

interface RepRow {
  rep: string;
  total: number;
  next30: number;
  overdue: number;
  thisWeek: number;
  unscheduledReady: number;
}

interface SchedulingResponse {
  summary: ScheduleSummary;
  benchmarks: Benchmarks;
  ageBuckets: Record<string, number>;
  thisWeek: ScheduleRow[];
  overdue: ScheduleRow[];
  unscheduledReady: ScheduleRow[];
  stale: ScheduleRow[];
  next30: ScheduleRow[];
  byRep: RepRow[];
  overdueStages: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Styles
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
  padding: "5px 10px",
  background: "rgba(0,0,0,0.15)",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
};

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  fontSize: 12,
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString();
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

function daysColor(d: number | null | undefined): string {
  if (d == null) return "var(--riq-text-muted)";
  if (d < 30) return "#10b981";
  if (d < 90) return "#f59e0b";
  if (d < 180) return "var(--riq-accent)";
  return "#ef4444";
}

function pillStyle(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
    background: color === "red" ? "rgba(239,68,68,0.15)" : color === "yellow" ? "rgba(245,158,11,0.15)" : color === "green" ? "rgba(16,185,129,0.15)" : "rgba(96,165,250,0.15)",
    color: color === "red" ? "#ef4444" : color === "yellow" ? "#f59e0b" : color === "green" ? "#10b981" : "#60a5fa",
  };
}

// ---------------------------------------------------------------------------
// Types for tabs
// ---------------------------------------------------------------------------

type TabKey = "overdue" | "unscheduled" | "stale" | "next30";

const TAB_CONFIG: Record<TabKey, { key: keyof SchedulingResponse; label: string; color: string }> = {
  overdue:     { key: "overdue",          label: "Overdue",           color: "#ef4444" },
  unscheduled: { key: "unscheduledReady", label: "Unscheduled Ready", color: "#f59e0b" },
  stale:       { key: "stale",            label: "Stale Pipeline",     color: "var(--riq-accent)" },
  next30:      { key: "next30",           label: "Next 30 Days",       color: "#10b981" },
};

const PER_PAGE = 30;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Scheduling({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [data, setData] = useState<SchedulingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("overdue");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterRep, setFilterRep] = useState("");
  const [filterCarrier, setFilterCarrier] = useState("");
  const [filterStage, setFilterStage] = useState("");

  useEffect(() => {
    fetch("/api/intel/scheduling", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SchedulingResponse>;
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 60, textAlign: "center", color: "var(--riq-text-muted)" }}>Loading scheduling data…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load: {error}</div>
      </div>
    );
  }

  const s = data.summary;
  const bm = data.benchmarks;

  // Derived filter sets from all rows
  const allRows = [
    ...(data.overdue ?? []),
    ...(data.unscheduledReady ?? []),
    ...(data.stale ?? []),
    ...(data.next30 ?? []),
  ];
  const reps = [...new Set(allRows.map((r) => r.salesRep).filter(Boolean) as string[])].sort();
  const carriers = [...new Set(allRows.map((r) => r.carrier).filter(Boolean) as string[])].sort();
  const stages = [...new Set(allRows.map((r) => r.stage).filter(Boolean) as string[])].sort();

  // Filtered rows for current tab
  const tabCfg = TAB_CONFIG[tab];
  const rawRows = (data[tabCfg.key] as ScheduleRow[]) ?? [];
  const q = search.trim().toLowerCase();
  const filtered = rawRows.filter((r) => {
    if (q && !`${r.customer ?? ""}${r.salesRep ?? ""}${r.carrier ?? ""}${r.address ?? ""}`.toLowerCase().includes(q)) return false;
    if (filterRep && r.salesRep !== filterRep) return false;
    if (filterCarrier && r.carrier !== filterCarrier) return false;
    if (filterStage && r.stage !== filterStage) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pages - 1);
  const slice = filtered.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);

  // Age bar
  const ageBucketLabels = ["0-30d", "31-60d", "61-90d", "91-180d", "181-365d", "365d+"];
  const ageBucketColors = ["#10b981", "#10b981", "#f59e0b", "var(--riq-accent)", "#ef4444", "#ef4444"];
  const ageBucketVals = ageBucketLabels.map((l) => data.ageBuckets[l] ?? 0);
  const ageMax = Math.max(...ageBucketVals, 1);

  // This week list
  const weekList = data.thisWeek ?? [];

  // Overdue stages
  const osSorted = Object.entries(data.overdueStages ?? {}).sort((a, b) => b[1] - a[1]);
  const osMax = osSorted[0]?.[1] ?? 1;

  const selectStyle: React.CSSProperties = {
    background: "#342c23",
    border: "1px solid var(--riq-border)",
    color: "var(--riq-text)",
    padding: "5px 10px",
    borderRadius: 5,
    fontSize: 12,
  };

  const inputStyle: React.CSSProperties = {
    ...selectStyle,
    flex: 1,
    minWidth: 120,
    fontFamily: "inherit",
    outline: "none",
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* TOP KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 16 }}>
        {[
          { v: fmt(s.overdueCount),          l: "Overdue Installs",   c: "#ef4444" },
          { v: fmt(s.unscheduledReadyCount),  l: "Ready — No Date",    c: "#f59e0b" },
          { v: fmt(s.thisWeekCount),          l: "Starting This Week", c: "#10b981" },
          { v: fmt(s.next30Count),            l: "Next 30 Days",       c: "var(--riq-text)" },
          { v: fmt(s.staleCount),             l: `Stale (P90+)`,       c: "#f59e0b" },
          { v: fmt(s.activeSignedCount),      l: "Total Active Signed",c: "var(--riq-text)" },
        ].map(({ v, l, c }) => (
          <div
            key={l}
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "12px 16px",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: c === "var(--riq-text)" ? "var(--riq-accent)" : c, lineHeight: 1 }}>{v}</div>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* THIS WEEK + AGE DISTRIBUTION */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Panel title="This Week's Schedule">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10 }}>
            {weekList.length} jobs confirmed for the next 7 days.
          </div>
          {weekList.length === 0 ? (
            <div style={{ color: "var(--riq-text-muted)", fontSize: 13, padding: "20px 0" }}>No jobs scheduled this week.</div>
          ) : (
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {weekList.map((j) => (
                <div key={j.id} style={{ background: "#342c23", borderRadius: 6, padding: "10px 12px", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--riq-accent)", fontWeight: 700, marginBottom: 4 }}>
                    {fmtDate(j.expectedWorkStartDate)} — {j.daysUntilStart === 0 ? "Today" : `${j.daysUntilStart}d`}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{j.customer ?? "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--riq-text-muted)", marginTop: 2 }}>
                    {j.salesRep ?? "—"} · {j.carrier ?? "—"} · {j.stage ?? "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>{j.address ?? ""}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Pipeline Age Distribution">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            All active signed jobs by days since signing. P50=<strong>{bm.p50}d</strong>, P90=<strong>{bm.p90}d</strong>. Jobs past P90 are outliers.
          </div>
          {/* Age bar */}
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 60, margin: "8px 0 4px" }}>
            {ageBucketLabels.map((l, i) => {
              const v = ageBucketVals[i];
              const barH = Math.max(4, Math.round((v / ageMax) * 56));
              return (
                <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: ageBucketColors[i] }}>{v}</div>
                  <div style={{ width: "100%", height: barH, borderRadius: "3px 3px 0 0", background: ageBucketColors[i], minHeight: 2 }} />
                  <div style={{ fontSize: 9, color: "var(--riq-text-muted)", textAlign: "center", lineHeight: 1.2 }}>{l}</div>
                </div>
              );
            })}
          </div>
          {/* Benchmarks */}
          <div style={{ display: "flex", gap: 10, margin: "8px 0" }}>
            {[
              { v: `${bm.p25}d`, l: "P25" },
              { v: `${bm.p50}d`, l: "P50 median" },
              { v: `${bm.p75}d`, l: "P75" },
              { v: `${bm.p90}d`, l: "P90 threshold" },
            ].map((b) => (
              <div key={b.l} style={{ flex: 1, background: "#342c23", borderRadius: 6, padding: "8px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--riq-accent)" }}>{b.v}</div>
                <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase", letterSpacing: "0.4px", marginTop: 2 }}>{b.l}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 6, padding: "10px 14px", fontSize: 12, lineHeight: 1.5 }}>
            Median job takes <strong>{bm.p50} days</strong> from signed to installed. Any active job past <strong>{bm.p90} days</strong> is statistically overdue.
          </div>
        </Panel>
      </div>

      {/* JOB LISTS */}
      <Panel title="Job Lists">
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" as const }}>
          {(Object.keys(TAB_CONFIG) as TabKey[]).map((k) => {
            const cfg = TAB_CONFIG[k];
            const count = (data[cfg.key] as ScheduleRow[])?.length ?? 0;
            const isActive = tab === k;
            return (
              <button
                key={k}
                onClick={() => { setTab(k); setPage(0); }}
                style={{
                  background: isActive ? "var(--riq-accent)" : "#342c23",
                  border: `1px solid ${isActive ? "var(--riq-accent)" : "var(--riq-border)"}`,
                  color: isActive ? "#1a1612" : "var(--riq-text-muted)",
                  padding: "5px 12px",
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {cfg.label} ({fmt(count)})
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 10, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search customer, rep, carrier…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            style={inputStyle}
          />
          <select value={filterRep} onChange={(e) => { setFilterRep(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All reps</option>
            {reps.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterCarrier} onChange={(e) => { setFilterCarrier(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All carriers</option>
            {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterStage} onChange={(e) => { setFilterStage(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All stages</option>
            {stages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>{filtered.length} jobs</div>

        <div style={{ overflowX: "auto" as const }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Carrier</th>
                <th style={thStyle}>Stage</th>
                <th style={thStyle}>Rep</th>
                <th style={thStyle}>
                  {tab === "overdue" ? "Days Overdue" : tab === "next30" ? "Days Until Start" : "Days Since Signed"}
                </th>
                <th style={thStyle}>
                  {tab === "unscheduled" ? "Trades" : tab === "stale" ? "" : tab === "overdue" ? "Expected Start" : "Start Date"}
                </th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle} title={r.address ?? ""}>{r.customer ?? "—"}</td>
                  <td style={tdStyle}>{r.carrier ?? "—"}</td>
                  <td style={tdStyle}>{r.stage ?? "—"}</td>
                  <td style={tdStyle}>{r.salesRep ?? "—"}</td>
                  <td style={tdStyle}>
                    {tab === "overdue" ? (
                      <span style={{ color: "#ef4444", fontWeight: 700 }}>{r.daysOverdue}d</span>
                    ) : tab === "next30" ? (
                      <span style={{ color: "#10b981", fontWeight: 700 }}>{r.daysUntilStart ?? "—"}d</span>
                    ) : (
                      <span style={{ color: daysColor(r.daysSinceSigned), fontWeight: 700 }}>{r.daysSinceSigned ?? "—"}d</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--riq-text-muted)", fontSize: 11 }}>
                    {tab === "unscheduled"
                      ? (r.trades ?? []).slice(0, 2).join(", ")
                      : tab === "stale"
                      ? r.ageNote ?? ""
                      : fmtDate(r.expectedWorkStartDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 12, color: "var(--riq-text-muted)" }}>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={{ background: "#342c23", border: "1px solid var(--riq-border)", color: "var(--riq-text)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: safePage === 0 ? "default" : "pointer", opacity: safePage === 0 ? 0.4 : 1, fontFamily: "inherit" }}
          >
            ← Prev
          </button>
          <span>Page {safePage + 1} of {pages} ({filtered.length} total)</span>
          <button
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={safePage >= pages - 1}
            style={{ background: "#342c23", border: "1px solid var(--riq-border)", color: "var(--riq-text)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: safePage >= pages - 1 ? "default" : "pointer", opacity: safePage >= pages - 1 ? 0.4 : 1, fontFamily: "inherit" }}
          >
            Next →
          </button>
        </div>
      </Panel>

      {/* REP WORKLOAD + OVERDUE BY STAGE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Rep Workload">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            Overdue + unscheduled items per rep.
          </div>
          <div style={{ overflowX: "auto" as const }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rep</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>This Wk</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Next 30</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Overdue</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Unscheduled</th>
                </tr>
              </thead>
              <tbody>
                {[...(data.byRep ?? [])].sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0)).slice(0, 20).map((r) => (
                  <tr key={r.rep}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.rep}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.thisWeek ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.next30 ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{ color: (r.overdue ?? 0) > 5 ? "#ef4444" : (r.overdue ?? 0) > 2 ? "#f59e0b" : "var(--riq-text-muted)", fontWeight: (r.overdue ?? 0) > 0 ? 700 : 400 }}>
                        {r.overdue ?? 0}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: (r.unscheduledReady ?? 0) > 5 ? "#f59e0b" : "var(--riq-text-muted)" }}>
                      {r.unscheduledReady ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Overdue by Stage">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            What stage are overdue jobs stuck in?
          </div>
          {osSorted.map(([stage, cnt]) => (
            <div key={stage} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: 12 }}>
              <span style={{ flex: 1 }}>{stage}</span>
              <div style={{ flex: 2, background: "var(--riq-border)", borderRadius: 3, height: 6, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((cnt / osMax) * 100)}%`, height: "100%", background: cnt > 50 ? "#ef4444" : cnt > 20 ? "#f59e0b" : "var(--riq-text-muted)", borderRadius: 3 }} />
              </div>
              <span style={pillStyle(cnt > 50 ? "red" : cnt > 20 ? "yellow" : "blue")}>{cnt}</span>
            </div>
          ))}
        </Panel>
      </div>

    </div>
  );
}
