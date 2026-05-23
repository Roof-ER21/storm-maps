/**
 * Carrier Hub — Playbook tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/carrier-playbook.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/carrier-boilerplate
 *      Response: { byCarrier, totalCarriers, totalCuratedPhrases, totalNgramPhrases, generated }
 *   2. GET /api/intel/denial-intake/stats
 *      Response: { winRates: [{ carrier, flipRate, approved, partial, denied, total }] }
 *
 * Both are fetched in parallel at mount. Carrier selection is via internal
 * tab buttons sorted by phrase count desc (same as HTML). No props.
 */
import { useState } from "react";
import { useFetch, Panel } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

interface CuratedPhrase {
  phrase: string;
  occurrences: number;
}

interface NgramPhrase {
  phrase: string;
  occurrences?: number;
}

interface CarrierStrategy {
  carrierTactic?: string;
  rooferTactic?: string;
  lessonForAnalyzer?: string;
  source?: string;
}

interface CarrierBoilerplateBag {
  curatedPhrases?: CuratedPhrase[];
  phrases?: NgramPhrase[];
  strategies?: CarrierStrategy[];
}

interface CarrierBoilerplateResponse {
  byCarrier: Record<string, CarrierBoilerplateBag>;
  totalCarriers: number;
  totalCuratedPhrases: number;
  totalNgramPhrases: number;
  generated: string;
}

interface WinRateEntry {
  carrier: string;
  flipRate: number;
  approved: number;
  partial: number;
  denied: number;
  total: number;
}

interface DenialIntakeStatsResponse {
  winRates?: WinRateEntry[];
}

// ---------------------------------------------------------------------------
// Win-rate lookup (fuzzy match, mirrors HTML logic)
// ---------------------------------------------------------------------------

