/**
 * Pipeline Intelligence — native React (Phase 2d batch1)
 * IntelView id: "pipeline-intel"
 *
 * Data: /api/intel/pipeline-intel (single endpoint, all data)
 *
 * Sections:
 *   1. Summary KPI strip
 *   2. Supplement signal split
 *   3. Stage bottleneck funnel (click-to-expand movers)
 *   4. Carrier DNA matrix (sortable)
 *   5. Seasonal patterns (inline bars)
 *   6. Velocity paradox (inline bars)
 *   7. What gets jobs moving (stuck-job movers grid)
 *   8. Automation trigger library
 *   9. Rep risk monitor
 *  10. Adjuster assignment signals
 *  11. Claim type impact
 */

import { useState, useMemo } from "react";
import { useFetch, KpiCard, CardRow, Panel, fmtPct } from "../../../homes/HomeCommon";
import type { NativeViewComponent } from "../types";

// ---------------------------------------------------------------------------
// Response shape (verified against /api/intel/pipeline-intel)
// ---------------------------------------------------------------------------
interface PipelineSummary {
  total: number;
  totalDead: number;
  totalActive: number;
  totalCompleted: number;
  repRiskCount: number;
  overallDeadRate: number;
  overallCompletionRate: number;
  biggestBottleneck: string;
  medianDaysToComplete: number;
  p90DaysToComplete: number;
  supplementImpactDelta: number;
  bestCarrier: string;
  worstCarrier: string;
  bestCarrierCompletionPct: number;
}

interface SuppImpactBranch {
  count: number;
  completedPct: number;
  completedCount: number;
}

interface SuppImpact {
  delta: number;
  withSupplement: SuppImpactBranch;
  withoutSupplement: SuppImpactBranch;
}

interface StageFunnelRow {
  stage: string;
  activeCount: number;
  avgDaysSigned: number;
  medDaysSigned: number;
  completionRateFromHere: number;
  [k: string]: unknown;
}

interface CarrierMatrixRow {
  carrier: string;
  total: number;
  deadPct: number;
  completedPct: number;
  supplementRate: number;
  medDaysToComplete: number;
  [k: string]: unknown;
}

interface StuckJobMover {
  stage: string;
  activeCount: number;
  avgDaysStuck: number;
  completionRateFromHere: number;
  insight: string;
  movers: { action: string; impact: string }[];
}

interface AdjusterSignals {
  total: number;
  withoutAdjuster: number;
  withNamedAdjuster: number;
  namedAdjusterDeadRate: number;
  unknownAdjusterDeadRate: number;
  namedAdjusterCompletionRate: number;
}

interface ClaimTypeImpactRow {
  claimType: string;
  count: number;
  completedPct: number;
  deadPct: number;
}

interface VelocityBucket {
  bucket: string;
  label: string;
  count: number;
  completedPct: number;
  deadPct: number;
  min: number;
  max: number;
}

interface SeasonalPattern {
  month: number;
  label: string;
  count: number;
  approvalRate: number;
  completedPct: number;
  deadPct: number;
  insJobs: number;
}

interface AutomationTrigger {
  trigger: string;
  action: string;
  basis: string;
  portalWorkflow: string;
  priority: string;
  impactedActiveJobs: number;
}

interface RepRiskFlag {
  rep: string;
  total: number;
  dead: number;
  completed: number;
  revenue: number;
  deadRate: number;
  completedRate: number;
  deadRevenue: number;
}

