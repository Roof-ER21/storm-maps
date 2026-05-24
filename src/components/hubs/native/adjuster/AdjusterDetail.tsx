/**
 * Adjuster Detail tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/adjuster-detail.html.
 *
 * Data flow:
 *   1. GET /api/intel/adjusters-summary → left-pane adjuster list (sorted by completed desc)
 *   2. On adjuster select → GET /api/intel/adjuster-deep?name=<name>&carrier=<carrier>
 *
 * Internal entity picker: search + list, auto-select first item.
 * No props — owns all state.
 */
import { useState, useEffect } from "react";
import { getUrlParam, matchByName } from "../../../urlParams";
import { useFetch, KpiCard, CardRow, fmtMoney, fmtPct } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface AdjusterListItem {
  name: string;
  carrier: string;
  signed: number;
  completed: number;
  dead: number;
  approvalRate: number | null;
  completedRevenue: number;
}

interface AdjustersSummaryResponse {
  adjusters: AdjusterListItem[];
}

interface ZipRow {
  zip: string;
  signed: number;
  completed: number;
}

interface RepRow {
  rep: string;
  count: number;
}

interface TradeRow {
  trade: string;
  count: number;
}

interface YearRow {
  year: string;
  signed: number;
  completed: number;
}

interface RecentJob {
  signedDate: string | null;
  customer: string | null;
  city: string | null;
  stage: string | null;
  jobTotal: number | null;
}

interface AdjusterDeepSummary {
  medianDeductible: number | null;
}

interface AdjusterDeepResponse {
  summary: AdjusterDeepSummary;
  emails: string[];
  phones: string[];
  supervisors: string[];
  zips: ZipRow[];
  reps: RepRow[];
  trades: TradeRow[];
  years: YearRow[];
  recent: RecentJob[];
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
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid rgba(52,44,35,1)",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 360, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Detail pane
// ---------------------------------------------------------------------------

function DetailPane({
  adjuster,
}: {
  adjuster: AdjusterListItem;
}) {
  const [deep, setDeep] = useState<AdjusterDeepResponse | null>(null);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);

