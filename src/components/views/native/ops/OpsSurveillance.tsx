/**
 * Ops Surveillance — native React (Phase 2d batch3)
 *
 * Endpoints:
 *   GET /api/intel/active-work
 *     → { totals, install, crossSell, supplement, publicAdjustment, generated }
 *   GET /api/intel/adjustments-open  (fire-and-forget, PA section)
 *     → { adjustments: AdjustmentRow[] }
 */
import {
  useFetch,
  KpiCard,
  CardRow,
  Panel,
  fmtMoney,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response shapes (verified against live prod)
// ---------------------------------------------------------------------------

interface ActiveWorkTotals {
  activeJobs: number;
  withCrossSellBid: number;
  crossSellBaseValue: number;
  withOpenSupplement: number;
}

interface InstallData {
  overdue: number;
  scheduledCount: number;
  startingThisWeek: number;
  startingNext30Days: number;
  readyForInstallCount: number;
}

interface CrossSellSummaryItem {
  type: string;
  openBids: number;
  postRecheck: number;
  baseJobValue: number;
}

interface CrossSellByCarrierItem {
  carrier: string;
  count: number;
  baseJobValue: number;
  bidCounts: Record<string, number>;
}

interface SupplementByCarrierItem {
  carrier: string;
  total: number;
  totalValue: number;
  byStatus: Record<string, number>;
}

interface PublicAdjustmentData {
  count: number;
  byStatus: Record<string, number>;
}

interface ActiveWorkResponse {
  totals: ActiveWorkTotals;
  install: InstallData;
  crossSell: {
    summary: CrossSellSummaryItem[];
    byCarrier: CrossSellByCarrierItem[];
  };
  supplement: {
    byStatus: Record<string, number>;
    byCarrier: SupplementByCarrierItem[];
  };
  publicAdjustment: PublicAdjustmentData;
}

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
  padding: "5px 10px",
  background: "rgba(0,0,0,0.15)",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "middle",
  fontSize: 12,
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Number(n).toLocaleString();
}

function pillClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("finalized") || l.includes("confirmed")) return "green";
  if (l.includes("post-install") || l.includes("sent")) return "blue";
  if (l.includes("pending") || l.includes("revised") || l.includes("assigned")) return "yellow";
  if (l.includes("overdue") || l.includes("partial")) return "red";
  return "purple";
}

function pillStyle(cls: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 700,
  };
  const map: Record<string, React.CSSProperties> = {
    green: { background: "rgba(16,185,129,0.15)", color: "#10b981" },
    blue:  { background: "rgba(96,165,250,0.15)", color: "#60a5fa" },
    yellow:{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" },
    red:   { background: "rgba(239,68,68,0.15)",  color: "#ef4444" },
    purple:{ background: "rgba(167,139,250,0.15)",color: "#a78bfa" },
  };
  return { ...base, ...(map[cls] ?? map.purple) };
}

// ---------------------------------------------------------------------------
// FunnelRow
// ---------------------------------------------------------------------------

function FunnelRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 6 }}>
      <span style={{ width: 140, color: "var(--riq-text-muted)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          flex: 1,
          background: "var(--riq-border)",
          borderRadius: 3,
          height: 16,
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            borderRadius: 3,
            background: color,
            width: `${pct}%`,
          }}
        />
      </span>
      <span style={{ width: 60, textAlign: "right", fontWeight: 700, color, flexShrink: 0 }}>
        {fmt(value)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const SUPP_ORDER = [
  "Finalized",
  "Post-install service",
  "Sent",
  "Confirmed Receipt",
  "Assigned",
  "Revised Pending",
  "Pending Bid Approval",
  "Pending Bids",
] as const;

const SUPP_COLORS: Record<string, string> = {
  Finalized: "#10b981",
  "Post-install service": "#60a5fa",
  Sent: "#f4a738",
  "Confirmed Receipt": "#60a5fa",
  Assigned: "#f59e0b",
  "Revised Pending": "#ef4444",
  "Pending Bid Approval": "#f59e0b",
  "Pending Bids": "#a09486",
};

const STAGE_URGENCY: Record<string, string> = {
  "Partial Approval": "red",
  "Decision Pending": "yellow",
  "Legal/Pending": "red",
  "Adjuster Meeting": "yellow",
  "Reinspection Pending": "yellow",
  Appraisal: "yellow",
  "Quality Check": "yellow",
  "Post-Install Service": "blue",
  "Wrap-up": "blue",
  "Schedule Pending": "yellow",
  "Project Meeting": "blue",
  Downpayment: "green",
  Scheduled: "green",
  "Balance Pending": "green",
  "Warranty/Review": "blue",
  "Pending PA": "yellow",
  "PA Result Pending": "red",
};

const ACTIVE_STAGES: [string, number][] = [
  ["Partial Approval", 269],
  ["Decision Pending", 233],
  ["Adjuster Meeting", 367],
  ["Reinspection Pending", 20],
  ["Legal/Pending", 97],
  ["Appraisal", 30],
  ["Schedule Pending", 126],
  ["Quality Check", 34],
  ["Wrap-up", 57],
  ["Post-Install Service", 10],
  ["Downpayment", 61],
  ["Scheduled", 58],
  ["Balance Pending", 155],
  ["Warranty/Review", 21],
  ["Pending Approval", 245],
];

const APPROVAL_QUEUE = [
  { stage: "Partial Approval",  count: 269, cls: "red",    note: "Supplement or re-inspect each one" },
  { stage: "Pending Approval",  count: 245, cls: "yellow", note: "Carrier decision pending" },
  { stage: "Decision Pending",  count: 233, cls: "yellow", note: "Homeowner deciding" },
  { stage: "Legal/Pending",     count: 97,  cls: "red",    note: "Legal hold — review weekly" },
  { stage: "Adjuster Meeting",  count: 367, cls: "yellow", note: "Adjuster visit scheduled/pending" },
  { stage: "Balance Pending",   count: 155, cls: "blue",   note: "Awaiting final payment" },
];

export function OpsSurveillance({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const aw = useFetch<ActiveWorkResponse>("/api/intel/active-work");

  if (aw.loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 60, textAlign: "center", color: "var(--riq-text-muted)" }}>
          Loading ops data…
        </div>
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
  const totals = d.totals;
  const inst = d.install;
  const supp = d.supplement;
  const cs = d.crossSell;
  const pa = d.publicAdjustment;

  const instTotal = (inst.readyForInstallCount ?? 0) + (inst.scheduledCount ?? 0) + (inst.overdue ?? 0);
  const suppByStatus = supp.byStatus ?? {};
  const suppTotal = Object.values(suppByStatus).reduce((a, b) => a + b, 0);

  // Carrier supp top 8 by totalValue
  const carrierSupp = [...(supp.byCarrier ?? [])]
    .sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0))
    .slice(0, 8);

  // Cross-sell totals
  const csTotal = (cs.summary ?? []).reduce((s, c) => s + (c.baseJobValue ?? 0), 0);

  const queueTotal = APPROVAL_QUEUE.reduce((s, q) => s + q.count, 0);

  const stageColor = (cls: string) =>
    cls === "red" ? "#ef4444" : cls === "yellow" ? "#f59e0b" : cls === "green" ? "#10b981" : cls === "blue" ? "#60a5fa" : "var(--riq-text)";

  const calloutStyle = (cls: "red" | "yellow" | "green" | "blue"): React.CSSProperties => {
    const map = {
      red:    { background: "rgba(239,68,68,0.08)",  border: "1px solid rgba(239,68,68,0.25)" },
      yellow: { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" },
      green:  { background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" },
      blue:   { background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)" },
    };
    return { ...map[cls], borderRadius: 6, padding: "10px 14px", fontSize: 12, lineHeight: 1.5, marginTop: 8 };
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>

      {/* TOP KPIs */}
      <CardRow>
        <KpiCard label="Active Jobs" value={fmt(totals.activeJobs)} />
        <KpiCard label="Overdue Installs" value={fmt(inst.overdue)} emphasis />
        <KpiCard label="Ready for Install" value={fmt(inst.readyForInstallCount)} hint={`${fmt(inst.scheduledCount)} scheduled`} />
        <KpiCard label="Open Supplements" value={fmt(totals.withOpenSupplement)} />
        <KpiCard label="Cross-Sell Bids" value={fmt(totals.withCrossSellBid)} hint={fmtMoney(totals.crossSellBaseValue) + " base value"} />
        <KpiCard label="PA Cases" value={fmt(pa.count)} />
      </CardRow>

      {/* INSTALL PIPELINE + SUPPLEMENT PIPELINE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Install Pipeline">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            Jobs signed and moving toward installation.
          </div>
          <FunnelRow label="Ready for Install" value={inst.readyForInstallCount ?? 0} total={instTotal} color="#f59e0b" />
          <FunnelRow label="Scheduled"         value={inst.scheduledCount ?? 0}        total={instTotal} color="#10b981" />
          <FunnelRow label="Overdue"            value={inst.overdue ?? 0}               total={instTotal} color="#ef4444" />
          <FunnelRow label="Starting This Week" value={inst.startingThisWeek ?? 0}      total={Math.max(1, (inst.startingThisWeek ?? 0) + (inst.startingNext30Days ?? 0))} color="#60a5fa" />
          <div style={calloutStyle("red")}>
            <strong>{fmt(inst.overdue)} overdue jobs</strong> — homeowners waiting. Each is a cancellation risk.
          </div>
        </Panel>

        <Panel title="Supplement Pipeline">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            Active supplements by status. Finalized = resolved; everything else needs action.
          </div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Status</th>
                <th style={thNumStyle}>Count</th>
                <th style={thNumStyle}>% Total</th>
              </tr>
            </thead>
            <tbody>
              {SUPP_ORDER.map((s) => {
                const v = suppByStatus[s];
                if (!v) return null;
                const pct = Math.round((v / suppTotal) * 100);
                const needsAction = ["Assigned", "Revised Pending", "Sent", "Pending Bid Approval", "Pending Bids"].includes(s);
                return (
                  <tr key={s}>
                    <td style={tdStyle}>{needsAction ? <strong>{s}</strong> : s}</td>
                    <td style={tdNumStyle}>
                      <span style={pillStyle(pillClass(s))}>{v}</span>
                    </td>
                    <td style={{ ...tdNumStyle, color: "var(--riq-text-muted)" }}>{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={calloutStyle("yellow")}>
            <strong>Needs action:</strong> Assigned ({suppByStatus.Assigned ?? 0}) + Revised Pending ({suppByStatus["Revised Pending"] ?? 0}) + Sent ({suppByStatus.Sent ?? 0}) + Pending Bids ({suppByStatus["Pending Bids"] ?? 0}) require active carrier follow-up.
          </div>
        </Panel>
      </div>

      {/* STAGE GRID + APPROVAL QUEUE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Active Job Stage Breakdown">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10 }}>
            Where your {fmt(totals.activeJobs)} active jobs currently sit.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {ACTIVE_STAGES.map(([s, c]) => {
              const cls = STAGE_URGENCY[s] ?? "";
              return (
                <div key={s} style={{ background: "#342c23", borderRadius: 5, padding: "8px 10px", fontSize: 11 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: stageColor(cls) }}>
                    {fmt(c)}
                  </div>
                  <div style={{ color: "var(--riq-text-muted)", marginTop: 2, fontSize: 10 }}>{s}</div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Approval Queue — Needs Push">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            {fmt(queueTotal)} total jobs in queue stages. These need adjuster follow-up or re-inspection.
          </div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Stage</th>
                <th style={thNumStyle}>Count</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {APPROVAL_QUEUE.map((q) => (
                <tr key={q.stage}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{q.stage}</td>
                  <td style={tdNumStyle}>
                    <span style={pillStyle(q.cls)}>{fmt(q.count)}</span>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--riq-text-muted)" }}>{q.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={calloutStyle("yellow")}>
            <strong>Partial Approval ({suppByStatus["Partial Approval"] ?? 269} jobs)</strong> means carrier approved some but not all trades. Each needs a supplement request or re-inspection. Run through the Denial Analyzer first.
          </div>
        </Panel>
      </div>

      {/* CROSS-SELL + SUPPLEMENT BY CARRIER */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Cross-Sell Bids Open">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            {fmt(totals.withCrossSellBid)} jobs with open additional-trade bids. {fmtMoney(csTotal)} total base value.
          </div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Type</th>
                <th style={thNumStyle}>Open Bids</th>
                <th style={thNumStyle}>Post-Recheck</th>
                <th style={thNumStyle}>Base Value</th>
              </tr>
            </thead>
            <tbody>
              {(cs.summary ?? []).map((c) => (
                <tr key={c.type}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{c.type}</td>
                  <td style={tdNumStyle}>
                    <span style={pillStyle("purple")}>{c.openBids ?? 0}</span>
                  </td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-text-muted)" }}>{c.postRecheck ?? 0}</td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>{fmtMoney(c.baseJobValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={calloutStyle("green")}>
            Closing open cross-sell bids adds {fmtMoney(csTotal)} to revenue without new acquisition cost.
          </div>
        </Panel>

        <Panel title="Supplement by Carrier (Top 8)">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            Value of open supplements per carrier. Sorted by total supplement value.
          </div>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Carrier</th>
                <th style={thNumStyle}>Total</th>
                <th style={thNumStyle}>Value</th>
                <th style={thNumStyle}>Finalized</th>
                <th style={thNumStyle}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {carrierSupp.map((c) => {
                const pending =
                  (c.byStatus?.Sent ?? 0) +
                  (c.byStatus?.Assigned ?? 0) +
                  (c.byStatus?.["Revised Pending"] ?? 0) +
                  (c.byStatus?.["Confirmed Receipt"] ?? 0);
                return (
                  <tr key={c.carrier}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{c.carrier}</td>
                    <td style={tdNumStyle}>{fmt(c.total)}</td>
                    <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>{fmtMoney(c.totalValue)}</td>
                    <td style={tdNumStyle}>
                      <span style={pillStyle("green")}>{c.byStatus?.Finalized ?? 0}</span>
                    </td>
                    <td style={tdNumStyle}>
                      <span style={pillStyle(pending > 10 ? "red" : "yellow")}>{pending}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* SUPPLEMENT STATUS FUNNEL */}
      <div style={{ marginTop: 14 }}>
        <Panel title="Supplement Status Funnel">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10 }}>
            {fmt(suppTotal)} active supplements across 8 statuses. Assigned + Revised Pending + Sent = active negotiation.
          </div>
          {SUPP_ORDER.map((s) => {
            const v = suppByStatus[s] ?? 0;
            if (!v) return null;
            const pct = Math.round((v / suppTotal) * 100);
            const color = SUPP_COLORS[s] ?? "var(--riq-text-muted)";
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, marginBottom: 6 }}>
                <span style={{ width: 180, color: "var(--riq-text-muted)", flexShrink: 0 }}>{s}</span>
                <span style={{ flex: 1, background: "var(--riq-border)", borderRadius: 3, height: 16, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", borderRadius: 3, background: color, width: `${pct}%` }} />
                </span>
                <span style={{ width: 50, textAlign: "right", fontWeight: 700, color, flexShrink: 0 }}>{v}</span>
                <span style={{ width: 40, textAlign: "right", color: "var(--riq-text-muted)", fontSize: 11, flexShrink: 0 }}>{pct}%</span>
              </div>
            );
          })}
        </Panel>
      </div>

      {/* PA + OVERDUE + QUICK NUMBERS */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        <Panel title="Public Adjustment">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10 }}>
            Jobs where a PA has been engaged.
          </div>
          {pa.count > 0 ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--riq-accent)", marginBottom: 4 }}>
                {pa.count}
              </div>
              <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10 }}>
                Public adjustment cases active
              </div>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Status</th>
                    <th style={thNumStyle}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pa.byStatus ?? {}).map(([s, c]) => (
                    <tr key={s}>
                      <td style={tdStyle}>{s}</td>
                      <td style={tdNumStyle}>{c}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={calloutStyle("blue")}>
                PA cases require close coordination with the assigned adjuster and legal. Review weekly.
              </div>
            </>
          ) : (
            <div style={{ color: "var(--riq-text-muted)", fontSize: 13, padding: "20px 0" }}>
              No active PA cases.
            </div>
          )}
        </Panel>

        <Panel title="Overdue Installs — Action Required">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            {fmt(inst.overdue)} jobs past expected install date.
          </div>
          <div style={calloutStyle("red")}>
            <strong>{fmt(inst.overdue)} jobs are past expected start date.</strong> Ops team needs to contact homeowners and reschedule. Each day delayed risks losing the job.
          </div>
          <div style={calloutStyle("yellow")}>
            {fmt(inst.startingThisWeek)} starting this week, {fmt(inst.startingNext30Days)} starting in next 30 days. Those are correctly pipelined — focus overdue effort on the {fmt(inst.overdue)}.
          </div>
        </Panel>

        <Panel title="Quick Numbers">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
            Snapshot from active-work data.
          </div>
          {[
            ["Active Jobs",       totals.activeJobs,          ""],
            ["Open Supplements",  totals.withOpenSupplement,   "red"],
            ["Ready for Install", inst.readyForInstallCount,   "green"],
            ["Scheduled",         inst.scheduledCount,          "blue"],
            ["Overdue Installs",  inst.overdue,                 "red"],
            ["Starting This Week",inst.startingThisWeek,        "yellow"],
            ["Cross-Sell Bids",   totals.withCrossSellBid,      "purple"],
            ["PA Cases",          pa.count,                     ""],
          ].map(([l, v, c]) => (
            <div
              key={String(l)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "5px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                fontSize: 12,
              }}
            >
              <span style={{ color: "var(--riq-text-muted)" }}>{l}</span>
              <span style={pillStyle(String(c) || "purple")}>{fmt(v as number)}</span>
            </div>
          ))}
        </Panel>
      </div>

    </div>
  );
}
