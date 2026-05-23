/**
 * Carrier Hub — Trades tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/carrier-trades.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/carrier-trade-matrix
 *      Response: { topCarriers, topTrades, cells, terciles: { t1, t2 }, carrierTotals }
 *
 * No carrier picker — the matrix shows ALL top carriers vs ALL top trades
 * in a single cross-tab heat-map. No props, owns all state.
 */
import { useFetch } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface TradeCell {
  avg: number;
  jobs: number;
}

interface CarrierTradeMatrixResponse {
  topCarriers: string[];
  topTrades: string[];
  cells: Record<string, TradeCell>;
  terciles: {
    t1: number; // lower tercile boundary (warm/cool split)
    t2: number; // upper tercile boundary (hot/warm split)
  };
  carrierTotals: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Cell heat class logic (mirrors the HTML)
// ---------------------------------------------------------------------------

type HeatClass = "hot" | "warm" | "cool";

function heatClass(avg: number, t1: number, t2: number): HeatClass {
  if (avg >= t2) return "hot";
  if (avg >= t1) return "warm";
  return "cool";
}

const HEAT_STYLES: Record<HeatClass, React.CSSProperties> = {
  hot: { background: "rgba(16,185,129,0.3)", color: "#10b981" },
  warm: { background: "rgba(245,158,11,0.25)", color: "#f59e0b" },
  cool: { background: "rgba(94,200,255,0.15)", color: "var(--riq-accent)" },
};

function fmtMoneyK(v: number): string {
  if (v === 0) return "—";
  return "$" + Math.round(v / 1000) + "k";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CarrierTrades() {
  const matrix = useFetch<CarrierTradeMatrixResponse>("/api/intel/carrier-trade-matrix");

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {matrix.loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}
      {matrix.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load matrix: {matrix.error}
        </div>
      )}
      {matrix.data && (() => {
        const { topCarriers, topTrades, cells, terciles, carrierTotals } = matrix.data;
        const { t1, t2 } = terciles;

        return (
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
            }}
          >
            <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>
              Avg approved $ per trade per carrier
            </h2>
            <p
              style={{
                color: "var(--riq-text-muted)",
                fontSize: 12,
                margin: "0 0 14px",
                lineHeight: 1.5,
              }}
            >
              For every completed job: split by carrier × trade. Cell color:{" "}
              <span style={{ color: "#10b981" }}>● hot</span> = avg approved $ in top tercile ·{" "}
              <span style={{ color: "#f59e0b" }}>● warm</span> = middle ·{" "}
              <span style={{ color: "var(--riq-accent)" }}>● cool</span> = bottom.
              Number = avg approved $, below = job count.{" "}
              <strong style={{ color: "var(--riq-accent)" }}>
                Insurance carriers only — Retail / No Carrier excluded.
              </strong>
            </p>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid var(--riq-border)",
                        color: "var(--riq-text-muted)",
                        fontWeight: 500,
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        position: "sticky",
                        top: 0,
                        background: "var(--riq-surface)",
                        zIndex: 2,
                      }}
                    >
                      Carrier (jobs)
                    </th>
                    {topTrades.map((t) => (
                      <th
                        key={t}
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--riq-border)",
                          color: "var(--riq-text-muted)",
                          fontWeight: 500,
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          position: "sticky",
                          top: 0,
                          background: "var(--riq-surface)",
                          zIndex: 2,
                        }}
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topCarriers.map((carrier) => (
                    <tr key={carrier}>
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: "1px solid var(--riq-border)",
                          fontWeight: 600,
                          color: "var(--riq-accent)",
                          position: "sticky",
                          left: 0,
                          background: "var(--riq-surface)",
                          zIndex: 1,
                        }}
                      >
                        {carrier}
                        <br />
                        <span style={{ color: "var(--riq-text-muted)", fontSize: 10, fontWeight: 400 }}>
                          {carrierTotals[carrier]} trade-jobs
                        </span>
                      </td>
                      {topTrades.map((trade) => {
                        const cellKey = `${carrier}|${trade}`;
                        const cell = cells[cellKey];
                        if (!cell) {
                          return (
                            <td
                              key={trade}
                              style={{
                                textAlign: "right",
                                padding: "6px 8px",
                                borderBottom: "1px solid var(--riq-border)",
                                color: "var(--riq-text-muted)",
                              }}
                            >
                              —
                            </td>
                          );
                        }
                        const cls = heatClass(cell.avg, t1, t2);
                        const hs = HEAT_STYLES[cls];
                        return (
                          <td
                            key={trade}
                            style={{
                              textAlign: "right",
                              padding: "4px 6px",
                              borderBottom: "1px solid var(--riq-border)",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 6px",
                                borderRadius: 3,
                                ...hs,
                              }}
                            >
                              <span style={{ fontWeight: 700 }}>{fmtMoneyK(cell.avg)}</span>
                              <br />
                              <span style={{ color: "var(--riq-text-muted)", fontSize: 10 }}>
                                {cell.jobs}j
                              </span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
