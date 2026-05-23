/**
 * Denial Combat Hub — Analyze tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/denial-analyzer.html.
 *
 * Data flow:
 *   1. On mount: GET /api/intel/carrier-patents → populate carrier picker
 *   2. File upload → POST /api/intel/transcribe-denial (base64 + mimeType)
 *      → prefill denial text textarea
 *   3. Analyze button → POST /api/intel/analyze-denial { denialText, carrier }
 *      → render analysis sections
 *   4. Outcome button → POST /api/intel/denial-intake/:id/outcome { outcome }
 *
 * No props — owns all state.
 */
import { useState, useEffect, useRef, type DragEvent, type ChangeEvent } from "react";

// ---------------------------------------------------------------------------
// Shared table / panel helpers (inline — no HomeCommon dep needed for this tab
// as the layout is quite different from the KPI-card pattern)
// ---------------------------------------------------------------------------

const ACCENT = "var(--riq-accent)";
const MUTED = "var(--riq-text-muted)";
const TEXT = "var(--riq-text)";
const SURFACE = "var(--riq-surface)";
const BORDER = "var(--riq-border)";
const BG = "var(--riq-bg)";

const RED = "#ef4444";
const GREEN = "#10b981";
const YELLOW = "#f59e0b";
const PURPLE = "#a78bfa";
const BLUE = "#60a5fa";

// ---------------------------------------------------------------------------
// Response shape interfaces
// ---------------------------------------------------------------------------

interface CarrierPatentsBlob {
  byCarrier: Record<string, string[]>;
}

interface TranscribeResponse {
  text: string;
  model: string;
  generated: string;
}

interface DenialReason {
  verbatimQuote: string;
  category: string;
}

interface MatchedPatent {
  patentId: string;
  ruleApplied: string;
  likelyReason: string;
}

interface Contradiction {
  patentId: string;
  contradiction: string;
}

interface RecommendedAction {
  priority: number;
  action: string;
  rationale?: string;
}

interface CounterLetter {
  subject?: string;
  body: string;
}

interface DenialAnalysis {
  identifiedCarrier?: string;
  identifiedAdjuster?: string;
  claimNumber?: string;
  denialDateGuess?: string;
  denialPosture?: string;
  denialReasons?: DenialReason[];
  matchedPatents?: MatchedPatent[];
  contradictions?: Contradiction[];
  aiTells?: string[];
  badFaithSignals?: string[];
  counterLetter?: CounterLetter;
  recommendedActions?: RecommendedAction[];
  appealStrength?: string;
  appealStrengthReasoning?: string;
}

interface BoilerplateMatch {
  phrase: string;
  carrier: string;
  sourceType: string;
  occurrencesInCorpus: number;
}

interface AnalyzeResponse {
  generated: string;
  model: string;
  carrierHint: string;
  stanceVariant: string;
  stanceSource: string;
  patentsConsidered: string[];
  corpusExamplesUsed: Array<{ id: string; source: string; carrier: string | null }>;
  boilerplateMatches: BoilerplateMatch[];
  matchedAdjusters: Array<{ name?: string; email?: string; denialPattern?: string }>;
  intakeId: number | null;
  analysis: DenialAnalysis;
}

