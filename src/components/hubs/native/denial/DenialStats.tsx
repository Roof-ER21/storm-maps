/**
 * Denial Combat Hub — Stats tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/denial-stats.html.
 *
 * Data flow:
 *   1. On mount: GET /api/intel/denial-intake/stats
 *      Returns: { total, byCarrier, byOutcome, winRates, stanceRollup, carrierStanceMatrix }
 *
 * Features:
 *   - KPI tiles (total / with-outcome / approved / partial / overall flip rate)
 *   - Top carriers by denial volume (sortable)
 *   - Outcome breakdown
 *   - Stance A/B performance rollup
 *   - Carrier × stance heatmap
 *   - Flip rate by carrier (sortable)
 *
 * No props — owns all state.
 */
import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface OutcomeRow {
  outcome: string;
  count: number;
}

interface CarrierRow {
  carrier: string;
  count: number;
}

interface WinRateRow {
  carrier: string;
  total: number;
  approved: number;
  partial: number;
  denied: number;
  flipRate: number;
}

interface StanceRow {
  stance: string;
  analyzed: number;
  withOutcome: number;
  approved: number;
  partial: number;
  denied: number;
  flipRate: number | null;
}

interface CXSCell {
  total: number;
  approved: number;
  partial: number;
  denied: number;
  flipRate: number | null;
}

interface CarrierStanceRow {
  carrier: string;
  totalOutcomes: number;
  cells: Record<string, CXSCell | null>;
  recommendedStance: string | null;
  recommendedFlipRate: number | null;
}

interface StatsResponse {
  total: number;
  byCarrier: CarrierRow[];
  byOutcome: OutcomeRow[];
  winRates: WinRateRow[];
  stanceRollup: StanceRow[];
  carrierStanceMatrix: CarrierStanceRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCENT = "var(--riq-accent)";
const MUTED = "var(--riq-text-muted)";
const TEXT = "var(--riq-text)";
const SURFACE = "var(--riq-surface)";
const BORDER = "var(--riq-border)";

const RED = "#ef4444";
const GREEN = "#10b981";
const YELLOW = "#f59e0b";

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

const STANCE_LABELS: Record<string, string> = {
  "firm-legal": "Firm-legal",
  "collaborative-evidence": "Collaborative-evidence",
  "escalation-focused": "Escalation-focused",
};

// ---------------------------------------------------------------------------
// Shared table style constants
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thBase: React.CSSProperties = {
  textAlign: "left",
  color: MUTED,
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "8px 6px",
  borderBottom: `1px solid ${BORDER}`,
  cursor: "pointer",
  userSelect: "none",
};

const thNum: React.CSSProperties = { ...thBase, textAlign: "right" };

const tdBase: React.CSSProperties = {
  padding: "7px 6px",
  borderBottom: "1px solid #342c23",
  verticalAlign: "middle",
};

const tdNum: React.CSSProperties = {
  ...tdBase,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Shared Section wrapper
// ---------------------------------------------------------------------------

function SectionPanel({ title, desc, children }: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "18px 22px",
        marginBottom: 16,
      }}
    >
      <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: ACCENT }}>
        {title}
      </h2>
      {desc && (
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 14, marginTop: 0, lineHeight: 1.5 }}>
          {desc}
        </p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

