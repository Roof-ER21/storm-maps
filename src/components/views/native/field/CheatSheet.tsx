/**
 * CheatSheet — native React replacement for public/cheat-sheet.html
 *
 * Endpoints (verified against live prod):
 *   GET /api/intel/cheat-sheets
 *     → {
 *         reps: RepSheet[], carriers: CarrierSheet[], adjusters: AdjSheet[],
 *         states: StateSheet[], zips: ZipSheet[], team: TeamBaseline, generated
 *       }
 *   GET /api/intel/carrier-patents  (fire-and-forget; graceful on failure)
 *     → { patents: Record<id, Patent>, byCarrier: Record<name, id[]>, model, generated }
 *
 * 5 tabs: Reps | Carriers | Adjusters | States | ZIPs
 * Left pane = searchable list; right pane = detail card.
 * No `any` types.
 */
import { useState, useEffect } from "react";
import { fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response types (verified via curl | python -c)
// ---------------------------------------------------------------------------

interface RepTotals {
  insSigned: number;
  retailSigned: number;
  insTotal: number;
  retailTotal: number;
  combinedSignedTotal: number;
  insApprovalRate: number;
  insApproved: number;
  insDead: number;
}

interface RepSpeed {
  medianDaysLossToSign: number | null;
  medianDaysSignToComplete: number | null;
}

interface RepCohortDelta {
  approvalRate: number | null;
  medianDaysLossToSign: number | null;
  medianDaysSignToComplete: number | null;
}

interface RepCarrierRow {
  carrier: string;
  jobs: number;
  approved: number;
  approvalRate: number;
  avgApprovedJob: number;
  deltaVsRepBaseline: number | null;
}

interface RepAdjRow {
  name: string;
  carrier: string;
  jobs: number;
  approvalRate: number;
  deltaVsRepBaseline: number | null;
}

interface RepZipRow { zip: string; city: string; jobs: number; revenue: number; }
interface RepTradeRow { trade: string; jobs: number; approved: number; approvalRate: number; }
interface RepStormRow { date: string | null; type: string; mag: string | null; jobs: number; }
interface RepBestWorst { carrier: string; approvalRate: number; jobs: number; deltaPp: number | null; }

interface RepSheet {
  name: string;
  totals: RepTotals;
  speed: RepSpeed;
  cohortDelta: RepCohortDelta;
  byCarrier: RepCarrierRow[];
  byAdjuster: RepAdjRow[];
  byZip: RepZipRow[];
  byTrade: RepTradeRow[];
  topStorms: RepStormRow[];
  bestCarrier: RepBestWorst | null;
  worstCarrier: RepBestWorst | null;
}

interface CarrierTotals {
  jobs: number;
  approvalRate: number;
  insTotal: number;
  dead: number;
}

interface CarrierHailRow { tier: string; jobs: number; approved: number; approvalRate: number; }
interface CarrierStateRow { state: string; jobs: number; approvalRate: number; medianDeductible: number | null; }
interface CarrierAdjRow { name: string; jobs: number; approvalRate: number; deltaVsCarrier: number; }
interface CarrierRepRow { name: string; jobs: number; approvalRate: number; insTotal: number; deltaVsCarrier: number; }

interface CarrierSheet {
  name: string;
  totals: CarrierTotals;
  byHail: CarrierHailRow[];
  byState: CarrierStateRow[];
  adjusters: CarrierAdjRow[];
  reps: CarrierRepRow[];
  deathRate: number;
  medianUplift: number | null;
  pctOver50Uplift: number;
  medianDeductible: number | null;
  medianInsuranceTotal: number | null;
  medianDaysLossToSign: number | null;
  medianDaysSignToComplete: number | null;
}

interface AdjSheet {
  name: string;
  carrier: string;
  jobs: number;
  approved: number;
  dead: number;
  approvalRate: number;
  stance: "lenient" | "strict" | "baseline";
  deltaVsCarrier: number;
  medianUplift: number | null;
  medianDeductible: number | null;
  insufficient: boolean;
  reps: { name: string; jobs: number; approvalRate: number }[];
  cities: { city: string; jobs: number }[];
}

interface StateSheet {
  state: string;
  insJobs: number;
  insApproved: number;
  insDead: number;
  insTotal: number;
  retailJobs: number;
  insApprovalRate: number;
  medianDeductible: number | null;
  lawSummary: string;
  topCarriers: { name: string; jobs: number; approvalRate: number }[];
  topAdjusters: { name: string; carriers: string[]; jobs: number; approvalRate: number }[];
}

interface ZipSheet {
  zip: string;
  city: string;
  insJobs: number;
  insApproved: number;
  insDead: number;
  insApprovalRate: number;
  medianDeductible: number | null;
  dominantCarrier: string | null;
  topCarriers: { name: string; jobs: number; approvalRate: number }[];
  topAdjusters: { name: string; jobs: number; approvalRate: number }[];
  topReps: { name: string; jobs: number; approved: number }[];
}

interface TeamBaseline {
  insApprovalRate: number;
  medianDaysLossToSign: number;
  medianDaysSignToComplete: number;
  minN: number;
}

interface CheatSheetsResponse {
  reps: RepSheet[];
  carriers: CarrierSheet[];
  adjusters: AdjSheet[];
  states: StateSheet[];
  zips: ZipSheet[];
  team: TeamBaseline;
  generated: string;
}

interface PatentExtracted {
  summary?: string;
  relevanceToRoofers?: string;
  imageFeaturesScanned?: string[];
  decisionRules?: { trigger?: string; condition?: string; outcome?: string }[];
  scoringThresholds?: { metric: string; threshold: string; meaning?: string }[];
  exclusions?: string[];
  counterPlaysForRoofers?: string[];
  badFaithSignals?: string[];
}

interface Patent {
  id: string;
  url: string;
  filed: string;
  title: string;
  carrier: string;
  assignee: string;
  extracted?: PatentExtracted;
}

interface PatentsResponse {
  patents: Record<string, Patent>;
  byCarrier: Record<string, string[]>;
  model: string;
  generated: string;
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = { textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", padding: "6px", borderBottom: "1px solid var(--riq-border)" };
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "5px 6px", borderBottom: "1px solid var(--riq-surface)" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function pctClass(v: number | null): React.CSSProperties {
  if (v == null) return { color: "var(--riq-accent)" };
  if (v >= 0.75) return { color: "#10b981" };
  if (v < 0.5) return { color: "#ef4444" };
  return { color: "var(--riq-accent)" };
}

function DeltaPp({ v }: { v: number | null | undefined }) {
  if (v == null || Math.abs(v) < 0.0001) return <span style={{ color: "var(--riq-text-muted)", fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--riq-surface)" }}>—</span>;
  const up = v > 0;
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: up ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)", color: up ? "#10b981" : "#ef4444" }}>
      {v > 0 ? "+" : ""}{(v * 100).toFixed(1)}pp
    </span>
  );
}

function StancePill({ stance }: { stance: "lenient" | "strict" | "baseline" }) {
  const styles: Record<string, React.CSSProperties> = {
    lenient: { background: "rgba(16,185,129,0.15)", color: "#10b981" },
    strict: { background: "rgba(239,68,68,0.15)", color: "#ef4444" },
    baseline: { background: "var(--riq-surface)", color: "var(--riq-text-muted)" },
  };
  return <span style={{ display: "inline-block", padding: "2px 6px", borderRadius: 3, fontSize: 10, ...styles[stance] }}>{stance}</span>;
}

// ---------------------------------------------------------------------------
// Panel wrapper
// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "20px 24px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16, color: "var(--riq-accent)" }}>{title}</h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Patent decoder (carrier detail)
// ---------------------------------------------------------------------------

function PatentDecoder({ carrierName, patents }: { carrierName: string; patents: PatentsResponse | null }) {
  if (!patents) return null;
  const ids = [...(patents.byCarrier[carrierName] || []), ...(patents.byCarrier["VENDOR_MULTI"] || [])];
  if (!ids.length) return null;
  const ps = ids.map((id) => patents.patents[id]).filter(Boolean);
  if (!ps.length) return null;

  return (
    <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "20px 24px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 16, color: "#a78bfa" }}>
        {carrierName} AI Playbook — decoded from {ps.length} public patent{ps.length === 1 ? "" : "s"}
      </h2>
      <div style={{ fontSize: 11, color: "var(--riq-text-muted)", lineHeight: 1.5, padding: "12px 14px", background: "#342c23", borderLeft: "3px solid #a78bfa", borderRadius: "0 4px 4px 0", marginBottom: 14 }}>
        Source: public patent filings (Google Patents / USPTO). Each block is what THEIR AI is documented to look for and decide.
      </div>
      {ps.map((p) => {
        const e = p.extracted || {};
        return (
          <div key={p.id} style={{ background: "var(--riq-bg)", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "14px 18px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <div>
                <strong style={{ color: "var(--riq-accent)", fontSize: 14 }}>{p.id}</strong>
                <span style={{ color: "var(--riq-text-muted)", fontSize: 11, marginLeft: 6 }}>filed {p.filed} · {p.assignee}</span>
              </div>
              <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--riq-accent)" }}>Open patent →</a>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
              <strong>{p.title.replace(/^US\d+B?\d?\s*-\s*/, "").replace(/\s*-\s*Google Patents$/, "")}</strong>
              {e.summary && <div style={{ color: "var(--riq-text-muted)" }}>{e.summary}</div>}
            </div>
            {e.relevanceToRoofers && (
              <div style={{ fontSize: 12, marginBottom: 10, padding: "6px 10px", background: "#342c23", borderLeft: "2px solid var(--riq-accent)", borderRadius: "0 4px 4px 0" }}>
                <strong>Why this matters:</strong> {e.relevanceToRoofers}
              </div>
            )}
            {(e.counterPlaysForRoofers || []).length > 0 && (
              <div style={{ marginBottom: 10, padding: "8px 12px", background: "rgba(16,185,129,0.05)", borderLeft: "2px solid #10b981", borderRadius: "0 4px 4px 0" }}>
                <div style={{ fontSize: 10, color: "#10b981", textTransform: "uppercase", marginBottom: 4 }}>Counter-plays for the rep</div>
                {(e.counterPlaysForRoofers || []).map((cp, i) => (
                  <div key={i} style={{ fontSize: 12, lineHeight: 1.55 }}>→ {cp}</div>
                ))}
              </div>
            )}
            {(e.badFaithSignals || []).length > 0 && (
              <div style={{ marginBottom: 6, padding: "8px 12px", background: "rgba(168,139,250,0.05)", borderLeft: "2px solid #a78bfa", borderRadius: "0 4px 4px 0" }}>
                <div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", marginBottom: 4 }}>Bad-faith signals</div>
                {(e.badFaithSignals || []).map((bf, i) => (
                  <div key={i} style={{ fontSize: 12, lineHeight: 1.55 }}>⚠ {bf}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail renderers
// ---------------------------------------------------------------------------

function RepDetail({ r, team }: { r: RepSheet; team: TeamBaseline }) {
  const t = r.totals;
  const kpiStyle: React.CSSProperties = { background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" };
  const kpiLStyle: React.CSSProperties = { fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" };
  const kpiVStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 };
  return (
    <div>
      <Card title={r.name}>
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
          {t.insSigned.toLocaleString()} insurance signed · {t.retailSigned.toLocaleString()} retail signed
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div style={kpiStyle}><div style={kpiLStyle}>Insurance Sales</div><div style={kpiVStyle}>{fmtMoney(t.insTotal)}</div><div style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>{t.insSigned} jobs</div></div>
          <div style={kpiStyle}><div style={kpiLStyle}>Retail Sales</div><div style={kpiVStyle}>{fmtMoney(t.retailTotal)}</div><div style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>{t.retailSigned} jobs</div></div>
          <div style={kpiStyle}>
            <div style={kpiLStyle}>Approval Rate</div>
            <div style={{ ...kpiVStyle, ...pctClass(t.insApprovalRate) }}>{fmtPct(t.insApprovalRate, 1)}</div>
            <div style={{ fontSize: 11, color: r.cohortDelta.approvalRate != null && r.cohortDelta.approvalRate > 0 ? "#10b981" : "#ef4444" }}>
              {r.cohortDelta.approvalRate != null ? `${r.cohortDelta.approvalRate > 0 ? "+" : ""}${(r.cohortDelta.approvalRate * 100).toFixed(1)}pp` : ""} vs team {fmtPct(team.insApprovalRate, 1)}
            </div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLStyle}>Speed loss→sign</div>
            <div style={kpiVStyle}>{r.speed.medianDaysLossToSign ?? "—"}<span style={{ fontSize: 13 }}> d</span></div>
            <div style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>team: {team.medianDaysLossToSign}d</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLStyle}>Speed sign→complete</div>
            <div style={kpiVStyle}>{r.speed.medianDaysSignToComplete ?? "—"}<span style={{ fontSize: 13 }}> d</span></div>
            <div style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>team: {team.medianDaysSignToComplete}d</div>
          </div>
        </div>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Carrier</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approved</th>
            <th style={thNumStyle}>Approval</th><th style={thNumStyle}>vs Their Avg</th><th style={thNumStyle}>Avg Approved $</th>
          </tr></thead>
          <tbody>{r.byCarrier.slice(0, 25).map((c) => (
            <tr key={c.carrier}>
              <td style={{ ...tdStyle, color: "var(--riq-accent)" }}>{c.carrier}</td>
              <td style={tdNumStyle}>{c.jobs}</td>
              <td style={tdNumStyle}>{c.approved}</td>
              <td style={{ ...tdNumStyle, ...pctClass(c.approvalRate) }}>{fmtPct(c.approvalRate, 1)}</td>
              <td style={tdNumStyle}>{c.jobs < team.minN ? <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>N&lt;{team.minN}</span> : <DeltaPp v={c.deltaVsRepBaseline} />}</td>
              <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(c.avgApprovedJob)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      {r.bestCarrier && r.worstCarrier && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "20px 24px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14, color: "#10b981" }}>Best carrier</h2>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{r.bestCarrier.carrier}</div>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 6 }}>{fmtPct(r.bestCarrier.approvalRate, 1)} · {r.bestCarrier.jobs} jobs</div>
          </div>
          <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "20px 24px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14, color: "#ef4444" }}>Toughest carrier</h2>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{r.worstCarrier.carrier}</div>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 6 }}>{fmtPct(r.worstCarrier.approvalRate, 1)} · {r.worstCarrier.jobs} jobs</div>
          </div>
        </div>
      )}
    </div>
  );
}

function CarrierDetail({ c, patents }: { c: CarrierSheet; patents: PatentsResponse | null }) {
  return (
    <div>
      <Card title={c.name}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            { l: "Total insured $", v: fmtMoney(c.totals.insTotal), n: `${c.totals.jobs} jobs` },
            { l: "Median deductible", v: c.medianDeductible ? `$${c.medianDeductible.toLocaleString()}` : "—" },
            { l: "Median insuranceTotal", v: fmtMoney(c.medianInsuranceTotal) },
            { l: "Median uplift", v: fmtPct(c.medianUplift, 1) },
            { l: "Death rate", v: fmtPct(c.deathRate, 1), n: `${c.totals.dead} dead` },
            { l: "Days loss→sign", v: c.medianDaysLossToSign != null ? `${c.medianDaysLossToSign}d` : "—" },
            { l: "Days sign→complete", v: c.medianDaysSignToComplete != null ? `${c.medianDaysSignToComplete}d` : "—" },
          ].map((k) => (
            <div key={k.l} style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>{k.l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{k.v}</div>
              {k.n && <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 2 }}>{k.n}</div>}
            </div>
          ))}
        </div>
      </Card>
      <Card title="Hail-tier Sensitivity">
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Hail tier</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approved</th><th style={thNumStyle}>Approval rate</th>
          </tr></thead>
          <tbody>{c.byHail.map((h) => (
            <tr key={h.tier}>
              <td style={tdStyle}>{h.tier}"</td>
              <td style={tdNumStyle}>{h.jobs}</td>
              <td style={tdNumStyle}>{h.approved}</td>
              <td style={tdNumStyle}>{h.jobs < 5 ? <span style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>low N</span> : <span style={pctClass(h.approvalRate)}>{fmtPct(h.approvalRate, 1)}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <PatentDecoder carrierName={c.name} patents={patents} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title="By State">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>State</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th><th style={thNumStyle}>Med ded.</th></tr></thead>
            <tbody>{c.byState.map((s) => (
              <tr key={s.state}>
                <td style={tdStyle}>{s.state}</td>
                <td style={tdNumStyle}>{s.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(s.approvalRate) }}>{fmtPct(s.approvalRate, 1)}</td>
                <td style={tdNumStyle}>{s.medianDeductible ? `$${s.medianDeductible.toLocaleString()}` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Top Adjusters">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Name</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th><th style={thStyle}>Stance</th></tr></thead>
            <tbody>{c.adjusters.slice(0, 15).map((a) => (
              <tr key={a.name}>
                <td style={tdStyle}>{a.name}</td>
                <td style={tdNumStyle}>{a.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(a.approvalRate) }}>{fmtPct(a.approvalRate, 1)}</td>
                <td style={tdStyle}><StancePill stance={a.deltaVsCarrier > 0.05 ? "lenient" : a.deltaVsCarrier < -0.05 ? "strict" : "baseline"} /></td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
      <Card title={`Top Reps Against ${c.name}`}>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Rep</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th><th style={thNumStyle}>$ Insured</th><th style={thNumStyle}>vs Carrier Avg</th>
          </tr></thead>
          <tbody>{c.reps.slice(0, 15).map((r) => (
            <tr key={r.name}>
              <td style={tdStyle}>{r.name}</td>
              <td style={tdNumStyle}>{r.jobs}</td>
              <td style={{ ...tdNumStyle, ...pctClass(r.approvalRate) }}>{fmtPct(r.approvalRate, 1)}</td>
              <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.insTotal)}</td>
              <td style={tdNumStyle}><DeltaPp v={r.deltaVsCarrier} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

function AdjDetail({ a }: { a: AdjSheet }) {
  return (
    <div>
      <Card title={`${a.name} — ${a.carrier}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Approval Rate</div>
            <div style={{ fontSize: 22, fontWeight: 700, ...pctClass(a.approvalRate) }}>{fmtPct(a.approvalRate, 1)}</div>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>{a.approved} of {a.jobs - a.dead}</div>
          </div>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Stance vs carrier</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}><StancePill stance={a.stance} /></div>
            <div style={{ fontSize: 11, color: "var(--riq-text-muted)" }}><DeltaPp v={a.deltaVsCarrier} /> vs {a.carrier}</div>
          </div>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Median uplift</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{fmtPct(a.medianUplift, 1)}</div>
          </div>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Median deductible</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{a.medianDeductible ? `$${a.medianDeductible.toLocaleString()}` : "—"}</div>
          </div>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title="Reps Who Worked With Them">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Rep</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th></tr></thead>
            <tbody>{a.reps.length ? a.reps.map((r) => (
              <tr key={r.name}>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdNumStyle}>{r.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(r.approvalRate) }}>{fmtPct(r.approvalRate, 1)}</td>
              </tr>
            )) : <tr><td colSpan={3} style={{ ...tdStyle, color: "var(--riq-text-muted)", fontStyle: "italic" }}>No rep matches</td></tr>}</tbody>
          </table>
        </Card>
        <Card title="Coverage Cities">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>City</th><th style={thNumStyle}>Jobs</th></tr></thead>
            <tbody>{a.cities.length ? a.cities.map((c) => (
              <tr key={c.city}><td style={tdStyle}>{c.city}</td><td style={tdNumStyle}>{c.jobs}</td></tr>
            )) : <tr><td colSpan={2} style={{ ...tdStyle, color: "var(--riq-text-muted)", fontStyle: "italic" }}>No city data</td></tr>}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function StateDetail({ s }: { s: StateSheet }) {
  return (
    <div>
      <Card title={s.state}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Insurance Approval</div>
            <div style={{ fontSize: 22, fontWeight: 700, ...pctClass(s.insApprovalRate) }}>{fmtPct(s.insApprovalRate, 1)}</div>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>{s.insApproved} of {s.insJobs - s.insDead}</div>
          </div>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Insurance Sales</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{fmtMoney(s.insTotal)}</div>
          </div>
          <div style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>Median deductible</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{s.medianDeductible ? `$${s.medianDeductible.toLocaleString()}` : "—"}</div>
          </div>
        </div>
        <div style={{ background: "rgba(168,139,250,0.08)", borderLeft: "3px solid #a78bfa", padding: "10px 14px", fontSize: 12, lineHeight: 1.5, borderRadius: "0 6px 6px 0", marginBottom: 12 }}>
          {s.lawSummary}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title={`Top Carriers in ${s.state}`}>
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Carrier</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th></tr></thead>
            <tbody>{s.topCarriers.map((c) => (
              <tr key={c.name}>
                <td style={tdStyle}>{c.name}</td><td style={tdNumStyle}>{c.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(c.approvalRate) }}>{fmtPct(c.approvalRate, 1)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title={`Top Adjusters in ${s.state}`}>
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Name</th><th style={thStyle}>Carriers</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th></tr></thead>
            <tbody>{s.topAdjusters.map((a) => (
              <tr key={a.name}>
                <td style={tdStyle}>{a.name}</td>
                <td style={{ ...tdStyle, fontSize: 11, color: "var(--riq-text-muted)" }}>{a.carriers.join(", ")}</td>
                <td style={tdNumStyle}>{a.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(a.approvalRate) }}>{fmtPct(a.approvalRate, 1)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function ZipDetail({ z }: { z: ZipSheet }) {
  return (
    <div>
      <Card title={`${z.zip} ${z.city ? `· ${z.city}` : ""}`}>
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
          {z.insJobs} insurance jobs · dominant carrier: <strong>{z.dominantCarrier || "—"}</strong>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            { l: "Insurance Approval", v: fmtPct(z.insApprovalRate, 1), s: `${z.insApproved} of ${z.insJobs - z.insDead}` },
            { l: "Median deductible", v: z.medianDeductible ? `$${z.medianDeductible.toLocaleString()}` : "—" },
            { l: "Dominant carrier", v: z.dominantCarrier || "—" },
          ].map((k) => (
            <div key={k.l} style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>{k.l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 }}>{k.v}</div>
              {k.s && <div style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>{k.s}</div>}
            </div>
          ))}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Card title="Carriers in this ZIP">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Carrier</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th></tr></thead>
            <tbody>{z.topCarriers.map((c) => (
              <tr key={c.name}>
                <td style={tdStyle}>{c.name}</td><td style={tdNumStyle}>{c.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(c.approvalRate) }}>{fmtPct(c.approvalRate, 1)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="Top Adjusters in this ZIP">
          <table style={tblStyle}>
            <thead><tr><th style={thStyle}>Name</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approval</th></tr></thead>
            <tbody>{z.topAdjusters.length ? z.topAdjusters.map((a) => (
              <tr key={a.name}>
                <td style={tdStyle}>{a.name}</td><td style={tdNumStyle}>{a.jobs}</td>
                <td style={{ ...tdNumStyle, ...pctClass(a.approvalRate) }}>{fmtPct(a.approvalRate, 1)}</td>
              </tr>
            )) : <tr><td colSpan={3} style={{ ...tdStyle, color: "var(--riq-text-muted)", fontStyle: "italic" }}>No adjusters with 2+ jobs</td></tr>}</tbody>
          </table>
        </Card>
      </div>
      <Card title="Top Reps in this ZIP">
        <table style={tblStyle}>
          <thead><tr><th style={thStyle}>Rep</th><th style={thNumStyle}>Jobs</th><th style={thNumStyle}>Approved</th></tr></thead>
          <tbody>{z.topReps.map((r) => (
            <tr key={r.name}><td style={tdStyle}>{r.name}</td><td style={tdNumStyle}>{r.jobs}</td><td style={tdNumStyle}>{r.approved}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabType = "rep" | "carrier" | "adjuster" | "state" | "zip";

export function CheatSheet({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [data, setData] = useState<CheatSheetsResponse | null>(null);
  const [patents, setPatents] = useState<PatentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>("rep");
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/intel/cheat-sheets", { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<CheatSheetsResponse>;
      }),
      fetch("/api/intel/carrier-patents", { credentials: "include" })
        .then((r) => r.ok ? r.json() as Promise<PatentsResponse> : null)
        .catch(() => null),
    ])
      .then(([d, p]) => { setData(d); setPatents(p); setLoading(false); })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  // Build list items per tab
  type ListItem = { key: string; label: string; sub: string };
  function listItems(): ListItem[] {
    if (!data) return [];
    const q = search.toLowerCase();
    function filt(items: ListItem[]) { return q ? items.filter((i) => (i.label + i.sub).toLowerCase().includes(q)) : items; }
    if (tab === "rep") return filt(data.reps.map((r) => ({ key: r.name, label: r.name, sub: `${r.totals.insSigned} ins jobs · ${fmtMoney(r.totals.combinedSignedTotal)}` })));
    if (tab === "carrier") return filt(data.carriers.map((c) => ({ key: c.name, label: c.name, sub: `${c.totals.jobs} jobs · ${fmtPct(c.totals.approvalRate, 1)} approval` })));
    if (tab === "adjuster") return filt(data.adjusters.map((a) => ({ key: `${a.name}|${a.carrier}`, label: a.name, sub: `${a.carrier} · ${a.jobs} jobs · ${fmtPct(a.approvalRate, 1)} approval` })));
    if (tab === "state") return filt(data.states.map((s) => ({ key: s.state, label: s.state, sub: `${s.insJobs} ins jobs · ${fmtPct(s.insApprovalRate, 1)} approval` })));
    if (tab === "zip") return filt(data.zips.map((z) => ({ key: z.zip, label: `${z.zip}${z.city ? ` · ${z.city}` : ""}`, sub: `${z.insJobs} ins jobs · ${fmtPct(z.insApprovalRate, 1)} approval` })));
    return [];
  }

  const items = listItems();
  const resolvedKey = activeKey && items.find((i) => i.key === activeKey) ? activeKey : (items[0]?.key ?? null);

  function renderDetail() {
    if (!data || !resolvedKey) return <div style={{ color: "var(--riq-text-muted)" }}>Pick an entry on the left.</div>;
    if (tab === "rep") {
      const r = data.reps.find((x) => x.name === resolvedKey);
      return r ? <RepDetail r={r} team={data.team} /> : null;
    }
    if (tab === "carrier") {
      const c = data.carriers.find((x) => x.name === resolvedKey);
      return c ? <CarrierDetail c={c} patents={patents} /> : null;
    }
    if (tab === "adjuster") {
      const [name, carrier] = resolvedKey.split("|");
      const a = data.adjusters.find((x) => x.name === name && x.carrier === carrier);
      return a ? <AdjDetail a={a} /> : null;
    }
    if (tab === "state") {
      const s = data.states.find((x) => x.state === resolvedKey);
      return s ? <StateDetail s={s} /> : null;
    }
    if (tab === "zip") {
      const z = data.zips.find((x) => x.zip === resolvedKey || `${x.zip} · ${x.city}` === resolvedKey || `${x.zip}${x.city ? ` · ${x.city}` : ""}` === resolvedKey);
      // Also try exact zip match
      const zAlt = data.zips.find((x) => x.zip === resolvedKey.split(" · ")[0]);
      return (z || zAlt) ? <ZipDetail z={(z || zAlt)!} /> : null;
    }
    return null;
  }

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px", fontSize: 13, cursor: "pointer",
    color: active ? "var(--riq-accent)" : "var(--riq-text-muted)",
    border: `1px solid ${active ? "var(--riq-accent)" : "var(--riq-border)"}`,
    borderRadius: 6,
    background: active ? "#342c23" : "transparent",
    fontWeight: active ? 600 : 400,
    fontFamily: "inherit",
  });

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {loading && <div style={{ padding: 60, textAlign: "center", color: "var(--riq-accent)" }}>Loading cheat sheets…</div>}
      {error && <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>}
      {!loading && !error && data && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "14px 18px", marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(["rep", "carrier", "adjuster", "state", "zip"] as TabType[]).map((t) => (
                <button key={t} style={tabBtnStyle(tab === t)} onClick={() => { setTab(t); setActiveKey(null); setSearch(""); }}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}s
                </button>
              ))}
            </div>
            <input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "8px 14px", fontSize: 14, fontFamily: "inherit" }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>
            {/* Left list */}
            <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: 8, maxHeight: "80vh", overflowY: "auto" }}>
              {items.slice(0, 300).map((item) => (
                <div
                  key={item.key}
                  onClick={() => setActiveKey(item.key)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 13,
                    borderLeft: resolvedKey === item.key ? "3px solid var(--riq-accent)" : "3px solid transparent",
                    background: resolvedKey === item.key ? "#342c23" : "transparent",
                    paddingLeft: resolvedKey === item.key ? 9 : 12,
                  }}
                >
                  <div>{item.label}</div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>{item.sub}</div>
                </div>
              ))}
            </div>
            {/* Right detail */}
            <div style={{ overflowY: "auto" }}>
              {renderDetail()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
