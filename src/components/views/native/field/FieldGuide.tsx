/**
 * FieldGuide — native React replacement for public/field-guide.html
 *
 * Endpoint (verified against live prod):
 *   GET /api/intel/patterns
 *     → {
 *         hailTiers: { bucket, jobs, completed, dead, approvalRate }[],
 *         speedToSign: { bucket, jobs, completed, dead, approvalRate, avgApprovedJob }[],
 *         carrierByState: { carrier, state, jobs, completed, approvalRate }[],
 *         carrierByZip: { carrier, zip, city, jobs, completed, dead, approvalRate }[],
 *         adjusters: { name, carrier, jobs, completed, dead, approvalRate, avgApprovedJob, medianUplift, medianDeductible, topZips }[],
 *         reps: { name, jobs, completed, dead, approvalRate, revenue, bestCarrier, topTrade, topZip, avgApprovedJob, medianDaysLossToSign }[],
 *         dayOfWeek: { day, jobs, completed, approvalRate }[],
 *         monthOfYear: { month, jobs, completed, approvalRate, avgApprovedJob }[],
 *         totalProjects, generated
 *       }
 *
 * 9 tabs: Key Thresholds | Hail Size Approval | Speed-to-Sign |
 *         Carrier × State | Carrier × ZIP | Adjuster Patterns |
 *         Rep Best-Match | Day & Month Patterns | Battle-Tested Plays
 */
import { useState } from "react";
import { useFetch, fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface HailTier {
  bucket: string;
  jobs: number;
  completed: number;
  dead: number;
  approvalRate: number;
}

interface SpeedRow {
  bucket: string;
  jobs: number;
  completed: number;
  dead: number;
  approvalRate: number;
  avgApprovedJob: number;
}

interface CarrierStateRow {
  carrier: string;
  state: string;
  jobs: number;
  completed: number;
  approvalRate: number;
}

interface CarrierZipRow {
  carrier: string;
  zip: string;
  city?: string;
  jobs: number;
  completed: number;
  dead: number;
  approvalRate: number;
}

interface AdjusterRow {
  name: string;
  carrier: string;
  jobs: number;
  completed: number;
  dead: number;
  approvalRate: number;
  avgApprovedJob: number;
  medianUplift?: number | null;
  medianDeductible?: number | null;
}

interface RepRow {
  name: string;
  jobs: number;
  completed: number;
  dead: number;
  approvalRate: number;
  revenue: number;
  bestCarrier?: { carrier: string; signed: number; approvalRate: number } | null;
}

interface DayRow {
  day: string;
  jobs: number;
  completed: number;
  approvalRate: number;
}

interface MonthRow {
  month: string;
  jobs: number;
  completed: number;
  approvalRate: number;
  avgApprovedJob: number;
}

interface PatternsResponse {
  hailTiers: HailTier[];
  speedToSign: SpeedRow[];
  carrierByState: CarrierStateRow[];
  carrierByZip: CarrierZipRow[];
  adjusters: AdjusterRow[];
  reps: RepRow[];
  dayOfWeek: DayRow[];
  monthOfYear: MonthRow[];
  totalProjects: number;
  generated: string;
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
  fontSize: 11,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-surface)",
};

const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const inputStyle: React.CSSProperties = {
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

function pillCls(rate: number) {
  if (rate >= 0.75) return "#10b981";
  if (rate >= 0.5) return "#f59e0b";
  return "#ef4444";
}

function PillPct({ rate }: { rate: number }) {
  const color = pillCls(rate);
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: `${color}33`, color,
    }}>
      {fmtPct(rate, 1)}
    </span>
  );
}

