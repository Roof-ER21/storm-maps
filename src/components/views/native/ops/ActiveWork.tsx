/**
 * Active Work — native React (Phase 2d batch3)
 *
 * Endpoint:
 *   GET /api/intel/active-work
 *   → {
 *       totals: { activeJobs, withOpenSupplement, withCrossSellBid, crossSellBaseValue },
 *       install: { overdue, scheduledCount, startingThisWeek, startingNext30Days, readyForInstallCount },
 *       supplement: { byStatus, byCarrier: [{ carrier, total, totalValue, byStatus }] },
 *       crossSell: {
 *         summary: [{ type, openBids, postRecheck, baseJobValue }],
 *         byCarrier: [{ carrier, count, baseJobValue, bidCounts }],
 *       },
 *       publicAdjustment: { count, byStatus },
 *     }
 */
import { useFetch, Panel, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response shapes (verified against live prod)
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
// Shared table styles
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ActiveWork({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const aw = useFetch<ActiveWorkResponse>("/api/intel/active-work");

  if (aw.loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      </div>
    );
  }

  if (aw.error || !aw.data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load: {aw.error}</div>
      </div>
    );
  }

  const d = aw.data;
  const inst = d.install;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

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
            <div key={k.l} style={kpiStyle(k.cls as "red"|"yellow"|"green"|"blue"|"")}>
              <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.l}</div>
              <div style={kpiValStyle(k.cls)}>{k.v}</div>
            </div>
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
              <div key={k.l} style={kpiStyle(k.cls as "red"|"yellow"|"green"|"blue"|"")}>
                <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.l}</div>
                <div style={kpiValStyle(k.cls)}>{k.v}</div>
              </div>
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
              <div style={kpiStyle("blue")}>
                <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Active PA flags</div>
                <div style={kpiValStyle("blue")}>{fmt(d.publicAdjustment.count)}</div>
              </div>
              {Object.entries(d.publicAdjustment.byStatus ?? {}).map(([s, n]) => (
                <div key={s} style={kpiStyle("")}>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s}</div>
                  <div style={kpiValStyle("")}>{n}</div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

    </div>
  );
}