interface OutcomeResponse {
  ok: boolean;
  outcomeId: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AppealStrength = "very-strong" | "strong" | "moderate" | "weak";

function strengthMeta(s: string | undefined): { pct: number; color: string; label: string } {
  const map: Record<AppealStrength, { pct: number; color: string; label: string }> = {
    "very-strong": { pct: 95, color: GREEN, label: "Very Strong" },
    strong: { pct: 75, color: GREEN, label: "Strong" },
    moderate: { pct: 50, color: YELLOW, label: "Moderate" },
    weak: { pct: 25, color: RED, label: "Weak" },
  };
  return map[(s as AppealStrength) ?? "moderate"] ?? map["moderate"];
}

const POSTURE_LABELS: Record<string, { txt: string; color: string; desc: string }> = {
  "full-denial": { txt: "FULL DENIAL", color: RED, desc: "Carrier rejects coverage entirely — appeal posture" },
  "partial-approval-undersized": { txt: "PARTIAL APPROVAL — UNDER-SCOPED", color: YELLOW, desc: "Coverage approved but squares/scope under-counted — supplement-request posture, not appeal" },
  "partial-approval-coverage-limited": { txt: "PARTIAL APPROVAL — COVERAGE LIMITED", color: YELLOW, desc: "Some components approved, others denied — line-item appeal posture" },
  "acv-payment-only": { txt: "ACV PAYMENT — DEPRECIATION WITHHELD", color: BLUE, desc: "Approved but RCV pending repair completion — depreciation-recovery posture" },
  "supplement-rejected": { txt: "SUPPLEMENT REJECTED", color: RED, desc: "Carrier denied additional scope after supplement — escalation posture" },
  "approval-full": { txt: "FULL APPROVAL", color: GREEN, desc: "Clean approval — no appeal needed" },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result ?? "");
      resolve(url.replace(/^data:[^;]+;base64,/, ""));
    };
    r.onerror = () => reject(new Error("FileReader failed"));
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionPanel({
  title,
  titleColor,
  desc,
  children,
}: {
  title: string;
  titleColor?: string;
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
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 16,
          fontWeight: 700,
          color: titleColor ?? ACCENT,
        }}
      >
        {title}
      </h2>
      {desc && (
        <p
          style={{
            color: MUTED,
            fontSize: 13,
            marginBottom: 14,
            lineHeight: 1.5,
            marginTop: 0,
          }}
        >
          {desc}
        </p>
      )}
      {children}
    </div>
  );
}

function MetaGrid({ a, carrierHint }: { a: DenialAnalysis; carrierHint: string }) {
  const cells: Array<{ label: string; val: string }> = [
    { label: "Carrier", val: a.identifiedCarrier || carrierHint || "—" },
    { label: "Adjuster", val: a.identifiedAdjuster || "—" },
    { label: "Claim #", val: a.claimNumber || "—" },
    { label: "Letter Date", val: a.denialDateGuess || "—" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
        marginBottom: 16,
      }}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          style={{ background: "#342c23", borderRadius: 6, padding: "10px 14px" }}
        >
          <div style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {c.label}
          </div>
          <div style={{ color: TEXT, fontSize: 14, marginTop: 4, fontWeight: 600 }}>
            {c.val}
          </div>
        </div>
      ))}
    </div>
  );
}

function AppealMeter({ strength, reasoning }: { strength?: string; reasoning?: string }) {
  const meta = strengthMeta(strength);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: MUTED, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        Appeal Strength
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <div
          style={{
            flex: 1,
            height: 12,
            background: "#342c23",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${meta.pct}%`,
              background: meta.color,
              transition: "width 0.4s",
            }}
          />
        </div>
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: meta.color,
          }}
        >
          {meta.label}
        </div>
      </div>
      {reasoning && (
        <p style={{ color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 1.5, marginBottom: 0 }}>
          {reasoning}
        </p>
      )}
    </div>
  );
}

function PostureBadge({ posture }: { posture: string }) {
  const p = POSTURE_LABELS[posture] ?? { txt: posture.toUpperCase(), color: MUTED, desc: "" };
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        background: "rgba(0,0,0,0.2)",
        borderLeft: `3px solid ${p.color}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.5px" }}>
        Denial Posture
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: p.color, marginTop: 4 }}>{p.txt}</div>
      {p.desc && (
        <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{p.desc}</div>
      )}
    </div>
  );
}