interface PipelineResponse {
  summary: PipelineSummary;
  suppImpact: SuppImpact;
  stageFunnel: StageFunnelRow[];
  carrierMatrix: CarrierMatrixRow[];
  stuckJobMovers: StuckJobMover[];
  adjusterSignals: AdjusterSignals;
  claimTypeImpact: ClaimTypeImpactRow[];
  velocityBuckets: VelocityBucket[];
  seasonalPatterns: SeasonalPattern[];
  automationTriggers: AutomationTrigger[];
  repRiskFlags: RepRiskFlag[];
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------
type SortDir = "asc" | "desc";

function pct(n: number | undefined | null): string {
  if (n == null) return "—";
  return fmtPct(n / 100);
}

function days(n: number | undefined | null): string {
  if (n == null) return "—";
  return `${Math.round(n)}d`;
}

function InlineBar({ value, max, color = "var(--riq-accent)" }: {
  value: number;
  max: number;
  color?: string;
}) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1,
        height: 8,
        background: "var(--riq-border)",
        borderRadius: 4,
        overflow: "hidden",
      }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--riq-text-muted)", minWidth: 30, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SuppSignal({ suppImpact }: { suppImpact: SuppImpact }) {
  const { withSupplement: ws, withoutSupplement: wo, delta } = suppImpact;
  return (
    <Panel title="Supplement Signal Split">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div style={{ textAlign: "center", padding: 16, background: "var(--riq-surface)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>With Supplement</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--riq-accent)" }}>
            {pct(ws.completedPct * 100)}
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>completion</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{ws.count.toLocaleString()} jobs</div>
        </div>
        <div style={{ textAlign: "center", padding: 16, background: "var(--riq-surface)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>Without Supplement</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ef4444" }}>
            {pct(wo.completedPct * 100)}
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>completion</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{wo.count.toLocaleString()} jobs</div>
        </div>
        <div style={{ textAlign: "center", padding: 16, background: "var(--riq-surface)", borderRadius: 8, border: "2px solid var(--riq-accent)" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>Impact Delta</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#22c55e" }}>
            +{pct(delta * 100)}
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>lift from supplementing</div>
        </div>
      </div>
    </Panel>
  );
}

function StageFunnelPanel({ funnel }: { funnel: StageFunnelRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxActive = Math.max(...funnel.map(r => r.activeCount), 1);
  return (
    <Panel title="Stage Bottleneck Map">
      <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginTop: 0, marginBottom: 12 }}>
        Click a stage to see what gets jobs moving.
      </p>
      {funnel.map(row => (
        <div key={row.stage} style={{ marginBottom: 8 }}>
          <div
            onClick={() => setExpanded(expanded === row.stage ? null : row.stage)}
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr 80px 80px 80px",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              background: "var(--riq-surface)",
              borderRadius: 6,
              cursor: "pointer",
              border: expanded === row.stage ? "1px solid var(--riq-accent)" : "1px solid var(--riq-border)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>{row.stage}</span>
            <InlineBar value={row.activeCount} max={maxActive} />
            <span style={{ fontSize: 12, color: "var(--riq-text-muted)", textAlign: "right" }}>
              {days(row.avgDaysSigned)} avg
            </span>
            <span style={{ fontSize: 12, color: "var(--riq-text-muted)", textAlign: "right" }}>
              {days(row.medDaysSigned)} med
            </span>
            <span style={{
              fontSize: 12,
              textAlign: "right",
              color: row.completionRateFromHere > 0.5 ? "#22c55e" : "#ef4444",
            }}>
              {pct(row.completionRateFromHere * 100)} done
            </span>
          </div>
        </div>
      ))}
    </Panel>
  );
}

type CarrierSortKey = keyof CarrierMatrixRow;

