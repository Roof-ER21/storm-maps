/**
 * Leads Funnel tab — Phase 2c native React.
 *
 * Replaces the iframe of public/leads.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/leads-summary   → rollup blob (funnel KPIs, rep leaderboard,
 *                                        stuck leads, top zips, referral methods,
 *                                        by state, eligible by role)
 *
 * No props — owns all state.
 *
 * Shape of /api/intel/leads-summary (leads-rollup.json):
 *   { totalLeads, funnel, stuckLeads, repLeaderboard, topZips,
 *     byReferralMethod, byState, eligibleByRole }
 */
import {
  useFetch,
  Panel,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Type interfaces
// ---------------------------------------------------------------------------

interface FunnelShape {
  total: number;
  conversations: number;
  inspections: number;
  appointments: number;
  converted: number;
  doNotKnock: number;
}

interface StuckLead {
  name?: string;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  repName?: string | null;
  ageDays?: number;
}

interface StuckLeadsData {
  count: number;
  leads: StuckLead[];
}

interface RepRow {
  repName: string;
  count: number;
  conversations: number;
  appointments: number;
  conversionPct: number;
  appointmentPct: number;
  lastCreated?: string | null;
}

interface KeyCount {
  key: string;
  count: number;
}

interface RoleRow {
  roleId: number;
  total: number;
  active: number;
  usingPortal: number;
}

interface LeadsSummaryResponse {
  totalLeads: number;
  funnel: FunnelShape;
  stuckLeads: StuckLeadsData;
  repLeaderboard: RepRow[];
  topZips: KeyCount[];
  byReferralMethod: KeyCount[];
  byState: KeyCount[];
  eligibleByRole: RoleRow[];
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
  fontSize: 10,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "7px 6px",
  borderBottom: "1px solid var(--riq-surface)",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 500, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Role name map (matches the HTML)
// ---------------------------------------------------------------------------

const ROLE_NAMES: Record<number, string> = {
  100: "Admin",
  200: "Sales Manager",
  201: "Ops Manager",
  250: "Ops Assistant",
  275: "Supplementer",
  300: "HR Director",
  400: "Production Manager",
  500: "Field Tech",
  550: "Estimator",
  575: "Project Manager",
  600: "Project Coordinator",
  650: "Field Trainer",
  700: "Sales Rep",
  800: "External Supplementer",
  1000: "Customer",
  1100: "Apple Developer",
};

// ---------------------------------------------------------------------------
// KPI tile (matches the HTML's .kpi element)
// ---------------------------------------------------------------------------

type KpiVariant = "default" | "blue" | "yellow" | "green" | "purple" | "red";

function KpiTile({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: KpiVariant;
}) {
  const valueColors: Record<KpiVariant, string> = {
    default: "var(--riq-accent)",
    blue: "#60a5fa",
    yellow: "#f59e0b",
    green: "#10b981",
    purple: "#a78bfa",
    red: "#ef4444",
  };
  return (
    <div
      style={{
        background: "rgba(52,44,35,0.8)",
        borderRadius: 6,
        padding: "11px 14px",
      }}
    >
      <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColors[variant], marginTop: 4 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && (
        <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel visualization
// ---------------------------------------------------------------------------

const FUNNEL_STAGES = [
  { key: "total", name: "Total doors", cls: "stage-knock", borderColor: "var(--riq-text-muted)" },
  { key: "conversations", name: "Conversations", cls: "stage-conv", borderColor: "#60a5fa" },
  { key: "inspections", name: "Inspections", cls: "stage-insp", borderColor: "#f59e0b" },
  { key: "appointments", name: "Appointments", cls: "stage-appt", borderColor: "#10b981" },
  { key: "converted", name: "Converted to customer", cls: "stage-conv-customer", borderColor: "var(--riq-accent)" },
] as const;

function FunnelViz({ funnel }: { funnel: FunnelShape }) {
  const vals: Record<string, number> = {
    total: funnel.total,
    conversations: funnel.conversations,
    inspections: funnel.inspections,
    appointments: funnel.appointments,
    converted: funnel.converted,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 600, margin: "0 auto" }}>
      {FUNNEL_STAGES.map((s, i) => {
        const count = vals[s.key] ?? 0;
        const prev = i === 0 ? count : (vals[FUNNEL_STAGES[i - 1].key] ?? 1);
        const pct = prev > 0 ? ((count / prev) * 100).toFixed(1) : "0";
        return (
          <div
            key={s.key}
            style={{
              background: "rgba(52,44,35,0.8)",
              borderLeft: `4px solid ${s.borderColor}`,
              padding: "10px 14px",
              borderRadius: 4,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600 }}>{s.name}</span>
            <span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{count.toLocaleString()}</span>
              {i > 0 && (
                <span style={{ color: "var(--riq-text-muted)", fontSize: 11, marginLeft: 6 }}>
                  → {pct}% of prior
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeadsFunnel() {
  const res = useFetch<LeadsSummaryResponse>("/api/intel/leads-summary");

  if (res.loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      </div>
    );
  }
  if (res.error || !res.data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load: {res.error}</div>
      </div>
    );
  }

  const d = res.data;
  const f = d.funnel;
  const twoColGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 16,
    marginBottom: 14,
  };
  const twoColEqGrid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    marginBottom: 14,
  };
  const kpiRowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
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
      {/* FUNNEL SECTION */}
      <Panel title="Funnel — pre-conversion pipeline">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Door-knocking journey: leads captured → contact made → inspection booked → appointment set →
          converted. Snapshot of{" "}
          <strong style={{ color: "var(--riq-text)" }}>{d.totalLeads.toLocaleString()}</strong> active
          leads across the territory.
        </div>
        <div style={kpiRowStyle}>
          <KpiTile label="Total leads" value={f.total} />
          <KpiTile
            label="Conversations"
            variant="blue"
            value={f.conversations}
            sub={`${((f.conversations / f.total) * 100).toFixed(1)}% of all`}
          />
          <KpiTile label="Inspections" variant="yellow" value={f.inspections} />
          <KpiTile label="Appointments" variant="green" value={f.appointments} />
          <KpiTile label="Converted to customer" variant="purple" value={f.converted} />
          <KpiTile label="Do Not Knock" variant="red" value={f.doNotKnock} />
        </div>
        <FunnelViz funnel={f} />
      </Panel>

      {/* REP LEADERBOARD + STUCK LEADS */}
      <div style={{ ...twoColGrid, marginTop: 14 }}>
        <Panel title="Rep leaderboard — leads in pipeline">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Reps by lead volume. Conversion % = leads that reached at least Conversation status.
            Appointment % = leads that became appointments.
          </div>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Rep</th>
                  <th style={thNumStyle}>Leads</th>
                  <th style={thNumStyle}>Conv</th>
                  <th style={thNumStyle}>Appts</th>
                  <th style={thNumStyle}>Conv %</th>
                  <th style={thNumStyle}>Appt %</th>
                  <th style={thStyle}>Last lead</th>
                </tr>
              </thead>
              <tbody>
                {d.repLeaderboard.slice(0, 30).map((r) => (
                  <tr key={r.repName}>
                    <td style={tdStyle}>{r.repName}</td>
                    <td style={tdNumStyle}>{r.count}</td>
                    <td style={tdNumStyle}>{r.conversations}</td>
                    <td style={tdNumStyle}>{r.appointments}</td>
                    <td style={tdNumStyle}>{r.conversionPct}%</td>
                    <td style={tdNumStyle}>{r.appointmentPct}%</td>
                    <td style={tdStyle}>
                      {r.lastCreated ? new Date(r.lastCreated).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Stuck leads">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Leads in <em>Conversation</em> status with no movement for 14+ days. These need a follow-up.
          </div>
          <div style={{ marginBottom: 14 }}>
            <KpiTile label="Stuck count" variant="yellow" value={d.stuckLeads.count} />
          </div>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Lead</th>
                  <th style={thStyle}>Address</th>
                  <th style={thStyle}>Rep</th>
                  <th style={thNumStyle}>Days</th>
                </tr>
              </thead>
              <tbody>
                {d.stuckLeads.leads.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ ...tdStyle, textAlign: "center", color: "var(--riq-text-muted)", padding: 20 }}
                    >
                      No stuck leads — pipeline is flowing
                    </td>
                  </tr>
                ) : (
                  d.stuckLeads.leads.map((l, idx) => (
                    <tr key={idx}>
                      <td style={tdStyle}>{l.name ?? "—"}</td>
                      <td style={tdStyle}>
                        {[l.addressLine1, l.city, l.state, l.zipCode].filter(Boolean).join(", ")}
                      </td>
                      <td style={tdStyle}>{l.repName ?? "—"}</td>
                      <td style={tdNumStyle}>{l.ageDays ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      {/* TOP ZIPS + LEAD SOURCE + STATES */}
      <div style={twoColEqGrid}>
        <Panel title="Top zips — lead density">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
            Highest-volume zip codes. Use as hot-zone overlay for door-knocking routes.
          </div>
          <div style={{ ...scrollBox, maxHeight: 400 }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Zip</th>
                  <th style={thNumStyle}>Leads</th>
                </tr>
              </thead>
              <tbody>
                {d.topZips.map((z) => (
                  <tr key={z.key}>
                    <td style={tdStyle}>{z.key}</td>
                    <td style={tdNumStyle}>{z.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div>
          <Panel title="Lead source">
            <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              Where leads come from — door-knocking vs referrals.
            </div>
            <div style={{ ...scrollBox, maxHeight: 200 }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Source</th>
                    <th style={thNumStyle}>Leads</th>
                    <th style={thNumStyle}>% of total</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byReferralMethod.map((r) => (
                    <tr key={r.key}>
                      <td style={tdStyle}>{r.key}</td>
                      <td style={tdNumStyle}>{r.count}</td>
                      <td style={tdNumStyle}>
                        {((r.count / d.totalLeads) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <div style={{ marginTop: 14 }}>
            <Panel title="States">
              <div style={{ ...scrollBox, maxHeight: 160 }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>State</th>
                      <th style={thNumStyle}>Leads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byState.map((s) => (
                      <tr key={s.key}>
                        <td style={tdStyle}>{s.key}</td>
                        <td style={tdNumStyle}>{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      {/* ELIGIBLE EMPLOYEES BY ROLE */}
      <Panel title="Lead-eligible employees by role">
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Roles that can receive leads in the portal. Portal-using % shows who has logged in recently.
        </div>
        <div style={{ ...scrollBox, maxHeight: 300 }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Role ID</th>
                <th style={thNumStyle}>Total</th>
                <th style={thNumStyle}>Active</th>
                <th style={thNumStyle}>Using portal</th>
              </tr>
            </thead>
            <tbody>
              {d.eligibleByRole.map((r) => (
                <tr key={r.roleId}>
                  <td style={tdStyle}>
                    {r.roleId} — {ROLE_NAMES[r.roleId] ?? "(unknown)"}
                  </td>
                  <td style={tdNumStyle}>{r.total}</td>
                  <td style={tdNumStyle}>{r.active}</td>
                  <td style={tdNumStyle}>{r.usingPortal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Footnote */}
      <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
        Source: <code>portal.theroofdocs.com /v1/admin/leads</code> +{" "}
        <code>/v1/admin/leads/employees</code>. Rolled up by{" "}
        <code>scripts/roofdocs/build-leads.mjs</code>. Refreshed via <code>refresh-all.sh</code>.
        Sensitive employee fields (password / servicePassword) are scrubbed at ingestion.
      </div>
    </div>
  );
}
