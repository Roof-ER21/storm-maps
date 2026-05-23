/**
 * Adjuster Twin tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/adjuster-twin.html.
 *
 * Data flow:
 *   1. GET  /api/intel/adjuster-twin/list   → populate adjuster dropdown
 *   2. POST /api/intel/adjuster-twin/predict (JSON body) → AI prediction
 *      Body: { adjusterName, carrier, scope: { hailSizeInches, dateOfLoss,
 *              roofAgeYears, zip, notes }, photos?: [{ base64, mimeType }] }
 *
 * V2 features:
 *   - Photo upload (up to 5, drag-drop or file input), base64-encoded
 *   - Lenient adjuster banner auto-shown when stance === "lenient"
 *   - Full prediction result rendered with all sections from HTML
 */
import { useState, useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface AdjusterTwinListItem {
  name: string;
  carrier: string | null;
  totalJobs: number;
  approvalRate: number | null;
  stance: string | null;
  deltaVsCarrier: number | null;
}

interface AdjusterTwinListResponse {
  adjusters: AdjusterTwinListItem[];
}

interface TwinScope {
  hailSizeInches: number | null;
  dateOfLoss: string | null;
  roofAgeYears: number | null;
  zip: string | null;
  notes: string | null;
}

interface PhotoItem {
  base64: string;
  mimeType: string;
  name: string;
}

interface DenialReason {
  reason: string;
  basedOn: "historical" | "patent" | "both";
  likelihood: "low" | "medium" | "high";
}

interface PreEmptiveAdjustment {
  action: string;
  why?: string;
  priority: number;
}

interface EscalationRecommendation {
  shouldEscalate: boolean;
  trigger?: string;
  rationale?: string;
}

interface HailEvidence {
  present: boolean;
  confidence: string;
  description?: string;
  estimatedSize?: string;
  densityPer10sqft?: string;
}

interface WindEvidence {
  present: boolean;
  description?: string;
}

interface PreExistingDamage {
  present: boolean;
  description?: string;
}

interface SoftMetalEvidence {
  present: boolean;
  description?: string;
}

interface VisualEvidence {
  roofMaterial?: string;
  estimatedRoofAge?: string;
  slopesVisible?: number | null;
  hailEvidence?: HailEvidence;
  windEvidence?: WindEvidence;
  preExistingDamage?: PreExistingDamage;
  softMetalEvidence?: SoftMetalEvidence;
  claimSupportingFactors?: string[];
  claimRiskFactors?: string[];
}

interface TwinPrediction {
  likelyDecision?: string;
  decisionConfidence?: "low" | "medium" | "high";
  confidenceRationale?: string;
  approvalProbability?: number | null;
  predictedTotal?: number | null;
  likelyApprovalScope?: string;
  predictedDenialReasons?: DenialReason[];
  preEmptiveAdjustments?: PreEmptiveAdjustment[];
  leveragePoints?: string[];
  redFlags?: string[];
  escalationRecommendation?: EscalationRecommendation;
  comparableHistoricalJobs?: string[];
  playbookSummary?: string;
}

interface AdjusterDataPoints {
  totalJobs: number;
  approved: number;
  approvalRate: number | null;
  carrierBaseline: number | null;
  deltaVsCarrier: number | null;
  stance: string | null;
  medianUplift: number | null;
}

interface TwinPredictResponse {
  generated: string;
  model: string;
  adjuster: string;
  carrier: string;
  adjusterDataPoints: AdjusterDataPoints;
  patentsConsidered: string[];
  visualEvidence: VisualEvidence | null;
  photosAnalyzed: number;
  prediction: TwinPrediction;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decisionColor(d: string | undefined): string {
  if (!d) return "var(--riq-accent)";
  if (d === "approve-full" || d === "approve-partial") return "#10b981";
  if (d === "deny") return "#ef4444";
  if (d === "require-resubmit") return "#f59e0b";
  return "var(--riq-accent)";
}

function decisionLabel(d: string | undefined): string {
  const map: Record<string, string> = {
    "approve-full": "✅ APPROVE FULL",
    "approve-partial": "✅ APPROVE PARTIAL",
    "deny": "❌ DENY",
    "require-supplement": "📑 REQUIRE SUPPLEMENT",
    "require-resubmit": "↻ REQUIRE RESUBMIT",
  };
  if (!d) return "—";
  return map[d] ?? d.toUpperCase();
}

function confidenceFill(c: string | undefined): number {
  return ({ low: 30, medium: 60, high: 90 })[c as string] ?? 50;
}

function likelihoodColor(l: string): { bg: string; color: string } {
  if (l === "high") return { bg: "rgba(239,68,68,0.15)", color: "#ef4444" };
  if (l === "medium") return { bg: "rgba(245,158,11,0.15)", color: "#f59e0b" };
  return { bg: "rgba(96,165,250,0.15)", color: "#60a5fa" };
}

// ---------------------------------------------------------------------------
// Shared inline styles
// ---------------------------------------------------------------------------

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
  fontSize: 13,
  marginBottom: 14,
  lineHeight: 1.5,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  color: "var(--riq-text-muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(52,44,35,1)",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 6,
  padding: "9px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "var(--riq-accent)",
  color: "#1a1612",
  border: 0,
  padding: "10px 22px",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const decisionCardStyle: React.CSSProperties = {
  background: "rgba(52,44,35,1)",
  borderLeft: "4px solid var(--riq-accent)",
  borderRadius: "0 8px 8px 0",
  padding: "16px 20px",
  marginBottom: 14,
};

const reasonCardStyle: React.CSSProperties = {
  background: "rgba(52,44,35,1)",
  borderLeft: "3px solid #60a5fa",
  borderRadius: "0 6px 6px 0",
  padding: "11px 16px",
  marginBottom: 8,
  fontSize: 13,
  lineHeight: 1.55,
};

const playCardStyle: React.CSSProperties = {
  ...reasonCardStyle,
  borderLeft: "3px solid #10b981",
};

const signalGreenStyle: React.CSSProperties = {
  ...reasonCardStyle,
  borderLeft: "3px solid #10b981",
  background: "rgba(16,185,129,0.06)",
};

const signalRedStyle: React.CSSProperties = {
  ...reasonCardStyle,
  borderLeft: "3px solid #ef4444",
  background: "rgba(239,68,68,0.06)",
};

const signalYellowStyle: React.CSSProperties = {
  ...reasonCardStyle,
  borderLeft: "3px solid #f59e0b",
  background: "rgba(245,158,11,0.06)",
};

// ---------------------------------------------------------------------------
// Prediction result renderer
// ---------------------------------------------------------------------------

function PredictionResult({ result }: { result: TwinPredictResponse }) {
  const p = result.prediction ?? {};
  const dp = result.adjusterDataPoints ?? ({} as AdjusterDataPoints);

  const metaCellStyle: React.CSSProperties = {
    background: "rgba(52,44,35,1)",
    borderRadius: 6,
    padding: "10px 14px",
  };
  const metaLblStyle: React.CSSProperties = {
    color: "var(--riq-text-muted)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };
  const metaValStyle: React.CSSProperties = {
    color: "var(--riq-text)",
    fontSize: 15,
    marginTop: 4,
    fontWeight: 600,
  };

  return (
    <>
      {/* Simulation header + meta grid */}
      <section style={sectionStyle}>
        <h2 style={sectionH2}>
          Simulation — {result.adjuster} · {result.carrier || "?"}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div style={metaCellStyle}>
            <div style={metaLblStyle}>Decision</div>
            <div style={{ ...metaValStyle, color: decisionColor(p.likelyDecision) }}>
              {decisionLabel(p.likelyDecision)}
            </div>
          </div>
          <div style={metaCellStyle}>
            <div style={metaLblStyle}>Approval Probability</div>
            <div style={metaValStyle}>
              {p.approvalProbability != null
                ? `${(p.approvalProbability * 100).toFixed(0)}%`
                : "—"}
            </div>
          </div>
          <div style={metaCellStyle}>
            <div style={metaLblStyle}>Predicted Total</div>
            <div style={metaValStyle}>
              {p.predictedTotal != null
                ? `$${Number(p.predictedTotal).toLocaleString()}`
                : "—"}
            </div>
          </div>
          <div style={metaCellStyle}>
            <div style={metaLblStyle}>Adjuster Sample</div>
            <div style={metaValStyle}>
              {dp.totalJobs || 0} jobs ·{" "}
              {dp.approvalRate != null ? `${(dp.approvalRate * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </div>

        {/* Confidence meter */}
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              color: "var(--riq-text-muted)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Confidence in Prediction
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
            <div
              style={{
                flex: 1,
                height: 12,
                background: "rgba(52,44,35,1)",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${confidenceFill(p.decisionConfidence)}%`,
                  background: "var(--riq-accent)",
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
                color: "var(--riq-text)",
              }}
            >
              {(p.decisionConfidence ?? "medium").toUpperCase()}
            </div>
          </div>
          {p.confidenceRationale && (
            <p style={{ ...descStyle, marginTop: 6 }}>{p.confidenceRationale}</p>
          )}
        </div>

        {p.likelyApprovalScope && (
          <div style={decisionCardStyle}>
            <div
              style={{
                fontWeight: 700,
                color: "var(--riq-accent)",
                fontSize: 14,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 6,
              }}
            >
              Likely Approval Scope
            </div>
            {p.likelyApprovalScope}
          </div>
        )}
      </section>

      {/* Tailored Playbook */}
      {p.playbookSummary && (
        <section style={sectionStyle}>
          <h2 style={sectionH2}>📖 Tailored Playbook</h2>
          <p style={descStyle}>How to handle this specific adjuster — built from their history.</p>
          <div
            style={{
              background: "rgba(244,167,56,0.07)",
              border: "1px solid var(--riq-accent)",
              borderRadius: 6,
              padding: "16px 20px",
              fontSize: 14,
              lineHeight: 1.65,
            }}
          >
            <div style={{ color: "var(--riq-accent)", fontWeight: 700, marginBottom: 6 }}>
              For {result.adjuster}:
            </div>
            {p.playbookSummary}
          </div>
        </section>
      )}

      {/* Pre-Emptive Adjustments */}
      {(p.preEmptiveAdjustments ?? []).length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ ...sectionH2, color: "#10b981" }}>
            🎯 Pre-Emptive Adjustments (do these BEFORE submission)
          </h2>
          <p style={descStyle}>
            Highest-priority moves to maximize approval probability with this adjuster.
          </p>
          {[...(p.preEmptiveAdjustments ?? [])]
            .sort((a, b) => (a.priority || 99) - (b.priority || 99))
            .map((a, i) => (
              <div key={i} style={playCardStyle}>
                <div>
                  <span
                    style={{
                      background: "#10b981",
                      color: "#1a1612",
                      padding: "1px 7px",
                      borderRadius: 3,
                      fontSize: 11,
                      fontWeight: 700,
                      marginRight: 8,
                    }}
                  >
                    {a.priority}
                  </span>
                  {a.action}
                </div>
                {a.why && (
                  <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 4 }}>
                    {a.why}
                  </div>
                )}
              </div>
            ))}
        </section>
      )}

      {/* Predicted Denial Reasons */}
      {(p.predictedDenialReasons ?? []).length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ ...sectionH2, color: "#ef4444" }}>
            🚩 Likely Denial Reasons (rebut these in advance)
          </h2>
          {(p.predictedDenialReasons ?? []).map((r, i) => {
            const lc = likelihoodColor(r.likelihood);
            return (
              <div key={i} style={reasonCardStyle}>
                <div style={{ fontWeight: 600 }}>
                  {r.reason}{" "}
                  <span
                    style={{
                      display: "inline-block",
                      background: lc.bg,
                      color: lc.color,
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      marginLeft: 6,
                    }}
                  >
                    {r.likelihood}
                  </span>
                </div>
                <div
                  style={{
                    color: "var(--riq-text-muted)",
                    fontSize: 11,
                    marginTop: 3,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Based on: {r.basedOn}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Leverage Points */}
      {(p.leveragePoints ?? []).length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ ...sectionH2, color: "#10b981" }}>⚖️ Leverage Points</h2>
          <p style={descStyle}>Evidence/arguments this adjuster historically responds to.</p>
          {(p.leveragePoints ?? []).map((l, i) => (
            <div key={i} style={signalGreenStyle}>
              ✓ {l}
            </div>
          ))}
        </section>
      )}

      {/* Red Flags */}
      {(p.redFlags ?? []).length > 0 && (
        <section style={sectionStyle}>
          <h2 style={{ ...sectionH2, color: "#ef4444" }}>⚠️ Red Flags in Current Scope</h2>
          <p style={descStyle}>Elements this adjuster historically rejects. Fix or pre-counter.</p>
          {(p.redFlags ?? []).map((f, i) => (
            <div key={i} style={signalRedStyle}>
              ⚠ {f}
            </div>
          ))}
        </section>
      )}

      {/* Escalation */}
      {p.escalationRecommendation?.shouldEscalate && (
        <section style={sectionStyle}>
          <div
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid #f59e0b",
              borderRadius: 6,
              padding: "14px 18px",
            }}
          >
            <div style={{ color: "#f59e0b", fontWeight: 700, marginBottom: 6 }}>
              📞 RECOMMEND ESCALATION
            </div>
            <div>
              <strong>Trigger:</strong> {p.escalationRecommendation.trigger}
            </div>
            {p.escalationRecommendation.rationale && (
              <div style={{ marginTop: 6 }}>{p.escalationRecommendation.rationale}</div>
            )}
          </div>
        </section>
      )}

      {/* Comparable Historical Jobs */}
      {(p.comparableHistoricalJobs ?? []).length > 0 && (
        <section style={sectionStyle}>
          <h2 style={sectionH2}>📚 Comparable Past Jobs</h2>
          <p style={descStyle}>
            Jobs from this adjuster&apos;s history that closely match the proposed scope.
          </p>
          {(p.comparableHistoricalJobs ?? []).map((j, i) => (
            <div key={i} style={signalYellowStyle}>
              {j}
            </div>
          ))}
        </section>
      )}

      {/* Visual Evidence (V2) */}
      {result.visualEvidence && result.photosAnalyzed > 0 && (
        <section style={sectionStyle}>
          <h2 style={sectionH2}>
            📸 Visual Evidence ({result.photosAnalyzed} photo
            {result.photosAnalyzed > 1 ? "s" : ""} analyzed)
          </h2>
          <p style={descStyle}>
            Gemini extracted these observations from your photos. This was injected into the
            prediction — factors below directly influenced the playbook.
          </p>
          {(() => {
            const ve = result.visualEvidence!;
            const rows: Array<[string, string]> = [];
            if (ve.roofMaterial) rows.push(["Roof material", ve.roofMaterial]);
            if (ve.estimatedRoofAge) rows.push(["Estimated age", ve.estimatedRoofAge]);
            if (ve.slopesVisible != null) rows.push(["Slopes visible", String(ve.slopesVisible)]);
            if (ve.hailEvidence) {
              rows.push([
                "Hail evidence",
                ve.hailEvidence.present
                  ? `✅ ${ve.hailEvidence.confidence} confidence — ${ve.hailEvidence.description ?? ""}` +
                    (ve.hailEvidence.estimatedSize ? ` | size: ${ve.hailEvidence.estimatedSize}` : "") +
                    (ve.hailEvidence.densityPer10sqft ? ` | density: ${ve.hailEvidence.densityPer10sqft}` : "")
                  : "❌ Not visible in photos",
              ]);
            }
            if (ve.windEvidence?.present) rows.push(["Wind evidence", `✅ ${ve.windEvidence.description ?? ""}`]);
            if (ve.softMetalEvidence?.present) rows.push(["Soft metal", `✅ ${ve.softMetalEvidence.description ?? ""}`]);
            if (ve.preExistingDamage?.present) rows.push(["⚠ Pre-existing", ve.preExistingDamage.description ?? ""]);
            return (
              <>
                {rows.length > 0 && (
                  <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                    <tbody>
                      {rows.map(([k, v]) => (
                        <tr key={k}>
                          <td
                            style={{
                              padding: "5px 10px",
                              color: "var(--riq-text-muted)",
                              width: 140,
                              verticalAlign: "top",
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                            }}
                          >
                            {k}
                          </td>
                          <td
                            style={{
                              padding: "5px 10px",
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                            }}
                          >
                            {v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {(ve.claimSupportingFactors ?? []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "#10b981",
                        marginBottom: 4,
                      }}
                    >
                      Supporting factors
                    </div>
                    {(ve.claimSupportingFactors ?? []).map((f, i) => (
                      <div key={i} style={{ fontSize: 12, padding: "3px 0" }}>
                        ▶ {f}
                      </div>
                    ))}
                  </div>
                )}
                {(ve.claimRiskFactors ?? []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "#ef4444",
                        marginBottom: 4,
                      }}
                    >
                      Risk factors (carrier AI may cite)
                    </div>
                    {(ve.claimRiskFactors ?? []).map((f, i) => (
                      <div key={i} style={{ fontSize: 12, padding: "3px 0" }}>
                        ⚠ {f}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </section>
      )}

      {/* Footer */}
      <section
        style={{
          ...sectionStyle,
          textAlign: "center",
          color: "var(--riq-text-muted)",
          fontSize: 11,
        }}
      >
        Powered by Gemini 2.0 Flash · {(result.patentsConsidered ?? []).length} carrier patents ·
        adjuster N={dp.totalJobs || 0} jobs
        {result.photosAnalyzed > 0 ? ` · ${result.photosAnalyzed} photos analyzed` : ""} ·{" "}
        {new Date(result.generated).toLocaleString()}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AdjusterTwin() {
  const [listData, setListData] = useState<AdjusterTwinListItem[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const adjusterMap = useRef<Record<string, AdjusterTwinListItem>>({});

  // Form state
  const [adjusterName, setAdjusterName] = useState("");
  const [carrier, setCarrier] = useState("");
  const [hailSize, setHailSize] = useState("");
  const [hailDate, setHailDate] = useState("");
  const [roofAge, setRoofAge] = useState("");
  const [zip, setZip] = useState("");
  const [scopeNotes, setScopeNotes] = useState("");

  // Photo state
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoDragOver, setPhotoDragOver] = useState(false);

  // Prediction state
  const [predicting, setPredicting] = useState(false);
  const [predResult, setPredResult] = useState<TwinPredictResponse | null>(null);
  const [predErr, setPredErr] = useState<string | null>(null);

  // Lenient banner derived from selected adjuster
  const selectedAdj = adjusterName ? adjusterMap.current[adjusterName] : null;
  const showLenientBanner = selectedAdj?.stance === "lenient";

  useEffect(() => {
    fetch("/api/intel/adjuster-twin/list", { credentials: "include" })
      .then((r) => r.json() as Promise<AdjusterTwinListResponse>)
      .then((d) => {
        const stanceOrder: Record<string, number> = { lenient: 0, baseline: 1, strict: 2 };
        const sorted = [...(d.adjusters ?? [])].sort(
          (a, b) => (stanceOrder[a.stance ?? ""] ?? 1) - (stanceOrder[b.stance ?? ""] ?? 1),
        );
        sorted.forEach((a) => { adjusterMap.current[a.name] = a; });
        setListData(sorted);
      })
      .catch((e: unknown) => setListErr((e as Error).message ?? String(e)));
  }, []);

  function handleAdjusterChange(name: string) {
    setAdjusterName(name);
    const a = adjusterMap.current[name];
    if (a) setCarrier(a.carrier ?? "");
  }

  // Photo helpers
  function addPhoto(file: File) {
    if (photos.length >= 5) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setPhotos((prev) =>
        prev.length < 5
          ? [...prev, { base64, mimeType: file.type, name: file.name }]
          : prev,
      );
    };
    reader.readAsDataURL(file);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function handlePhotoFiles(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach((f) => addPhoto(f));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setPhotoDragOver(false);
    Array.from(e.dataTransfer.files)
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => addPhoto(f));
  }

  async function predict() {
    if (!adjusterName) {
      alert("Pick an adjuster first.");
      return;
    }
    const scope: TwinScope = {
      hailSizeInches: Number(hailSize) || null,
      dateOfLoss: hailDate || null,
      roofAgeYears: Number(roofAge) || null,
      zip: zip.trim() || null,
      notes: scopeNotes.trim() || null,
    };
    const photoPayload = photos.map((p) => ({ base64: p.base64, mimeType: p.mimeType }));

    setPredicting(true);
    setPredResult(null);
    setPredErr(null);

    try {
      const r = await fetch("/api/intel/adjuster-twin/predict", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjusterName,
          carrier,
          scope,
          ...(photoPayload.length > 0 ? { photos: photoPayload } : {}),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { detail?: string };
        throw new Error(err.detail ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as TwinPredictResponse;
      setPredResult(data);
    } catch (e: unknown) {
      setPredErr((e as Error).message ?? String(e));
    } finally {
      setPredicting(false);
    }
  }

  const photoZoneBorder = photoDragOver ? "var(--riq-accent)" : "var(--riq-border)";

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {/* Form section */}
      <section style={sectionStyle}>
        <h2 style={sectionH2}>Simulate the adjuster before the meeting</h2>
        <p style={descStyle}>
          Picks a specific adjuster from your history + their carrier&apos;s documented AI logic +
          your proposed scope. Predicts what they&apos;ll approve, flags pre-emptive scope
          adjustments, and gives you a playbook tailored to that adjuster&apos;s personal patterns.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 16,
          }}
        >
          {/* Adjuster dropdown */}
          <div>
            <label style={fieldLabelStyle}>Adjuster</label>
            {listErr ? (
              <div style={{ color: "#ef4444", fontSize: 12 }}>
                Failed to load adjusters: {listErr}
              </div>
            ) : (
              <select
                style={inputStyle}
                value={adjusterName}
                onChange={(e) => handleAdjusterChange(e.target.value)}
              >
                <option value="">
                  {listData.length === 0 ? "— Loading… —" : "— Pick an adjuster —"}
                </option>
                {listData.map((a) => {
                  const stance = a.stance ? ` · ${a.stance}` : "";
                  const rate =
                    a.approvalRate != null ? ` · ${(a.approvalRate * 100).toFixed(0)}%` : "";
                  return (
                    <option key={`${a.name}|${a.carrier ?? ""}`} value={a.name}>
                      {a.name} ({a.totalJobs} jobs{rate} · {a.carrier ?? "?"}
                      {stance})
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Carrier */}
          <div>
            <label style={fieldLabelStyle}>
              Carrier (auto-filled when adjuster is picked)
            </label>
            <input
              style={inputStyle}
              placeholder="e.g. State Farm, Allstate"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            />
          </div>

          {/* Hail size */}
          <div>
            <label style={fieldLabelStyle}>Hail size on the storm of record (inches)</label>
            <input
              style={inputStyle}
              type="number"
              step="0.25"
              placeholder="e.g. 1.25"
              value={hailSize}
              onChange={(e) => setHailSize(e.target.value)}
            />
          </div>

          {/* Date of loss */}
          <div>
            <label style={fieldLabelStyle}>Date of loss</label>
            <input
              style={inputStyle}
              type="date"
              value={hailDate}
              onChange={(e) => setHailDate(e.target.value)}
            />
          </div>

          {/* Roof age */}
          <div>
            <label style={fieldLabelStyle}>Roof age (years, approximate)</label>
            <input
              style={inputStyle}
              type="number"
              min="0"
              max="50"
              placeholder="e.g. 12"
              value={roofAge}
              onChange={(e) => setRoofAge(e.target.value)}
            />
          </div>

          {/* ZIP */}
          <div>
            <label style={fieldLabelStyle}>ZIP</label>
            <input
              style={inputStyle}
              placeholder="e.g. 20176"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
          </div>

          {/* Scope notes — full width */}
          <div style={{ gridColumn: "span 2" }}>
            <label style={fieldLabelStyle}>
              Scope notes — what you&apos;re claiming + key evidence
            </label>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 90,
                resize: "vertical",
                lineHeight: 1.5,
              }}
              placeholder='e.g. Full roof replacement, 28sq comp shingle. Hail bruising visible on all 4 slopes, ~12-15 hits per test square. Soft metals (gutter screens, downspouts) all show impact. 1.25" MRMS swath confirmed. Before-storm baseline photos available.'
              value={scopeNotes}
              onChange={(e) => setScopeNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Photo upload zone (V2) */}
        <div
          style={{
            marginBottom: 14,
            border: `2px dashed ${photoZoneBorder}`,
            borderRadius: 8,
            padding: 16,
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.2s",
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setPhotoDragOver(true); }}
          onDragLeave={() => setPhotoDragOver(false)}
          onDrop={handleDrop}
        >
          <div style={{ fontSize: 20, marginBottom: 4 }}>📸</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Upload roof damage photos{" "}
            <span style={{ color: "var(--riq-text-muted)", fontWeight: 400 }}>(optional)</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--riq-text-muted)", marginTop: 4 }}>
            Gemini analyzes photos to extract visual evidence — hail density, roof material, soft
            metal impacts, pre-existing damage flags. Drag-drop or click. Up to 5 photos.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handlePhotoFiles(e.target.files)}
          />
        </div>

        {/* Photo previews */}
        {photos.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
              alignItems: "center",
            }}
          >
            {photos.map((p, i) => (
              <div key={i} style={{ position: "relative", width: 64, height: 64 }}>
                <img
                  src={p.base64}
                  alt={p.name}
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 4,
                    border: "1px solid var(--riq-border)",
                  }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); removePhoto(i); }}
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#ef4444",
                    border: "none",
                    color: "white",
                    fontSize: 10,
                    cursor: "pointer",
                    lineHeight: "16px",
                    textAlign: "center",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div
              style={{
                fontSize: 11,
                color: "var(--riq-text-muted)",
                alignSelf: "center",
                marginLeft: 4,
              }}
            >
              {photos.length}/5 photos — Gemini will extract visual evidence
            </div>
          </div>
        )}

        {/* Lenient adjuster banner */}
        {showLenientBanner && selectedAdj && (
          <div
            style={{
              background: "rgba(16,185,129,0.1)",
              border: "1px solid #10b981",
              borderRadius: 6,
              padding: "12px 16px",
              marginBottom: 14,
            }}
          >
            <div style={{ color: "#10b981", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              ✅ LENIENT ADJUSTER — lean in on full scope
            </div>
            <div style={{ color: "var(--riq-text)", fontSize: 13, lineHeight: 1.5 }}>
              {selectedAdj.name} runs{" "}
              {selectedAdj.approvalRate != null
                ? `${(selectedAdj.approvalRate * 100).toFixed(0)}% approval rate`
                : ""}
              {selectedAdj.deltaVsCarrier != null
                ? ` — ${selectedAdj.deltaVsCarrier > 0 ? "+" : ""}${(selectedAdj.deltaVsCarrier * 100).toFixed(0)}pp vs ${selectedAdj.carrier ?? "carrier"}`
                : ""}
              . Push full scope with documentation — this adjuster approves above carrier baseline.
              Highest-value moment to be aggressive on line items.
            </div>
          </div>
        )}

        <button
          style={{
            ...primaryBtnStyle,
            opacity: predicting ? 0.5 : 1,
            cursor: predicting ? "not-allowed" : "pointer",
          }}
          disabled={predicting}
          onClick={predict}
        >
          {predicting
            ? photos.length > 0
              ? `Analyzing photos + running simulation…`
              : "Running simulation…"
            : "Run Simulation"}
        </button>
      </section>

      {/* Loading state */}
      {predicting && (
        <section style={sectionStyle}>
          <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>
            <span
              style={{
                display: "inline-block",
                width: 20,
                height: 20,
                border: "3px solid rgba(52,44,35,1)",
                borderTop: "3px solid var(--riq-accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                verticalAlign: "middle",
                marginRight: 10,
              }}
            />
            {photos.length > 0
              ? `Extracting visual evidence from ${photos.length} photo${photos.length > 1 ? "s" : ""}, then simulating adjuster response…`
              : "Simulating adjuster response…"}
          </div>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </section>
      )}

      {/* Error state */}
      {predErr && !predicting && (
        <section style={sectionStyle}>
          <h2 style={{ ...sectionH2, color: "#ef4444" }}>Simulation Failed</h2>
          <p style={descStyle}>{predErr}</p>
        </section>
      )}

      {/* Empty state */}
      {!predicting && !predResult && !predErr && (
        <section style={{ ...sectionStyle, textAlign: "center" }}>
          <span style={{ fontSize: 42, display: "block", marginBottom: 16 }}>🧠</span>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 14 }}>
            Pick an adjuster + drop in the scope. RIQ 21 will run their history against the
            carrier&apos;s patent logic and predict how they&apos;ll respond.
          </div>
        </section>
      )}

      {/* Prediction results */}
      {predResult && !predicting && <PredictionResult result={predResult} />}
    </div>
  );
}