function CarrierDNA({ matrix }: { matrix: CarrierMatrixRow[] }) {
  const [sortKey, setSortKey] = useState<CarrierSortKey>("total");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(k: CarrierSortKey) {
    if (k === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...matrix].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [matrix, sortKey, sortDir]);

  function Th({ k, label }: { k: CarrierSortKey; label: string }) {
    const active = k === sortKey;
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{
          cursor: "pointer",
          padding: "8px 10px",
          textAlign: k === "carrier" ? "left" : "right",
          whiteSpace: "nowrap",
          fontSize: 12,
          fontWeight: active ? 700 : 500,
          color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
          background: "var(--riq-surface)",
          userSelect: "none",
        }}
      >
        {label}{active ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
      </th>
    );
  }

  return (
    <Panel title="Carrier DNA Matrix">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th k="carrier" label="Carrier" />
              <Th k="total" label="Jobs" />
              <Th k="completedPct" label="Completed %" />
              <Th k="deadPct" label="Dead %" />
              <Th k="supplementRate" label="Supp Rate" />
              <Th k="medDaysToComplete" label="Med Days" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.carrier}
                style={{
                  background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.carrier}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.total.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#22c55e" }}>
                  {pct(row.completedPct * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>
                  {pct(row.deadPct * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {pct(row.supplementRate * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {days(row.medDaysToComplete)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SeasonalPanel({ patterns }: { patterns: SeasonalPattern[] }) {
  const maxCount = Math.max(...patterns.map(p => p.count), 1);
  return (
    <Panel title="Seasonal Patterns">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Month", "Volume", "Jobs", "Ins %", "Done %", "Dead %"].map(h => (
                <th key={h} style={{
                  padding: "8px 10px",
                  textAlign: h === "Month" ? "left" : "right",
                  fontSize: 12,
                  color: "var(--riq-text-muted)",
                  background: "var(--riq-surface)",
                  fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {patterns.map((row, i) => (
              <tr
                key={row.month}
                style={{
                  background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.label}</td>
                <td style={{ padding: "7px 10px" }}>
                  <InlineBar value={row.count} max={maxCount} />
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.count.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {row.insJobs > 0 ? pct((row.insJobs / row.count) * 100) : "—"}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#22c55e" }}>
                  {pct(row.completedPct * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>
                  {pct(row.deadPct * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function VelocityParadox({ buckets }: { buckets: VelocityBucket[] }) {
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  return (
    <Panel title="Velocity Paradox">
      <p style={{ fontSize: 12, color: "var(--riq-text-muted)", marginTop: 0 }}>
        Fast signings don't always complete fastest — see where speed backfires.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Bucket", "Volume", "Jobs", "Done %", "Dead %"].map(h => (
                <th key={h} style={{
                  padding: "8px 10px",
                  textAlign: h === "Bucket" ? "left" : "right",
                  fontSize: 12,
                  color: "var(--riq-text-muted)",
                  background: "var(--riq-surface)",
                  fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((row, i) => (
              <tr
                key={row.bucket}
                style={{
                  background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.label}</td>
                <td style={{ padding: "7px 10px" }}>
                  <InlineBar value={row.count} max={maxCount} />
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.count.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#22c55e" }}>
                  {pct(row.completedPct * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>
                  {pct(row.deadPct * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function StuckJobMovers({ movers }: { movers: StuckJobMover[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Panel title="What Gets Jobs Moving">
      {movers.map(row => (
        <div key={row.stage} style={{ marginBottom: 12 }}>
          <div
            onClick={() => setExpanded(expanded === row.stage ? null : row.stage)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 14px",
              background: "var(--riq-surface)",
              borderRadius: 8,
              cursor: "pointer",
              border: expanded === row.stage ? "1px solid var(--riq-accent)" : "1px solid var(--riq-border)",
            }}
          >
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{row.stage}</span>
              <span style={{ marginLeft: 12, fontSize: 12, color: "var(--riq-text-muted)" }}>
                {row.activeCount} active · {days(row.avgDaysStuck)} avg stuck · {pct(row.completionRateFromHere * 100)} done from here
              </span>
            </div>
            <span style={{ color: "var(--riq-accent)", fontSize: 18 }}>
              {expanded === row.stage ? "▲" : "▼"}
            </span>
          </div>
          {expanded === row.stage && (
            <div style={{
              padding: "12px 16px",
              background: "var(--riq-bg)",
              border: "1px solid var(--riq-border)",
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
            }}>
              {row.insight && (
                <p style={{ fontSize: 13, color: "var(--riq-text-muted)", marginTop: 0, marginBottom: 10 }}>
                  {row.insight}
                </p>
              )}
              {row.movers.map((m, i) => (
                <div key={i} style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 10px",
                  marginBottom: 6,
                  background: "var(--riq-surface)",
                  borderRadius: 6,
                  borderLeft: "3px solid var(--riq-accent)",
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 200 }}>{m.action}</span>
                  <span style={{ fontSize: 13, color: "var(--riq-text-muted)" }}>{m.impact}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

function AutomationTriggers({ triggers }: { triggers: AutomationTrigger[] }) {
  return (
    <Panel title="Automation Trigger Library">
      {triggers.map((t, i) => (
        <div key={i} style={{
          padding: 14,
          marginBottom: 10,
          background: "var(--riq-surface)",
          borderRadius: 8,
          border: "1px solid var(--riq-border)",
          borderLeft: `3px solid ${t.priority === "high" ? "#ef4444" : t.priority === "medium" ? "#f59e0b" : "var(--riq-accent)"}`,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t.trigger}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 12,
                background: t.priority === "high" ? "#ef444420" : t.priority === "medium" ? "#f59e0b20" : "var(--riq-accent)20",
                color: t.priority === "high" ? "#ef4444" : t.priority === "medium" ? "#f59e0b" : "var(--riq-accent)",
                textTransform: "capitalize",
              }}>
                {t.priority}
              </span>
              <span style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>
                {t.impactedActiveJobs} jobs
              </span>
            </div>
          </div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            <strong>Action:</strong> {t.action}
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>
            <strong>Basis:</strong> {t.basis}
          </div>
          {t.portalWorkflow && (
            <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>
              <strong>Portal:</strong> {t.portalWorkflow}
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

function RepRiskMonitor({ reps }: { reps: RepRiskFlag[] }) {
  const [sortKey, setSortKey] = useState<keyof RepRiskFlag>("deadRate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(k: keyof RepRiskFlag) {
    if (k === sortKey) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...reps].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [reps, sortKey, sortDir]);

  function Th({ k, label }: { k: keyof RepRiskFlag; label: string }) {
    const active = k === sortKey;
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{
          cursor: "pointer",
          padding: "8px 10px",
          textAlign: k === "rep" ? "left" : "right",
          fontSize: 12,
          fontWeight: active ? 700 : 500,
          color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
          background: "var(--riq-surface)",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}{active ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
      </th>
    );
  }

  return (
    <Panel title="Rep Risk Monitor">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <Th k="rep" label="Rep" />
              <Th k="total" label="Total" />
              <Th k="dead" label="Dead" />
              <Th k="completed" label="Done" />
              <Th k="deadRate" label="Dead %" />
              <Th k="completedRate" label="Done %" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={row.rep}
                style={{
                  background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.rep}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.total.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.dead.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.completed.toLocaleString()}</td>
                <td style={{
                  padding: "7px 10px",
                  textAlign: "right",
                  color: row.deadRate > 0.3 ? "#ef4444" : row.deadRate > 0.2 ? "#f59e0b" : "inherit",
                  fontWeight: row.deadRate > 0.3 ? 700 : 400,
                }}>
                  {pct(row.deadRate * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#22c55e" }}>
                  {pct(row.completedRate * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function AdjusterSignalPanel({ adj }: { adj: AdjusterSignals }) {
  return (
    <Panel title="Adjuster Assignment Signals">
      <CardRow>
        <KpiCard label="Total Jobs" value={adj.total.toLocaleString()} />
        <KpiCard label="No Adjuster" value={adj.withoutAdjuster.toLocaleString()} />
        <KpiCard label="Named Adjuster" value={adj.withNamedAdjuster.toLocaleString()} />
      </CardRow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ padding: 14, background: "var(--riq-surface)", borderRadius: 8, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>Named Adjuster Dead %</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#ef4444" }}>
            {pct(adj.namedAdjusterDeadRate * 100)}
          </div>
        </div>
        <div style={{ padding: 14, background: "var(--riq-surface)", borderRadius: 8, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>Unknown Adjuster Dead %</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>
            {pct(adj.unknownAdjusterDeadRate * 100)}
          </div>
        </div>
        <div style={{ padding: 14, background: "var(--riq-surface)", borderRadius: 8, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 4 }}>Named Adjuster Done %</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#22c55e" }}>
            {pct(adj.namedAdjusterCompletionRate * 100)}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ClaimTypePanel({ rows }: { rows: ClaimTypeImpactRow[] }) {
  const maxCount = Math.max(...rows.map(r => r.count), 1);
  return (
    <Panel title="Claim Type Impact">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Claim Type", "Volume", "Count", "Done %", "Dead %"].map(h => (
                <th key={h} style={{
                  padding: "8px 10px",
                  textAlign: h === "Claim Type" ? "left" : "right",
                  fontSize: 12,
                  color: "var(--riq-text-muted)",
                  background: "var(--riq-surface)",
                  fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.claimType}
                style={{
                  background: i % 2 === 0 ? "transparent" : "var(--riq-surface)",
                  borderBottom: "1px solid var(--riq-border)",
                }}
              >
                <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.claimType || "Unknown"}</td>
                <td style={{ padding: "7px 10px" }}>
                  <InlineBar value={row.count} max={maxCount} />
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>{row.count.toLocaleString()}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#22c55e" }}>
                  {pct(row.completedPct * 100)}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "#ef4444" }}>
                  {pct(row.deadPct * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export const Pipeline: NativeViewComponent = function Pipeline({ navigate: _navigate }) {
  const { data, loading, error } = useFetch<PipelineResponse>("/api/intel/pipeline-intel");

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", color: "var(--riq-text-muted)" }}>
        Loading pipeline intelligence…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div style={{ padding: "20px 24px", color: "#ef4444" }}>
        Failed to load pipeline intelligence: {error ?? "No data"}
      </div>
    );
  }

  const { summary, suppImpact, stageFunnel, carrierMatrix, stuckJobMovers,
    adjusterSignals, claimTypeImpact, velocityBuckets, seasonalPatterns,
    automationTriggers, repRiskFlags } = data;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {/* Summary KPIs */}
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700 }}>Pipeline Intelligence</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--riq-text-muted)" }}>
          Completion patterns, bottlenecks, carrier DNA, and actionable movers.
        </p>
      </div>

      <CardRow>
        <KpiCard label="Total Jobs" value={summary.total.toLocaleString()} />
        <KpiCard label="Active" value={summary.totalActive.toLocaleString()} />
        <KpiCard label="Completed" value={summary.totalCompleted.toLocaleString()} />
        <KpiCard label="Dead" value={summary.totalDead.toLocaleString()} hint={pct(summary.overallDeadRate * 100) + " dead rate"} />
      </CardRow>

      <div style={{ marginTop: 12 }}><CardRow>
        <KpiCard label="Completion Rate" value={pct(summary.overallCompletionRate * 100)} />
        <KpiCard label="Median Days" value={days(summary.medianDaysToComplete)} />
        <KpiCard label="P90 Days" value={days(summary.p90DaysToComplete)} />
        <KpiCard label="Rep Risk Flags" value={summary.repRiskCount.toLocaleString()} />
      </CardRow></div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16, marginTop: 12 }}>
        <div style={{ padding: 14, background: "var(--riq-surface)", borderRadius: 8, border: "1px solid var(--riq-border)" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Biggest Bottleneck</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{summary.biggestBottleneck}</div>
        </div>
        <div style={{ padding: 14, background: "var(--riq-surface)", borderRadius: 8, border: "1px solid var(--riq-border)" }}>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Best Carrier</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: "#22c55e" }}>
            {summary.bestCarrier} <span style={{ fontSize: 13, fontWeight: 400 }}>
              ({pct(summary.bestCarrierCompletionPct * 100)})
            </span>
          </div>
        </div>
      </div>

      <SuppSignal suppImpact={suppImpact} />
      <StageFunnelPanel funnel={stageFunnel} />
      <CarrierDNA matrix={carrierMatrix} />
      <SeasonalPanel patterns={seasonalPatterns} />
      <VelocityParadox buckets={velocityBuckets} />
      <StuckJobMovers movers={stuckJobMovers} />
      <AutomationTriggers triggers={automationTriggers} />
      <RepRiskMonitor reps={repRiskFlags} />
      <AdjusterSignalPanel adj={adjusterSignals} />
      <ClaimTypePanel rows={claimTypeImpact} />
    </div>
  );
};
