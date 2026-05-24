/**
 * Active Work v2 — native React (Phase 8c: tabbed Ops Surveillance)
 *
 * 4 tabs:
 *   • Supplements  — GET /api/intel/active-work (eager) — the original active-work view, unchanged
 *   • Fixes        — GET /api/intel/fixes-summary                         [Phase 8c · server/Mac]
 *   • Tasks        — GET /api/intel/tasks-overdue                         [Phase 8c · server/Mac]
 *   • Punch List   — GET /api/intel/punchlist-active                      [Phase 8c · server/Mac]
 *
 * Built contract-first against the 8c endpoint shapes posted in COORD-2026-05-24
 * (the 3 new tabs' keys are PROVISIONAL until Mac confirms "endpoints green").
 * The new tabs lazy-load on first open and degrade gracefully (a "pending server
 * push" note) while their endpoints are still pre-deploy — same B1→F2 pattern.
 *
 * Supplements response shape (verified against live prod):
 *   GET /api/intel/active-work
 *   → { totals:{activeJobs,withOpenSupplement,withCrossSellBid,crossSellBaseValue},
 *       install:{overdue,scheduledCount,startingThisWeek,startingNext30Days,readyForInstallCount},
 *       supplement:{byStatus,byCarrier:[{carrier,total,totalValue,byStatus}]},
 *       crossSell:{summary:[{type,openBids,postRecheck,baseJobValue}],
 *                  byCarrier:[{carrier,count,baseJobValue,bidCounts}]},
 *       publicAdjustment:{count,byStatus} }
 */
import { useState, useEffect, useRef } from "react";
import { useFetch, Panel, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Supplements response shapes (verified against live prod)
// ---------------------------------------------------------------------------

interface ActiveWorkTotals {
  activeJobs: number;
  withOpenSupplement: number;
  withCrossSellBid: number;
  crossSellBaseValue: number;
}

interface InstallData {
  overdue: number;
  scheduledCount: number;
  startingThisWeek: number;
  startingNext30Days: number;
  readyForInstallCount: number;
}

interface SuppCarrierRow {
  carrier: string;
  total: number;
  totalValue: number;
  byStatus: Record<string, number>;
}

interface CrossSellSummaryItem {
  type: string;
  openBids: number;
  postRecheck: number;
  baseJobValue: number;
}

interface CrossSellCarrierItem {
  carrier: string;
  count: number;
  baseJobValue: number;
  bidCounts: Record<string, number>;
}

interface ActiveWorkResponse {
  totals: ActiveWorkTotals;
  install: InstallData;
  supplement: {
    byStatus: Record<string, number>;
    byCarrier: SuppCarrierRow[];
  };
  crossSell: {
    summary: CrossSellSummaryItem[];
    byCarrier: CrossSellCarrierItem[];
  };
  publicAdjustment: {
    count: number;
    byStatus: Record<string, number>;
  };
}

// ---------------------------------------------------------------------------
// Phase 8c response shapes (PROVISIONAL — confirm on Mac's "endpoints green")
// Mirrors the contract posted in COORD-2026-05-24.
// ---------------------------------------------------------------------------

interface FixesSummary {
  total: number;
  open: number;
  completed: number;
  by_trade: { key: string; count: number }[];
  by_rep: { rep: string; employee_id: number | null; open: number; completed: number }[];
  by_age: { bucket: string; count: number }[];
  took_ms?: number;
}

interface TasksOverdue {
  total_overdue: number;
  by_rep: { rep: string; employee_id: number | null; count: number }[];
  items: {
    id: number;
    description: string | null;
    priority: string | null;
    due_date: string | null;
    rep: string | null;          // server-computed name (data->'user'->>firstName/lastName)
    employee_id: number | null;
    customer_id: string | null;  // portal customer id arrives as a string
  }[];
}

interface PunchlistActive {
  total: number;
  items: {
    id: number;
    name: string | null;
    city: string | null;
    state: string | null;
    status_id: number | null;
    substatus_id: number | null;
    work_completed: boolean | null;
  }[];
}

interface FixesByRep {
  rep: string;
  open: { id: number; job_id: number | null; trade: string | null; description: string | null; created_date: string | null; photo_count: number | null }[];
  count: number;
  took_ms?: number;
}

interface TasksByRep {
  rep: string;
  pending: { id: number; description: string | null; priority: string | null; due_date: string | null; customer_id: string | null }[];
  overdue_count: number;
  count: number;
  took_ms?: number;
}

type LoadState = "idle" | "loading" | "error" | "ok";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString();
}