  useEffect(() => {
    setDeep(null);
    setDeepErr(null);
    setDeepLoading(true);
    const url =
      `/api/intel/adjuster-deep?name=${encodeURIComponent(adjuster.name)}` +
      `&carrier=${encodeURIComponent(adjuster.carrier)}`;
    fetch(url, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AdjusterDeepResponse>;
      })
      .then((d) => { setDeep(d); setDeepLoading(false); })
      .catch((e: unknown) => {
        setDeepErr((e as Error).message ?? String(e));
        setDeepLoading(false);
      });
  }, [adjuster.name, adjuster.carrier]);

  if (deepLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
        Loading…
      </div>
    );
  }
  if (deepErr || !deep) {
    return (
      <div style={{ padding: 20, color: "#ef4444" }}>
        Failed to load: {deepErr}
      </div>
    );
  }

  const {
    summary,
    emails = [],
    phones = [],
    supervisors = [],
    zips = [],
    reps = [],
    trades = [],
    years = [],
    recent = [],
  } = deep;

  const subH2: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    margin: "0 0 8px",
    color: "var(--riq-text)",
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600, color: "var(--riq-text)" }}>
        {adjuster.name}{" "}
        <span style={{ color: "var(--riq-text-muted)", fontWeight: 400 }}>
          · {adjuster.carrier}
        </span>
      </h2>
      <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
        {adjuster.signed} signed · {adjuster.completed} approved · {fmtPct(adjuster.approvalRate, 1)} approval rate
      </div>

      {/* Contact info */}
      {(emails.length > 0 || phones.length > 0) && (
        <div style={{ marginTop: 6, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {emails.map((e) => (
            <a
              key={e}
              href={`mailto:${e}`}
              style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 12 }}
            >
              📧 {e}
            </a>
          ))}
          {phones.map((p) => (
            <a
              key={p}
              href={`tel:${p.replace(/\D/g, "")}`}
              style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 12 }}
            >
              📱 {p}
            </a>
          ))}
        </div>
      )}
      {supervisors.length > 0 && (
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 4 }}>
          Supervisor(s): {supervisors.join(", ")}
        </div>
      )}

      {/* KPI row */}
      <div style={{ marginTop: 16 }}>
        <CardRow>
          <KpiCard label="Signed" value={adjuster.signed.toLocaleString()} />
          <KpiCard label="Approved" value={adjuster.completed.toLocaleString()} />
          <KpiCard label="Denied/Dead" value={adjuster.dead.toLocaleString()} />
          <KpiCard label="Approval %" value={fmtPct(adjuster.approvalRate, 1)} emphasis />
          <KpiCard label="Closed revenue" value={fmtMoney(adjuster.completedRevenue)} />
          <KpiCard
            label="Med deductible"
            value={fmtMoney(summary.medianDeductible)}
          />
        </CardRow>
      </div>

      {/* 2-col grid: ZIPs, reps, trades, years */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <div>
          <h2 style={subH2}>Top ZIPs handled</h2>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>ZIP</th>
                  <th style={thNumStyle}>Signed</th>
                  <th style={thNumStyle}>Approved</th>
                </tr>
              </thead>
              <tbody>
                {zips.map((z) => (
                  <tr key={z.zip}>
                    <td style={tdStyle}>{z.zip}</td>
                    <td style={tdNumStyle}>{z.signed}</td>
                    <td style={tdNumStyle}>{z.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 style={subH2}>Top reps working this adjuster</h2>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.rep}>
                    <td style={tdStyle}>{r.rep}</td>
                    <td style={tdNumStyle}>{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 style={subH2}>Top trades</h2>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.trade}>
                    <td style={tdStyle}>{t.trade}</td>
                    <td style={tdNumStyle}>{t.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 style={subH2}>Year-over-year</h2>
          <div style={scrollBox}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Year</th>
                  <th style={thNumStyle}>Signed</th>
                  <th style={thNumStyle}>Approved</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year}>
                    <td style={tdStyle}>{y.year}</td>
                    <td style={tdNumStyle}>{y.signed}</td>
                    <td style={tdNumStyle}>{y.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent jobs */}
      <h2 style={{ ...subH2, marginTop: 20 }}>Recent jobs (last 20)</h2>
      <div style={scrollBox}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>City</th>
              <th style={thStyle}>Stage</th>
              <th style={thNumStyle}>Total</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((j, idx) => (
              <tr key={idx}>
                <td style={tdStyle}>{j.signedDate ?? "—"}</td>
                <td style={tdStyle}>{j.customer ?? "—"}</td>
                <td style={tdStyle}>{j.city ?? "—"}</td>
                <td style={tdStyle}>{j.stage ?? "—"}</td>
                <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(j.jobTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdjusterDetail() {
  const { data, error, loading } = useFetch<AdjustersSummaryResponse>(
    "/api/intel/adjusters-summary",
  );

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AdjusterListItem | null>(null);

  // Sort by completed desc, auto-select first
  const adjusters = (data?.adjusters ?? [])
    .slice()
    .sort((a, b) => b.completed - a.completed);

  // Auto-select once data loads: honor ?name= deep-link, else first adjuster.
  useEffect(() => {
    if (selected || adjusters.length === 0) return;
    setSelected(matchByName(adjusters, getUrlParam("name")) ?? adjusters[0]);
  }, [adjusters.length, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = adjusters.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) || a.carrier.toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load adjusters: {error}
        </div>
      )}
      {!loading && !error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "360px 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Left pane */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "var(--riq-text)" }}>
              Adjusters
            </h2>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
              Sorted by approved jobs. Click any for full intel.
            </div>
            <input
              placeholder="Search name or carrier"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: "rgba(52,44,35,1)",
                color: "var(--riq-text)",
                border: "1px solid var(--riq-border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 13,
                width: "100%",
                marginBottom: 10,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
              {filtered.length} adjusters
            </div>
            <div style={{ maxHeight: 800, overflowY: "auto" }}>
              {filtered.slice(0, 300).map((a) => {
                const key = `${a.name}|${a.carrier}`;
                const isActive = selected?.name === a.name && selected?.carrier === a.carrier;
                return (
                  <div
                    key={key}
                    onClick={() => setSelected(a)}
                    style={{
                      padding: "10px 12px",
                      border: `1px solid ${isActive ? "var(--riq-accent)" : "var(--riq-border)"}`,
                      background: isActive ? "rgba(52,44,35,1)" : "transparent",
                      borderRadius: 6,
                      marginBottom: 6,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--riq-text)" }}>
                      {a.name}{" "}
                      <span style={{ color: "var(--riq-text-muted)", fontWeight: 400, fontSize: 11 }}>
                        · {a.carrier}
                      </span>
                    </div>
                    <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>
                      {a.signed} jobs · {a.completed} approved ({fmtPct(a.approvalRate, 1)})
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right pane */}
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
                Pick an adjuster
              </div>
            ) : (
              <DetailPane adjuster={selected} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