function Insight({ text, variant = "default" }: { text: React.ReactNode; variant?: "default" | "warn" | "bad" | "good" }) {
  const colors: Record<string, { bg: string; border: string }> = {
    default: { bg: "rgba(94,200,255,0.08)", border: "var(--riq-accent)" },
    warn: { bg: "rgba(245,158,11,0.08)", border: "#f59e0b" },
    bad: { bg: "rgba(239,68,68,0.08)", border: "#ef4444" },
    good: { bg: "rgba(16,185,129,0.08)", border: "#10b981" },
  };
  const c = colors[variant];
  return (
    <div style={{ background: c.bg, borderLeft: `3px solid ${c.border}`, padding: "12px 16px", borderRadius: "0 6px 6px 0", margin: "10px 0", fontSize: 13, lineHeight: 1.6 }}>
      {text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TAB PANELS
// ---------------------------------------------------------------------------

function Thresholds() {
  const thresholds = [
    { what: "Hail size — asphalt 3-tab (functional)", val: '1.0"', src: "Soft threshold. State Farm uses 1.25\" + 15% granule loss." },
    { what: "Hail size — architectural", val: '1.25"', src: "Industry consensus (HAAG / Ridgeline)." },
    { what: "Hail size — Class 4 IR shingle", val: '1.75"', src: "Material spec." },
    { what: "Wind speed — shingle lift", val: "50 mph", src: "NWS / NSSL — soft." },
    { what: "Wind speed — significant", val: "58 mph", src: "NWS severe threshold." },
    { what: "Roof age — RCV → ACV cliff", val: "10 yr", src: "Many carriers drop to ACV at 10y. Cliff at 15y." },
    { what: "Roof age — non-renewal risk", val: "15-20 yr", src: "15y carrier reinspection trigger; 20y non-renewal common." },
    { what: "Test square impacts (10'×10')", val: "8-10", src: "HAAG protocol. <8 = repair; ≥8 = replacement." },
    { what: "Days from loss to notify", val: "365", src: "Most policy max. Practical: 60-90 days." },
    { what: "Suit limitation", val: "1-2 yr", src: "Per policy \"Suit Against Us\"." },
  ];

  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>
        Industry-Backed Approval Thresholds
      </h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>
        From HAAG, NWS, NSSL, NCEI, RoofPredict, and Insurance industry research.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {thresholds.map((t) => (
          <div key={t.what} style={{ background: "#342c23", borderRadius: 6, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--riq-text-muted)", textTransform: "uppercase" }}>{t.what}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{t.val}</div>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 4, fontStyle: "italic" }}>{t.src}</div>
          </div>
        ))}
      </div>
      <h2 style={{ margin: "24px 0 8px", fontSize: 14, fontWeight: 700, color: "var(--riq-accent)" }}>
        Our Data Confirms
      </h2>
      <Insight variant="good" text={<><strong>Speed-to-sign sweet spot is 31-90 days</strong> — across 5,000+ matched jobs, 31-90d window converts at <strong>82.6%</strong> vs 61.9% at 181-365d.</>} />
      <Insight text={<><strong>Hail tier non-linearity</strong> — 1.0-1.25" hail = 73% approval. Drops at 1.25-1.5" (52%) because carriers send to engineers. Spikes back up at 1.5"+ (76-82%).</>} />
      <Insight variant="warn" text={<><strong>Adjuster identity &gt; damage</strong> — Same property, different IA = opposite outcome. Track adjuster name in every appointment.</>} />
    </section>
  );
}

function HailTab({ tiers }: { tiers: HailTier[] }) {
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Hail Magnitude → Approval Rate</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>Our 16k jobs cross-referenced against IEM Local Storm Reports.</p>
      <table style={tblStyle}>
        <thead><tr>
          <th style={thStyle}>Hail tier</th>
          <th style={thNumStyle}>Jobs</th>
          <th style={thNumStyle}>Approved</th>
          <th style={thNumStyle}>Dead</th>
          <th style={thNumStyle}>Approval rate</th>
        </tr></thead>
        <tbody>{tiers.map((t) => (
          <tr key={t.bucket}>
            <td style={tdStyle}>{t.bucket.replace(/_/g, "–").replace("lt", "<").replace("gte", "≥")}</td>
            <td style={tdNumStyle}>{t.jobs}</td>
            <td style={tdNumStyle}>{t.completed}</td>
            <td style={tdNumStyle}>{t.dead}</td>
            <td style={tdNumStyle}><PillPct rate={t.approvalRate} /></td>
          </tr>
        ))}</tbody>
      </table>
      <Insight variant="good" text={<><strong>The 1.0-1.25" sweet spot</strong>: best approval band — adjusters approve fastest without invoking engineer reports.</>} />
      <Insight variant="warn" text={<><strong>The 1.25-1.5" valley</strong>: counter-intuitive drop — carrier engineers routinely deny in this range. Pre-emptively bring an independent HAAG-certified inspector.</>} />
    </section>
  );
}

function SpeedTab({ rows }: { rows: SpeedRow[] }) {
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Days from Date-of-Loss to Signed → Approval Rate</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>How fast Roof Docs gets the contract relative to the storm event.</p>
      <table style={tblStyle}>
        <thead><tr>
          <th style={thStyle}>Window</th>
          <th style={thNumStyle}>Jobs</th>
          <th style={thNumStyle}>Approved</th>
          <th style={thNumStyle}>Dead</th>
          <th style={thNumStyle}>Approval rate</th>
          <th style={thNumStyle}>Avg approved $</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.bucket}>
            <td style={tdStyle}>{r.bucket}</td>
            <td style={tdNumStyle}>{r.jobs}</td>
            <td style={tdNumStyle}>{r.completed}</td>
            <td style={tdNumStyle}>{r.dead}</td>
            <td style={tdNumStyle}><PillPct rate={r.approvalRate} /></td>
            <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.avgApprovedJob)}</td>
          </tr>
        ))}</tbody>
      </table>
      <Insight variant="good" text={<><strong>31-90 days is the sweet spot (82.6%).</strong> Reps who sign in this window beat both rushed and stale leads.</>} />
      <Insight variant="bad" text={<><strong>181-365 days = 61.9%.</strong> Once past 6 months from loss, the carrier has already settled, denied, or is fighting harder.</>} />
    </section>
  );
}

