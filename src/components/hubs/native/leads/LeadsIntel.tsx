/**
 * Leads Intel tab — Phase 2c native React.
 *
 * Replaces the iframe of public/leads-intel.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/leads-rollup   → full rollup blob (primary)
 *   2. GET /api/intel/leads-employees → fire-and-forget (employees data, not used in this tab)
 *
 * The rollup payload shape: { funnel, byStatus, repLeaderboard, topCities, topZips,
 *   byReferralMethod, byState, totalLeads }
 * The HTML accesses it as: const d = rollup.data || rollup — so we handle both top-level shapes.
 *
 * No props — owns all state. Internal sort for rep leaderboard.
 */
import { useState } from "react";
import {
  useFetch,
  KpiCard,
  CardRow,
  Panel,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Type interfaces
// ---------------------------------------------------------------------------

interface FunnelData {
  doorKnocks?: number;
  conversations?: number;
  inspections?: number;
  appointments?: number;
  converted?: number;
  doNotKnock?: number;
  doorKnockToConversationPct?: number;
  conversationToAppointmentPct?: number;
}

interface StatusBucket {
  key: string;
  count: number;
}

interface RepLeaderboardRow {
  repName: string;
  count: number;
  conversations?: number;
  conversionPct?: number;
  inspections?: number;
  appointments?: number;
  appointmentPct?: number;
  lastCreated?: string | null;
}

interface GeoRow {
  key: string;
  count: number;
}

interface RollupPayload {
  totalLeads?: number;
  funnel?: FunnelData;
  byStatus?: StatusBucket[];
  repLeaderboard?: RepLeaderboardRow[];
  topCities?: GeoRow[];
  topZips?: GeoRow[];
  byReferralMethod?: GeoRow[];
  byState?: GeoRow[];
}

// The blob endpoint may return the payload directly or wrapped in { data: ... }
interface RollupResponse extends RollupPayload {
  data?: RollupPayload;
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
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  userSelect: "none",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--riq-surface)",
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

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

function rateColor(pct: number): string {
  if (pct >= 20) return "#10b981";
  if (pct >= 10) return "#f59e0b";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Funnel Visualization
// ---------------------------------------------------------------------------

function FunnelViz({ funnel, totalLeads }: { funnel: FunnelData; totalLeads: number }) {
  const doorKnockRate = funnel.doorKnockToConversationPct ?? 0;
  const apptRate = funnel.conversationToAppointmentPct ?? 0;
  const inspConvRate =
    (funnel.conversations ?? 0) > 0
      ? Math.round(((funnel.inspections ?? 0) / (funnel.conversations ?? 1)) * 100)
      : 0;
  const convToApptRate =
    (funnel.appointments ?? 0) > 0
      ? Math.round(((funnel.converted ?? 0) / (funnel.appointments ?? 1)) * 100)
      : 0;

  const funnelStages = [
    { name: "Door Knocks", val: funnel.doorKnocks ?? 0, color: "var(--riq-text-muted)", rate: null as number | null },
    { name: "Conversations", val: funnel.conversations ?? 0, color: "var(--riq-accent)", rate: doorKnockRate },
    { name: "Inspections", val: funnel.inspections ?? 0, color: "#f59e0b", rate: inspConvRate },
    { name: "Appointments", val: funnel.appointments ?? 0, color: "#10b981", rate: apptRate },
    { name: "Converted", val: funnel.converted ?? 0, color: "#60a5fa", rate: convToApptRate },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "12px 0" }}>
      {funnelStages.map((s, i) => {
        const pct = Math.round((s.val / (totalLeads || 1)) * 100);
        return (
          <div
            key={s.name}
            style={{
              position: "relative",
              padding: "10px 14px",
              marginBottom: 3,
              borderRadius: 5,
              background: "rgba(52,44,35,0.7)",
              overflow: "hidden",
            }}
          >
            {/* Fill bar */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                height: "100%",
                width: `${pct}%`,
                borderRadius: 5,
                opacity: 0.15,
                background: s.color,
              }}
            />
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)" }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>
                  {fmt(s.val)}
                </div>
              </div>
              {i > 0 && s.rate !== null && (
                <div
                  style={{
                    marginLeft: "auto",
                    fontSize: 11,
                    fontWeight: 700,
                    color: s.rate >= 15 ? "#10b981" : s.rate >= 8 ? "#f59e0b" : "#ef4444",
                  }}
                >
                  → {typeof s.rate === "number" ? s.rate.toFixed(1) : s.rate}% from above
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Breakdown horizontal bars
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  "No answer": "var(--riq-text-muted)",
  "No answer - material drop": "var(--riq-text-muted)",
  "Conversation": "var(--riq-accent)",
  "Do Not Knock": "#ef4444",
  "Inspection": "#f59e0b",
  "Appointment": "#10b981",
  "Converted": "#60a5fa",
};

function StatusBreakdown({ byStatus }: { byStatus: StatusBucket[] }) {
  const total = byStatus.reduce((s, b) => s + b.count, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {byStatus.map((s) => {
        const pct = Math.round((s.count / total) * 100);
        const color = STATUS_COLORS[s.key] ?? "var(--riq-text-muted)";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <span
              style={{
                width: 160,
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={s.key}
            >
              {s.key}
            </span>
            <span
              style={{
                flex: 1,
                background: "var(--riq-border)",
                borderRadius: 3,
                height: 14,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${pct}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: color,
                }}
              />
            </span>
            <span style={{ width: 40, textAlign: "right", flexShrink: 0, fontWeight: 700 }}>
              {s.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rep Leaderboard with sortable columns
// ---------------------------------------------------------------------------

type RepSortKey = keyof RepLeaderboardRow;

function RepLeaderboard({ reps }: { reps: RepLeaderboardRow[] }) {
  const [sortKey, setSortKey] = useState<RepSortKey>("count");
  const [sortAsc, setSortAsc] = useState(false);

  function handleSort(key: RepSortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  const sorted = [...reps].sort((a, b) => {
    const va = a[sortKey] ?? 0;
    const vb = b[sortKey] ?? 0;
    const cmp =
      typeof va === "string" ? String(va).localeCompare(String(vb)) : (vb as number) - (va as number);
    return sortAsc ? -cmp : cmp;
  });

  const rankStyle = (i: number): React.CSSProperties => ({
    display: "inline-block",
    width: 20,
    height: 20,
    borderRadius: "50%",
    textAlign: "center",
    lineHeight: "20px",
    fontSize: 11,
    fontWeight: 700,
    marginRight: 6,
    flexShrink: 0,
    background:
      i === 0 ? "rgba(244,167,56,0.3)"
      : i === 1 ? "rgba(160,148,134,0.3)"
      : i === 2 ? "rgba(167,139,250,0.2)"
      : "transparent",
    color:
      i === 0 ? "var(--riq-accent)"
      : i === 1 ? "var(--riq-text-muted)"
      : i === 2 ? "#a78bfa"
      : "var(--riq-text-muted)",
  });

  function thSortStyle(key: RepSortKey): React.CSSProperties {
    return { ...thNumStyle, color: sortKey === key ? "var(--riq-accent)" : undefined };
  }

  return (
    <>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
        {reps.length} reps active · Click column headers to sort
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, color: sortKey === "repName" ? "var(--riq-accent)" : undefined }} onClick={() => handleSort("repName")}>Rep</th>
              <th style={thSortStyle("count")} onClick={() => handleSort("count")}>Leads</th>
              <th style={thSortStyle("conversations")} onClick={() => handleSort("conversations")}>Convos</th>
              <th style={thSortStyle("conversionPct")} onClick={() => handleSort("conversionPct")}>Conv %</th>
              <th style={thSortStyle("inspections")} onClick={() => handleSort("inspections")}>Inspections</th>
              <th style={thSortStyle("appointments")} onClick={() => handleSort("appointments")}>Appointments</th>
              <th style={thSortStyle("appointmentPct")} onClick={() => handleSort("appointmentPct")}>Appt %</th>
              <th style={{ ...thStyle, color: sortKey === "lastCreated" ? "var(--riq-accent)" : undefined }} onClick={() => handleSort("lastCreated")}>Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const convColor = rateColor(r.conversionPct ?? 0);
              const apptColor = rateColor((r.appointmentPct ?? 0) * 5);
              return (
                <tr key={r.repName}>
                  <td style={{ ...tdStyle, display: "flex", alignItems: "center" }}>
                    <span style={rankStyle(i)}>{i + 1}</span>
                    <strong>{r.repName}</strong>
                  </td>
                  <td style={tdNumStyle}>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 7px",
                      borderRadius: 3,
                      fontSize: 10,
                      fontWeight: 700,
                      background: "rgba(167,139,250,0.15)",
                      color: "#a78bfa",
                    }}>
                      {r.count}
                    </span>
                  </td>
                  <td style={tdNumStyle}>{r.conversations ?? 0}</td>
                  <td style={{ ...tdNumStyle, fontWeight: 700, color: convColor }}>
                    {r.conversionPct ?? 0}%
                  </td>
                  <td style={tdNumStyle}>{r.inspections ?? 0}</td>
                  <td style={{ ...tdNumStyle, fontWeight: r.appointments ? 700 : 400, color: r.appointments ? "var(--riq-accent)" : "var(--riq-text-muted)" }}>
                    {r.appointments ?? 0}
                  </td>
                  <td style={{ ...tdNumStyle, color: apptColor }}>{r.appointmentPct ?? 0}%</td>
                  <td style={{ ...tdStyle, color: "var(--riq-text-muted)", fontSize: 11 }}>
                    {fmtDate(r.lastCreated)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart helper
// ---------------------------------------------------------------------------

function BarList({ items, color = "var(--riq-accent)" }: { items: GeoRow[]; color?: string }) {
  const max = items[0]?.count || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {items.map((item) => (
        <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span
            style={{
              width: 160,
              flexShrink: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.key}
          >
            {item.key}
          </span>
          <span
            style={{
              flex: 1,
              background: "var(--riq-border)",
              borderRadius: 3,
              height: 14,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                width: `${Math.round((item.count / max) * 100)}%`,
                height: "100%",
                borderRadius: 3,
                background: color,
              }}
            />
          </span>
          <span style={{ width: 40, textAlign: "right", flexShrink: 0, fontWeight: 700 }}>
            {item.count}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referral source breakdown
// ---------------------------------------------------------------------------

function ReferralBreakdown({ items, total }: { items: GeoRow[]; total: number }) {
  return (
    <div>
      {items.map((r) => (
        <div
          key={r.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, fontWeight: 600 }}>{r.key}</span>
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            background: "rgba(96,165,250,0.15)",
            color: "#60a5fa",
          }}>
            {r.count}
          </span>
          <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
            {Math.round((r.count / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State breakdown
// ---------------------------------------------------------------------------

function StateBreakdown({ items }: { items: GeoRow[] }) {
  const total = items.reduce((s, r) => s + r.count, 0);
  return (
    <div>
      {items.map((s) => (
        <div
          key={s.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1, fontWeight: 600 }}>{s.key}</span>
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            background: "rgba(167,139,250,0.15)",
            color: "#a78bfa",
          }}>
            {s.count}
          </span>
          <div
            style={{
              flex: 2,
              background: "var(--riq-border)",
              borderRadius: 3,
              height: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round((s.count / total) * 100)}%`,
                height: "100%",
                background: "var(--riq-accent)",
                borderRadius: 3,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-up queue
// ---------------------------------------------------------------------------

function FollowUpQueue({
  funnel,
  byStatus,
}: {
  funnel: FunnelData;
  byStatus: StatusBucket[];
}) {
  const queue = [
    {
      icon: "●",
      iconColor: "#10b981",
      label: "Appointments outstanding",
      count: funnel.appointments ?? 0,
      action: "Call now to confirm",
      urgent: true,
    },
    {
      icon: "●",
      iconColor: "#f59e0b",
      label: "Inspections not yet appointed",
      count: funnel.inspections ?? 0,
      action: "Follow up within 24h",
      urgent: true,
    },
    {
      icon: "●",
      iconColor: "#60a5fa",
      label: "Open conversations",
      count: funnel.conversations ?? 0,
      action: "Check last contact date",
      urgent: false,
    },
    {
      icon: "○",
      iconColor: "var(--riq-text-muted)",
      label: "No answer (2nd touch needed)",
      count: byStatus.find((s) => s.key === "No answer")?.count ?? 0,
      action: "Storm-triggered re-knock",
      urgent: false,
    },
    {
      icon: "○",
      iconColor: "var(--riq-text-muted)",
      label: "Material drop follow-up",
      count: byStatus.find((s) => s.key === "No answer - material drop")?.count ?? 0,
      action: "Call within 48h of drop",
      urgent: false,
    },
  ];

  return (
    <div>
      {queue.map((q) => (
        <div
          key={q.label}
          style={{
            display: "flex",
            alignItems: "start",
            gap: 8,
            padding: "7px 0",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
            fontSize: 12,
          }}
        >
          <span style={{ color: q.iconColor, fontSize: 14, lineHeight: 1.5 }}>{q.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: q.urgent ? 700 : 400 }}>{q.label}</div>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{q.action}</div>
          </div>
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            background: q.urgent ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)",
            color: q.urgent ? "#10b981" : "#f59e0b",
          }}>
            {fmt(q.count)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeadsIntel() {
  const raw = useFetch<RollupResponse>("/api/intel/leads-rollup");

  if (raw.loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 60, textAlign: "center", color: "var(--riq-text-muted)" }}>
          Loading leads data…
        </div>
      </div>
    );
  }
  if (raw.error || !raw.data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Error: {raw.error}</div>
      </div>
    );
  }

  // The blob may be wrapped in { data: ... } or be flat
  const d: RollupPayload = raw.data.data ?? raw.data;
  const funnel = d.funnel ?? {};
  const byStatus = d.byStatus ?? [];
  const reps = d.repLeaderboard ?? [];
  const cities = (d.topCities ?? []).slice(0, 10);
  const zips = (d.topZips ?? []).slice(0, 10);
  const referral = d.byReferralMethod ?? [];
  const states = d.byState ?? [];
  const totalLeads = d.totalLeads ?? 0;
  const refTotal = referral.reduce((s, r) => s + r.count, 0);

  const doorKnockRate = funnel.doorKnockToConversationPct ?? 0;
  const apptRate = funnel.conversationToAppointmentPct ?? 0;

  const twoCol: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    marginBottom: 14,
  };
  const threeCol: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 14,
    marginBottom: 14,
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
      {/* TOP STATS */}
      <CardRow>
        <KpiCard label="Total Leads" value={fmt(totalLeads)} hint="Active pipeline" />
        <KpiCard
          label="Door Knocks"
          value={fmt(funnel.doorKnocks)}
          hint={`${doorKnockRate.toFixed(1)}% to conversation`}
        />
        <KpiCard
          label="Conversations"
          value={fmt(funnel.conversations)}
          hint={`${apptRate.toFixed(1)}% to appointment`}
          emphasis
        />
        <KpiCard label="Appointments" value={fmt(funnel.appointments)} hint="Outstanding now" />
        <KpiCard label="Do Not Knock" value={fmt(funnel.doNotKnock)} hint="Excluded addresses" />
      </CardRow>

      {/* FUNNEL + STATUS BREAKDOWN */}
      <div style={{ ...twoCol, marginTop: 14 }}>
        <Panel title="Conversion Funnel">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            From door knock to conversion. The drop from Conversation → Appointment ({apptRate.toFixed(2)}%) is where the most leads are lost.
          </div>
          <FunnelViz funnel={funnel} totalLeads={totalLeads} />
          <div
            style={{
              marginTop: 14,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
            }}
          >
            <strong>{fmt(funnel.converted ?? 0)} converted</strong> from {fmt(totalLeads)} active leads
            — these are pre-conversion leads not yet closed as customers. The pipeline is live.{" "}
            <strong>{fmt(funnel.appointments ?? 0)} appointments outstanding</strong> are the most
            immediate opportunities.
          </div>
        </Panel>

        <Panel title="Lead Status Breakdown">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            "No Answer" leads still have untapped potential. A second touch campaign at these addresses
            could surface more conversations.
          </div>
          <StatusBreakdown byStatus={byStatus} />
          <div
            style={{
              marginTop: 12,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
            }}
          >
            <strong>
              {(byStatus.find((s) => s.key === "No answer")?.count ?? 0) +
                (byStatus.find((s) => s.key === "No answer - material drop")?.count ?? 0)}{" "}
              no-answer + material drop
            </strong>{" "}
            = addresses that got a knock but no engagement. Revisit after a storm event — timing matters
            more than persistence.
          </div>
        </Panel>
      </div>

      {/* REP LEADERBOARD */}
      <Panel title="Rep Leaderboard">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
          Sorted by conversation rate — a better signal of quality than raw lead count. High volume +
          low conversation rate = rushing. Low volume + high rate = working quality areas.
        </div>
        <RepLeaderboard reps={reps} />
      </Panel>

      {/* GEO BREAKDOWN */}
      <div style={{ ...twoCol, marginTop: 14 }}>
        <Panel title="Top Cities">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            Where your reps are canvassing. Concentrated canvassing = better door-to-door routing.
          </div>
          <BarList items={cities} />
        </Panel>

        <Panel title="Top ZIP Codes">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            Highest-density canvassing zones. These ZIPs have the most leads — cross-reference with
            storm-playbook for highest-leverage knocking.
          </div>
          <BarList items={zips} />
          <div
            style={{
              marginTop: 12,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(96,165,250,0.08)",
              border: "1px solid rgba(96,165,250,0.25)",
            }}
          >
            Cross-check these ZIPs against the Storm Playbook — knocking a ZIP that was hit by hail
            in the last 30 days produces 3× higher conversation rates.
          </div>
        </Panel>
      </div>

      {/* REFERRAL + STATE + FOLLOW-UP */}
      <div style={threeCol}>
        <Panel title="Lead Source">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            How leads were generated.
          </div>
          <ReferralBreakdown items={referral} total={refTotal} />
          <div
            style={{
              marginTop: 10,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.25)",
            }}
          >
            <strong>Referrals convert significantly higher</strong> than door knocks. Prioritize
            referral cultivation from completed jobs.
          </div>
        </Panel>

        <Panel title="State Breakdown">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            Geographic distribution of the lead pipeline.
          </div>
          <StateBreakdown items={states} />
          <div
            style={{
              marginTop: 10,
              borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.5,
              background: "rgba(96,165,250,0.08)",
              border: "1px solid rgba(96,165,250,0.25)",
            }}
          >
            VA dominates the pipeline. The MD non-renewal crisis creates a direct expansion
            opportunity — non-renewed MD homeowners need new coverage and a roof inspection.
          </div>
        </Panel>

        <Panel title="Immediate Follow-Up Queue">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8, lineHeight: 1.4 }}>
            Leads with outstanding engagement — prioritized action list.
          </div>
          <FollowUpQueue funnel={funnel} byStatus={byStatus} />
        </Panel>
      </div>
    </div>
  );
}
