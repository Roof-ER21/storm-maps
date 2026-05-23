/**
 * Carrier Hub — Overview tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/carrier-detail.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/carriers-summary              → left-pane carrier list
 *   2. On carrier select → GET /api/intel/carrier-deep?name=<carrier>
 *   3. Fire-and-forget GET /api/intel/carrier-complaints?carrier=<carrier>
 *   4. Fire-and-forget GET /api/intel/receivables/rollup?carrier=<carrier>
 *   5. Fire-and-forget GET /api/intel/active-work
 *
 * Carrier selection: internal picker (search + list, same as the HTML).
 * No props — owns all state.
 */
import { useState, useEffect } from "react";
import {
  useFetch,
  KpiCard,
  CardRow,
  Panel,
  fmtMoney,
  fmtPct,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface CarrierSummaryItem {
  name: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
  avgApprovedJob: number;
  naicIndex: number | null;
  naicRating: string | null;
}

interface CarriersSummaryResponse {
  carriers: CarrierSummaryItem[];
  total: number;
  took_ms: number;
}

interface TradeRow {
  t: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  share: number;
  closeRate: number;
}

interface ZipRow {
  z: string;
  city: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
}

interface RepRow {
  n: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
}

interface AdjusterRow {
  n: string;
  signed: number;
  completed: number;
  dead: number;
  approvalRate: number;
}

interface YearRow {
  y: string;
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number;
}

interface StormRow {
  stormId: string;
  date: string | null;
  type: string | null;
  mag: number | null;
  unit: string | null;
  jobs: number;
  revenue: number;
}

interface CarrierDeepResponse {
  summary: {
    name: string;
    signed: number;
    completed: number;
    dead: number;
    revenue: number;
    closeRate: number;
    avgApprovedJob: number;
  };
  trades: TradeRow[];
  zips: ZipRow[];
  reps: RepRow[];
  adjusters: AdjusterRow[];
  years: YearRow[];
  storms: StormRow[];
  medians: {
    deductible: number | null;
    upliftPct: number | null;
  };
  took_ms: number;
}

interface ComplaintEntry {
  index: number | null;
  rating: string;
  note?: string;
}

interface CarrierComplaintsResponse {
  carrier: string;
  entry: ComplaintEntry | null;
  sourceUrl: string;
  source: string;
  methodology: string;
  interpretation: Record<string, string>;
}

interface ArAgingBucket {
  count: number;
  outstanding: number;
}

interface ArCarrierRow {
  carrier: string;
  avgDays: number | null;
  oldestDays: number | null;
}

interface ArRollupResponse {
  noData?: boolean;
  asOf: string;
  totals: {
    count: number;
    outstanding: number;
  };
  byCarrier: ArCarrierRow[];
  aging: Record<string, ArAgingBucket>;
}

interface ActiveWorkSupplementByCarrier {
  carrier: string;
  total: number;
  totalValue: number;
  byStatus: Record<string, number>;
}

interface ActiveWorkCrossSellByCarrier {
  carrier: string;
  count: number;
  baseJobValue: number;
  bidCounts: Record<string, number>;
}

interface ActiveWorkResponse {
  supplement?: { byCarrier: ActiveWorkSupplementByCarrier[] };
  crossSell?: { byCarrier: ActiveWorkCrossSellByCarrier[] };
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

const scrollBox: React.CSSProperties = { maxHeight: 320, overflowY: "auto" };

// ---------------------------------------------------------------------------
// NAIC dot color helper
// ---------------------------------------------------------------------------
function naicDotColor(index: number | null): string {
  if (index == null) return "transparent";
  if (index <= 0.5) return "#10b981";
  if (index <= 0.8) return "#9ed27a";
  if (index <= 1.2) return "var(--riq-text-muted)";
  if (index <= 2.0) return "#e0a04f";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NaicDot({ index }: { index: number | null }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: index != null ? naicDotColor(index) : "transparent",
        border: index == null ? "1px solid var(--riq-border)" : "none",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function ScrollTable({ children }: { children: React.ReactNode }) {
  return (
    <div style={scrollBox}>
      <table style={tblStyle}>{children}</table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AR Friction section — fire-and-forget sub-fetch
// ---------------------------------------------------------------------------

function ArFriction({ carrierName }: { carrierName: string }) {
  const [ar, setAr] = useState<ArRollupResponse | null>(null);
  const [arErr, setArErr] = useState<string | null>(null);

  useEffect(() => {
    setAr(null);
    setArErr(null);
    fetch(`/api/intel/receivables/rollup?carrier=${encodeURIComponent(carrierName)}`, {
      credentials: "include",
    })
      .then((r) => r.json() as Promise<ArRollupResponse>)
      .then(setAr)
      .catch((e: unknown) => setArErr((e as Error).message ?? String(e)));
  }, [carrierName]);

  const buckets = ["0-30", "31-60", "61-90", "91-180", "180+"] as const;

  if (arErr) {
    return (
      <div style={{ color: "#ef4444", fontSize: 12 }}>AR load failed: {arErr}</div>
    );
  }
  if (!ar) {
    return <div style={{ color: "var(--riq-text-muted)", fontSize: 12 }}>Loading AR data…</div>;
  }
  if (ar.noData || (ar.totals?.count ?? 0) === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>
        No open AR for this carrier — paid or pre-billing.
      </div>
    );
  }

  const t = ar.totals;
  const carrierRow = (ar.byCarrier ?? [])[0];
  const aging = ar.aging ?? {};

  return (
    <>
      <CardRow>
        <KpiCard label="Open accounts" value={t.count.toLocaleString()} />
        <KpiCard label="Outstanding" value={fmtMoney(t.outstanding)} emphasis />
        <KpiCard
          label="Avg days outstanding"
          value={carrierRow?.avgDays != null ? String(carrierRow.avgDays) : "—"}
        />
        <KpiCard
          label="Oldest"
          value={carrierRow?.oldestDays != null ? `${carrierRow.oldestDays}d` : "—"}
        />
      </CardRow>
      <div style={{ ...scrollBox, marginTop: 10 }}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Aging</th>
              <th style={thNumStyle}>0–30 d</th>
              <th style={thNumStyle}>31–60</th>
              <th style={thNumStyle}>61–90</th>
              <th style={thNumStyle}>91–180</th>
              <th style={{ ...thNumStyle, color: "#ef4444" }}>180+</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}>
                <strong>{carrierName}</strong>
              </td>
              {buckets.map((k) => (
                <td key={k} style={tdNumStyle}>
                  {aging[k]?.count ?? 0}
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 10 }}>
                    {fmtMoney(aging[k]?.outstanding ?? 0)}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 6 }}>
        As of {ar.asOf}. Each cell: account count + dollars outstanding.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Active Work section — fire-and-forget sub-fetch
// ---------------------------------------------------------------------------

function ActiveWork({ carrierName }: { carrierName: string }) {
  const [aw, setAw] = useState<ActiveWorkResponse | null>(null);
  const [awErr, setAwErr] = useState<string | null>(null);

  useEffect(() => {
    setAw(null);
    setAwErr(null);
    fetch("/api/intel/active-work", { credentials: "include" })
      .then((r) => r.json() as Promise<ActiveWorkResponse>)
      .then(setAw)
      .catch((e: unknown) => setAwErr((e as Error).message ?? String(e)));
  }, [carrierName]);

  if (awErr) {
    return (
      <div style={{ color: "#ef4444", fontSize: 12 }}>Active-work load failed: {awErr}</div>
    );
  }
  if (!aw) {
    return (
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12 }}>Loading active work…</div>
    );
  }

  const supp = (aw.supplement?.byCarrier ?? []).find((x) => x.carrier === carrierName);
  const xsell = (aw.crossSell?.byCarrier ?? []).find((x) => x.carrier === carrierName);

  if (!supp && !xsell) {
    return (
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12 }}>
        No active supplements or cross-sell bids in flight for this carrier.
      </div>
    );
  }

  const tagStyle: React.CSSProperties = {
    display: "inline-block",
    background: "var(--riq-surface)",
    color: "var(--riq-accent)",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    marginRight: 4,
    marginBottom: 3,
  };
  const tagGreenStyle: React.CSSProperties = { ...tagStyle, color: "#10b981" };

  return (
    <>
      {supp && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "var(--riq-text)", fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
            Active supplements: {supp.total} jobs · {fmtMoney(supp.totalValue)} touched
          </div>
          <div>
            {Object.entries(supp.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => (
                <span key={s} style={tagStyle}>
                  {s}: {n}
                </span>
              ))}
          </div>
        </div>
      )}
      {xsell && (
        <div>
          <div style={{ color: "var(--riq-text)", fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
            Cross-sell pipeline: {xsell.count} jobs · {fmtMoney(xsell.baseJobValue)} base value
          </div>
          <div>
            {Object.entries(xsell.bidCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([b, n]) => (
                <span key={b} style={tagGreenStyle}>
                  {b}: {n}
                </span>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// NAIC Complaint inline section — fire-and-forget
// ---------------------------------------------------------------------------

function NaicComplaintBadge({ carrierName }: { carrierName: string }) {
  const [data, setData] = useState<CarrierComplaintsResponse | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/intel/carrier-complaints?carrier=${encodeURIComponent(carrierName)}`, {
      credentials: "include",
    })
      .then((r) => r.json() as Promise<CarrierComplaintsResponse>)
      .then(setData)
      .catch(() => {/* silently ignore — same as HTML fire-and-forget */});
  }, [carrierName]);

  if (!data || !data.entry || data.entry.index == null) return null;

  const e = data.entry;
  const idx = Number(e.index);
  const ratingColor =
    idx <= 0.5
      ? "#10b981"
      : idx <= 0.8
      ? "#9ed27a"
      : idx <= 1.2
      ? "var(--riq-text-muted)"
      : idx <= 2.0
      ? "#e0a04f"
      : "#ef4444";

  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 12px",
        background: "rgba(94,200,255,0.05)",
        border: "1px solid var(--riq-border)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--riq-text-muted)",
      }}
    >
      <strong style={{ color: "var(--riq-text)" }}>NAIC Complaint Index:</strong>{" "}
      <strong style={{ color: ratingColor }}>{idx.toFixed(2)}</strong>{" "}
      <span style={{ color: ratingColor }}>({e.rating})</span>
      {" · "}
      <a
        href={data.sourceUrl}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--riq-text-muted)", textDecoration: "underline" }}
      >
        Indiana DOI 2022 baseline
      </a>
      {e.note && (
        <div style={{ marginTop: 4, color: "var(--riq-text-muted)", fontSize: 11 }}>{e.note}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carrier detail pane (right side)
// ---------------------------------------------------------------------------

function CarrierDetail({ carrier }: { carrier: CarrierSummaryItem }) {
  const deep = useFetch<CarrierDeepResponse>(
    `/api/intel/carrier-deep?name=${encodeURIComponent(carrier.name)}`,
    [carrier.name],
  );

  if (deep.loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  }
  if (deep.error || !deep.data) {
    return (
      <div style={{ padding: 20, color: "#ef4444" }}>
        Failed to load carrier deep dive: {deep.error}
      </div>
    );
  }

  const d = deep.data;
  const { trades, zips, reps, adjusters, years, storms, medians } = d;
  const s = d.summary;

  const subH2: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--riq-accent)",
    margin: "0 0 8px",
  };
  const note: React.CSSProperties = { color: "var(--riq-text-muted)", fontWeight: 400, fontSize: 10 };

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "var(--riq-text)" }}>
        {carrier.name}
      </h2>
      <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
        {s.signed} signed · {s.completed} approved · {fmtMoney(s.revenue)} revenue ·{" "}
        {fmtPct(s.closeRate, 1)} close rate
      </div>

      <NaicComplaintBadge carrierName={carrier.name} />

      <CardRow>
        <KpiCard label="Signed" value={s.signed.toLocaleString()} />
        <KpiCard label="Approved" value={s.completed.toLocaleString()} />
        <KpiCard label="Dead" value={s.dead.toLocaleString()} />
        <KpiCard label="Close rate" value={fmtPct(s.closeRate, 1)} emphasis />
        <KpiCard label="Avg approved" value={fmtMoney(s.avgApprovedJob)} />
        <KpiCard
          label="Median deductible"
          value={medians.deductible != null ? fmtMoney(medians.deductible) : "—"}
        />
        <KpiCard
          label="Median supplement uplift"
          value={medians.upliftPct != null ? fmtPct(medians.upliftPct, 1) : "—"}
        />
      </CardRow>

      {/* 6-panel grid: trades, zips, reps, adjusters, years, storms */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* Top trades */}
        <Panel title="Top trades">
          <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginBottom: 6 }}>
            close% is post-scope — excludes jobs that died before trade scope was set
          </div>
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>Trade</th>
                <th style={thNumStyle}>Jobs</th>
                <th style={thNumStyle}>Share</th>
                <th style={thNumStyle}>Post-scope%</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((r) => (
                <tr key={r.t}>
                  <td style={tdStyle}>{r.t}</td>
                  <td style={tdNumStyle}>{r.signed}</td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>
                    {fmtPct(r.share, 1)}
                  </td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>
                    {fmtPct(r.closeRate, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>

        {/* Top ZIPs */}
        <Panel title="Top ZIPs">
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>ZIP</th>
                <th style={thStyle}>City</th>
                <th style={thNumStyle}>Signed</th>
                <th style={thNumStyle}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {zips.map((r) => (
                <tr key={r.z}>
                  <td style={tdStyle}>{r.z}</td>
                  <td style={tdStyle}>{r.city}</td>
                  <td style={tdNumStyle}>{r.signed}</td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>

        {/* Top reps */}
        <Panel title="Top reps for this carrier">
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>Rep</th>
                <th style={thNumStyle}>Signed</th>
                <th style={thNumStyle}>Approved</th>
                <th style={thNumStyle}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.n}>
                  <td style={tdStyle}>{r.n}</td>
                  <td style={tdNumStyle}>{r.signed}</td>
                  <td style={tdNumStyle}>{r.completed}</td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>

        {/* Top adjusters */}
        <Panel title="Top adjusters">
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>Adjuster</th>
                <th style={thNumStyle}>Jobs</th>
                <th style={thNumStyle}>Approved</th>
                <th style={thNumStyle}>Approval %</th>
              </tr>
            </thead>
            <tbody>
              {adjusters.map((r) => (
                <tr key={r.n}>
                  <td style={tdStyle}>{r.n}</td>
                  <td style={tdNumStyle}>{r.signed}</td>
                  <td style={tdNumStyle}>{r.completed}</td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>
                    {fmtPct(r.approvalRate, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>

        {/* Year-over-year */}
        <Panel title="Year-over-year">
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>Year</th>
                <th style={thNumStyle}>Signed</th>
                <th style={thNumStyle}>Approved</th>
                <th style={thNumStyle}>Close%</th>
                <th style={thNumStyle}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {years.map((r) => (
                <tr key={r.y}>
                  <td style={tdStyle}>{r.y}</td>
                  <td style={tdNumStyle}>{r.signed}</td>
                  <td style={tdNumStyle}>{r.completed}</td>
                  <td style={{ ...tdNumStyle, color: "var(--riq-accent)" }}>
                    {fmtPct(r.closeRate, 1)}
                  </td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>

        {/* Top storms */}
        <Panel title="Top storms (this carrier)">
          <ScrollTable>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Mag</th>
                <th style={thNumStyle}>Jobs</th>
                <th style={thNumStyle}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {storms.map((s) => (
                <tr key={s.stormId}>
                  <td style={tdStyle}>{(s.date ?? "").slice(0, 10)}</td>
                  <td style={tdStyle}>{s.type}</td>
                  <td style={tdStyle}>
                    {s.mag != null ? s.mag : "—"} {s.unit ?? ""}
                  </td>
                  <td style={tdNumStyle}>{s.jobs}</td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </Panel>
      </div>

      {/* AR Friction */}
      <div
        style={{
          marginTop: 16,
          borderTop: "1px solid var(--riq-border)",
          paddingTop: 14,
        }}
      >
        <h3 style={{ ...subH2, marginBottom: 8 }}>
          AR Friction{" "}
          <span style={note}>— how this carrier actually pays</span>
        </h3>
        <ArFriction carrierName={carrier.name} />
      </div>

      {/* Active Work */}
      <div
        style={{
          marginTop: 16,
          borderTop: "1px solid var(--riq-border)",
          paddingTop: 14,
        }}
      >
        <h3 style={{ ...subH2, marginBottom: 8 }}>
          Active Work{" "}
          <span style={note}>— supplements in flight + cross-sell pipeline</span>
        </h3>
        <ActiveWork carrierName={carrier.name} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CarrierOverview() {
  const summary = useFetch<CarriersSummaryResponse>("/api/intel/carriers-summary");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CarrierSummaryItem | null>(null);

  // Auto-select first carrier once data loads
  useEffect(() => {
    if (summary.data?.carriers?.length && !selected) {
      setSelected(summary.data.carriers[0]);
    }
  }, [summary.data, selected]);

  const filtered = (summary.data?.carriers ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {summary.loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}
      {summary.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load carriers: {summary.error}
        </div>
      )}
      {!summary.loading && !summary.error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "260px 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Left pane — carrier list */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Carriers</div>
            <div
              style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}
            >
              Sorted by signed volume
            </div>
            <input
              type="text"
              placeholder="Search carrier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: "var(--riq-bg)",
                color: "var(--riq-text)",
                border: "1px solid var(--riq-border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 13,
                width: "100%",
                marginBottom: 8,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}>
              {filtered.length} carriers
            </div>
            <div style={{ maxHeight: 680, overflowY: "auto" }}>
              {filtered.map((c) => (
                <div
                  key={c.name}
                  onClick={() => setSelected(c)}
                  style={{
                    padding: "9px 11px",
                    border: `1px solid ${selected?.name === c.name ? "var(--riq-accent)" : "var(--riq-border)"}`,
                    background: selected?.name === c.name ? "rgba(244,167,56,0.08)" : "transparent",
                    borderRadius: 6,
                    marginBottom: 5,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>
                    <NaicDot index={c.naicIndex} />
                    <span>{c.name}</span>
                  </div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2, paddingLeft: 14 }}>
                    {c.signed} signed · {c.completed} done · {fmtMoney(c.revenue)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right pane — carrier detail */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            {!selected ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>
                Pick a carrier
              </div>
            ) : (
              <CarrierDetail carrier={selected} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
