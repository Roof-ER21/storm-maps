/**
 * Analytics — native React (Phase 2d batch1)
 *
 * Data:
 *   GET /api/intel/projects   → ProjectRecord[]  (16,355 items; all client-side analytics)
 *   GET /api/intel/job-storms → StormMatchRecord[] (6,597 items; keyed by jobId)
 *
 * All aggregation runs client-side (same as analytics.html).
 * No charting library — Chart.js not available in the SPA bundle.
 * The monthly trend, speed, and type-volume charts from the HTML are replaced with
 * sortable tables / text summaries (noted in report as trade-off).
 */
import { useState, useMemo } from "react";
import { useFetch, Panel, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Interfaces (minimal — only fields we actually use)
// ---------------------------------------------------------------------------

interface ProjectRecord {
  id: number;
  stage: string | null;
  signedDate: string | null;
  projectSignedDate: string | null;
  completedDate: string | null;
  jobType: string | null;
  salesRep: string | null;
  insurance: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  trades: string[];
  jobTotal: number | null;
  claimType: string | null;
  houseType: string | null;
  leadSource: string | null;
  adjusterName: string | null;
  deductible: number | null;
  acv: number | null;
  depreciation: number | null;
  insuranceTotal: number | null;
  initialEstimate: number | null;
  revisedEstimate: number | null;
  daysLossToSign: number | null;
  daysToComplete: number | null;
  paused: boolean | null;
  pauseCount: number | null;
  hasSupplement: boolean | null;
  stormMatch: StormMatch | null;
}

interface StormMatch {
  jobId: number;
  stormId: string;
  stormDate: string;
  stormType: string;
  stormMagnitude: number;
  stormUnit: string;
  stormState: string;
  stormCity: string;
  stormCounty: string;
  stormDistanceMiles: number;
  daysFromLossToStorm: number;
}

interface JobStormRecord {
  jobId: number;
  stormId: string;
  stormDate: string;
  stormType: string;
  stormMagnitude: number;
  stormUnit: string;
  stormState: string;
  stormCity: string;
  stormCounty: string;
  stormDistanceMiles: number;
  daysFromLossToStorm: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCompleted(r: ProjectRecord) { return /completed|finalized/i.test(r.stage ?? ""); }
function isDead(r: ProjectRecord) { return /dead|cancel/i.test(r.stage ?? ""); }

function yearOf(r: ProjectRecord): number | null {
  const d = r.signedDate ?? r.projectSignedDate ?? r.completedDate;
  if (!d) return null;
  const m = String(d).match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
}

function monthOf(r: ProjectRecord): string | null {
  return r.signedDate ? r.signedDate.slice(0, 7) : null;
}

interface Stats {
  signed: number;
  completed: number;
  dead: number;
  open: number;
  revenue: number;
  avg: number;
  closeRate: number;
  deathRate: number;
}

function calcStats(rows: ProjectRecord[]): Stats {
  let completed = 0, dead = 0, revenue = 0;
  for (const r of rows) {
    if (isCompleted(r)) completed++;
    else if (isDead(r)) dead++;
    if (r.jobTotal) revenue += r.jobTotal;
  }
  const completedRevenue = rows.filter(isCompleted).reduce((s, r) => s + (r.jobTotal ?? 0), 0);
  const avg = completed > 0 ? completedRevenue / completed : 0;
  return {
    signed: rows.length, completed, dead, open: rows.length - completed - dead,
    revenue, avg,
    closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
    deathRate: rows.length > 0 ? dead / rows.length : 0,
  };
}

function groupBy<K>(arr: ProjectRecord[], key: (r: ProjectRecord) => K | null | undefined): Map<K, ProjectRecord[]> {
  const m = new Map<K, ProjectRecord[]>();
  for (const r of arr) {
    const k = key(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 12 };
const th: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500,
  fontSize: 10, textTransform: "uppercase", padding: "6px",
  borderBottom: "1px solid var(--riq-border)", cursor: "pointer", userSelect: "none",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "5px 6px", borderBottom: "1px solid #342c23" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const scrollBox: React.CSSProperties = { maxHeight: 400, overflowY: "auto" };

function pct(n: number) { return (n * 100).toFixed(1) + "%"; }
function fmt(n: number | null | undefined) { if (n == null) return "—"; return n.toLocaleString(); }

// ---------------------------------------------------------------------------
// Sortable table component
// ---------------------------------------------------------------------------

interface ColDef {
  key: string;
  label: string;
  num?: boolean;
  green?: boolean;
  accent?: boolean;
  red?: boolean;
  render?: (val: unknown, row: Record<string, unknown>) => string;
}

function SortTable({ columns, rows: initialRows, defaultSort }: { columns: ColDef[]; rows: Record<string, unknown>[]; defaultSort?: string }) {
  const [sortKey, setSortKey] = useState(defaultSort ?? columns[0].key);
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    return [...initialRows].sort((a, b) => {
      const va = a[sortKey] as number | string | null | undefined;
      const vb = b[sortKey] as number | string | null | undefined;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortAsc ? cmp : -cmp;
    });
  }, [initialRows, sortKey, sortAsc]);

  return (
    <table style={tbl}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              style={c.num ? thNum : th}
              onClick={() => {
                if (sortKey === c.key) setSortAsc(!sortAsc);
                else { setSortKey(c.key); setSortAsc(false); }
              }}
            >
              {c.label}
              {sortKey === c.key ? (sortAsc ? " ▲" : " ▼") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => {
              const val = r[c.key];
              const display = c.render ? c.render(val, r) : (val == null ? "—" : String(val));
              const color = c.green ? "#10b981" : c.accent ? "var(--riq-accent)" : c.red ? "#ef4444" : undefined;
              return (
                <td key={c.key} style={{ ...(c.num ? tdNum : td), ...(color ? { color } : {}) }}>
                  {display}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Analytics({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const projects = useFetch<ProjectRecord[]>("/api/intel/projects");
  const jobStorms = useFetch<JobStormRecord[]>("/api/intel/job-storms");

  const [filterYear, setFilterYear] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterType, setFilterType] = useState("");

  // Merge storm matches into projects
  const all = useMemo<ProjectRecord[]>(() => {
    if (!projects.data) return [];
    if (!jobStorms.data) return projects.data;
    const stormMap = new Map(jobStorms.data.map((s) => [s.jobId, s]));
    return projects.data.map((r) => ({ ...r, stormMatch: stormMap.get(r.id) ?? null }));
  }, [projects.data, jobStorms.data]);

  // Available filter options
  const { years, states, types } = useMemo(() => {
    const years = new Set<number>(), states = new Set<string>(), types = new Set<string>();
    for (const r of all) {
      const y = yearOf(r); if (y) years.add(y);
      if (r.state) states.add(r.state);
      if (r.jobType) types.add(r.jobType);
    }
    return {
      years: [...years].sort().reverse(),
      states: [...states].sort(),
      types: [...types].sort(),
    };
  }, [all]);

  const filtered = useMemo(() => {
    return all.filter((r) => {
      if (filterYear && String(yearOf(r)) !== filterYear) return false;
      if (filterState && r.state !== filterState) return false;
      if (filterType && r.jobType !== filterType) return false;
      return true;
    });
  }, [all, filterYear, filterState, filterType]);

  // --- Computed sections ---

  const summary = useMemo(() => calcStats(filtered), [filtered]);

  const typeRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.jobType);
    return [...m.entries()].map(([type, jobs]) => ({ type: type ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const yearRows = useMemo(() => {
    const m = groupBy(filtered.filter((r) => yearOf(r) != null), yearOf);
    return [...m.entries()].map(([year, jobs]) => ({ year: String(year), ...calcStats(jobs) }))
      .sort((a, b) => Number(b.year) - Number(a.year));
  }, [filtered]);

  const repRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.salesRep);
    return [...m.entries()].map(([rep, jobs]) => ({ rep: rep ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed).slice(0, 80);
  }, [filtered]);

  const insRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.insurance);
    return [...m.entries()].map(([ins, jobs]) => ({ ins: ins ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const cityRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.city && r.state ? `${r.city}, ${r.state}` : null);
    return [...m.entries()].map(([city, jobs]) => ({ city, ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed).slice(0, 60);
  }, [filtered]);

  const zipRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.zip ? r.zip.slice(0, 5) : null);
    return [...m.entries()].map(([zip, jobs]) => {
      const s = calcStats(jobs);
      const cities = [...new Set(jobs.map((j) => j.city).filter(Boolean))];
      return { zip, city: cities.slice(0, 2).join(" / "), ...s };
    }).sort((a, b) => b.completed - a.completed).slice(0, 50);
  }, [filtered]);

  const leadRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.leadSource);
    return [...m.entries()].map(([ls, jobs]) => ({ ls: ls ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const claimRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.claimType);
    return [...m.entries()].map(([t, jobs]) => ({ t: t ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const houseRows = useMemo(() => {
    const m = groupBy(filtered, (r) => r.houseType);
    return [...m.entries()].map(([t, jobs]) => ({ t: t ?? "—", ...calcStats(jobs) }))
      .sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const tradeRows = useMemo(() => {
    const tradeCount: Record<string, { trade: string; signed: number; completed: number; dead: number; revenue: number }> = {};
    for (const r of filtered) {
      for (const t of (r.trades ?? [])) {
        if (!tradeCount[t]) tradeCount[t] = { trade: t, signed: 0, completed: 0, dead: 0, revenue: 0 };
        tradeCount[t].signed++;
        if (isCompleted(r)) tradeCount[t].completed++;
        else if (isDead(r)) tradeCount[t].dead++;
        if (r.jobTotal) tradeCount[t].revenue += r.jobTotal;
      }
    }
    return Object.values(tradeCount).map((r) => ({
      ...r,
      closeRate: r.signed - r.dead > 0 ? r.completed / (r.signed - r.dead) : 0,
      avg: r.completed > 0 ? r.revenue / r.completed : 0,
    })).sort((a, b) => b.signed - a.signed);
  }, [filtered]);

  const multiRows = useMemo(() => {
    const buckets: Record<string, ProjectRecord[]> = { "Single trade": [], "2 trades": [], "3 trades": [], "4+ trades": [], "No trade data": [] };
    for (const r of filtered) {
      const n = (r.trades ?? []).length;
      const k = n === 0 ? "No trade data" : n === 1 ? "Single trade" : n === 2 ? "2 trades" : n === 3 ? "3 trades" : "4+ trades";
      buckets[k].push(r);
    }
    return Object.entries(buckets).map(([bucket, jobs]) => ({ bucket, ...calcStats(jobs) }));
  }, [filtered]);

  const adjRows = useMemo(() => {
    const m = new Map<string, { name: string; carrier: string; signed: number; completed: number; dead: number; revenue: number }>();
    for (const r of filtered) {
      if (!r.adjusterName) continue;
      const key = `${r.adjusterName}|${r.insurance ?? "Unknown"}`;
      if (!m.has(key)) m.set(key, { name: r.adjusterName, carrier: r.insurance ?? "Unknown", signed: 0, completed: 0, dead: 0, revenue: 0 });
      const s = m.get(key)!;
      s.signed++;
      if (isCompleted(r)) s.completed++;
      else if (isDead(r)) s.dead++;
      if (r.jobTotal) s.revenue += r.jobTotal;
    }
    return [...m.values()].map((r) => ({
      ...r,
      closeRate: r.signed - r.dead > 0 ? r.completed / (r.signed - r.dead) : 0,
      avg: r.completed > 0 ? r.revenue / r.completed : 0,
    })).sort((a, b) => b.completed - a.completed).slice(0, 100);
  }, [filtered]);

  const dedRows = useMemo(() => {
    const m = new Map<string, { carrier: string; count: number; sum: number; vals: number[] }>();
    for (const r of filtered) {
      if (!r.deductible || r.deductible <= 0 || r.deductible > 50000) continue;
      const c = r.insurance ?? "Unknown";
      if (!m.has(c)) m.set(c, { carrier: c, count: 0, sum: 0, vals: [] });
      const e = m.get(c)!;
      e.count++; e.sum += r.deductible; e.vals.push(r.deductible);
    }
    return [...m.values()].map((e) => {
      e.vals.sort((a, b) => a - b);
      return { carrier: e.carrier, jobs: e.count, avg: e.sum / e.count, median: e.vals[Math.floor(e.vals.length / 2)], max: e.vals[e.vals.length - 1] };
    }).sort((a, b) => b.jobs - a.jobs).slice(0, 30);
  }, [filtered]);

  // Friction
  const frictionRows = useMemo(() => {
    const total = filtered.length;
    const paused = filtered.filter((r) => r.paused).length;
    const pauseEver = filtered.filter((r) => (r.pauseCount ?? 0) > 0).length;
    const supplement = filtered.filter((r) => r.hasSupplement).length;
    const suppCompleted = filtered.filter((r) => r.hasSupplement && isCompleted(r)).length;
    const suppDead = filtered.filter((r) => r.hasSupplement && isDead(r)).length;
    return [
      { signal: "Currently paused", count: paused, pct: total > 0 ? paused / total : 0, note: "Sign of active blocker / dispute" },
      { signal: "Paused at some point", count: pauseEver, pct: total > 0 ? pauseEver / total : 0, note: "Includes resolved pauses" },
      { signal: "Has supplement filed", count: supplement, pct: total > 0 ? supplement / total : 0, note: `${suppCompleted} completed, ${suppDead} dead` },
    ];
  }, [filtered]);

  // Storm correlation
  const { stormKpis, stormByJobRows, stormByRevRows } = useMemo(() => {
    const matched = filtered.filter((r) => r.stormMatch);
    const totalRev = matched.reduce((s, r) => s + (r.jobTotal ?? 0), 0);
    const completedRev = matched.filter(isCompleted).reduce((s, r) => s + (r.jobTotal ?? 0), 0);
    const byStorm = new Map<string, { stormId: string; date: string; type: string; magnitude: number; unit: string; jobs: number; revenue: number; completed: number }>();
    for (const r of matched) {
      const sm = r.stormMatch!;
      if (!byStorm.has(sm.stormId)) byStorm.set(sm.stormId, { stormId: sm.stormId, date: (sm.stormDate ?? "").slice(0, 10), type: sm.stormType, magnitude: sm.stormMagnitude, unit: sm.stormUnit, jobs: 0, revenue: 0, completed: 0 });
      const s = byStorm.get(sm.stormId)!;
      s.jobs++;
      if (r.jobTotal) s.revenue += r.jobTotal;
      if (isCompleted(r)) s.completed++;
    }
    const rows = [...byStorm.values()];
    return {
      stormKpis: { matched: matched.length, totalRev, completedCount: matched.filter(isCompleted).length, completedRev },
      stormByJobRows: [...rows].sort((a, b) => b.jobs - a.jobs).slice(0, 30),
      stormByRevRows: [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    };
  }, [filtered]);

  // Carrier pay
  const carrierPayRows = useMemo(() => {
    const m = new Map<string, { carrier: string; jobs: ProjectRecord[]; acvSum: number; acvCount: number; depSum: number; depCount: number }>();
    for (const r of filtered) {
      if (!r.insurance) continue;
      if (!m.has(r.insurance)) m.set(r.insurance, { carrier: r.insurance, jobs: [], acvSum: 0, acvCount: 0, depSum: 0, depCount: 0 });
      const e = m.get(r.insurance)!;
      e.jobs.push(r);
      if (r.acv) { e.acvSum += r.acv; e.acvCount++; }
      if (r.depreciation) { e.depSum += r.depreciation; e.depCount++; }
    }
    return [...m.values()].map((e) => {
      const avgAcv = e.acvCount ? e.acvSum / e.acvCount : null;
      const avgDep = e.depCount ? e.depSum / e.depCount : null;
      const depPct = avgAcv && avgDep ? avgDep / (avgAcv + avgDep) : null;
      const completedJobs = e.jobs.filter(isCompleted);
      const completedRev = completedJobs.reduce((s, r) => s + (r.jobTotal ?? 0), 0);
      return {
        carrier: e.carrier, jobs: e.jobs.length, completed: completedJobs.length,
        avgAcv, avgDep, depPct,
        avgJobTotal: completedJobs.length ? completedRev / completedJobs.length : null,
      };
    }).sort((a, b) => b.jobs - a.jobs).slice(0, 40);
  }, [filtered]);

  // Supplement uplift
  const suppUpliftRows = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of filtered) {
      if (!r.insurance || !r.initialEstimate || !r.revisedEstimate) continue;
      if (r.initialEstimate <= 0) continue;
      if (!m.has(r.insurance)) m.set(r.insurance, []);
      m.get(r.insurance)!.push((r.revisedEstimate - r.initialEstimate) / r.initialEstimate);
    }
    const rows = [];
    for (const [carrier, vals] of m) {
      if (vals.length < 5) continue;
      vals.sort((a, b) => a - b);
      rows.push({
        carrier, jobs: vals.length,
        medianUplift: vals[Math.floor(vals.length / 2)],
        avgUplift: vals.reduce((s, v) => s + v, 0) / vals.length,
        maxUplift: vals[vals.length - 1],
        pctOver50: vals.filter((v) => v > 0.5).length / vals.length,
      });
    }
    return rows.sort((a, b) => b.jobs - a.jobs).slice(0, 30);
  }, [filtered]);

  // Cluster
  const clusterRows = useMemo(() => {
    const m = groupBy(filtered.filter(isCompleted), (r) => r.zip ? r.zip.slice(0, 5) : null);
    const rows = [];
    for (const [zip, jobs] of m) {
      if (jobs.length < 3) continue;
      const carrierCount: Record<string, number> = {};
      const tradeCount: Record<string, number> = {};
      const repCount: Record<string, number> = {};
      let revenue = 0;
      for (const j of jobs) {
        if (j.insurance) carrierCount[j.insurance] = (carrierCount[j.insurance] ?? 0) + 1;
        if (j.claimType) tradeCount[j.claimType] = (tradeCount[j.claimType] ?? 0) + 1;
        if (j.salesRep) repCount[j.salesRep] = (repCount[j.salesRep] ?? 0) + 1;
        revenue += j.jobTotal ?? 0;
      }
      const topCarrier = Object.entries(carrierCount).sort((a, b) => b[1] - a[1])[0];
      const topTrade = Object.entries(tradeCount).sort((a, b) => b[1] - a[1])[0];
      const topRep = Object.entries(repCount).sort((a, b) => b[1] - a[1])[0];
      const cities = [...new Set(jobs.map((j) => j.city).filter(Boolean))].slice(0, 2).join(" / ");
      rows.push({
        zip, city: cities, approvals: jobs.length,
        topCarrier: topCarrier ? `${topCarrier[0]} (${topCarrier[1]})` : "—",
        topTrade: topTrade ? topTrade[0] : "—",
        topRep: topRep ? `${topRep[0]} (${topRep[1]})` : "—",
        revenue,
      });
    }
    return rows.sort((a, b) => b.approvals - a.approvals).slice(0, 60);
  }, [filtered]);

  // Monthly trend (simplified — table)
  const monthlyRows = useMemo(() => {
    const m = groupBy(filtered.filter((r) => monthOf(r) != null), monthOf);
    return [...m.entries()].map(([month, jobs]) => ({
      month: month ?? "", signed: jobs.length,
      revenue: jobs.reduce((s, r) => s + (r.jobTotal ?? 0), 0),
    })).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 36);
  }, [filtered]);

  if (projects.loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading {(16355).toLocaleString()} projects…</div>
      </div>
    );
  }

  if (projects.error) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed: {projects.error}</div>
      </div>
    );
  }

  const filterBar: React.CSSProperties = {
    display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end",
  };
  const selectStyle: React.CSSProperties = {
    background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
    borderRadius: 4, padding: "4px 8px", fontSize: 13, fontFamily: "inherit",
  };

  const twoCol: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {/* Filter bar */}
      <div style={filterBar}>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          Year
          <select style={selectStyle} value={filterYear} onChange={(e) => setFilterYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          State
          <select style={selectStyle} value={filterState} onChange={(e) => setFilterState(e.target.value)}>
            <option value="">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          Job Type
          <select style={selectStyle} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {/* Summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total signed", value: fmt(summary.signed) },
          { label: "Completed", value: `${fmt(summary.completed)} (${pct(summary.completed / (summary.signed || 1))})` },
          { label: "Dead / Cancelled", value: `${fmt(summary.dead)} (${pct(summary.dead / (summary.signed || 1))})` },
          { label: "In progress", value: fmt(summary.open) },
          { label: "Total revenue", value: fmtMoney(summary.revenue) },
          { label: "Avg completed job", value: fmtMoney(summary.avg) },
          { label: "Close rate", value: pct(summary.closeRate) },
        ].map((c) => (
          <div key={c.label} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--riq-text-muted)", letterSpacing: "0.05em" }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "var(--riq-accent)", marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Job Type Breakdown */}
      <Panel title="Job Type Breakdown">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Volume, completion rate, revenue per job type.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "type", label: "Job Type" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "deathRate", label: "Death Rate", num: true, red: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
              { key: "avg", label: "Avg Job", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={typeRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </div>
      </Panel>

      {/* Monthly Trend (table — no Chart.js in SPA bundle) */}
      <Panel title="Monthly Trend — Signed Jobs & Revenue (Most Recent 36 mo)">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Sorted newest first. Spring/summer peaks = storm season.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "month", label: "Month" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={monthlyRows as unknown as Record<string, unknown>[]}
            defaultSort="month"
          />
        </div>
      </Panel>

      {/* Year-over-Year */}
      <Panel title="Year-over-Year Performance">
        <SortTable
          columns={[
            { key: "year", label: "Year" },
            { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
            { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
            { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
            { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            { key: "avg", label: "Avg Job", num: true, green: true, render: (v) => fmtMoney(v as number) },
          ]}
          rows={yearRows as unknown as Record<string, unknown>[]}
          defaultSort="year"
        />
      </Panel>

      {/* Sales Rep Leaderboard */}
      <Panel title="Sales Rep Leaderboard (Top 80)">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Top 80 reps by signed jobs. Click columns to sort.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "rep", label: "Sales Rep" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "dead", label: "Dead", num: true, render: fmt as (v: unknown) => string },
              { key: "open", label: "Open", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
              { key: "avg", label: "Avg Job", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={repRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </div>
      </Panel>

      {/* Insurance Carrier Analysis */}
      <Panel title="Insurance Carrier Analysis">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Close rate per carrier is a proxy for approval.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "ins", label: "Carrier" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Approval / Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "deathRate", label: "Death Rate", num: true, red: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
              { key: "avg", label: "Avg Approved Job", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={insRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </div>
      </Panel>

      {/* City Hot Zones */}
      <Panel title="City Hot Zones — Top 60 by Volume">
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "city", label: "City, State" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={cityRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </div>
      </Panel>

      {/* ZIP Hot Zones */}
      <Panel title="ZIP Code Hot Zones — Top 50 by Approvals">
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "zip", label: "ZIP" },
              { key: "city", label: "Cities" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Approvals", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={zipRows as unknown as Record<string, unknown>[]}
            defaultSort="completed"
          />
        </div>
      </Panel>

      {/* Lead Source */}
      <Panel title="Lead Source Performance">
        <SortTable
          columns={[
            { key: "ls", label: "Lead Source" },
            { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
            { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
            { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
            { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
          ]}
          rows={leadRows as unknown as Record<string, unknown>[]}
          defaultSort="signed"
        />
      </Panel>

      {/* Claim type + house type */}
      <div style={{ ...twoCol, marginBottom: 0 }}>
        <Panel title="Claim Type">
          <SortTable
            columns={[
              { key: "t", label: "Claim Type" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={claimRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </Panel>
        <Panel title="House Type">
          <SortTable
            columns={[
              { key: "t", label: "House Type" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={houseRows as unknown as Record<string, unknown>[]}
            defaultSort="signed"
          />
        </Panel>
      </div>

      {/* Trade breakdown */}
      <Panel title="Trade Breakdown">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Which trades drive revenue. Multi-trade jobs are higher value.</div>
        <SortTable
          columns={[
            { key: "trade", label: "Trade" },
            { key: "signed", label: "On Jobs", num: true, render: fmt as (v: unknown) => string },
            { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
            { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
            { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
          ]}
          rows={tradeRows as unknown as Record<string, unknown>[]}
          defaultSort="signed"
        />
      </Panel>

      {/* Single vs Multi trade */}
      <Panel title="Single-Trade vs Multi-Trade">
        <SortTable
          columns={[
            { key: "bucket", label: "Trade Count" },
            { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
            { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
            { key: "closeRate", label: "Close Rate", num: true, accent: true, render: (v) => pct(v as number) },
            { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            { key: "avg", label: "Avg Job", num: true, green: true, render: (v) => fmtMoney(v as number) },
          ]}
          rows={multiRows as unknown as Record<string, unknown>[]}
        />
      </Panel>

      {/* Adjuster Scorecard */}
      <Panel title="Adjuster Scorecard">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Top adjusters by approval volume.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "name", label: "Adjuster" },
              { key: "carrier", label: "Carrier" },
              { key: "signed", label: "Signed", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Approved", num: true, render: fmt as (v: unknown) => string },
              { key: "closeRate", label: "Approval Rate", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={adjRows as unknown as Record<string, unknown>[]}
            defaultSort="completed"
          />
        </div>
      </Panel>

      {/* Deductible patterns */}
      <Panel title="Deductible Patterns by Carrier">
        <SortTable
          columns={[
            { key: "carrier", label: "Carrier" },
            { key: "jobs", label: "Jobs with Deductible", num: true, render: fmt as (v: unknown) => string },
            { key: "avg", label: "Avg Deductible", num: true, green: true, render: (v) => fmtMoney(v as number) },
            { key: "median", label: "Median", num: true, green: true, render: (v) => fmtMoney(v as number) },
            { key: "max", label: "Max", num: true, render: (v) => fmtMoney(v as number) },
          ]}
          rows={dedRows as unknown as Record<string, unknown>[]}
          defaultSort="jobs"
        />
      </Panel>

      {/* Friction signals */}
      <Panel title="Friction Signals">
        <SortTable
          columns={[
            { key: "signal", label: "Signal" },
            { key: "count", label: "Count", num: true, render: fmt as (v: unknown) => string },
            { key: "pct", label: "% of filtered", num: true, accent: true, render: (v) => pct(v as number) },
            { key: "note", label: "Notes" },
          ]}
          rows={frictionRows as unknown as Record<string, unknown>[]}
        />
      </Panel>

      {/* Carrier Payment Profile */}
      <Panel title="Carrier Payment Profile">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Per carrier: avg ACV, depreciation %, avg job total.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "carrier", label: "Carrier" },
              { key: "jobs", label: "Total Jobs", num: true, render: fmt as (v: unknown) => string },
              { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
              { key: "avgAcv", label: "Avg ACV", num: true, green: true, render: (v) => fmtMoney(v as number) },
              { key: "avgDep", label: "Avg Depreciation", num: true, render: (v) => fmtMoney(v as number) },
              { key: "depPct", label: "Depreciation %", num: true, render: (v) => v == null ? "—" : pct(v as number) },
              { key: "avgJobTotal", label: "Avg Job Total", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={carrierPayRows as unknown as Record<string, unknown>[]}
            defaultSort="jobs"
          />
        </div>
      </Panel>

      {/* Supplement Uplift */}
      <Panel title="Supplement Uplift by Carrier">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>How much supplements increased payout. Min 5 jobs with both estimates.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "carrier", label: "Carrier" },
              { key: "jobs", label: "Jobs (with both ests)", num: true, render: fmt as (v: unknown) => string },
              { key: "medianUplift", label: "Median Uplift", num: true, accent: true, render: (v) => pct(v as number) },
              { key: "avgUplift", label: "Avg Uplift", num: true, render: (v) => pct(v as number) },
              { key: "maxUplift", label: "Max Uplift", num: true, render: (v) => pct(v as number) },
              { key: "pctOver50", label: "% jobs >50% uplift", num: true, render: (v) => pct(v as number) },
            ]}
            rows={suppUpliftRows as unknown as Record<string, unknown>[]}
            defaultSort="medianUplift"
          />
        </div>
      </Panel>

      {/* Storm Correlation */}
      <Panel title="Storm Correlation — Job ↔ Storm-of-Record">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
          {fmt(stormKpis.matched)} jobs matched to a storm ({pct(stormKpis.matched / (filtered.length || 1))} of filtered).
          Revenue from matched: {fmtMoney(stormKpis.totalRev)}. Completed + matched: {fmt(stormKpis.completedCount)} ({fmtMoney(stormKpis.completedRev)}).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Top 30 storms by jobs driven</div>
            <div style={scrollBox}>
              <SortTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "type", label: "Type" },
                  { key: "magnitude", label: "Mag", num: true },
                  { key: "jobs", label: "Jobs", num: true, render: fmt as (v: unknown) => string },
                  { key: "completed", label: "Completed", num: true, render: fmt as (v: unknown) => string },
                  { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
                ]}
                rows={stormByJobRows as unknown as Record<string, unknown>[]}
                defaultSort="jobs"
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Top 30 storms by revenue driven</div>
            <div style={scrollBox}>
              <SortTable
                columns={[
                  { key: "date", label: "Date" },
                  { key: "type", label: "Type" },
                  { key: "jobs", label: "Jobs", num: true, render: fmt as (v: unknown) => string },
                  { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
                ]}
                rows={stormByRevRows as unknown as Record<string, unknown>[]}
                defaultSort="revenue"
              />
            </div>
          </div>
        </div>
      </Panel>

      {/* Geographic Clustering */}
      <Panel title="Geographic Clustering — Same Carrier, Same Trade, Nearby Approvals">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Dominant carrier and trade per ZIP among approved jobs. Min 3 approvals per ZIP.</div>
        <div style={scrollBox}>
          <SortTable
            columns={[
              { key: "zip", label: "ZIP" },
              { key: "city", label: "Cities" },
              { key: "approvals", label: "Approvals", num: true, render: fmt as (v: unknown) => string },
              { key: "topCarrier", label: "Dominant Carrier" },
              { key: "topTrade", label: "Dominant Trade" },
              { key: "topRep", label: "Top Rep" },
              { key: "revenue", label: "Revenue", num: true, green: true, render: (v) => fmtMoney(v as number) },
            ]}
            rows={clusterRows as unknown as Record<string, unknown>[]}
            defaultSort="approvals"
          />
        </div>
      </Panel>
    </div>
  );
}