function Pill({ outcome }: { outcome: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    approved: { bg: "rgba(16,185,129,0.2)", color: GREEN },
    partial: { bg: "rgba(245,158,11,0.2)", color: YELLOW },
    denied: { bg: "rgba(239,68,68,0.2)", color: RED },
  };
  const s = map[outcome];
  const label = outcome.charAt(0).toUpperCase() + outcome.slice(1);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: s?.bg ?? "#342c23",
        color: s?.color ?? MUTED,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mini bar cell (distribution)
// ---------------------------------------------------------------------------

function BarCell({
  total,
  approved,
  partial,
  denied,
}: {
  total: number;
  approved: number;
  partial: number;
  denied: number;
}) {
  const aw = total ? (approved / total) * 100 : 0;
  const pw = total ? (partial / total) * 100 : 0;
  const dw = total ? (denied / total) * 100 : 0;
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 120 }}
      title={`approved ${approved} / partial ${partial} / denied ${denied}`}
    >
      <span
        style={{
          display: "inline-block",
          height: 10,
          background: GREEN,
          borderRadius: 2,
          minWidth: 1,
          width: `${aw.toFixed(1)}px`,
        }}
      />
      <span
        style={{
          display: "inline-block",
          height: 10,
          background: YELLOW,
          borderRadius: 2,
          minWidth: 1,
          width: `${pw.toFixed(1)}px`,
        }}
      />
      <span
        style={{
          display: "inline-block",
          height: 10,
          background: RED,
          borderRadius: 2,
          minWidth: 1,
          width: `${dw.toFixed(1)}px`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

function KpiTiles({ data }: { data: StatsResponse }) {
  const total = data.total;
  const approved = data.byOutcome.find((o) => o.outcome === "approved")?.count ?? 0;
  const partial = data.byOutcome.find((o) => o.outcome === "partial")?.count ?? 0;
  const denied = data.byOutcome.find((o) => o.outcome === "denied")?.count ?? 0;
  const withOutcome = approved + partial + denied;
  const flipRate = withOutcome > 0 ? (approved + partial) / withOutcome : null;

  const tiles: Array<{ label: string; value: string; colorClass?: "green" | "yellow" | "red" }> = [
    { label: "Total denials archived", value: fmtNum(total) },
    { label: "With recorded outcome", value: fmtNum(withOutcome) },
    { label: "Approved (full flip)", value: fmtNum(approved), colorClass: "green" },
    { label: "Partial (partial flip)", value: fmtNum(partial), colorClass: "yellow" },
    {
      label: "Overall flip rate",
      value: fmtPct(flipRate),
      colorClass:
        flipRate != null && flipRate >= 0.5
          ? "green"
          : flipRate != null && flipRate < 0.25
          ? "red"
          : "yellow",
    },
  ];

  const colorMap: Record<string, string> = {
    green: GREEN,
    yellow: YELLOW,
    red: RED,
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: 10,
        marginBottom: 16,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{ background: "#342c23", borderRadius: 6, padding: "11px 14px" }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: t.colorClass ? colorMap[t.colorClass] : ACCENT,
            }}
          >
            {t.value}
          </div>
          <div style={{ color: MUTED, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
            {t.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carrier volume table (sortable)
// ---------------------------------------------------------------------------

function CarrierVolumeTable({ rows: initialRows }: { rows: CarrierRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [sortKey, setSortKey] = useState<"carrier" | "count">("count");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  function sort(key: "carrier" | "count") {
    const dir: 1 | -1 = sortKey === key ? (sortDir === 1 ? -1 : 1) : key === "carrier" ? 1 : -1;
    setSortKey(key);
    setSortDir(dir);
    setRows((prev) =>
      [...prev].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === "string") return dir * (av as string).localeCompare(bv as string);
        return dir * ((av as number) - (bv as number));
      }),
    );
  }

  function thIndicator(key: "carrier" | "count") {
    if (sortKey !== key) return "";
    return sortDir > 0 ? " ▲" : " ▼";
  }

  if (!rows.length) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 13 }}>
        No denials yet.
      </div>
    );
  }

  return (
    <table style={tblStyle}>
      <thead>
        <tr>
          <th
            style={thBase}
            onClick={() => sort("carrier")}
          >
            Carrier{thIndicator("carrier")}
          </th>
          <th
            style={{ ...thNum, color: sortKey === "count" ? ACCENT : MUTED }}
            onClick={() => sort("count")}
          >
            Denials{thIndicator("count")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.carrier}>
            <td style={tdBase}>
              <span style={{ color: ACCENT }}>{r.carrier}</span>
            </td>
            <td style={tdNum}>{fmtNum(r.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Outcome breakdown table
// ---------------------------------------------------------------------------

function OutcomeTable({ rows }: { rows: OutcomeRow[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!rows.length) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 13 }}>
        No outcomes recorded yet.
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return (
    <table style={tblStyle}>
      <thead>
        <tr>
          <th style={thBase}>Outcome</th>
          <th style={thNum}>Count</th>
          <th style={thNum}>Share</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.outcome}>
            <td style={tdBase}>
              <Pill outcome={r.outcome} />
            </td>
            <td style={tdNum}>{fmtNum(r.count)}</td>
            <td style={tdNum}>{fmtPct(r.count / Math.max(1, total))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Stance A/B table
// ---------------------------------------------------------------------------

function StanceTable({ rows }: { rows: StanceRow[] }) {
  if (!rows.length) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 13 }}>
        No stance-tagged analyses yet. New analyses are tagged automatically — run a few through the Analyzer and they'll appear here.
      </div>
    );
  }
  return (
    <table style={tblStyle}>
      <thead>
        <tr>
          <th style={thBase}>Stance</th>
          <th style={thNum}>Analyses</th>
          <th style={thNum}>With outcome</th>
          <th style={thBase}>Distribution</th>
          <th style={thNum}>Flip Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const low = r.withOutcome < 3;
          return (
            <tr key={r.stance} style={{ opacity: low ? 0.5 : 1 }}>
              <td style={tdBase}>
                <strong>{STANCE_LABELS[r.stance] ?? r.stance}</strong>
                {low && r.withOutcome > 0 && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#342c23",
                      color: MUTED,
                      marginLeft: 6,
                    }}
                  >
                    low N
                  </span>
                )}
              </td>
              <td style={tdNum}>{fmtNum(r.analyzed)}</td>
              <td style={tdNum}>{fmtNum(r.withOutcome)}</td>
              <td style={tdBase}>
                {r.withOutcome > 0 ? (
                  <BarCell
                    total={r.withOutcome}
                    approved={r.approved}
                    partial={r.partial}
                    denied={r.denied}
                  />
                ) : (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#342c23",
                      color: MUTED,
                    }}
                  >
                    no outcomes yet
                  </span>
                )}
              </td>
              <td style={tdNum}>
                <strong>{fmtPct(r.flipRate)}</strong>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Carrier × stance heatmap
