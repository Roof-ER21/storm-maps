/**
 * Rep Hub — Overview tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/reps.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/reps-summary               → left-pane rep list
 *   2. On rep select → GET /api/intel/rep-deep?name=<rep>
 *                                                → deep dive (trades/carriers/cities/zips/bigJobs)
 *
 * Rep selection: internal picker (search + list, same as the HTML).
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

interface TrailingWindow {
  signed: number;
  completed: number;
  dead: number;
  revenue: number;
  closeRate: number | null;
}

interface RepSummaryItem {
  name: string;
  signed: number;
  completed: number;
  dead: number;
  open: number;
  revenue: number;
  completedRevenue: number;
  insSalesTotal: number;
  retailSalesTotal: number;
  insSignedCount: number;
  retailSignedCount: number;
  insSignedFullCount: number;
  insCompletedCount: number;
  insDeadCount: number;
  totalSalesAllTime: number;
  closeRate: number;
  insApprovalRate: number;
  avgApprovedJob: number | null;
  trailing30d: TrailingWindow;
  trailing200d: TrailingWindow;
}

interface RepsSummaryResponse {
  reps: RepSummaryItem[];
  total: number;
  took_ms: number;
}

interface NameCount {
  name: string;
  count: number;
}

interface BigJob {
  customer: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  insurance: string | null;
  stage: string | null;
  signedDate: string | null;
  jobTotal: number | null;
}

interface RepDeepResponse {
  trades: NameCount[];
  carriers: NameCount[];
  cities: NameCount[];
  zips: NameCount[];
  medianSpeedDays: number | null;
  medianCompleteDays: number | null;
  bigJobs: BigJob[];
  took_ms: number;
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
// Close-rate color helper (matches HTML color key: ≥75% green, 50–74% default, <50% red)
// ---------------------------------------------------------------------------
function rateColor(rate: number | null | undefined): string {
  if (rate == null) return "var(--riq-text-muted)";
  if (rate >= 0.75) return "#10b981";
  if (rate >= 0.5) return "var(--riq-text)";
  return "#ef4444";
}

// ---------------------------------------------------------------------------
// NameCount table (top trades / carriers / cities / zips)
// ---------------------------------------------------------------------------
function NameCountTable({ rows, label }: { rows: NameCount[]; label: string }) {
  return (
    <Panel title={label}>
      <div style={scrollBox}>
        <table style={tblStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thNumStyle}>Jobs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdNumStyle}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Rep detail pane (right side)
// ---------------------------------------------------------------------------

function RepDetail({ rep }: { rep: RepSummaryItem }) {
  const deep = useFetch<RepDeepResponse>(
    `/api/intel/rep-deep?name=${encodeURIComponent(rep.name)}`,
    [rep.name],
  );

  if (deep.loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
        Loading…
      </div>
    );
  }
  if (deep.error || !deep.data) {
    return (
      <div style={{ padding: 20, color: "#ef4444" }}>
        Failed to load rep deep dive: {deep.error}
      </div>
    );
  }

  const d = deep.data;

  const subH2: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--riq-accent)",
    margin: "0 0 8px",
  };
  const note: React.CSSProperties = {
    color: "var(--riq-text-muted)",
    fontWeight: 400,
    fontSize: 10,
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, color: "var(--riq-text)" }}>
        {rep.name}
      </h2>
      <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 12 }}>
        Full book of business · {rep.signed} signed · {rep.completed} completed ·{" "}
        {fmtMoney(rep.completedRevenue)} closed revenue
      </div>

      {/* Color legend */}
      <div
        style={{
          fontSize: 11,
          color: "var(--riq-text-muted)",
          marginBottom: 10,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong>Color key:</strong>
        <span style={{ color: "#10b981" }}>● ≥75%</span>
        <span>● 50–74%</span>
        <span style={{ color: "#ef4444" }}>● &lt;50%</span>
        <span style={{ opacity: 0.7 }}>(approval / close rate where shown)</span>
      </div>

      {/* Main KPIs */}
      <CardRow>
        <KpiCard label="Signed" value={rep.signed.toLocaleString()} />
        <KpiCard label="Completed" value={rep.completed.toLocaleString()} />
        <KpiCard label="Dead" value={rep.dead.toLocaleString()} />
        <KpiCard
          label="Ins approval rate"
          value={
            <span style={{ color: rateColor(rep.insApprovalRate) }}>
              {fmtPct(rep.insApprovalRate, 1)}
            </span>
          }
          hint={`${rep.insCompletedCount} of ${rep.insCompletedCount + rep.insDeadCount}`}
          emphasis
        />
        <KpiCard
          label="Close rate (all)"
          value={
            <span style={{ color: rateColor(rep.closeRate) }}>
              {fmtPct(rep.closeRate, 1)}
            </span>
          }
        />
        <KpiCard label="Closed revenue" value={fmtMoney(rep.completedRevenue)} emphasis />
        <KpiCard
          label="Avg approved job"
          value={rep.avgApprovedJob != null ? fmtMoney(rep.avgApprovedJob) : "—"}
        />
        <KpiCard
          label="Median loss→sign"
          value={d.medianSpeedDays != null ? `${d.medianSpeedDays}d` : "—"}
        />
        <KpiCard
          label="Median sign→complete"
          value={d.medianCompleteDays != null ? `${d.medianCompleteDays}d` : "—"}
        />
      </CardRow>

      {/* Trailing windows */}
      <h3 style={{ ...subH2, marginTop: 18 }}>
        Trailing windows{" "}
        <span style={note}>
          — velocity trend by signed_date. 30d = recent activity (most jobs still open). 200d = most stable read.
        </span>
      </h3>
      <CardRow>
        <KpiCard
          label="Signed (30d)"
          value={rep.trailing30d.signed.toLocaleString()}
          hint="Jobs signed in trailing 30 days"
        />
        <KpiCard
          label="Completed (30d)"
          value={rep.trailing30d.completed.toLocaleString()}
          hint="Of 30d-signed, completed so far"
        />
        <KpiCard
          label="Dead (30d)"
          value={rep.trailing30d.dead.toLocaleString()}
          hint="Of 30d-signed, marked dead/cancel"
        />
        <KpiCard
          label="Closed rev (30d)"
          value={fmtMoney(rep.trailing30d.revenue)}
          hint="Closed revenue from 30d-signed jobs"
        />
        <KpiCard
          label="Close rate (30d)"
          value={
            <span style={{ color: rateColor(rep.trailing30d.closeRate) }}>
              {fmtPct(rep.trailing30d.closeRate, 1)}
            </span>
          }
          hint="Among resolved 30d-signed jobs (small denominator)"
        />
      </CardRow>
      <div style={{ marginTop: 8 }}>
        <CardRow>
          <KpiCard
            label="Signed (200d)"
            value={rep.trailing200d.signed.toLocaleString()}
            hint="Jobs signed in trailing 200 days"
          />
          <KpiCard
            label="Completed (200d)"
            value={rep.trailing200d.completed.toLocaleString()}
            hint="Of 200d-signed, completed so far"
          />
          <KpiCard
            label="Dead (200d)"
            value={rep.trailing200d.dead.toLocaleString()}
            hint="Of 200d-signed, marked dead/cancel"
          />
          <KpiCard
            label="Closed rev (200d)"
            value={fmtMoney(rep.trailing200d.revenue)}
            hint="Closed revenue from 200d-signed jobs"
          />
          <KpiCard
            label="Close rate (200d)"
            value={
              <span style={{ color: rateColor(rep.trailing200d.closeRate) }}>
                {fmtPct(rep.trailing200d.closeRate, 1)}
              </span>
            }
            hint="Among resolved 200d-signed jobs — most stable trailing read"
            emphasis
          />
        </CardRow>
      </div>

      {/* 4-panel grid: trades, carriers, cities, zips */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <NameCountTable rows={d.trades} label="Top trades" />
        <NameCountTable rows={d.carriers} label="Top carriers" />
        <NameCountTable rows={d.cities} label="Top cities" />
        <NameCountTable rows={d.zips} label="Top ZIPs" />
      </div>

      {/* Top 10 biggest jobs */}
      <div
        style={{
          marginTop: 16,
          borderTop: "1px solid var(--riq-border)",
          paddingTop: 14,
        }}
      >
        <h3 style={{ ...subH2, marginBottom: 8 }}>Top 10 biggest jobs</h3>
        <div style={{ ...scrollBox, maxHeight: 360 }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Address</th>
                <th style={thStyle}>Carrier</th>
                <th style={thStyle}>Stage</th>
                <th style={thStyle}>Signed</th>
                <th style={thNumStyle}>Total</th>
              </tr>
            </thead>
            <tbody>
              {d.bigJobs.map((j, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{j.customer ?? "—"}</td>
                  <td style={tdStyle}>
                    {[j.addressLine1, j.city, j.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td style={tdStyle}>{j.insurance ?? "—"}</td>
                  <td style={tdStyle}>{j.stage ?? "—"}</td>
                  <td style={tdStyle}>{j.signedDate ?? "—"}</td>
                  <td style={{ ...tdNumStyle, color: "#10b981" }}>
                    {fmtMoney(j.jobTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RepOverview() {
  const summary = useFetch<RepsSummaryResponse>("/api/intel/reps-summary");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<RepSummaryItem | null>(null);

  // Auto-select first rep once data loads
  useEffect(() => {
    if (summary.data?.reps?.length && !selected) {
      setSelected(summary.data.reps[0]);
    }
  }, [summary.data, selected]);

  const filtered = (summary.data?.reps ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
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
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading…
        </div>
      )}
      {summary.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load reps: {summary.error}
        </div>
      )}
      {!summary.loading && !summary.error && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "320px 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Left pane — rep list */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Sales reps
            </div>
            <div
              style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}
            >
              Sorted by total sales (all time)
            </div>
            <input
              type="text"
              placeholder="Search reps"
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
            <div
              style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 8 }}
            >
              {filtered.length} reps
            </div>
            <div style={{ maxHeight: 760, overflowY: "auto" }}>
              {filtered.map((r) => (
                <div
                  key={r.name}
                  onClick={() => setSelected(r)}
                  style={{
                    padding: "10px 12px",
                    border: `1px solid ${
                      selected?.name === r.name ? "var(--riq-accent)" : "var(--riq-border)"
                    }`,
                    background:
                      selected?.name === r.name
                        ? "rgba(244,167,56,0.08)"
                        : "transparent",
                    borderRadius: 6,
                    marginBottom: 6,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, color: "var(--riq-text)" }}>
                    {r.name}
                  </div>
                  <div
                    style={{
                      color: "var(--riq-text-muted)",
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {r.signed} signed · {r.completed} done
                    <br />
                    <span style={{ color: "var(--riq-accent)", fontWeight: 600 }}>
                      {fmtMoney(r.totalSalesAllTime)}
                    </span>{" "}
                    <span style={{ fontSize: 10 }}>
                      (Ins {fmtMoney(r.insSalesTotal)} + Retail{" "}
                      {fmtMoney(r.retailSalesTotal)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right pane — rep detail */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            {!selected ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  color: "var(--riq-text-muted)",
                }}
              >
                Pick a rep to see their book of business
              </div>
            ) : (
              <RepDetail rep={selected} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