function pillForSuppStatus(s: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    marginRight: 4,
    background: "#342c23",
    color: "var(--riq-text-muted)",
  };
  if (/Finalized/i.test(s))       return { ...base, background: "rgba(16,185,129,0.18)", color: "#10b981" };
  if (/Sent|Confirmed/i.test(s))   return { ...base, background: "rgba(96,165,250,0.18)", color: "#60a5fa" };
  if (/Pending|Revised/i.test(s))  return { ...base, background: "rgba(245,158,11,0.18)", color: "#f59e0b" };
  return base;
}

// ---------------------------------------------------------------------------
// Shared table + KPI styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "7px 6px", borderBottom: "1px solid #342c23" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const kpiStyle = (cls: "red" | "yellow" | "green" | "blue" | ""): React.CSSProperties => ({
  background: "#342c23",
  borderRadius: 6,
  padding: "11px 14px",
  ...(cls === "red"    ? { border: "1px solid rgba(239,68,68,0.25)" } :
      cls === "yellow" ? { border: "1px solid rgba(245,158,11,0.25)" } :
      cls === "green"  ? { border: "1px solid rgba(16,185,129,0.25)" } :
      cls === "blue"   ? { border: "1px solid rgba(96,165,250,0.25)" } :
                         { border: "1px solid var(--riq-border)" }),
});

const kpiValStyle = (cls: string): React.CSSProperties => ({
  fontSize: 22,
  fontWeight: 700,
  marginTop: 4,
  color: cls === "red" ? "#ef4444" : cls === "yellow" ? "#f59e0b" : cls === "green" ? "#10b981" : cls === "blue" ? "#60a5fa" : "var(--riq-accent)",
});

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "10px 18px",
  cursor: "pointer",
  color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
  borderBottom: active ? "2px solid var(--riq-accent)" : "2px solid transparent",
  fontSize: 13,
  userSelect: "none" as const,
});

// Small KPI tile used by the 8c tabs.
function Kpi({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: "red" | "yellow" | "green" | "blue" | "" }) {
  return (
    <div style={kpiStyle(cls)}>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={kpiValStyle(cls)}>{value}</div>
    </div>
  );
}