function findWinRate(
  canonical: string,
  winRates: WinRateEntry[],
): WinRateEntry | null {
  const t = canonical.toLowerCase();
  for (const w of winRates) {
    const key = (w.carrier ?? "").toLowerCase();
    if (key === t || key.includes(t) || t.includes(key)) return w;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        background: "var(--riq-bg)",
        borderRadius: 6,
        padding: "10px 14px",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)" }}>{value}</div>
      <div
        style={{
          color: "var(--riq-text-muted)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function PhraseRow({
  phrase,
  occurrences,
  type,
}: {
  phrase: string;
  occurrences?: number;
  type: "curated" | "ngram";
}) {
  const pillStyle: React.CSSProperties =
    type === "curated"
      ? {
          display: "inline-block",
          background: "rgba(167,139,250,0.18)",
          color: "#a78bfa",
          padding: "1px 8px",
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          marginLeft: 8,
        }
      : {
          display: "inline-block",
          background: "rgba(96,165,250,0.18)",
          color: "#60a5fa",
          padding: "1px 8px",
          borderRadius: 3,
          fontSize: 10,
          fontWeight: 700,
          marginLeft: 8,
        };

  return (
    <div
      style={{
        background: "var(--riq-bg)",
        borderLeft: "3px solid #a78bfa",
        borderRadius: "0 5px 5px 0",
        padding: "9px 14px",
        marginBottom: 7,
        fontSize: 13,
        lineHeight: 1.5,
        fontStyle: "italic",
      }}
    >
      &ldquo;{phrase}&rdquo;
      <span style={pillStyle}>{type === "curated" ? "CURATED" : "NGRAM"}</span>
      {occurrences != null && occurrences > 1 && (
        <span style={{ color: "var(--riq-text-muted)", fontSize: 11, fontStyle: "normal", marginLeft: 6 }}>
          {occurrences}x in corpus
        </span>
      )}
    </div>
  );
}

function StrategyCard({ s }: { s: CarrierStrategy }) {
  return (
    <div
      style={{
        background: "var(--riq-bg)",
        borderLeft: "3px solid var(--riq-accent)",
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {s.carrierTactic && (
        <div>
          <strong style={{ color: "#ef4444" }}>CARRIER TACTIC:</strong> {s.carrierTactic}
        </div>
      )}
      {s.rooferTactic && (
        <div style={{ marginTop: 6 }}>
          <strong style={{ color: "#10b981" }}>ROOFER COUNTER:</strong> {s.rooferTactic}
        </div>
      )}
      {s.lessonForAnalyzer && (
        <div style={{ marginTop: 6 }}>
          <strong style={{ color: "#a78bfa" }}>ANALYZER LESSON:</strong> {s.lessonForAnalyzer}
        </div>
      )}
      {s.source && (
        <div style={{ marginTop: 6, color: "var(--riq-text-muted)", fontSize: 11, fontStyle: "italic" }}>
          — from {s.source}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-carrier content panel
// ---------------------------------------------------------------------------

function CarrierContent({
  bag,
  winRates,
  carrierName,
}: {
  bag: CarrierBoilerplateBag;
  winRates: WinRateEntry[];
  carrierName: string;
}) {
  const curated = bag.curatedPhrases ?? [];
  const ngrams = (bag.phrases ?? []).slice(0, 30);
  const strategies = bag.strategies ?? [];

  const wr = findWinRate(carrierName, winRates);

  const subH3: React.CSSProperties = {
    margin: "14px 0 8px",
    fontSize: 14,
    fontWeight: 700,
    color: "#60a5fa",
  };
  const emptyNote: React.CSSProperties = {
    padding: "20px",
    textAlign: "center",
    color: "var(--riq-text-muted)",
    fontSize: 13,
  };

  const flipColor =
    wr && wr.total > 0
      ? wr.flipRate >= 0.6
        ? "#10b981"
        : wr.flipRate >= 0.3
        ? "#f59e0b"
        : "#ef4444"
      : null;

  return (
    <div>
      {/* Win-rate banner */}
      {wr && wr.total > 0 && flipColor && (
        <div
          style={{
            background: "var(--riq-bg)",
            borderLeft: `3px solid ${flipColor}`,
            borderRadius: "0 6px 6px 0",
            padding: "12px 16px",
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          <strong style={{ color: flipColor, fontSize: 15 }}>
            {(wr.flipRate * 100).toFixed(0)}% flip rate
          </strong>{" "}
          · {wr.approved} approved, {wr.partial} partial, {wr.denied} denied across {wr.total} tracked
          outcomes
        </div>
      )}

      {/* Strategies */}
      {strategies.length > 0 && (
        <>
          <h3 style={subH3}>Carrier Tactics vs Roof Docs Counter-Plays</h3>
          {strategies.map((s, i) => (
            <StrategyCard key={i} s={s} />
          ))}
        </>
      )}

      {/* Curated phrases */}
      <h3 style={subH3}>Curated Boilerplate (hand-tagged from real denials)</h3>
      {curated.length === 0 ? (
        <div style={emptyNote}>
          No curated phrases yet — corpus too small. Will populate as more denials flow through the Analyzer.
        </div>
      ) : (
        curated.map((p, i) => (
          <PhraseRow key={i} phrase={p.phrase} occurrences={p.occurrences} type="curated" />
        ))
      )}

      {/* N-gram phrases */}
      <h3 style={subH3}>N-gram Boilerplate (auto-detected repeated phrases)</h3>
      {ngrams.length === 0 ? (
        <div style={emptyNote}>
          No repeated n-grams detected — need 2+ carrier denials with similar phrasing.
        </div>
      ) : (
        ngrams.map((p, i) => (
          <PhraseRow key={i} phrase={p.phrase} occurrences={p.occurrences ?? 2} type="ngram" />
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CarrierPlaybook() {
  const bpFetch = useFetch<CarrierBoilerplateResponse>("/api/intel/carrier-boilerplate");
  const statsFetch = useFetch<DenialIntakeStatsResponse>("/api/intel/denial-intake/stats");
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);

  const loading = bpFetch.loading || statsFetch.loading;
  const err = bpFetch.error || statsFetch.error;

  // Build carrier list sorted by phrase count desc (mirrors HTML)
  const carriers = Object.entries(bpFetch.data?.byCarrier ?? {})
    .map(([name, bag]) => ({
      name,
      count: (bag.curatedPhrases?.length ?? 0) + (bag.phrases?.length ?? 0),
      bag,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // Auto-select first when data arrives
  const activeCarrierName =
    selectedCarrier ?? (carriers.length > 0 ? carriers[0].name : null);
  const activeBag = activeCarrierName
    ? (bpFetch.data?.byCarrier ?? {})[activeCarrierName]
    : null;

  const winRates = statsFetch.data?.winRates ?? [];
  const bp = bpFetch.data;

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
        <div style={{ padding: 50, textAlign: "center", color: "var(--riq-accent)" }}>
          Loading playbook…
        </div>
      )}
      {!loading && err && (
        <div style={{ padding: 20, color: "#ef4444" }}>
          Failed to load — refresh data first
        </div>
      )}
      {!loading && !err && bp && (
        <>
          {/* Header stats */}
          <Panel title="Per-Carrier Boilerplate Library">
            <p
              style={{
                color: "var(--riq-text-muted)",
                fontSize: 13,
                margin: "0 0 14px",
                lineHeight: 1.5,
              }}
            >
              Phrases we&apos;ve seen carriers use in 2+ denials — strong signal of template/AI-generated
              language. When a denial contains these phrases verbatim, the Analyzer auto-flags them as
              boilerplate matches.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
                marginBottom: 4,
              }}
            >
              <StatBox value={String(bp.totalCarriers ?? 0)} label="Carriers profiled" />
              <StatBox value={String(bp.totalCuratedPhrases ?? 0)} label="Curated phrases" />
              <StatBox value={String(bp.totalNgramPhrases ?? 0)} label="Ngram phrases" />
              <StatBox
                value={bp.generated ? new Date(bp.generated).toLocaleDateString() : "—"}
                label="Last rebuilt"
              />
            </div>
          </Panel>

          {/* Carrier tabs + content */}
          {carriers.length > 0 && (
            <Panel title="Carriers" action={undefined}>
              {/* Tab row */}
              <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {carriers.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedCarrier(c.name)}
                    style={{
                      background:
                        activeCarrierName === c.name ? "var(--riq-accent)" : "var(--riq-bg)",
                      color: activeCarrierName === c.name ? "#1a1612" : "var(--riq-text)",
                      border: `1px solid ${
                        activeCarrierName === c.name
                          ? "var(--riq-accent)"
                          : "var(--riq-border)"
                      }`,
                      padding: "7px 14px",
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {c.name}{" "}
                    <span style={{ opacity: 0.6 }}>({c.count})</span>
                  </button>
                ))}
              </div>

              {/* Per-carrier content */}
              {activeCarrierName && activeBag ? (
                <CarrierContent
                  bag={activeBag}
                  winRates={winRates}
                  carrierName={activeCarrierName}
                />
              ) : (
                <div style={{ padding: 20, color: "var(--riq-text-muted)", textAlign: "center" }}>
                  No data for selected carrier.
                </div>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