function ReasonCard({ reason }: { reason: DenialReason }) {
  return (
    <div
      style={{
        background: "#342c23",
        borderLeft: `3px solid ${BLUE}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontStyle: "italic", color: TEXT }}>"{reason.verbatimQuote}"</div>
      <span
        style={{
          display: "inline-block",
          background: "rgba(96,165,250,0.15)",
          color: BLUE,
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          marginTop: 6,
        }}
      >
        {(reason.category ?? "other").replace(/-/g, " ")}
      </span>
    </div>
  );
}

function PatentCard({ m }: { m: MatchedPatent }) {
  const purl = `https://patents.google.com/patent/${m.patentId}/en`;
  return (
    <div
      style={{
        background: "#342c23",
        borderLeft: `3px solid ${ACCENT}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div>
        <a
          href={purl}
          target="_blank"
          rel="noreferrer"
          style={{ color: ACCENT, fontWeight: 700, fontSize: 12, fontFamily: "ui-monospace, monospace", textDecoration: "none" }}
        >
          {m.patentId}
        </a>
        {" — "}{m.ruleApplied}
      </div>
      <div style={{ marginTop: 4, color: MUTED }}>{m.likelyReason}</div>
    </div>
  );
}

function ContradictionCard({ c }: { c: Contradiction }) {
  const purl = `https://patents.google.com/patent/${c.patentId}/en`;
  return (
    <div
      style={{
        background: "rgba(239,68,68,0.08)",
        borderLeft: `3px solid ${RED}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ color: RED, fontWeight: 700 }}>
        {c.patentId}{" "}
        <a href={purl} target="_blank" rel="noreferrer" style={{ color: RED, textDecoration: "underline" }}>
          (patent)
        </a>
      </div>
      <div style={{ marginTop: 4 }}>{c.contradiction}</div>
    </div>
  );
}

function SignalCard({ text, color, label }: { text: string; color: string; label: string }) {
  return (
    <div
      style={{
        background: `rgba(${color === RED ? "239,68,68" : color === PURPLE ? "167,139,250" : "245,158,11"},0.08)`,
        borderLeft: `3px solid ${color}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ color, fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 4 }}>{text}</div>
    </div>
  );
}

function BoilerplateCard({ m }: { m: BoilerplateMatch }) {
  return (
    <div
      style={{
        background: "rgba(167,139,250,0.08)",
        borderLeft: `3px solid ${PURPLE}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ color: PURPLE, fontWeight: 700 }}>
        📌 {m.sourceType.toUpperCase()} boilerplate · {m.occurrencesInCorpus}x in {m.carrier} corpus
      </div>
      <div style={{ marginTop: 4, fontStyle: "italic" }}>"{m.phrase}"</div>
    </div>
  );
}

function ActionCard({ action }: { action: RecommendedAction }) {
  return (
    <div
      style={{
        background: "#342c23",
        borderLeft: `3px solid ${GREEN}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 10,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          display: "inline",
          background: GREEN,
          color: "#1a1612",
          padding: "1px 8px",
          borderRadius: 4,
          fontWeight: 700,
          fontSize: 11,
          marginRight: 8,
        }}
      >
        {action.priority}
      </span>
      {action.action}
      {action.rationale && (
        <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>{action.rationale}</div>
      )}
    </div>
  );
}

function LetterBox({
  subject,
  body,
  onCopy,
}: {
  subject?: string;
  body: string;
  onCopy: (text: string) => void;
}) {
  const fullLetter = (subject ? `Subject: ${subject}\n\n` : "") + body;
  return (
    <div
      style={{
        background: BG,
        border: `1px dashed ${BORDER}`,
        borderRadius: 6,
        padding: "18px 22px",
        fontFamily: "ui-monospace, 'SF Mono', Monaco, monospace",
        fontSize: 13,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
      }}
    >
      <div
        style={{
          color: ACCENT,
          fontWeight: 700,
          marginBottom: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          whiteSpace: "normal",
        }}
      >
        {subject ?? "Re: Claim Appeal"}
        <button
          onClick={() => onCopy(fullLetter)}
          style={{
            background: "transparent",
            color: ACCENT,
            border: `1px solid ${ACCENT}`,
            padding: "5px 12px",
            borderRadius: 5,
            fontSize: 12,
            cursor: "pointer",
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          📋 Copy Letter
        </button>
      </div>
      {body}
    </div>
  );
}

function OutcomeTracker({
  intakeId,
  onOutcomeSaved,
}: {
  intakeId: number;
  onOutcomeSaved: (msg: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const outcomes: Array<{ label: string; value: string; cls: string }> = [
    { label: "✓ Approved (full)", value: "approved", cls: "ok" },
    { label: "◐ Partial approval", value: "partial", cls: "warn" },
    { label: "✗ Denied (stood firm)", value: "denied", cls: "bad" },
    { label: "… Pending / no reply yet", value: "pending", cls: "muted" },
    { label: "↩ Withdrawn", value: "withdrawn", cls: "muted" },
  ];

  const clsMap: Record<string, React.CSSProperties> = {
    ok: { background: GREEN, color: "#1a1612", border: `1px solid ${GREEN}` },
    warn: { background: YELLOW, color: "#1a1612", border: `1px solid ${YELLOW}` },
    bad: { background: RED, color: "#fff", border: `1px solid ${RED}` },
    muted: { background: "#342c23", color: MUTED, border: `1px solid ${BORDER}` },
  };

  async function mark(outcome: string) {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/intel/denial-intake/${intakeId}/outcome`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as OutcomeResponse;
      setDone(true);
      onOutcomeSaved(`✓ Outcome saved (${outcome}) as #${data.outcomeId}. Counter-strategy performance is now being tracked.`);
    } catch (e: unknown) {
      setErr((e as Error).message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p style={{ color: MUTED, fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
        When you hear back from the carrier, mark the outcome so RIQ learns which counter-letters actually flip denials.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {outcomes.map((o) => (
          <button
            key={o.value}
            disabled={done || saving}
            onClick={() => mark(o.value)}
            style={{
              ...clsMap[o.cls],
              padding: "7px 14px",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              cursor: done || saving ? "default" : "pointer",
              opacity: done || saving ? 0.5 : 1,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {err && <div style={{ marginTop: 8, color: RED, fontSize: 12 }}>Failed: {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function Toast({ message, onHide }: { message: string; onHide: () => void }) {
  useEffect(() => {
    const t = setTimeout(onHide, 1800);
    return () => clearTimeout(t);
  }, [onHide]);
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        background: GREEN,
        color: "#1a1612",
        padding: "12px 18px",
        borderRadius: 6,
        fontWeight: 700,
        zIndex: 100,
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analysis result rendering
// ---------------------------------------------------------------------------

function AnalysisResult({
  result,
  onCopy,
}: {
  result: AnalyzeResponse;
  onCopy: (text: string) => void;
}) {
  const [outcomeSavedMsg, setOutcomeSavedMsg] = useState<string | null>(null);
  const a = result.analysis;

  return (
    <div>
      {/* Meta block */}
      <SectionPanel title="📋 Letter Identified">
        <MetaGrid a={a} carrierHint={result.carrierHint} />
        {a.denialPosture && <PostureBadge posture={a.denialPosture} />}
        <AppealMeter strength={a.appealStrength} reasoning={a.appealStrengthReasoning} />
        <div style={{ marginTop: 8, color: MUTED, fontSize: 11 }}>
          Stance: {result.stanceVariant} ({result.stanceSource})
        </div>
      </SectionPanel>

      {/* Denial reasons */}
      {(a.denialReasons ?? []).length > 0 && (
        <SectionPanel
          title="📑 Denial Reasons (Verbatim)"
          desc="Each quote pulled directly from the letter — no paraphrase. The category is how the carrier framed it."
        >
          {(a.denialReasons ?? []).map((r, i) => <ReasonCard key={i} reason={r} />)}
        </SectionPanel>
      )}

      {/* Matched patents */}
      {(a.matchedPatents ?? []).length > 0 && (
        <SectionPanel
          title="🥷 Matched Patent Logic"
          desc="Each denial reason mapped to the carrier's documented AI rule. This is the actual decision logic — not a guess."
        >
          {(a.matchedPatents ?? []).map((m, i) => <PatentCard key={i} m={m} />)}
        </SectionPanel>
      )}

      {/* Contradictions */}
      {(a.contradictions ?? []).length > 0 && (
        <SectionPanel
          title="🚩 Contradictions vs. Patent Logic"
          titleColor={RED}
          desc="Denial language that diverges from the carrier's own patent-documented decision logic. Each one is potential bad-faith leverage."
        >
          {(a.contradictions ?? []).map((c, i) => <ContradictionCard key={i} c={c} />)}
        </SectionPanel>
      )}

      {/* Deterministic boilerplate matches */}
      {(result.boilerplateMatches ?? []).length > 0 && (
        <SectionPanel
          title="🎯 Verbatim Boilerplate Match (Deterministic)"
          titleColor={PURPLE}
          desc="These EXACT phrases from the incoming letter were found word-for-word in past denials from this same carrier in Roof Docs' archive. Hard evidence the carrier reuses template/AI-generated language across claims — admissible under 2026 bad-faith case law."
        >
          {result.boilerplateMatches.map((m, i) => <BoilerplateCard key={i} m={m} />)}
        </SectionPanel>
      )}

      {/* AI tells */}
      {(a.aiTells ?? []).length > 0 && (
        <SectionPanel
          title="🤖 AI Boilerplate Tells (Inferred)"
          titleColor={PURPLE}
          desc="Phrases that suggest the letter was AI-generated with little human review. Strong evidence under 2026 case law for demanding disclosure of automated decision systems."
        >
          {(a.aiTells ?? []).map((t, i) => (
            <SignalCard key={i} text={t} color={PURPLE} label="⚠ AI signal" />
          ))}
        </SectionPanel>
      )}

      {/* Bad faith */}
      {(a.badFaithSignals ?? []).length > 0 && (
        <SectionPanel
          title="⚖️ Bad-Faith Signals"
          titleColor={YELLOW}
          desc="Concrete elements that support a bad-faith argument under 2026 precedent (State Farm OK litigation, AG involvement)."
        >
          {(a.badFaithSignals ?? []).map((s, i) => (
            <SignalCard key={i} text={s} color={YELLOW} label="🚩 Bad-faith signal" />
          ))}
        </SectionPanel>
      )}

      {/* Counter letter */}
      {a.counterLetter?.body && (
        <SectionPanel
          title="📝 Drafted Response Letter"
          desc="Ready-to-send draft. Requests specific basis for each denial, demands AI disclosure, asks for supervisor adjuster review. Review required — never send without your signature on it."
        >
          <LetterBox
            subject={a.counterLetter.subject}
            body={a.counterLetter.body}
            onCopy={onCopy}
          />
        </SectionPanel>
      )}

      {/* Recommended actions */}
      {(a.recommendedActions ?? []).length > 0 && (
        <SectionPanel
          title="✅ Recommended Actions"
          titleColor={GREEN}
          desc="Sorted by priority. Run these in order."
        >
          {[...(a.recommendedActions ?? [])]
            .sort((p, q) => (p.priority ?? 99) - (q.priority ?? 99))
            .map((x, i) => <ActionCard key={i} action={x} />)}
        </SectionPanel>
      )}

      {/* Outcome tracker */}
      {result.intakeId && (
        <SectionPanel title={`📌 Track Outcome (intake #${result.intakeId})`}>
          {outcomeSavedMsg ? (
            <div style={{ color: GREEN, fontSize: 12 }}>{outcomeSavedMsg}</div>
          ) : (
            <OutcomeTracker
              intakeId={result.intakeId}
              onOutcomeSaved={setOutcomeSavedMsg}
            />
          )}
        </SectionPanel>
      )}

      {/* Footer */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "14px 22px",
          marginBottom: 16,
          textAlign: "center",
          color: MUTED,
          fontSize: 11,
        }}
      >
        Powered by Gemini 2.0 Flash · {(result.patentsConsidered ?? []).length} patents in decoder
        {(result.corpusExamplesUsed ?? []).length > 0 &&
          ` · ${result.corpusExamplesUsed.length} real denials referenced from archive`}
        {" · "}Generated {new Date(result.generated).toLocaleString()}
        {result.intakeId && (
          <>
            <br />
            Archived as intake #{result.intakeId} · This denial is now part of the corpus and will inform future analyses
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropzone
// ---------------------------------------------------------------------------

function Dropzone({
  onFile,
  status,
  statusClass,
}: {
  onFile: (f: File) => void;
  status: string;
  statusClass: "ok" | "err" | "";
}) {
  const [isDrag, setIsDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) onFile(f);
  }

  const statusColor = statusClass === "ok" ? GREEN : statusClass === "err" ? RED : MUTED;

  return (
    <>
      <div
        tabIndex={0}
        role="button"
        aria-label="Drop a denial PDF or photo, or click to choose"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
        onDragLeave={() => setIsDrag(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${isDrag ? ACCENT : BORDER}`,
          borderRadius: 8,
          padding: "28px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: isDrag ? "#342c23" : SURFACE,
          marginBottom: 12,
          transition: "all 0.18s",
        }}
      >
        <span style={{ fontSize: 32, display: "block", marginBottom: 8 }}>📄</span>
        <div style={{ color: TEXT, lineHeight: 1.55 }}>
          <strong>Drop a denial PDF or photo here</strong> · or click to choose
        </div>
        <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>PDF, JPG, PNG, HEIC up to 15 MB</div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={handleChange}
        />
      </div>
      {status && (
        <div style={{ margin: "6px 0 10px", fontSize: 12, color: statusColor, minHeight: 18 }}>
          {status}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DenialAnalyze() {
  const [carriers, setCarriers] = useState<Array<{ name: string; count: number }>>([]);
  const [selectedCarrier, setSelectedCarrier] = useState("");
  const [denialText, setDenialText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [analyzeErr, setAnalyzeErr] = useState<string | null>(null);
  const [dzStatus, setDzStatus] = useState("");
  const [dzClass, setDzClass] = useState<"ok" | "err" | "">("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Load carriers on mount
  useEffect(() => {
    fetch("/api/intel/carrier-patents", { credentials: "include" })
      .then((r) => r.json() as Promise<CarrierPatentsBlob>)
      .then((data) => {
        const list = Object.entries(data.byCarrier ?? {})
          .filter(([name]) => name !== "VENDOR_MULTI")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, ids]) => ({ name, count: (ids ?? []).length }));
        setCarriers(list);
      })
      .catch(() => {
        // Fall back to hardcoded list
        setCarriers([
          { name: "Allstate", count: 0 },
          { name: "State Farm", count: 0 },
          { name: "USAA", count: 0 },
        ]);
      });
  }, []);

  async function handleFile(file: File) {
    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > 15) {
      setDzStatus(`File too large (${sizeMb.toFixed(1)} MB). Limit is 15 MB.`);
      setDzClass("err");
      return;
    }
    if (!/pdf|image\//.test(file.type)) {
      setDzStatus(`Unsupported type ${file.type}. Use PDF or image.`);
      setDzClass("err");
      return;
    }
    setDzStatus(`Transcribing ${file.name} (${sizeMb.toFixed(1)} MB) with Gemini vision…`);
    setDzClass("");
    try {
      const base64 = await readFileAsBase64(file);
      const r = await fetch("/api/intel/transcribe-denial", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: file.type.startsWith("image/") ? "image" : "pdf",
          base64,
          mimeType: file.type,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as TranscribeResponse;
      setDenialText(data.text ?? "");
      setDzStatus(`✓ Transcribed ${(data.text ?? "").length} chars. Review then click Analyze.`);
      setDzClass("ok");
    } catch (e: unknown) {
      setDzStatus(`Transcription failed: ${(e as Error).message}`);
      setDzClass("err");
    }
  }

  async function analyze() {
    const text = denialText.trim();
    if (text.length < 50) {
      alert("Please paste the denial letter (at least 50 characters).");
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setAnalyzeErr(null);
    try {
      const r = await fetch("/api/intel/analyze-denial", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ denialText: text, carrier: selectedCarrier }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail ?? `HTTP ${r.status}`);
      }
      const data = (await r.json()) as AnalyzeResponse;
      setResult(data);
    } catch (e: unknown) {
      setAnalyzeErr((e as Error).message ?? String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => setToastMsg("Copied to clipboard"));
  }

  const inputStyle: React.CSSProperties = {
    background: BG,
    color: TEXT,
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    padding: "9px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: TEXT }}>
      {toastMsg && <Toast message={toastMsg} onHide={() => setToastMsg(null)} />}

      {/* Input section */}
      <div
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: "18px 22px",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: ACCENT }}>
          Drop, paste, or upload the denial letter
        </h2>
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 14, lineHeight: 1.5, marginTop: 0 }}>
          PDF or screenshot? Drag-drop or click to upload — RIQ transcribes it with Gemini vision. Already have the text? Paste it. The analyzer runs against 22 carrier patents + 289 real-world denials to decode it.
        </p>

        <Dropzone onFile={handleFile} status={dzStatus} statusClass={dzClass} />

        <textarea
          value={denialText}
          onChange={(e) => setDenialText(e.target.value)}
          placeholder="…or paste the full carrier denial letter here. Include the header, body, and signature — the more context, the better the analysis."
          style={{
            width: "100%",
            minHeight: 280,
            background: "#342c23",
            color: TEXT,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: 14,
            fontFamily: "ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace",
            fontSize: 13,
            lineHeight: 1.55,
            resize: "vertical",
            boxSizing: "border-box",
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = ACCENT)}
          onBlur={(e) => (e.target.style.borderColor = BORDER)}
        />

        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
          <div>
            <label
              htmlFor="carrier-select-analyze"
              style={{ display: "block", color: MUTED, fontSize: 11, textTransform: "uppercase", marginBottom: 4, letterSpacing: "0.5px" }}
            >
              Carrier (helps target the right patents)
            </label>
            <select
              id="carrier-select-analyze"
              value={selectedCarrier}
              onChange={(e) => setSelectedCarrier(e.target.value)}
              style={{ ...inputStyle, minWidth: 240 }}
            >
              <option value="">— Auto-detect (uses VENDOR patents only) —</option>
              {carriers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}{c.count > 0 ? ` (${c.count} patents)` : ""}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={analyze}
            disabled={analyzing}
            style={{
              background: ACCENT,
              color: "#1a1612",
              border: 0,
              padding: "10px 22px",
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 14,
              cursor: analyzing ? "not-allowed" : "pointer",
              opacity: analyzing ? 0.5 : 1,
            }}
          >
            {analyzing ? "Analyzing…" : "Analyze Denial"}
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: MUTED, marginTop: 8, flexWrap: "wrap" }}>
          {[
            { label: "Contradictions", color: RED },
            { label: "AI Boilerplate Tells", color: PURPLE },
            { label: "Bad-Faith Signals", color: YELLOW },
            { label: "Recommended Actions", color: GREEN },
          ].map((l) => (
            <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: l.color,
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Output area */}
      {analyzing && (
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: 50,
            marginBottom: 16,
            textAlign: "center",
            color: ACCENT,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 20,
              height: 20,
              border: `3px solid #342c23`,
              borderTop: `3px solid ${ACCENT}`,
              borderRadius: "50%",
              verticalAlign: "middle",
              marginRight: 10,
              animation: "riq-spin 0.8s linear infinite",
            }}
          />
          Decoding letter against carrier patent corpus…
          <style>{`@keyframes riq-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {analyzeErr && !analyzing && (
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: "18px 22px",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700, color: RED }}>Analysis Failed</h2>
          <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>{analyzeErr}</p>
        </div>
      )}

      {!analyzing && !analyzeErr && !result && (
        <div
          style={{
            background: SURFACE,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: "80px 20px",
            marginBottom: 16,
            textAlign: "center",
            color: MUTED,
            fontSize: 14,
          }}
        >
          <span style={{ fontSize: 42, display: "block", marginBottom: 16 }}>⚖️</span>
          Paste a denial letter and hit <strong>Analyze</strong>. RIQ 21 decodes it against the carrier's own patent-documented AI logic to find leverage for your appeal.
        </div>
      )}

      {result && !analyzing && (
        <AnalysisResult result={result} onCopy={copyText} />
      )}
    </div>
  );
}