// ---------------------------------------------------------------------------

function CxsTable({ rows }: { rows: CarrierStanceRow[] }) {
  if (!rows.length) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 13 }}>
        No outcome data per carrier × stance yet. As analyses get outcomes marked in the Archive, this heatmap fills in.
      </div>
    );
  }

  function cellTd(cells: Record<string, CXSCell | null>, stance: string) {
    const c = cells?.[stance];
    if (!c || c.total === 0) {
      return <td key={stance} style={{ ...tdNum, color: MUTED }}>—</td>;
    }
    if (c.total < 3) {
      return <td key={stance} style={{ ...tdNum, color: MUTED, fontSize: 11 }}>n={c.total}</td>;
    }
    const fr = c.flipRate ?? 0;
    const bg =
      fr >= 0.75
        ? "rgba(16,185,129,0.20)"
        : fr >= 0.50
        ? "rgba(245,158,11,0.20)"
        : "rgba(239,68,68,0.20)";
    const color = fr >= 0.75 ? GREEN : fr >= 0.50 ? YELLOW : RED;
    return (
      <td
        key={stance}
        style={{ ...tdNum, background: bg, color, fontWeight: 600 }}
        title={`${c.approved} approved / ${c.partial} partial / ${c.denied} denied`}
      >
        {fmtPct(fr)}
        <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>n={c.total}</div>
      </td>
    );
  }

  const stances = ["firm-legal", "collaborative-evidence", "escalation-focused"] as const;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ ...tblStyle, minWidth: 600 }}>
        <thead>
          <tr>
            <th style={thBase}>Carrier</th>
            <th style={thNum}>Outcomes</th>
            <th style={thNum}>Firm-legal</th>
            <th style={thNum}>Collaborative</th>
            <th style={thNum}>Escalation</th>
            <th style={thBase}>Recommended</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.carrier}>
              <td style={tdBase}>
                <span style={{ color: ACCENT }}>{r.carrier}</span>
              </td>
              <td style={tdNum}>{fmtNum(r.totalOutcomes)}</td>
              {stances.map((s) => cellTd(r.cells, s))}
              <td style={tdBase}>
                {r.recommendedStance ? (
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: "rgba(16,185,129,0.2)",
                        color: GREEN,
                      }}
                    >
                      {STANCE_LABELS[r.recommendedStance] ?? r.recommendedStance}
                    </span>{" "}
                    <span style={{ color: MUTED, fontSize: 11 }}>@ {fmtPct(r.recommendedFlipRate)}</span>
                  </>
                ) : (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#342c23",
                      color: MUTED,
                    }}
                  >
                    need more data
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flip rate by carrier (sortable)
// ---------------------------------------------------------------------------

