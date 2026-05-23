/**
 * Pricing Hub — Margins tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/pricing-margins.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/pricing-margins       → overall KPIs + byTrade + byContractor + worstByPercent + bestByPercent
 *   2. Fire-and-forget GET /api/intel/pricing-templates → template section
 *
 * No entity picker — this is a top-level aggregate view.
 * No props — owns all state.
 */
import { useState, useEffect } from "react";
import {
  useFetch,
  KpiCard,
  CardRow,
  Panel,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface MarginsOverall {
  totalLines: number;
  avgMargin: number | null;
  underwaterLines: number;
  brokeEvenLines: number;
  healthyLines: number;
}

interface TradeMarginRow {
  trade: string;
  lineCount: number;
  avgMargin: number | null;
  avgOurPrice: number | null;
  avgContractorPrice: number | null;
  worstMargin: number | null;
}

interface ContractorMarginRow {
  contractorName: string;
  lineCount: number;
  avgMargin: number | null;
  underwaterLines: number;
}

interface LineMarginRow {
  description: string;
  contractorName: string;
  ourPrice: number | null;
  contractorPrice: number | null;
  margin: number | null;
}

interface PricingMarginsResponse {
  overall: MarginsOverall;
  byTrade: TradeMarginRow[];
  byContractor: ContractorMarginRow[];
  worstByPercent: LineMarginRow[];
  bestByPercent: LineMarginRow[];
}

interface TemplateRow {
  name: string;
  type: string | null;
  trade: string | null;
  itemCount: number;
  totalPrice: number | null;
}

interface TemplatesTotals {
  count: number | null;
  withItems: number | null;
  avgItems: number | null;
  totalLineValue: number | null;
}

interface PricingTemplatesResponse {
  totals: TemplatesTotals;
  templates: TemplateRow[];
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
  padding: "6px",
  borderBottom: "1px solid var(--riq-surface)",
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 500, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Formatters (matching the HTML's fmt helpers exactly)
// ---------------------------------------------------------------------------

function fmtMoney2(v: number | null | undefined): string {
  if (v == null) return "—";
  return "$" + Number(v).toFixed(2);
}

function fmtPct1(v: number | null | undefined): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

function marginColor(m: number | null): string {
  if (m == null) return "var(--riq-text)";
  if (m < 0) return "#ef4444";
  if (m >= 0.2) return "#10b981";
  return "var(--riq-text)";
}

// ---------------------------------------------------------------------------
// Templates section — fire-and-forget sub-fetch
// ---------------------------------------------------------------------------

function TemplatesSection() {
  const [data, setData] = useState<PricingTemplatesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/intel/pricing-templates", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PricingTemplatesResponse>;
      })
      .then(setData)
      .catch((e: unknown) => setErr((e as Error).message ?? String(e)));
  }, []);

  const sectionH2: React.CSSProperties = {
    margin: "0 0 6px",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--riq-accent)",
  };
  const descStyle: React.CSSProperties = {
    color: "var(--riq-text-muted)",
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 1.5,
  };

  return (
    <div
      style={{
        background: "var(--riq-surface)",
        border: "1px solid var(--riq-border)",
        borderRadius: 8,
        padding: "18px 22px",
        marginTop: 16,
      }}
    >
      <h2 style={sectionH2}>Pricing templates</h2>
      <p style={descStyle}>
        Estimate templates used in scoping — bundled line-item collections by trade. Type categories:{" "}
        <strong style={{ color: "var(--riq-text)" }}>ProjectMeeting</strong> (initial scope),{" "}
        <strong style={{ color: "var(--riq-text)" }}>Supplement</strong> (carrier supp packets),{" "}
        <strong style={{ color: "var(--riq-text)" }}>Contractor</strong> (sub labor groupings),{" "}
        <strong style={{ color: "var(--riq-text)" }}>Labor</strong> (in-house labor).
      </p>

      {err && (
        <div style={{ color: "#ef4444", fontSize: 12, marginBottom: 10 }}>
          Templates load failed: {err}
        </div>
      )}

      {!data && !err && (
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 10 }}>
          Loading templates…
        </div>
      )}

      {data && (
        <>
          <CardRow>
            <KpiCard label="Templates" value={fmtInt(data.totals.count)} />
            <KpiCard label="With items" value={fmtInt(data.totals.withItems)} />
            <KpiCard
              label="Avg items/template"
              value={data.totals.avgItems != null ? data.totals.avgItems.toFixed(1) : "—"}
            />
            <KpiCard label="Total line value" value={fmtMoney2(data.totals.totalLineValue)} />
          </CardRow>

          <div style={{ ...scrollBox, marginTop: 14 }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Template</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Trade</th>
                  <th style={thNumStyle}>Items</th>
                  <th style={thNumStyle}>Total value</th>
                </tr>
              </thead>
              <tbody>
                {(data.templates ?? []).map((tpl, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>
                      <strong>{tpl.name}</strong>
                    </td>
                    <td style={tdStyle}>{tpl.type ?? "—"}</td>
                    <td style={{ ...tdStyle, color: tpl.trade ? "var(--riq-text)" : "var(--riq-text-muted)" }}>
                      {tpl.trade ?? "uncategorized"}
                    </td>
                    <td
                      style={{
                        ...tdNumStyle,
                        color: tpl.itemCount === 0 ? "var(--riq-text-muted)" : "var(--riq-text)",
                      }}
                    >
                      {tpl.itemCount}
                    </td>
                    <td style={tdNumStyle}>{fmtMoney2(tpl.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 10 }}>
            Source: <code>/api/intel/pricing-templates</code>. Empty templates (0 items) typically mean a stub created but not populated yet.
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PricingMargins() {
  const result = useFetch<PricingMarginsResponse>("/api/intel/pricing-margins");

  const sectionStyle: React.CSSProperties = {
    background: "var(--riq-surface)",
    border: "1px solid var(--riq-border)",
    borderRadius: 8,
    padding: "18px 22px",
    marginBottom: 16,
  };

  const sectionH2: React.CSSProperties = {
    margin: "0 0 6px",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--riq-accent)",
  };

  const descStyle: React.CSSProperties = {
    color: "var(--riq-text-muted)",
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 1.5,
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
      {result.loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}

      {result.error && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load: {result.error}
        </div>
      )}

      {!result.loading && !result.error && result.data && (() => {
        const d = result.data;
        const o = d.overall ?? ({} as MarginsOverall);

        return (
          <>
            {/* Negative margin warning */}
            {o.avgMargin != null && o.avgMargin < 0 && (
              <div
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 6,
                  padding: "12px 14px",
                  marginBottom: 14,
                  color: "#ef4444",
                  fontSize: 13,
                }}
              >
                <strong>
                  Average margin is negative ({fmtPct1(o.avgMargin)}).
                </strong>{" "}
                {o.underwaterLines} of {o.totalLines} line items charge less than the subcontractor costs us. Top offenders below.
              </div>
            )}

            {/* Overall KPIs */}
            <div style={sectionStyle}>
              <h2 style={sectionH2}>Pricing margin — overall</h2>
              <p style={descStyle}>
                For each contractor pricing entry (subcontractor cost per line item), compare against Roof Docs&apos;s charged price from the pricing library.{" "}
                <strong style={{ color: "var(--riq-text)" }}>Margin = (our price − sub price) / our price.</strong>{" "}
                Directional signal, not bottom-line P&amp;L — doesn&apos;t account for quantity, supplements, or overhead.
              </p>
              <CardRow>
                <KpiCard label="Total line items" value={fmtInt(o.totalLines)} />
                <KpiCard
                  label="Avg margin"
                  value={<span style={{ color: o.avgMargin == null ? "var(--riq-text)" : o.avgMargin < 0 ? "#ef4444" : o.avgMargin < 0.1 ? "#f59e0b" : "#10b981" }}>
                    {fmtPct1(o.avgMargin)}
                  </span>}
                  emphasis={o.avgMargin != null && o.avgMargin < 0}
                />
                <KpiCard label="Underwater" value={<span style={{ color: "#ef4444" }}>{fmtInt(o.underwaterLines)}</span>} />
                <KpiCard label="Break-even (<5%)" value={<span style={{ color: "#f59e0b" }}>{fmtInt(o.brokeEvenLines)}</span>} />
                <KpiCard label="Healthy (≥20%)" value={<span style={{ color: "#10b981" }}>{fmtInt(o.healthyLines)}</span>} />
              </CardRow>
            </div>

            {/* By trade */}
            <div style={sectionStyle}>
              <h2 style={sectionH2}>By trade — where the leaks are</h2>
              <p style={descStyle}>
                Sorted by average margin. Negative = we charge less than the sub costs, on average across that trade&apos;s line items.
              </p>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Trade</th>
                    <th style={thNumStyle}>Lines</th>
                    <th style={thNumStyle}>Avg margin</th>
                    <th style={thNumStyle}>Avg our price</th>
                    <th style={thNumStyle}>Avg sub price</th>
                    <th style={thNumStyle}>Worst line</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.byTrade ?? []).map((t) => (
                    <tr key={t.trade}>
                      <td style={tdStyle}>
                        <strong>{t.trade}</strong>
                      </td>
                      <td style={tdNumStyle}>{t.lineCount}</td>
                      <td style={{ ...tdNumStyle, color: marginColor(t.avgMargin) }}>
                        {fmtPct1(t.avgMargin)}
                      </td>
                      <td style={tdNumStyle}>{fmtMoney2(t.avgOurPrice)}</td>
                      <td style={tdNumStyle}>{fmtMoney2(t.avgContractorPrice)}</td>
                      <td style={{ ...tdNumStyle, color: "#ef4444" }}>{fmtPct1(t.worstMargin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By contractor */}
            <div style={sectionStyle}>
              <h2 style={sectionH2}>By contractor — who we&apos;re upside-down with</h2>
              <p style={descStyle}>
                Subcontractors sorted from worst average margin upward. &ldquo;Underwater lines&rdquo; = how many of their priced line items have our charge below their cost.
              </p>
              <div style={scrollBox}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Contractor</th>
                      <th style={thNumStyle}>Lines priced</th>
                      <th style={thNumStyle}>Avg margin</th>
                      <th style={thNumStyle}>Underwater lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.byContractor ?? []).map((c) => (
                      <tr key={c.contractorName}>
                        <td style={tdStyle}>
                          <strong>{c.contractorName}</strong>
                        </td>
                        <td style={tdNumStyle}>{c.lineCount}</td>
                        <td style={{ ...tdNumStyle, color: marginColor(c.avgMargin) }}>
                          {fmtPct1(c.avgMargin)}
                        </td>
                        <td
                          style={{
                            ...tdNumStyle,
                            color:
                              c.underwaterLines > 5
                                ? "#ef4444"
                                : c.underwaterLines > 0
                                ? "#f59e0b"
                                : "var(--riq-text-muted)",
                          }}
                        >
                          {c.underwaterLines}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Worst + Best lines side-by-side */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 16,
              }}
            >
              <Panel title="Worst lines (sub costs us more than we charge)">
                <p style={{ ...descStyle, marginBottom: 10 }}>
                  Action items. Either renegotiate the sub, raise our charge, or document why we&apos;re eating the loss.
                </p>
                <div style={scrollBox}>
                  <table style={tblStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Line</th>
                        <th style={thStyle}>Contractor</th>
                        <th style={thNumStyle}>Ours</th>
                        <th style={thNumStyle}>Sub</th>
                        <th style={thNumStyle}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.worstByPercent ?? []).map((l, i) => (
                        <tr key={i}>
                          <td style={tdStyle}>{l.description}</td>
                          <td style={{ ...tdStyle, color: "var(--riq-text-muted)", fontSize: 11 }}>
                            {l.contractorName}
                          </td>
                          <td style={tdNumStyle}>{fmtMoney2(l.ourPrice)}</td>
                          <td style={tdNumStyle}>{fmtMoney2(l.contractorPrice)}</td>
                          <td style={{ ...tdNumStyle, color: "#ef4444" }}>{fmtPct1(l.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Best margin lines">
                <p style={{ ...descStyle, marginBottom: 10 }}>
                  Where we make the most. Keep doing what&apos;s working.
                </p>
                <div style={scrollBox}>
                  <table style={tblStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Line</th>
                        <th style={thStyle}>Contractor</th>
                        <th style={thNumStyle}>Ours</th>
                        <th style={thNumStyle}>Sub</th>
                        <th style={thNumStyle}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.bestByPercent ?? []).map((l, i) => (
                        <tr key={i}>
                          <td style={tdStyle}>{l.description}</td>
                          <td style={{ ...tdStyle, color: "var(--riq-text-muted)", fontSize: 11 }}>
                            {l.contractorName}
                          </td>
                          <td style={tdNumStyle}>{fmtMoney2(l.ourPrice)}</td>
                          <td style={tdNumStyle}>{fmtMoney2(l.contractorPrice)}</td>
                          <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtPct1(l.margin)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            {/* Footnote */}
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>
              Source: <code>/api/intel/pricing-margins</code>. Computed nightly from{" "}
              <code>pricing-items.json</code> (Roof Docs library) × <code>pricing-contractor.json</code>{" "}
              (subcontractor pricing). 718 contractor↔line matches.
            </div>

            {/* Templates section — fire-and-forget */}
            <TemplatesSection />
          </>
        );
      })()}
    </div>
  );
}