// Loading / pre-deploy / error placeholder for the lazy 8c tabs.
function TabPlaceholder({ state, label }: { state: LoadState; label: string }) {
  if (state === "loading" || state === "idle") {
    return <div style={{ padding: 30, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  }
  return (
    <div style={{ padding: 20, color: "var(--riq-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
      Couldn't load <strong style={{ color: "var(--riq-text)" }}>{label}</strong> — its Phase 8c endpoint may not be
      deployed yet (pending the server push + data backfill). This tab will populate automatically once the endpoint is live.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — tab shell
// ---------------------------------------------------------------------------

type TabId = "supplements" | "fixes" | "tasks" | "punchlist";

export function ActiveWork({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [tab, setTab] = useState<TabId>("supplements");

  // Supplements: eager on mount (default tab) via the existing endpoint.
  const aw = useFetch<ActiveWorkResponse>("/api/intel/active-work");

  // Phase 8c tabs: lazy-load on first open. A ref dedupes the fetch kickoff so the
  // effect never sets state synchronously (only the async fetch callbacks do); the
  // per-tab LoadState is derived in render from {data, error}.
  const requested = useRef<Set<TabId>>(new Set());
  const [fixes, setFixes] = useState<FixesSummary | null>(null);
  const [fixesErr, setFixesErr] = useState(false);
  const [tasks, setTasks] = useState<TasksOverdue | null>(null);
  const [tasksErr, setTasksErr] = useState(false);
  const [punch, setPunch] = useState<PunchlistActive | null>(null);
  const [punchErr, setPunchErr] = useState(false);

  useEffect(() => {
    if (tab === "supplements" || requested.current.has(tab)) return;
    requested.current.add(tab);
    if (tab === "fixes") {
      fetch("/api/intel/fixes-summary", { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<FixesSummary>; })
        .then(setFixes)
        .catch(() => setFixesErr(true));
    } else if (tab === "tasks") {
      fetch("/api/intel/tasks-overdue", { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<TasksOverdue>; })
        .then(setTasks)
        .catch(() => setTasksErr(true));
    } else if (tab === "punchlist") {
      fetch("/api/intel/punchlist-active", { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<PunchlistActive>; })
        .then(setPunch)
        .catch(() => setPunchErr(true));
    }
  }, [tab]);

  const loadState = (data: unknown, err: boolean): LoadState => (err ? "error" : data ? "ok" : "loading");

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* TABS */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--riq-border)" }}>
        {([
          ["supplements", "Supplements"],
          ["fixes",       "Fixes"],
          ["tasks",       "Tasks"],
          ["punchlist",   "Punch List"],
        ] as [TabId, string][]).map(([id, label]) => (
          <div key={id} style={tabStyle(tab === id)} onClick={() => setTab(id)}>{label}</div>
        ))}
      </div>

      {tab === "supplements" && <SupplementsTab aw={aw} />}
      {tab === "fixes" && <FixesTab state={loadState(fixes, fixesErr)} data={fixes} />}
      {tab === "tasks" && <TasksTab state={loadState(tasks, tasksErr)} data={tasks} />}
      {tab === "punchlist" && <PunchlistTab state={loadState(punch, punchErr)} data={punch} />}

    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplements tab — the original active-work view (unchanged content)
// ---------------------------------------------------------------------------

function SupplementsTab({ aw }: { aw: { data: ActiveWorkResponse | null; error: string | null; loading: boolean } }) {
  if (aw.loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  }
  if (aw.error || !aw.data) {
    return <div style={{ padding: 20, color: "#ef4444" }}>Failed to load: {aw.error}</div>;
  }

  const d = aw.data;
  const inst = d.install;

  return (
    <>
      {/* OVERVIEW */}
      <Panel title="Overview — what's in motion right now">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Live snapshot from the portal's active-jobs dashboard. Supplements, cross-sell bids, install readiness,
          and active PA tags across <strong>{fmt(d.totals.activeJobs)}</strong> jobs currently in flight.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          {[
            { l: "Active jobs",           v: fmt(d.totals.activeJobs),           cls: "" },
            { l: "With open supplement",  v: fmt(d.totals.withOpenSupplement),   cls: "blue" },
            { l: "With cross-sell bid",   v: fmt(d.totals.withCrossSellBid),     cls: "green" },
            { l: "Cross-sell base value", v: fmtMoney(d.totals.crossSellBaseValue), cls: "green" },
            { l: "Overdue installs",      v: fmt(inst.overdue), cls: (inst.overdue > 100 ? "red" : "yellow") },
          ].map((k) => (
            <Kpi key={k.l} label={k.l} value={k.v} cls={k.cls as "red" | "yellow" | "green" | "blue" | ""} />
          ))}
        </div>
      </Panel>

      {/* SUPPLEMENT TRACKER */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Supplement Tracker — by carrier">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Carriers with active supplements in flight. Total job value of supplemented work shown to prioritize by stakes.
          </div>
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Carrier</th>
                  <th style={thNumStyle}>Active supps</th>
                  <th style={thNumStyle}>Job $ touched</th>
                  <th style={thStyle}>Status mix</th>
                </tr>
              </thead>
              <tbody>
                {(d.supplement.byCarrier ?? []).map((c) => (
                  <tr key={c.carrier}>
                    <td style={tdStyle}>{c.carrier}</td>
                    <td style={tdNumStyle}>{c.total}</td>
                    <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>{fmtMoney(c.totalValue)}</td>
                    <td style={tdStyle}>
                      {Object.entries(c.byStatus ?? {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([s, n]) => (
                          <span key={s} style={pillForSuppStatus(s)}>{s} {n}</span>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            Source: <code>supplementTrackerStatus</code> field on active jobs. "Post-install service" = supplement opened after install. "Pending Bid Approval" = waiting on internal sign-off.
          </div>
        </Panel>
      </div>

      {/* CROSS-SELL PIPELINE */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Cross-sell pipeline">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Active jobs with at least one additional bid open. Numbers below are <em>base job value</em> — the bid itself is incremental on top.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* By bid type */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>By bid type</div>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Bid</th>
                    <th style={thNumStyle}>Open</th>
                    <th style={thNumStyle}>PR</th>
                    <th style={thNumStyle}>Base job $</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.crossSell.summary ?? []).map((x) => (
                    <tr key={x.type}>
                      <td style={tdStyle}>{x.type}</td>
                      <td style={tdNumStyle}>{x.openBids}</td>
                      <td style={tdNumStyle}>{x.postRecheck}</td>
                      <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>{fmtMoney(x.baseJobValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* By carrier */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>By carrier</div>
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Carrier</th>
                      <th style={thNumStyle}>Jobs</th>
                      <th style={thNumStyle}>Base $</th>
                      <th style={thStyle}>Bids</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.crossSell.byCarrier ?? []).map((c) => (
                      <tr key={c.carrier}>
                        <td style={tdStyle}>{c.carrier}</td>
                        <td style={tdNumStyle}>{c.count}</td>
                        <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>{fmtMoney(c.baseJobValue)}</td>
                        <td style={tdStyle}>
                          {Object.entries(c.bidCounts ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .map(([b, n]) => (
                              <span
                                key={b}
                                style={{
                                  display: "inline-block",
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  background: "#342c23",
                                  color: "var(--riq-text-muted)",
                                  marginRight: 4,
                                }}
                              >
                                {b}:{n}
                              </span>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            PR = bid status "post-recheck" / "production-ready" (carrier or production sign-off received). Open includes both pre- and post-PR.
          </div>
        </Panel>
      </div>

      {/* INSTALL READINESS */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Install readiness">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
            Where the install backlog stands. <strong>Overdue</strong> = expected work start date is in the past but job isn't done.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            {[
              { l: "Ready for install",       v: fmt(inst.readyForInstallCount), cls: "green" },
              { l: "Scheduled",               v: fmt(inst.scheduledCount),       cls: "blue" },
              { l: "Starting this week",      v: fmt(inst.startingThisWeek),     cls: "green" },
              { l: "Starting next 30 days",   v: fmt(inst.startingNext30Days),   cls: "" },
              { l: "Overdue",                 v: fmt(inst.overdue), cls: inst.overdue > 100 ? "red" : "yellow" },
            ].map((k) => (
              <Kpi key={k.l} label={k.l} value={k.v} cls={k.cls as "red" | "yellow" | "green" | "blue" | ""} />
            ))}
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            Source: <code>readyForInstallJob</code> + <code>expectedWorkStartDate</code> on active jobs. Overdue jobs often have a legitimate reason — use as a triage list, not a punch list.
          </div>
        </Panel>
      </div>

      {/* PUBLIC ADJUSTERS */}
      {d.publicAdjustment && d.publicAdjustment.count > 0 && (
        <div style={{ marginTop: 16 }}>
          <Panel title="Public adjusters on active jobs">
            <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
              Active jobs flagged with a PA representing the homeowner.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <Kpi label="Active PA flags" value={fmt(d.publicAdjustment.count)} cls="blue" />
              {Object.entries(d.publicAdjustment.byStatus ?? {}).map(([s, n]) => (
                <Kpi key={s} label={s} value={n} />
              ))}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Fixes tab — GET /api/intel/fixes-summary
// ---------------------------------------------------------------------------

function FixesTab({ state, data }: { state: LoadState; data: FixesSummary | null }) {
  const [selRep, setSelRep] = useState<string | null>(null);
  const [repData, setRepData] = useState<FixesByRep | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  // Fetch in the click handler (not an effect) so we never set state synchronously in an effect.
  function selectRep(rep: string, employeeId: number | null) {
    setSelRep(rep);
    setRepLoading(true);
    setRepData(null);
    const param = employeeId != null ? String(employeeId) : rep; // employee_id = exact match; name = ILIKE fallback
    fetch(`/api/intel/fixes-by-rep?rep=${encodeURIComponent(param)}`, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<FixesByRep>; })
      .then(setRepData)
      .catch(() => setRepData(null))
      .finally(() => setRepLoading(false));
  }

  if (state !== "ok" || !data) return <TabPlaceholder state={state} label="Fixes" />;

  return (
    <>
      <Panel title="Fixes — open trade work across active jobs">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Outstanding fix items by trade, rep, and age. <strong>Open</strong> items are the backlog to clear.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Kpi label="Total fixes" value={fmt(data.total)} />
          <Kpi label="Open" value={fmt(data.open)} cls={data.open > 50 ? "red" : "yellow"} />
          <Kpi label="Completed" value={fmt(data.completed)} cls="green" />
        </div>
      </Panel>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* By trade */}
        <Panel title="By trade">
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Trade</th>
                <th style={thNumStyle}>Count</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_trade ?? []).map((t) => (
                <tr key={t.key}>
                  <td style={tdStyle}>{t.key}</td>
                  <td style={tdNumStyle}>{fmt(t.count)}</td>
                </tr>
              ))}
              {(data.by_trade ?? []).length === 0 && (
                <tr><td style={tdStyle} colSpan={2}>No open fixes by trade.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        {/* By age */}
        <Panel title="By age">
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Age bucket</th>
                <th style={thNumStyle}>Count</th>
              </tr>
            </thead>
            <tbody>
              {(data.by_age ?? []).map((a) => (
                <tr key={a.bucket}>
                  <td style={tdStyle}>{a.bucket}</td>
                  <td style={tdNumStyle}>{fmt(a.count)}</td>
                </tr>
              ))}
              {(data.by_age ?? []).length === 0 && (
                <tr><td style={tdStyle} colSpan={2}>No age data.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* By rep — click a row to drill into that rep's open fixes */}
      <div style={{ marginTop: 16 }}>
        <Panel title="By rep" action={<span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>click a rep to drill in</span>}>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rep</th>
                  <th style={thNumStyle}>Open</th>
                  <th style={thNumStyle}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_rep ?? []).map((r) => (
                  <tr key={r.rep} onClick={() => selectRep(r.rep, r.employee_id)} style={{ cursor: "pointer", background: selRep === r.rep ? "#3d342a" : undefined }}>
                    <td style={tdStyle}>{selRep === r.rep ? "▸ " : ""}{r.rep}</td>
                    <td style={{ ...tdNumStyle, color: r.open > 0 ? "#f59e0b" : "var(--riq-text-muted)" }}>{fmt(r.open)}</td>
                    <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmt(r.completed)}</td>
                  </tr>
                ))}
                {(data.by_rep ?? []).length === 0 && (
                  <tr><td style={tdStyle} colSpan={3}>No fixes by rep.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* Rep drill-down — fixes-by-rep */}
      {selRep && (
        <div style={{ marginTop: 16 }}>
          <Panel
            title={`Open fixes — ${selRep}${repData ? ` (${repData.count})` : ""}`}
            action={<span onClick={() => { setSelRep(null); setRepData(null); }} style={{ cursor: "pointer", fontSize: 12, color: "var(--riq-text-muted)" }}>✕ close</span>}
          >
            {repLoading ? (
              <div style={{ padding: 16, color: "var(--riq-accent)" }}>Loading…</div>
            ) : !repData || repData.open.length === 0 ? (
              <div style={{ padding: 16, color: "var(--riq-text-muted)" }}>No open fixes for this rep.</div>
            ) : (
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thNumStyle}>Job</th>
                      <th style={thStyle}>Trade</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Created</th>
                      <th style={thNumStyle}>Photos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repData.open.map((f) => (
                      <tr key={f.id}>
                        <td style={tdNumStyle}>{f.job_id ?? "—"}</td>
                        <td style={tdStyle}>{f.trade ?? "—"}</td>
                        <td style={tdStyle}>{f.description ?? "—"}</td>
                        <td style={tdStyle}>{(f.created_date ?? "").slice(0, 10) || "—"}</td>
                        <td style={tdNumStyle}>{f.photo_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tasks tab — GET /api/intel/tasks-overdue
// ---------------------------------------------------------------------------

function TasksTab({ state, data }: { state: LoadState; data: TasksOverdue | null }) {
  const [selRep, setSelRep] = useState<string | null>(null);
  const [repData, setRepData] = useState<TasksByRep | null>(null);
  const [repLoading, setRepLoading] = useState(false);

  function selectRep(rep: string, employeeId: number | null) {
    setSelRep(rep);
    setRepLoading(true);
    setRepData(null);
    const param = employeeId != null ? String(employeeId) : rep; // employee_id = exact match; name = ILIKE fallback
    fetch(`/api/intel/tasks-by-rep?rep=${encodeURIComponent(param)}`, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<TasksByRep>; })
      .then(setRepData)
      .catch(() => setRepData(null))
      .finally(() => setRepLoading(false));
  }

  if (state !== "ok" || !data) return <TabPlaceholder state={state} label="Tasks" />;

  return (
    <>
      <Panel title="Tasks — overdue across the team">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Open tasks past their due date. Triage by rep, then work the item list.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Kpi label="Total overdue" value={fmt(data.total_overdue)} cls={data.total_overdue > 0 ? "red" : "green"} />
        </div>
      </Panel>

      {/* By rep — click a row to drill into that rep's pending tasks */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Overdue by rep" action={<span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>click a rep to drill in</span>}>
          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rep</th>
                  <th style={thNumStyle}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {(data.by_rep ?? []).map((r) => (
                  <tr key={r.rep} onClick={() => selectRep(r.rep, r.employee_id)} style={{ cursor: "pointer", background: selRep === r.rep ? "#3d342a" : undefined }}>
                    <td style={tdStyle}>{selRep === r.rep ? "▸ " : ""}{r.rep}</td>
                    <td style={{ ...tdNumStyle, color: r.count > 0 ? "#ef4444" : "var(--riq-text-muted)" }}>{fmt(r.count)}</td>
                  </tr>
                ))}
                {(data.by_rep ?? []).length === 0 && (
                  <tr><td style={tdStyle} colSpan={2}>No overdue tasks by rep.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* Rep drill-down — tasks-by-rep (all pending for the rep; overdue is the subset) */}
      {selRep && (
        <div style={{ marginTop: 16 }}>
          <Panel
            title={`Pending tasks — ${selRep}${repData ? ` (${repData.overdue_count} overdue / ${repData.count})` : ""}`}
            action={<span onClick={() => { setSelRep(null); setRepData(null); }} style={{ cursor: "pointer", fontSize: 12, color: "var(--riq-text-muted)" }}>✕ close</span>}
          >
            {repLoading ? (
              <div style={{ padding: 16, color: "var(--riq-accent)" }}>Loading…</div>
            ) : !repData || repData.pending.length === 0 ? (
              <div style={{ padding: 16, color: "var(--riq-text-muted)" }}>No pending tasks for this rep.</div>
            ) : (
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Priority</th>
                      <th style={thStyle}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repData.pending.map((t) => (
                      <tr key={t.id}>
                        <td style={tdStyle}>{t.description ?? "—"}</td>
                        <td style={tdStyle}>{t.priority ?? "—"}</td>
                        <td style={tdStyle}>{(t.due_date ?? "").slice(0, 10) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* Items */}
      <div style={{ marginTop: 16 }}>
        <Panel title="Overdue items">
          <div style={{ maxHeight: 500, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Priority</th>
                  <th style={thStyle}>Due</th>
                  <th style={thStyle}>Rep</th>
                </tr>
              </thead>
              <tbody>
                {(data.items ?? []).map((t) => (
                  <tr key={t.id}>
                    <td style={tdStyle}>{t.description ?? "—"}</td>
                    <td style={tdStyle}>{t.priority ?? "—"}</td>
                    <td style={{ ...tdStyle, color: "#ef4444" }}>{(t.due_date ?? "").slice(0, 10) || "—"}</td>
                    <td style={tdStyle}>{t.rep ?? (t.employee_id != null ? `emp ${t.employee_id}` : "—")}</td>
                  </tr>
                ))}
                {(data.items ?? []).length === 0 && (
                  <tr><td style={tdStyle} colSpan={4}>No overdue items 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Punch List tab — GET /api/intel/punchlist-active
// ---------------------------------------------------------------------------

function PunchlistTab({ state, data }: { state: LoadState; data: PunchlistActive | null }) {
  if (state !== "ok" || !data) return <TabPlaceholder state={state} label="Punch List" />;

  const items = data.items ?? [];
  const remaining = items.filter((i) => !i.work_completed).length;

  return (
    <>
      <Panel title="Punch List — active items">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14, lineHeight: 1.5 }}>
          Active punch-list jobs and whether the work is marked complete.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Kpi label="Active punch items" value={fmt(data.total)} />
          <Kpi label="Work remaining" value={fmt(remaining)} cls={remaining > 0 ? "yellow" : "green"} />
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Panel title="Items">
          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>City</th>
                  <th style={thStyle}>State</th>
                  <th style={thNumStyle}>Status</th>
                  <th style={thNumStyle}>Substatus</th>
                  <th style={thStyle}>Work done</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td style={tdStyle}>{i.name ?? "—"}</td>
                    <td style={tdStyle}>{i.city ?? "—"}</td>
                    <td style={tdStyle}>{i.state ?? "—"}</td>
                    <td style={tdNumStyle}>{i.status_id ?? "—"}</td>
                    <td style={tdNumStyle}>{i.substatus_id ?? "—"}</td>
                    <td style={tdStyle}>
                      <span style={i.work_completed
                        ? { ...pillForSuppStatus("Finalized") }
                        : { ...pillForSuppStatus("Pending") }}>
                        {i.work_completed ? "Complete" : "Open"}
                      </span>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td style={tdStyle} colSpan={6}>No active punch-list items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