function WinRateTable({ rows: initialRows }: { rows: WinRateRow[] }) {
  const filtered = initialRows.filter((r) => r.total > 0);
  const [rows, setRows] = useState(filtered);
  const [sortKey, setSortKey] = useState<keyof WinRateRow>("flipRate");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  useEffect(() => {
    setRows(initialRows.filter((r) => r.total > 0));
  }, [initialRows]);

  function sort(key: keyof WinRateRow) {
    const dir: 1 | -1 = sortKey === key ? (sortDir === 1 ? -1 : 1) : key === "carrier" ? 1 : -1;
    setSortKey(key);
    setSortDir(dir);
    setRows((prev) =>
      [...prev].sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === "string") return dir * (av as string).localeCompare(bv as string);
        return dir * ((av as number) - (bv as number));
      }),
    );
  }

  function thInd(key: keyof WinRateRow) {
    if (sortKey !== key) return "";
    return sortDir > 0 ? " ▲" : " ▼";
  }

  if (!rows.length) {
    return (
      <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED, fontSize: 13 }}>
        No outcomes recorded yet — mark a few outcomes in the Archive to populate this table.
      </div>
    );
  }

  return (
    <table style={tblStyle}>
      <thead>
        <tr>
          <th style={thBase} onClick={() => sort("carrier")}>
            Carrier{thInd("carrier")}
          </th>
          <th style={{ ...thNum, color: sortKey === "total" ? ACCENT : MUTED }} onClick={() => sort("total")}>
            Outcomes{thInd("total")}
          </th>
          <th style={thBase}>Distribution</th>
          <th
            style={{ ...thNum, color: sortKey === "flipRate" ? ACCENT : MUTED }}
            onClick={() => sort("flipRate")}
          >
            Flip Rate{thInd("flipRate")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const low = r.total < 3;
          return (
            <tr key={r.carrier} style={{ opacity: low ? 0.5 : 1 }}>
              <td style={tdBase}>
                <span style={{ color: ACCENT }}>{r.carrier}</span>
                {low && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#342c23",
                      color: MUTED,
                      marginLeft: 6,
                    }}
                  >
                    low N
                  </span>
                )}
              </td>
              <td style={tdNum}>{fmtNum(r.total)}</td>
              <td style={tdBase}>
                <BarCell
                  total={r.total}
                  approved={r.approved}
                  partial={r.partial}
                  denied={r.denied}
                />
              </td>
              <td style={tdNum}>
                <strong>{fmtPct(r.flipRate)}</strong>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DenialStats() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/intel/denial-intake/stats", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<StatsResponse>;
      })
      .then((d) => {
        setData(d);
        setNoData((d.total ?? 0) === 0);
      })
      .catch((e: unknown) => {
        setLoadErr((e as Error).message ?? String(e));
        setNoData(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: TEXT }}>
        <div style={{ padding: 50, textAlign: "center", color: ACCENT }}>Loading stats…</div>
      </div>
    );
  }

  if (noData || !data) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: TEXT }}>
        <div style={{ padding: "60px 20px", textAlign: "center", color: MUTED }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: TEXT, marginBottom: 8 }}>
            No outcome data yet
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
            Submit denial letters through the Analyzer, then mark outcomes in the Archive. Stats populate automatically as outcomes accumulate.
            {loadErr && (
              <div style={{ color: RED, marginTop: 8, fontSize: 12 }}>Error: {loadErr}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: TEXT }}>
      {/* KPI overview */}
      <SectionPanel
        title="Counter-letter performance overview"
        desc="Aggregate denial-archive performance. As reps mark outcomes on archived denials, RIQ learns which carriers flip most often and which boilerplate strategies actually work. Numbers update live from the denial-intake corpus."
      >
        <KpiTiles data={data} />
      </SectionPanel>

      {/* Two-column: carrier volume + outcome breakdown */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <SectionPanel
          title="Top carriers by denial volume"
          desc="Where denials are coming from. Top 20 by canonical carrier name."
        >
          <CarrierVolumeTable rows={data.byCarrier} />
        </SectionPanel>

        <SectionPanel
          title="Outcome breakdown"
          desc="Latest outcome marked per archived denial."
        >
          <OutcomeTable rows={data.byOutcome} />
        </SectionPanel>
      </div>

      {/* Stance A/B */}
      <SectionPanel
        title="Stance A/B performance"
        desc="RIQ randomly picks one of three counter-letter stances per analysis (firm-legal, collaborative-evidence, escalation-focused) and records which one was used. Once enough outcomes accumulate, the winning stance per carrier flips on automatically. Low-volume table early on — needs ~50+ outcomes before the per-stance flip rate stabilizes."
      >
        <StanceTable rows={data.stanceRollup} />
        <p style={{ color: MUTED, fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          Variant directives steer the <code>counterLetter</code> + <code>recommendedActions</code> tone only. Analytical fields (carrier, adjuster, denial reasons, patent matches, bad-faith signals) stay stance-neutral so comparisons across variants are apples-to-apples.
        </p>
      </SectionPanel>

      {/* Carrier × stance heatmap */}
      <SectionPanel
        title="Carrier × stance heatmap"
        desc="Per-carrier flip-rate by stance. Once a cell reaches ≥3 outcomes (the 'stable enough' floor), it shows as a colored tile and contributes to the recommended-stance pick for that carrier. Until then, only counts appear. Sparse early — heatmap fills in as more denials with each stance accumulate per carrier."
      >
        <CxsTable rows={data.carrierStanceMatrix} />
        <p style={{ color: MUTED, fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          When carrier has ≥3 outcomes per stance, the cell is color-coded (green ≥75% / yellow 50-74% / red &lt;50%). "Recommended" picks the highest flip-rate stance with at least 3 outcomes. If no stance has ≥3, recommendation stays blank and analyzer keeps random-selecting.
        </p>
      </SectionPanel>

      {/* Flip rate by carrier */}
      <SectionPanel
        title="Flip rate by carrier"
        desc="Where our counter-letters actually work. Flip rate = (approved + partial) / total denials with an outcome. Carriers with fewer than 3 outcomes are de-emphasized — the percentage is volatile at low N."
      >
        <WinRateTable rows={data.winRates} />
        <p style={{ color: MUTED, fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
          "Approved" = denial overturned in full. "Partial" = adjuster came back with a partial scope. "Denied" = re-affirmed denial. Pending outcomes are excluded from this table.
        </p>
      </SectionPanel>

      <p style={{ color: MUTED, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
        Source: <code>/api/intel/denial-intake/stats</code>. Carrier names normalized via{" "}
        <code>server/intel/carrier-normalize.mjs</code>.
      </p>
    </div>
  );
}
