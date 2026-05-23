/**
 * Exec Snapshot — native React (Phase 2d batch1)
 *
 * Data:
 *   GET /api/intel/dashboard-kpis  → { hero, bookComposition, tiles, took_ms }
 *   GET /api/intel/exec-summary    → { latestStorm, topRepsLast12mo, topZipsByRev,
 *                                       yoy, topCarriersByRev, topStormsByJobs,
 *                                       risks, solarCandidates, took_ms }
 */
import { useState, useEffect } from "react";
import {
  useFetch,
  KpiCard,
  CardRow,
  Panel,
  fmtMoney,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface DashHero {
  total: number;
  completed: number;
  dead: number;
  totalRevenue: number;
  completedRevenue: number;
  customers: number;
  zips: number;
  reps: number;
  carriers: number;
  adjusters: number;
  stormMatched: number;
}

interface DashTiles {
  hotZips60: number;
  sidingUpsell: number;
  arTotal: number;
  resurrection: number;
  stormExposure: number;
  stormPlaybook: number;
  notes: number;
  lifetimeTouch: number;
}

interface DashboardKpisResponse {
  hero: DashHero;
  bookComposition: {
    insurance: { signed: number; completed: number; dead: number; closeRate: number; share: number };
    retail: { signed: number; completed: number; dead: number; closeRate: number; share: number };
  };
  tiles: DashTiles;
  took_ms: number;
}

interface LatestStorm {
  stormDate: string;
  stormType: string;
  stormMagnitude: number | null;
  stormUnit: string | null;
}

interface RepRow {
  name: string;
  signed: number;
  completed: number;
  revenue: number;
}

interface ZipRow {
  zip: string;
  city: string;
  signed: number;
  revenue: number;
}

interface YoyRow {
  year: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
}

interface CarrierRow {
  name: string;
  signed: number;
  completed: number;
  revenue: number;
}

interface StormRow {
  date: string;
  type: string;
  mag: number;
  unit: string | null;
  jobs: number;
  revenue: number;
}

interface Risks {
  paused: number;
  deadLast12mo: number;
  supplementsOpen: number;
}

interface ExecSummaryResponse {
  latestStorm: LatestStorm | null;
  topRepsLast12mo: RepRow[];
  topZipsByRev: ZipRow[];
  yoy: YoyRow[];
  topCarriersByRev: CarrierRow[];
  topStormsByJobs: StormRow[];
  risks: Risks;
  solarCandidates: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500,
  fontSize: 11, textTransform: "uppercase", padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "5px 6px", borderBottom: "1px solid var(--riq-surface)", fontSize: 13 };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// ---------------------------------------------------------------------------
// Opportunity card
// ---------------------------------------------------------------------------

function OppCard({
  title,
  desc,
  count,
  viewId,
  navigate,
}: {
  title: string;
  desc: string;
  count: string | number;
  viewId: string;
  navigate: (v: string) => void;
}) {
  return (
    <div
      style={{
        background: "#342c23",
        border: "1px solid var(--riq-border)",
        borderRadius: 8,
        padding: "14px 18px",
        marginBottom: 10,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: "var(--riq-accent)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>{desc}</div>
        <button
          onClick={() => navigate(viewId)}
          style={{
            color: "var(--riq-accent)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            padding: 0,
            marginTop: 4,
          }}
        >
          Open list →
        </button>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: "#10b981" }}>
          {typeof count === "number" ? count.toLocaleString() : count}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExecPage({ navigate }: { navigate: (v: string) => void }) {
  const kpis = useFetch<DashboardKpisResponse>("/api/intel/dashboard-kpis");
  const exec = useFetch<ExecSummaryResponse>("/api/intel/exec-summary");

  const [dataYears, setDataYears] = useState<string>("—");

  useEffect(() => {
    if (!exec.data?.yoy?.length) return;
    const years = exec.data.yoy.map((y) => Number(y.year)).sort();
    if (years.length >= 2) {
      setDataYears((years[years.length - 1] - years[0] + 1).toFixed(1));
    }
  }, [exec.data]);

  const loading = kpis.loading || exec.loading;
  const error = kpis.error || exec.error;

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      </div>
    );
  }

  if (error || !kpis.data || !exec.data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load exec data: {error}</div>
      </div>
    );
  }

  const h = kpis.data.hero;
  const t = kpis.data.tiles;
  const e = exec.data;
  const latest = e.latestStorm;

  const daysSinceStorm = latest
    ? Math.floor((Date.now() - new Date(latest.stormDate).getTime()) / 86400000)
    : null;

  const opps: Array<{ title: string; desc: string; count: string | number; viewId: string }> = [
    { title: "Resurrection candidates", desc: "Dead insurance jobs hit by new strong storms", count: t.resurrection, viewId: "resurrection" },
    { title: "Warm customers w/ new damage", desc: "Strong storm within 2mi since first contact", count: t.stormExposure, viewId: "storm-exposure" },
    { title: "Siding upsell pool", desc: "Roof customers who never bought siding", count: t.sidingUpsell, viewId: "campaigns" },
    { title: "Solar candidates", desc: "Completed roof 1-7 years old (right age for solar)", count: e.solarCandidates, viewId: "solar" },
    { title: "Open AR ($)", desc: "Money awaiting collection right now", count: fmtMoney(t.arTotal), viewId: "receivables" },
  ];

  const sectionStyle: React.CSSProperties = {
    background: "var(--riq-surface)",
    border: "1px solid var(--riq-border)",
    borderRadius: 10,
    padding: "18px 22px",
  };

  const rowStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: 16,
    marginBottom: 16,
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {/* Hero */}
      <div
        style={{
          background: "linear-gradient(135deg, #342c23 0%, #2a241e 100%)",
          border: "1px solid var(--riq-border)",
          borderRadius: 12,
          padding: "28px 32px",
          marginBottom: 24,
        }}
      >
        <CardRow>
          <KpiCard label={`Completed revenue · ${dataYears}y`} value={fmtMoney(h.completedRevenue)} emphasis />
          <KpiCard label="Completed jobs" value={h.completed.toLocaleString()} />
          <KpiCard label="Lifetime signed jobs" value={h.total.toLocaleString()} />
          <KpiCard label="Open AR" value={fmtMoney(t.arTotal)} />
        </CardRow>
      </div>

      {/* Opportunities + Latest storm */}
      <div style={rowStyle}>
        <div style={sectionStyle}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
            Immediate Opportunities — Money & Leads on the Table
          </div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14 }}>
            Pre-qualified outreach lists. Each is a CSV away from a campaign.
          </div>
          {opps.map((o) => (
            <OppCard key={o.viewId} {...o} navigate={navigate} />
          ))}
        </div>
        <div style={sectionStyle}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Most Recent Strong Storm</div>
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 14 }}>
            Latest hail ≥1" or wind ≥60mph in our service area.
          </div>
          {latest ? (
            <>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--riq-accent)" }}>
                {latest.stormType} {latest.stormMagnitude ?? ""} {latest.stormUnit ?? ""}
              </div>
              <div style={{ color: "var(--riq-text-muted)", marginTop: 4 }}>
                {(latest.stormDate || "").slice(0, 10)} · {daysSinceStorm}d ago
              </div>
              <button
                onClick={() => navigate("storm-playbook")}
                style={{
                  color: "var(--riq-accent)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  display: "inline-block",
                  marginTop: 12,
                  padding: 0,
                }}
              >
                Open Playbook for outreach lists →
              </button>
            </>
          ) : (
            <div style={{ color: "var(--riq-text-muted)", fontSize: 13 }}>No recent storm data.</div>
          )}
        </div>
      </div>

      {/* Top reps + Top ZIPs */}
      <div style={rowStyle}>
        <Panel title="Top 5 Reps (Last 12 Months)">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>By signed volume in the rolling year.</div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Rep</th>
                <th style={thNum}>Signed</th>
                <th style={thNum}>Completed</th>
                <th style={thNum}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {e.topRepsLast12mo.map((r) => (
                <tr key={r.name}>
                  <td style={td}>{r.name}</td>
                  <td style={tdNum}>{r.signed}</td>
                  <td style={tdNum}>{r.completed}</td>
                  <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Top 5 ZIPs (All Time)">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Highest revenue.</div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>ZIP</th>
                <th style={th}>City</th>
                <th style={thNum}>Signed</th>
                <th style={thNum}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {e.topZipsByRev.map((r) => (
                <tr key={r.zip}>
                  <td style={td}>{r.zip}</td>
                  <td style={td}>{r.city || "—"}</td>
                  <td style={tdNum}>{r.signed}</td>
                  <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* YoY + Top Carriers */}
      <div style={rowStyle}>
        <Panel title="Year-Over-Year Performance">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Signed jobs, completion rate, revenue.</div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Year</th>
                <th style={thNum}>Signed</th>
                <th style={thNum}>Completed</th>
                <th style={thNum}>Close Rate</th>
                <th style={thNum}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {e.yoy.map((y) => (
                <tr key={y.year}>
                  <td style={td}>{y.year}</td>
                  <td style={tdNum}>{y.signed}</td>
                  <td style={tdNum}>{y.completed}</td>
                  <td style={{ ...tdNum, color: "var(--riq-accent)" }}>
                    {(y.closeRate * 100).toFixed(1)}%
                  </td>
                  <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(y.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Top 5 Insurance Carriers">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>By revenue.</div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Carrier</th>
                <th style={thNum}>Signed</th>
                <th style={thNum}>Approved</th>
                <th style={thNum}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {e.topCarriersByRev.map((c) => (
                <tr key={c.name}>
                  <td style={td}>{c.name}</td>
                  <td style={tdNum}>{c.signed}</td>
                  <td style={tdNum}>{c.completed}</td>
                  <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(c.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Top storms + Risk flags */}
      <div style={rowStyle}>
        <Panel title="Top 5 Single Storms That Drove Revenue (Lifetime)">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Single storm events that produced the most jobs.</div>
          <table style={tbl}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Type</th>
                <th style={th}>Mag</th>
                <th style={thNum}>Jobs</th>
                <th style={thNum}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {e.topStormsByJobs.map((s, i) => (
                <tr key={i}>
                  <td style={td}>{(s.date || "").slice(0, 10)}</td>
                  <td style={td}>{s.type || ""}</td>
                  <td style={td}>{s.mag ?? ""} {s.unit ?? ""}</td>
                  <td style={tdNum}>{s.jobs}</td>
                  <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Risk Flags">
          <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>Issues worth ops review.</div>
          {[
            { title: "Paused jobs", desc: "Active blockers", count: e.risks.paused, color: "#f59e0b" },
            { title: "Open supplements", desc: "Supplement-filed, not yet closed", count: e.risks.supplementsOpen, color: "#f59e0b" },
            { title: "Dead jobs (last 12 mo)", desc: "Resurrection candidates pool", count: e.risks.deadLast12mo, color: "#ef4444" },
          ].map((r) => (
            <div
              key={r.title}
              style={{
                background: "#342c23",
                border: "1px solid var(--riq-border)",
                borderRadius: 8,
                padding: "14px 18px",
                marginBottom: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "var(--riq-accent)" }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>{r.desc}</div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: r.color }}>
                {r.count.toLocaleString()}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