function CarrierStateTab({ rows }: { rows: CarrierStateRow[] }) {
  const sorted = [...rows].sort((a, b) => b.jobs - a.jobs).slice(0, 60);
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Carrier × State — Where Each Carrier Plays Hardest</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>Matching laws differ by state (PA adverse; MD has strong bad-faith statute §27-303).</p>
      <div style={{ maxHeight: 580, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Carrier</th>
            <th style={thStyle}>State</th>
            <th style={thNumStyle}>Jobs</th>
            <th style={thNumStyle}>Approved</th>
            <th style={thNumStyle}>Approval rate</th>
          </tr></thead>
          <tbody>{sorted.map((r, i) => (
            <tr key={i}>
              <td style={{ ...tdStyle, color: "var(--riq-accent)" }}>{r.carrier}</td>
              <td style={tdStyle}>{r.state}</td>
              <td style={tdNumStyle}>{r.jobs}</td>
              <td style={tdNumStyle}>{r.completed}</td>
              <td style={tdNumStyle}><PillPct rate={r.approvalRate} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function CarrierZipTab({ rows }: { rows: CarrierZipRow[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("approval-desc");

  let filtered = [...rows];
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((r) =>
      `${r.carrier} ${r.zip} ${r.city || ""}`.toLowerCase().includes(q)
    );
  }
  if (sort === "approval-desc") filtered.sort((a, b) => b.approvalRate - a.approvalRate);
  else if (sort === "approval-asc") filtered.sort((a, b) => a.approvalRate - b.approvalRate);
  else if (sort === "jobs-desc") filtered.sort((a, b) => b.jobs - a.jobs);
  else filtered.sort((a, b) => a.zip.localeCompare(b.zip));

  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Carrier × ZIP — Highest-Confidence Combos (≥10 jobs)</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>
        When you canvas a zip, this tells you which carriers Roof Docs has the best track record with in that exact area.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="zip / city / carrier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 240 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle}>
          <option value="approval-desc">Approval rate (high)</option>
          <option value="approval-asc">Approval rate (low)</option>
          <option value="jobs-desc">Jobs (high)</option>
          <option value="zip-asc">ZIP (a-z)</option>
        </select>
      </div>
      <div style={{ maxHeight: 580, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Carrier</th>
            <th style={thStyle}>ZIP</th>
            <th style={thStyle}>City</th>
            <th style={thNumStyle}>Jobs</th>
            <th style={thNumStyle}>Approved</th>
            <th style={thNumStyle}>Dead</th>
            <th style={thNumStyle}>Approval rate</th>
          </tr></thead>
          <tbody>{filtered.slice(0, 300).map((r, i) => (
            <tr key={i}>
              <td style={tdStyle}>{r.carrier}</td>
              <td style={tdStyle}><strong>{r.zip}</strong></td>
              <td style={tdStyle}>{r.city || "—"}</td>
              <td style={tdNumStyle}>{r.jobs}</td>
              <td style={tdNumStyle}>{r.completed}</td>
              <td style={tdNumStyle}>{r.dead}</td>
              <td style={tdNumStyle}><PillPct rate={r.approvalRate} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function AdjustersTab({ adjusters }: { adjusters: AdjusterRow[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("approval-desc");

  let rows = adjusters.filter((a) => a.jobs >= 3);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => `${r.name} ${r.carrier}`.toLowerCase().includes(q));
  }
  if (sort === "approval-desc") rows.sort((a, b) => b.approvalRate - a.approvalRate);
  else if (sort === "approval-asc") rows.sort((a, b) => a.approvalRate - b.approvalRate);
  else if (sort === "completed-desc") rows.sort((a, b) => b.completed - a.completed);
  else rows.sort((a, b) => (b.medianUplift || 0) - (a.medianUplift || 0));

  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Adjuster Approval Patterns (≥3 jobs)</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>
        Adjuster identity &gt; damage — same property, different IA, opposite outcomes.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          placeholder="adjuster / carrier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 240 }}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle}>
          <option value="approval-desc">Approval rate (high)</option>
          <option value="approval-asc">Approval rate (low)</option>
          <option value="completed-desc">Approved jobs (high)</option>
          <option value="uplift-desc">Supplement uplift (high)</option>
        </select>
      </div>
      <div style={{ maxHeight: 580, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Adjuster</th>
            <th style={thStyle}>Carrier</th>
            <th style={thNumStyle}>Jobs</th>
            <th style={thNumStyle}>Approved</th>
            <th style={thNumStyle}>Dead</th>
            <th style={thNumStyle}>Approval rate</th>
            <th style={thNumStyle}>Avg approved</th>
            <th style={thNumStyle}>Median uplift</th>
          </tr></thead>
          <tbody>{rows.slice(0, 300).map((r, i) => (
            <tr key={i}>
              <td style={tdStyle}>{r.name}</td>
              <td style={tdStyle}>{r.carrier}</td>
              <td style={tdNumStyle}>{r.jobs}</td>
              <td style={tdNumStyle}>{r.completed}</td>
              <td style={tdNumStyle}>{r.dead}</td>
              <td style={tdNumStyle}><PillPct rate={r.approvalRate} /></td>
              <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.avgApprovedJob)}</td>
              <td style={tdNumStyle}>
                {r.medianUplift != null ? fmtPct(r.medianUplift, 1) : "—"}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function RepCarrierTab({ reps }: { reps: RepRow[] }) {
  const rows = reps.filter((r) => r.bestCarrier).slice(0, 80);
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Rep × Best Carrier Match</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>
        For each rep with ≥5 jobs: which carrier they have the best approval rate with.
      </p>
      <div style={{ maxHeight: 580, overflowY: "auto" }}>
        <table style={tblStyle}>
          <thead><tr>
            <th style={thStyle}>Rep</th>
            <th style={thNumStyle}>Total Jobs</th>
            <th style={thNumStyle}>Approval %</th>
            <th style={thStyle}>Best Carrier</th>
            <th style={thNumStyle}>w/ that carrier</th>
            <th style={thNumStyle}>Approval there</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td style={tdStyle}>{r.name}</td>
              <td style={tdNumStyle}>{r.jobs}</td>
              <td style={tdNumStyle}><PillPct rate={r.approvalRate} /></td>
              <td style={tdStyle}>{r.bestCarrier!.carrier}</td>
              <td style={tdNumStyle}>{r.bestCarrier!.signed}</td>
              <td style={tdNumStyle}><PillPct rate={r.bestCarrier!.approvalRate} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function TimingTab({ days, months }: { days: DayRow[]; months: MonthRow[] }) {
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Day-of-Week & Month-of-Year Patterns</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Day of week — when reps sign</div>
          <table style={tblStyle}>
            <thead><tr>
              <th style={thStyle}>Day</th>
              <th style={thNumStyle}>Signed</th>
              <th style={thNumStyle}>Approval %</th>
            </tr></thead>
            <tbody>{days.map((d) => (
              <tr key={d.day}>
                <td style={tdStyle}>{d.day}</td>
                <td style={tdNumStyle}>{d.jobs}</td>
                <td style={tdNumStyle}><PillPct rate={d.approvalRate} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Month — seasonal signal</div>
          <table style={tblStyle}>
            <thead><tr>
              <th style={thStyle}>Month</th>
              <th style={thNumStyle}>Signed</th>
              <th style={thNumStyle}>Approval %</th>
              <th style={thNumStyle}>Avg $</th>
            </tr></thead>
            <tbody>{months.map((m) => (
              <tr key={m.month}>
                <td style={tdStyle}>{m.month}</td>
                <td style={tdNumStyle}>{m.jobs}</td>
                <td style={tdNumStyle}><PillPct rate={m.approvalRate} /></td>
                <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(m.avgApprovedJob)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const PLAYS = [
  { n: 1, text: "Meet the adjuster on the roof. Industry baseline: contractor-attended inspections = ~25% higher first-pass approval. Non-negotiable for first inspections." },
  { n: 2, text: "Pre-document the roof in person — chalk circles, macro phone photos, every slope before they arrive. Geo-tagged, timestamped. Eliminates ~80% of \"pre-existing\" disputes." },
  { n: 3, text: "Demand Xactimate \"Restoration\" pricing, not \"New Construction.\" State Farm routinely defaults to \"New Construction\" (~15-25% lower). Cite trial precedent on first email." },
  { n: 4, text: "Itemize permits, code upgrade, ice/water shield, drip edge, starter, ridge vent, O&P. Desk adjusters approve what's spelled out — they don't add lines." },
  { n: 5, text: "File supplements within 24-48 hrs of tear-off discovery. Original estimate + annotated photos + manufacturer install specs." },
  { n: 6, text: "Request reinspection when scope ≠ damage. Almost every policy grants it. CAT adjusters under-document — re-inspections favor us." },
  { n: 7, text: "Escalate properly: supervisor → desk manager → claims manager → DOI complaint. Three rungs before regulator." },
  { n: 8, text: "Invoke appraisal when $/scope gap > ~$15-25K AND coverage is undisputed. Cost: $500-1,500/appraiser. Favors insureds heavily." },
  { n: 9, text: "File DOI complaint in MD citing §27-303 (\"arbitrary or capricious\" denial, $2,500-$125,000 penalty). Sharp behavioral shift once filed." },
  { n: 10, text: "Code-upgrade leverage: get written notice from the building inspector listing required upgrades. Forces Ordinance/Law coverage activation — typically 10-25% of Coverage A." },
];

function PlaysTab() {
  return (
    <section style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Battle-Tested Plays (research-validated)</h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14 }}>From property insurance attorneys, public adjusters, and supplement experts.</p>
      {PLAYS.map((p) => (
        <div key={p.n} style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "10px 14px", marginBottom: 8, fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--riq-accent)" }}>{p.n}.</strong> {p.text}
        </div>
      ))}
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "24px 0 8px", color: "var(--riq-accent)" }}>State Differences That Matter</h3>
      <Insight variant="bad" text={<><strong>PA: matching is adverse.</strong> Per <em>Greene v. USAA</em> (2007), "damaged part" = damaged shingles only, no full-roof match obligation. Build slope-only estimates first.</>} />
      <Insight variant="good" text={<><strong>MD: strongest bad-faith statute (§27-303).</strong> $2,500-$125,000 per violation. Use the complaint threat early in disputes.</>} />
      <Insight variant="warn" text={<><strong>VA: long 5-yr SOL but weak bad-faith leverage.</strong> §38.2-209 requires "not in good faith" — high bar. Lean on procedural escalation, not statute.</>} />
      <Insight variant="bad" text={<><strong>PA: 2-year SOL — shortest.</strong> File and serve fast on disputed claims.</>} />
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "24px 0 8px", color: "var(--riq-accent)" }}>Counterintuitive Findings</h3>
      <Insight variant="warn" text={<><strong>MRMS hail often overshoots ground truth by 25-40%.</strong> Cross-corroborate with IEM LSR + NCEI Storm Events on every claim.</>} />
      <Insight variant="bad" text={<><strong>Cosmetic damage endorsement is silent.</strong> Often added at renewal without homeowner attention. Check carrier's recent declarations before estimating.</>} />
      <Insight text={<><strong>EXIF metadata is now scanned.</strong> Verisk ClaimSearch image forensics flag date-stamp mismatches as fraud. Train field reps to use the official app camera.</>} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TabId = "thresholds" | "hail" | "speed" | "carrier-state" | "carrier-zip" | "adjusters" | "rep-carrier" | "timing" | "plays";

const TABS: { id: TabId; label: string }[] = [
  { id: "thresholds", label: "Key Thresholds" },
  { id: "hail", label: "Hail Size Approval" },
  { id: "speed", label: "Speed-to-Sign" },
  { id: "carrier-state", label: "Carrier × State" },
  { id: "carrier-zip", label: "Carrier × ZIP" },
  { id: "adjusters", label: "Adjuster Patterns" },
  { id: "rep-carrier", label: "Rep Best-Match" },
  { id: "timing", label: "Day & Month Patterns" },
  { id: "plays", label: "Battle-Tested Plays" },
];

export function FieldGuide({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const { data, error, loading } = useFetch<PatternsResponse>("/api/intel/patterns");
  const [activeTab, setActiveTab] = useState<TabId>("thresholds");

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "var(--riq-accent)" }}>
        Field Guide — Patterns, Thresholds, Battle-Tested Plays
      </h2>

      {loading && <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading patterns…</div>}
      {error && <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>}

      {!loading && !error && data && (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--riq-border)", flexWrap: "wrap" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: "10px 16px",
                  cursor: "pointer",
                  color: activeTab === t.id ? "var(--riq-accent)" : "var(--riq-text-muted)",
                  fontSize: 13,
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${activeTab === t.id ? "var(--riq-accent)" : "transparent"}`,
                  fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {activeTab === "thresholds" && <Thresholds />}
          {activeTab === "hail" && <HailTab tiers={data.hailTiers} />}
          {activeTab === "speed" && <SpeedTab rows={data.speedToSign} />}
          {activeTab === "carrier-state" && <CarrierStateTab rows={data.carrierByState} />}
          {activeTab === "carrier-zip" && <CarrierZipTab rows={data.carrierByZip} />}
          {activeTab === "adjusters" && <AdjustersTab adjusters={data.adjusters} />}
          {activeTab === "rep-carrier" && <RepCarrierTab reps={data.reps} />}
          {activeTab === "timing" && <TimingTab days={data.dayOfWeek} months={data.monthOfYear} />}
          {activeTab === "plays" && <PlaysTab />}
        </>
      )}
    </div>
  );
}
