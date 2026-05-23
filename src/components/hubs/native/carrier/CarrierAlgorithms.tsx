/**
 * Carrier Hub — Algorithms tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/carrier-algorithms.html.
 *
 * Data flow (matches the HTML exactly — all parallel):
 *   1. GET /api/intel/carrier-patents           → { byCarrier: Record<carrier, string[]>, patents: Record<id, PatentDoc> }
 *   2. GET /api/intel/denial-sources-full       → DenialCase[] or { entries: DenialCase[] }
 *   3. GET /api/intel/naic-complaint-index      → { carriers: Record<name, NaicEntry> } or Record<name, NaicEntry>
 *   4. GET /api/intel/insurer-rankings          → optional, catch → null
 *   5. GET /api/intel/live-market-intel         → optional, catch → null
 *
 * Carrier selection: sidebar list (sorted alpha, VENDOR_MULTI separate button).
 * No props — owns all state.
 */
import { useState, useEffect, useRef } from "react";
import { useFetch, CardRow, KpiCard, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface DecisionRule {
  trigger?: string;
  rule?: string;
  condition?: string;
  outcome?: string;
  result?: string;
}

interface PatentExtracted {
  relevanceToRoofers?: string;
  imageFeaturesScanned?: string[];
  decisionRules?: DecisionRule[];
  exclusions?: string[];
  counterPlaysForRoofers?: string[];
  badFaithSignals?: string[];
}

interface PatentDoc {
  title?: string;
  assignee?: string;
  extracted?: PatentExtracted;
}

interface CarrierPatentsResponse {
  byCarrier: Record<string, string[]>;
  patents: Record<string, PatentDoc>;
}

interface DenialCase {
  carrier?: string;
  adjuster?: string;
  denialCategory?: string;
  dateOfDenial?: string;
  outcome?: string;
  keyDenialLanguage?: string | string[];
  carrierTactic?: string;
  rooferTactic?: string;
  rooferStrategyNote?: string;
  lessonForAnalyzer?: string;
  patentMapping?: string | Record<string, unknown>;
}

interface NaicByState {
  compositeScore?: number;
  rank?: number;
  marketSharePct?: string;
  avgPremium?: number;
  enforcement?: string;
  marketConduct?: string;
}

interface NaicEntry {
  index: number;
  rating?: string;
  amBest?: string;
  note?: string;
  byState?: Record<string, NaicByState>;
  marketConduct?: string;
  // NOTE: enforcement does NOT exist at top level on the real API response —
  // it lives per-state inside byState[stateCode].enforcement.
}

interface NaicComplaintIndexResponse {
  carriers?: Record<string, NaicEntry>;
  [key: string]: unknown;
}

// live-market-intel and insurer-rankings — we consume them as opaque blobs
// and only pull specific fields; define minimal shapes.
interface MdCountyNR {
  county: string;
  nr2021: number;
  nr2023: number;
  changePct21to23: number;
}

interface MdMarketHardening {
  statewide?: unknown;
  countyNonRenewals: MdCountyNR[];
  keyAlerts: string[];
}

interface OhioCarrierEntry {
  name: string;
  marketSharePct: number;
  dwp2024: number;
}

interface OhioTop70 {
  carriers: OhioCarrierEntry[];
  totalMarketDWP: number;
}

interface LiveMarketIntelResponse {
  mdMarketHardening_2024?: MdMarketHardening;
  ohioTop70_2024?: OhioTop70;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function naicClass(rating: string | undefined): string {
  if (!rating) return "naic-average";
  if (rating.includes("excellent")) return "naic-excellent";
  if (rating.includes("good")) return "naic-good";
  if (rating.includes("above") || rating.includes("high")) return "naic-high";
  return "naic-average";
}

function naicLabel(rating: string | undefined): string {
  if (!rating) return "?";
  if (rating.includes("excellent")) return "excellent";
  if (rating.includes("good")) return "good";
  if (rating.includes("above") || rating.includes("high")) return "high";
  return "avg";
}

function outcomeClass(outcome: string | undefined): string {
  if (!outcome) return "";
  const o = outcome.toLowerCase();
  if (o.includes("full") || o.includes("paid") || o.includes("approved")) return "approved";
  if (o.includes("partial") || o.includes("supplement")) return "partial";
  if (o.includes("denied") || o.includes("denial")) return "denied";
  return "escalated";
}

const OUTCOME_COLORS: Record<string, { bg: string; color: string }> = {
  approved: { bg: "rgba(16,185,129,0.15)", color: "#10b981" },
  partial: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" },
  denied: { bg: "rgba(239,68,68,0.15)", color: "#ef4444" },
  escalated: { bg: "rgba(96,165,250,0.15)", color: "#60a5fa" },
};

const NAIC_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  "naic-excellent": { bg: "rgba(16,185,129,0.2)", color: "#10b981" },
  "naic-good":      { bg: "rgba(96,165,250,0.2)",  color: "#60a5fa" },
  "naic-average":   { bg: "rgba(245,158,11,0.2)",  color: "#f59e0b" },
  "naic-high":      { bg: "rgba(239,68,68,0.2)",   color: "#ef4444" },
};

// Fuzzy carrier name match for cases (mirrors HTML caseCarrierMatch)
const CARRIER_ALIASES: Record<string, string[]> = {
  "state farm": ["statefarm", "state farm", "wccs"],
  allstate: ["allstate", "encompass"],
  travelers: ["travelers", "travco", "standard fire", "the standard fire"],
  "liberty mutual": ["liberty mutual", "liberty", "lm general"],
  usaa: ["usaa", "usaa general", "usaa casualty", "usaa / usaa"],
  nationwide: ["nationwide", "nationwide property"],
  erie: ["erie"],
  "amig (cincinnati financial)": ["amig", "cincinnati", "american modern"],
  "utica national": ["utica"],
};

function caseCarrierMatch(caseName: string | undefined, carrier: string): boolean {
  if (!caseName) return false;
  const cn = caseName.toLowerCase();
  const c = carrier.toLowerCase();
  if (cn.includes(c) || c.includes(cn)) return true;
  const map = CARRIER_ALIASES[c] ?? [c];
  return map.some((alias) => cn.includes(alias));
}

// ---------------------------------------------------------------------------
// Sub-section components
// ---------------------------------------------------------------------------

const subHead: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "var(--riq-text-muted)",
  margin: "10px 0 6px",
  fontWeight: 700,
};

const sectionStyle: React.CSSProperties = {
  background: "var(--riq-surface)",
  border: "1px solid var(--riq-border)",
  borderRadius: 8,
  padding: "18px 22px",
  marginBottom: 16,
};

function PatentCard({
  pid,
  doc,
}: {
  pid: string;
  doc: PatentDoc;
}) {
  const [open, setOpen] = useState(false);
  const e = doc.extracted ?? {};
  const rules = e.decisionRules ?? [];
  const counters = e.counterPlaysForRoofers ?? [];
  const badFaith = e.badFaithSignals ?? [];
  const imageFeatures = e.imageFeaturesScanned ?? [];
  const exclusions = e.exclusions ?? [];

  return (
    <div
      style={{
        border: "1px solid var(--riq-border)",
        borderRadius: 7,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "var(--riq-bg)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#a78bfa",
            fontFamily: "monospace",
          }}
        >
          {pid}
        </span>
        <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {doc.title?.replace(/^US\d+[A-Z0-9]* - /, "").replace(" - Google Patents", "").slice(0, 80)}
        </span>
        <span style={{ fontSize: 11, color: "var(--riq-text-muted)", whiteSpace: "nowrap" }}>
          {doc.assignee ?? ""}
        </span>
        <a
          href={`https://patents.google.com/patent/${pid}/en`}
          target="_blank"
          rel="noreferrer"
          onClick={(ev) => ev.stopPropagation()}
          style={{ fontSize: 10, color: "#60a5fa", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          view ↗
        </a>
        <span style={{ color: "var(--riq-text-muted)", fontSize: 16, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "none" }}>
          ▼
        </span>
      </div>

      {open && (
        <div style={{ padding: "14px 16px" }}>
          {e.relevanceToRoofers && (
            <div style={{ fontSize: 12, color: "var(--riq-text-muted)", marginBottom: 12, fontStyle: "italic" }}>
              {e.relevanceToRoofers}
            </div>
          )}

          {imageFeatures.length > 0 && (
            <>
              <div style={subHead}>What the AI visually scans</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {imageFeatures.map((f, i) => (
                  <span
                    key={i}
                    style={{
                      background: "rgba(167,139,250,0.12)",
                      border: "1px solid rgba(167,139,250,0.3)",
                      color: "#a78bfa",
                      padding: "3px 9px",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </>
          )}

          {rules.length > 0 && (
            <>
              <div style={subHead}>Decision Rules ({rules.length})</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 10px", background: "#1e1a16", color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--riq-border)" }}>
                      Trigger (what fires the rule)
                    </th>
                    <th style={{ textAlign: "left", padding: "6px 10px", background: "#1e1a16", color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--riq-border)" }}>
                      Outcome (what the AI decides)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "top", lineHeight: 1.4, fontSize: 12 }}>
                        {r.trigger ?? r.rule ?? r.condition ?? String(r)}
                      </td>
                      <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "top", lineHeight: 1.4, fontSize: 12, color: "var(--riq-text-muted)" }}>
                        {r.outcome ?? r.result ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {exclusions.length > 0 && (
            <>
              <div style={subHead}>Documented Exclusions (what AI flags as &ldquo;not covered&rdquo;)</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                {exclusions.map((ex, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "7px 12px 7px 28px",
                      position: "relative",
                      fontSize: 12,
                      lineHeight: 1.5,
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span style={{ position: "absolute", left: 10, color: "#ef4444", fontSize: 10, top: 9 }}>⚠</span>
                    {ex}
                  </li>
                ))}
              </ul>
            </>
          )}

          {counters.length > 0 && (
            <>
              <div style={subHead}>Counter-Plays for Roofers</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
                {counters.map((c, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "7px 12px 7px 28px",
                      position: "relative",
                      fontSize: 12,
                      lineHeight: 1.5,
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span style={{ position: "absolute", left: 10, color: "#10b981", fontSize: 9, top: 9 }}>▶</span>
                    {c}
                  </li>
                ))}
              </ul>
            </>
          )}

          {badFaith.length > 0 && (
            <>
              <div style={subHead}>Bad-Faith Indicators</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {badFaith.map((b, i) => (
                  <li
                    key={i}
                    style={{
                      padding: "7px 12px 7px 28px",
                      position: "relative",
                      fontSize: 12,
                      lineHeight: 1.5,
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <span style={{ position: "absolute", left: 10, color: "#ef4444", fontSize: 10, top: 7 }}>⚠</span>
                    {b}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CaseCard({ c }: { c: DenialCase }) {
  const keyLang = Array.isArray(c.keyDenialLanguage)
    ? c.keyDenialLanguage
    : c.keyDenialLanguage
    ? [c.keyDenialLanguage]
    : [];
  const oc = outcomeClass(c.outcome);
  const ocColors = OUTCOME_COLORS[oc] ?? {};

  return (
    <div
      style={{
        border: "1px solid var(--riq-border)",
        borderRadius: 7,
        padding: "14px 16px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--riq-accent)" }}>{c.carrier ?? ""}</span>
        {c.adjuster && (
          <span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>
            {c.adjuster.split(",")[0]}
          </span>
        )}
        {c.denialCategory && (
          <span
            style={{
              fontSize: 11,
              background: "rgba(167,139,250,0.15)",
              color: "#a78bfa",
              padding: "2px 8px",
              borderRadius: 3,
              fontWeight: 600,
            }}
          >
            {c.denialCategory}
          </span>
        )}
        {c.dateOfDenial && (
          <span style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>{c.dateOfDenial}</span>
        )}
        {c.outcome && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 3,
              fontWeight: 600,
              marginLeft: "auto",
              background: ocColors.bg ?? "transparent",
              color: ocColors.color ?? "var(--riq-text-muted)",
            }}
          >
            {c.outcome}
          </span>
        )}
      </div>

      {keyLang.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginBottom: 4 }}>
            Denial language (what triggered the rule)
          </div>
          {keyLang.slice(0, 3).map((phrase, i) => (
            <div
              key={i}
              style={{
                background: "rgba(239,68,68,0.08)",
                borderLeft: "3px solid #ef4444",
                padding: "6px 10px",
                borderRadius: "0 4px 4px 0",
                fontStyle: "italic",
                marginBottom: 4,
                fontSize: 12,
              }}
            >
              &ldquo;{phrase}&rdquo;
            </div>
          ))}
        </div>
      )}

      {c.carrierTactic && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginBottom: 4 }}>
            Carrier tactic (how the AI denial manifested)
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--riq-text-muted)" }}>{c.carrierTactic}</div>
        </div>
      )}

      {(c.rooferTactic ?? c.rooferStrategyNote) && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginBottom: 4 }}>
            Counter-tactic (what works)
          </div>
          <div
            style={{
              background: "rgba(16,185,129,0.08)",
              borderLeft: "3px solid #10b981",
              padding: "6px 10px",
              borderRadius: "0 4px 4px 0",
              fontSize: 12,
            }}
          >
            {c.rooferTactic ?? c.rooferStrategyNote}
          </div>
        </div>
      )}

      {c.lessonForAnalyzer && (
        <div>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--riq-text-muted)", marginBottom: 4 }}>
            Rep lesson
          </div>
          <div
            style={{
              background: "rgba(96,165,250,0.08)",
              borderLeft: "3px solid #60a5fa",
              padding: "6px 10px",
              borderRadius: "0 4px 4px 0",
              fontSize: 12,
            }}
          >
            {c.lessonForAnalyzer}
          </div>
        </div>
      )}

      {c.patentMapping && (
        <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 6, fontStyle: "italic" }}>
          Patent mapping:{" "}
          {typeof c.patentMapping === "string"
            ? c.patentMapping.slice(0, 200)
            : JSON.stringify(c.patentMapping).slice(0, 200)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Market Alerts banner
// ---------------------------------------------------------------------------

function MarketAlerts({ market }: { market: LiveMarketIntelResponse | null }) {
  if (!market) return null;
  const md = market.mdMarketHardening_2024;
  const oh = market.ohioTop70_2024;
  if (!md && !oh) return null;

  return (
    <div style={sectionStyle}>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "#ef4444" }}>
        Live Market Intelligence — MD + OH
      </h2>
      <p style={{ color: "var(--riq-text-muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
        Fetched directly from MD Insurance Administration (Nov 2024) and Ohio DOI (June 2025).
      </p>
      {md && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={subHead}>Maryland — Non-Renewal Crisis (2021→2023)</div>
            <CardRow>
              <KpiCard label="Non-renewals statewide" value="+62%" />
              <KpiCard label="Early cancellations (60–90d)" value="+125%" />
              <KpiCard label="Carriers restricting by roof age" value="11/29" />
            </CardRow>
            <div style={{ marginTop: 8 }}>
              {md.countyNonRenewals.slice(0, 6).map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 12,
                  }}
                >
                  <span style={{ flex: 1 }}>{c.county}</span>
                  <span style={{ color: "#ef4444", fontWeight: 700 }}>+{c.changePct21to23}%</span>
                  <span style={{ color: "var(--riq-text-muted)", fontSize: 10 }}>
                    ({c.nr2021}→{c.nr2023})
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={subHead}>MD Roof Intel for Roofers</div>
            {md.keyAlerts.map((a, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: "5px 10px 5px 22px",
                  position: "relative",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}
              >
                <span style={{ position: "absolute", left: 6, color: "var(--riq-accent)" }}>▸</span>
                {a}
              </div>
            ))}
          </div>
        </div>
      )}
      {oh?.carriers && (
        <>
          <div style={subHead}>
            Ohio HO Market — Top 8 by DWP (2024, ${(oh.totalMarketDWP / 1e9).toFixed(2)}B total)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            {oh.carriers.slice(0, 8).map((c, i) => {
              const name = c.name.replace(" GRP", "").replace(" INS", "").replace(" MUT", "");
              const pct = c.marketSharePct;
              const color = pct >= 10 ? "#ef4444" : pct >= 5 ? "#f59e0b" : "var(--riq-text-muted)";
              return (
                <div
                  key={i}
                  style={{
                    background: "var(--riq-bg)",
                    borderRadius: 6,
                    padding: "10px 14px",
                    minWidth: 110,
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, color }}>{pct}%</div>
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 2 }}>
                    {fmtMoney(c.dwp2024)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carrier detail pane
// ---------------------------------------------------------------------------

function CarrierDetail({
  carrier,
  patents,
  allCases,
  naicMap,
}: {
  carrier: string;
  patents: CarrierPatentsResponse;
  allCases: DenialCase[];
  naicMap: Record<string, NaicEntry>;
}) {
  const isVendor = carrier === "VENDOR_MULTI";
  const patentIds = patents.byCarrier[carrier] ?? [];
  const naicEntry: NaicEntry | undefined = isVendor
    ? undefined
    : naicMap[carrier] ??
      Object.entries(naicMap).find(([k]) => caseCarrierMatch(k, carrier))?.[1];
  const cases: DenialCase[] = isVendor
    ? []
    : allCases.filter((cs) => caseCarrierMatch(cs.carrier, carrier));

  const h2Style: React.CSSProperties = {
    margin: "0 0 4px",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--riq-accent)",
  };
  const h2Blue: React.CSSProperties = { ...h2Style, color: "#60a5fa" };

  return (
    <>
      {/* Intelligence brief */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>
          {isVendor ? "Vendor AI Engines (Multi-Carrier)" : carrier}
        </h2>
        <p style={{ color: "var(--riq-text-muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
          {isVendor
            ? "Third-party AI platforms (Accurence, Betterview, Tractable, Dolphin AI) licensed by multiple carriers. When a carrier's own adjuster can't explain the denial rationale, they're likely citing a vendor AI output."
            : "AI patent profile, NAIC complaint index, and real-world denial patterns."}
        </p>

        {naicEntry ? (
          (() => {
            const idx = naicEntry.index;
            const fillColor = idx <= 0.8 ? "#10b981" : idx <= 1.2 ? "#f59e0b" : "#ef4444";
            const fillPct = Math.min(100, (idx / 3) * 100);
            const amBest = naicEntry.amBest ?? "—";
            const amBestColor = amBest.includes("++")
              ? "#10b981"
              : amBest.includes("+")
              ? "#60a5fa"
              : "#f59e0b";
            const ratingColor =
              naicEntry.rating?.includes("excellent")
                ? "#10b981"
                : naicEntry.rating?.includes("good")
                ? "#60a5fa"
                : naicEntry.rating?.includes("above") || naicEntry.rating?.includes("high")
                ? "#ef4444"
                : "#f59e0b";

            return (
              <>
                <CardRow>
                  <KpiCard label="NAIC Complaint Index" value={idx.toFixed(2)} />
                  <KpiCard
                    label="Complaint Rating"
                    value={<span style={{ color: ratingColor }}>{naicEntry.rating ?? "?"}</span>}
                  />
                  <KpiCard
                    label="AM Best (Financial)"
                    value={<span style={{ color: amBestColor }}>{amBest}</span>}
                  />
                  <KpiCard label="AI Patents (own)" value={patentIds.length} />
                </CardRow>
                {/* NAIC bar */}
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--riq-border)",
                    margin: "8px 0",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 3,
                      width: `${fillPct}%`,
                      background: fillColor,
                    }}
                  />
                </div>
                {naicEntry.note && (
                  <p style={{ fontSize: 11, color: "var(--riq-text-muted)", margin: "4px 0 0" }}>
                    {naicEntry.note}
                  </p>
                )}

                {/* Per-state composite scores */}
                {naicEntry.byState && Object.keys(naicEntry.byState).length > 0 && (
                  <>
                    <div style={{ ...subHead, marginTop: 14 }}>Per-State Composite Score (1–10 = best)</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {Object.entries(naicEntry.byState).map(([state, sd]) => {
                        const sc = sd.compositeScore;
                        const scColor =
                          sc != null
                            ? sc >= 8
                              ? "#10b981"
                              : sc >= 6.5
                              ? "#f59e0b"
                              : "#ef4444"
                            : "var(--riq-text-muted)";
                        return (
                          <div
                            key={state}
                            style={{
                              background: "var(--riq-bg)",
                              borderRadius: 6,
                              padding: "10px 14px",
                              minWidth: 90,
                            }}
                          >
                            <div style={{ fontSize: 22, fontWeight: 700, color: scColor }}>
                              {sc ?? "—"}
                            </div>
                            <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                              {state} · #{sd.rank ?? "?"}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--riq-text-muted)", marginTop: 3 }}>
                              {sd.marketSharePct ?? "?"}% mkt share
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--riq-text-muted)" }}>
                      Avg annual premium:{" "}
                      {Object.entries(naicEntry.byState)
                        .map(([s, sd]) => `${s}: $${(sd.avgPremium ?? 0).toLocaleString()}`)
                        .join(" · ")}
                    </div>
                  </>
                )}

                {naicEntry.marketConduct && (
                  <div
                    style={{
                      marginTop: 10,
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: 6,
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 4 }}>
                      REGULATORY FINDINGS
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.5 }}>{naicEntry.marketConduct}</div>
                  </div>
                )}

                {Object.entries(naicEntry.byState ?? {}).some(
                  ([, sv]) => sv.enforcement && sv.enforcement !== sv.marketConduct
                ) && (
                  <div
                    style={{
                      marginTop: 6,
                      background: "rgba(245,158,11,0.08)",
                      border: "1px solid rgba(245,158,11,0.3)",
                      borderRadius: 6,
                      padding: "10px 14px",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", marginBottom: 4 }}>
                      ENFORCEMENT ACTIONS
                    </div>
                    {Object.entries(naicEntry.byState ?? {})
                      .filter(([, sv]) => sv.enforcement && sv.enforcement !== sv.marketConduct)
                      .map(([state, sv]) => (
                        <div key={state} style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 4 }}>
                          <strong>{state}:</strong> {sv.enforcement}
                        </div>
                      ))}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          <CardRow>
            <KpiCard label="AI Patents" value={patentIds.length} />
            <KpiCard label="Real Cases Logged" value={cases.length} />
          </CardRow>
        )}
      </div>

      {/* Patent Decoder */}
      <div style={sectionStyle}>
        <h2 style={h2Blue}>Patent Decision Rules</h2>
        <p style={{ color: "var(--riq-text-muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
          Documented decision rules each patent implements. Match denial language to a rule — and find counter-plays.
        </p>
        {patentIds.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)", fontSize: 13 }}>
            No patents indexed for this carrier yet. Carrier may rely on vendor AI (see Vendor AI Engines tab).
          </div>
        ) : (
          patentIds.map((pid) => {
            const doc = patents.patents[pid];
            if (!doc) return null;
            return <PatentCard key={pid} pid={pid} doc={doc} />;
          })
        )}
      </div>

      {/* Real Cases */}
      {!isVendor && (
        <div style={sectionStyle}>
          <h2 style={h2Blue}>Real Cases ({cases.length})</h2>
          <p style={{ color: "var(--riq-text-muted)", fontSize: 13, margin: "0 0 14px", lineHeight: 1.5 }}>
            Actual denial emails and letters — denial language, the tactic used, and what worked.
          </p>
          {cases.length === 0 ? (
            <p style={{ color: "var(--riq-text-muted)", margin: 0, fontSize: 13 }}>
              No logged cases for this carrier yet. Cases are added as denial emails are processed through the Analyzer.
            </p>
          ) : (
            cases.map((c, i) => <CaseCard key={i} c={c} />)
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component — parallel data loading, then sidebar + detail view
// ---------------------------------------------------------------------------

export function CarrierAlgorithms() {
  // Four separate fetches (parallel). insurer-rankings and live-market-intel
  // are optional — we handle their failure gracefully.
  const patentsFetch = useFetch<CarrierPatentsResponse>("/api/intel/carrier-patents");
  const casesFetch = useFetch<DenialCase[] | { entries: DenialCase[] }>("/api/intel/denial-sources-full");
  const naicFetch = useFetch<NaicComplaintIndexResponse>("/api/intel/naic-complaint-index");
  const marketFetch = useFetch<LiveMarketIntelResponse>("/api/intel/live-market-intel");

  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);
  const autoSelected = useRef(false);

  const loading =
    patentsFetch.loading || casesFetch.loading || naicFetch.loading;
  const err = patentsFetch.error || casesFetch.error;

  // Normalise cases array
  const allCases: DenialCase[] = !casesFetch.data
    ? []
    : Array.isArray(casesFetch.data)
    ? casesFetch.data
    : (casesFetch.data as { entries: DenialCase[] }).entries ?? [];

  // Normalise NAIC map
  const naicMap: Record<string, NaicEntry> = !naicFetch.data
    ? {}
    : (naicFetch.data.carriers as Record<string, NaicEntry> | undefined) ??
      (naicFetch.data as Record<string, NaicEntry>);

  const patentsData = patentsFetch.data;

  // Build carrier list and auto-select first
  const carrierNames = patentsData
    ? Object.keys(patentsData.byCarrier).filter((c) => c !== "VENDOR_MULTI").sort()
    : [];

  useEffect(() => {
    if (!autoSelected.current && carrierNames.length > 0) {
      setSelectedCarrier(carrierNames[0]);
      autoSelected.current = true;
    }
  }, [carrierNames]);

  const activeCarrier = selectedCarrier ?? null;

  const btnBase: React.CSSProperties = {
    background: "var(--riq-bg)",
    border: "1px solid var(--riq-border)",
    borderRadius: 6,
    padding: "10px 12px",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--riq-text)",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    fontFamily: "inherit",
    marginBottom: 4,
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
      {loading && (
        <div style={{ padding: 60, textAlign: "center", color: "var(--riq-accent)", fontSize: 16 }}>
          Loading algorithm intelligence…
        </div>
      )}
      {!loading && err && (
        <div style={{ padding: 20, color: "#ef4444" }}>Error loading data: {err}</div>
      )}
      {!loading && !err && patentsData && (
        <>
          <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 20, lineHeight: 1.5 }}>
            Every carrier&apos;s AI denial engine — decoded. Patent-documented decision rules, real denial cases
            mapped to those rules, and proven counter-plays. Use this before any supplement negotiation or
            re-inspection request.
          </p>

          <MarketAlerts market={marketFetch.data} />

          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20, alignItems: "start" }}>
            {/* Sidebar */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  color: "var(--riq-text-muted)",
                  padding: "0 4px 4px",
                  marginBottom: 4,
                }}
              >
                Select Carrier
              </div>
              {carrierNames.map((c) => {
                const naicEntry: NaicEntry | undefined =
                  naicMap[c] ??
                  Object.entries(naicMap).find(([k]) => caseCarrierMatch(k, c))?.[1];
                const rating = naicEntry?.rating ?? "average";
                const nc = naicClass(rating);
                const badgeColors = NAIC_BADGE_COLORS[nc] ?? NAIC_BADGE_COLORS["naic-average"];
                const casesCount = allCases.filter((cs) => caseCarrierMatch(cs.carrier, c)).length;
                const isActive = activeCarrier === c;

                return (
                  <button
                    key={c}
                    onClick={() => setSelectedCarrier(c)}
                    style={{
                      ...btnBase,
                      background: isActive ? "rgba(244,167,56,0.12)" : "var(--riq-bg)",
                      borderColor: isActive ? "var(--riq-accent)" : "var(--riq-border)",
                      color: isActive ? "var(--riq-accent)" : "var(--riq-text)",
                      fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    <span style={{ flex: 1 }}>{c}</span>
                    <span
                      style={{
                        fontSize: 10,
                        marginLeft: "auto",
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontWeight: 700,
                        background: badgeColors.bg,
                        color: badgeColors.color,
                      }}
                    >
                      {naicLabel(rating)}
                    </span>
                    {casesCount > 0 && (
                      <span style={{ fontSize: 10, color: "var(--riq-text-muted)" }}>
                        ({casesCount})
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Vendor multi-carrier button */}
              <div
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  color: "var(--riq-text-muted)",
                  padding: "4px 4px",
                  marginTop: 14,
                  marginBottom: 4,
                }}
              >
                Vendor AI (Multi-Carrier)
              </div>
              <button
                onClick={() => setSelectedCarrier("VENDOR_MULTI")}
                style={{
                  ...btnBase,
                  background:
                    activeCarrier === "VENDOR_MULTI"
                      ? "rgba(244,167,56,0.12)"
                      : "var(--riq-bg)",
                  borderColor:
                    activeCarrier === "VENDOR_MULTI"
                      ? "var(--riq-accent)"
                      : "var(--riq-border)",
                  color:
                    activeCarrier === "VENDOR_MULTI"
                      ? "var(--riq-accent)"
                      : "var(--riq-text)",
                  fontWeight: activeCarrier === "VENDOR_MULTI" ? 700 : 400,
                }}
              >
                <span>🔬 Vendor AI Engines</span>
                <span
                  style={{
                    fontSize: 10,
                    marginLeft: "auto",
                    padding: "2px 6px",
                    borderRadius: 3,
                    fontWeight: 700,
                    background: "rgba(245,158,11,0.2)",
                    color: "#f59e0b",
                  }}
                >
                  multi
                </span>
              </button>
            </div>

            {/* Detail pane */}
            <div>
              {!activeCarrier ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: "center",
                    color: "var(--riq-text-muted)",
                    fontSize: 13,
                  }}
                >
                  Select a carrier to see its algorithm breakdown.
                </div>
              ) : (
                <CarrierDetail
                  carrier={activeCarrier}
                  patents={patentsData}
                  allCases={allCases}
                  naicMap={naicMap}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
