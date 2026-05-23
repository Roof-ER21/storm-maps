/**
 * Weekly Recap — native React (Phase 2d batch1)
 *
 * Data:
 *   GET /api/intel/weekly-recap?days=N[&state=XX]
 *     → { window, numbers: { newSigned, newCompleted, newDead, closedRev, deltaSigned, deltaRev },
 *          topReps: [{ name, signed, revenue }], receivables: { arTotal, cfPending, accountsTotal, downpaymentsAwaiting }, took_ms }
 *   GET /api/intel/storms-light
 *     → GeoJSON FeatureCollection { type, features: [{ geometry.coordinates:[lng,lat], properties:{ typetext, magf, magnitude, valid, city, state } }] }
 *   GET /api/intel/resurrection
 *     → [{ jobId, customer, address, city, state, insurance, signedDate, lastTouchDate, strongestStorm:{ stormDate, stormType, stormMagnitude, stormDistanceMiles } }]
 *   GET /api/intel/jobs-nearby?lat=N&lng=N&radius=3
 *     → { jobs: [...] }  (for per-storm nearby count)
 */
import { useState, useEffect, useCallback } from "react";
import { fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface WeeklyNumbers {
  newSigned: number;
  newCompleted: number;
  newDead: number;
  closedRev: number;
  deltaSigned: number;
  deltaRev: number;
}

interface TopRep {
  name: string;
  signed: number;
  revenue: number;
}

interface Receivables {
  arTotal: number;
  cfPending: number;
  accountsTotal: number;
  downpaymentsAwaiting: number;
}

interface WeeklyRecapResponse {
  window: { days: number; since: string; state: string | null };
  numbers: WeeklyNumbers;
  topReps: TopRep[];
  receivables: Receivables;
  took_ms: number;
}

interface StormFeature {
  type: string;
  mag: number | null;
  valid: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

interface ResurrectionCandidate {
  jobId: number;
  customer: string;
  address: string;
  city: string;
  state: string;
  insurance: string | null;
  signedDate: string;
  lastTouchDate: string;
  strongestStorm: {
    stormDate: string;
    stormType: string;
    stormMagnitude: number | null;
    stormDistanceMiles: number;
  };
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const kpiRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 10,
  marginBottom: 14,
};

const kpiBox: React.CSSProperties = {
  background: "#342c23",
  border: "1px solid var(--riq-border)",
  borderRadius: 6,
  padding: "10px 14px",
};

const kpiLabel: React.CSSProperties = {
  fontSize: 10,
  color: "var(--riq-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const kpiValue: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: "var(--riq-accent)", marginTop: 4 };
const kpiDelta: React.CSSProperties = { fontSize: 11, marginTop: 2 };

const sectionHead: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: "26px 0 8px",
  paddingBottom: 6,
  borderBottom: "1px solid var(--riq-border)",
  color: "var(--riq-text)",
};

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 };
const th: React.CSSProperties = {
  textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--riq-border)",
  color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase",
};
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid #342c23" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

function stormTypePill(type: string): React.CSSProperties {
  if (type === "HAIL" || type === "TORNADO" || (type || "").includes("WND")) {
    return {};
  }
  return {};
}

function stormPillColor(type: string): string {
  if (type === "HAIL") return "#a78bfa";
  if (type === "TORNADO") return "#ef4444";
  return "var(--riq-accent)";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WeeklyRecap({ navigate }: { navigate: (v: string) => void }) {
  const [days, setDays] = useState(7);
  const [state, setState] = useState("");
  const [recapData, setRecapData] = useState<WeeklyRecapResponse | null>(null);
  const [allStorms, setAllStorms] = useState<StormFeature[]>([]);
  const [resurrection, setResurrection] = useState<ResurrectionCandidate[]>([]);
  const [stormNearby, setStormNearby] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load static data once (storms + resurrection)
  useEffect(() => {
    Promise.all([
      fetch("/api/intel/storms-light", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/intel/resurrection", { credentials: "include" }).then((r) => r.json()).catch(() => []),
    ]).then(([r2, r3]) => {
      const features = Array.isArray(r2) ? r2 : (r2?.features ?? []);
      const storms: StormFeature[] = (features as Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { typetext?: string; magf?: string | number | null; magnitude?: string | number | null; valid?: string; city?: string; state?: string };
      }>).map((f) => {
        const p = f.properties ?? {};
        const c = f.geometry?.coordinates;
        if (!Array.isArray(c)) return null;
        const mag = p.magf != null ? Number(p.magf) : p.magnitude != null ? Number(p.magnitude) : null;
        return {
          type: p.typetext ?? "",
          mag: isNaN(mag as number) || mag == null ? null : (mag as number),
          valid: p.valid ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          lat: c[1],
          lng: c[0],
        };
      }).filter((x): x is StormFeature => x !== null);
      setAllStorms(storms);
      setResurrection(Array.isArray(r3) ? r3 : []);
    }).catch((e: unknown) => {
      setError((e as Error).message ?? String(e));
    });
  }, []);

  // Reload recap when days/state changes
  const buildRecap = useCallback(async () => {
    if (!allStorms.length && allStorms.length === 0) return; // wait for storms
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (state) params.set("state", state);
      const r = await fetch(`/api/intel/weekly-recap?${params}`, { credentials: "include" }).then((r) => r.json() as Promise<WeeklyRecapResponse>);
      setRecapData(r);

      const since = new Date(Date.now() - days * 86400000);
      const strongStorms = allStorms.filter((s) => {
        if (!s.valid) return false;
        const ts = new Date(s.valid).getTime();
        return ts >= since.getTime() && ts <= Date.now() &&
          (state ? s.state === state : true) &&
          ((s.type === "HAIL" && (s.mag ?? 0) >= 1.0) ||
           ((s.type ?? "").includes("WND") && (s.mag ?? 0) >= 60) ||
           s.type === "TORNADO");
      });

      // Fire-and-forget nearby queries for top 5 storms
      const top5 = strongStorms.slice(0, 5);
      const nearbyMap: Record<number, number> = {};
      await Promise.all(top5.map(async (s, i) => {
        try {
          const res = await fetch(`/api/intel/jobs-nearby?lat=${s.lat}&lng=${s.lng}&radius=3`, { credentials: "include" });
          const json = await res.json() as { jobs?: unknown[] };
          nearbyMap[i] = (json.jobs ?? []).length;
        } catch {
          nearbyMap[i] = 0;
        }
      }));
      setStormNearby(nearbyMap);
    } catch (e: unknown) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [days, state, allStorms]);

  useEffect(() => {
    if (allStorms.length > 0 || !loading) {
      buildRecap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, state, allStorms.length]);

  // Derived data
  const since = new Date(Date.now() - days * 86400000);
  const sinceStr = since.toISOString().slice(0, 10);
  const weekLabel = `${since.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const strongStorms = allStorms.filter((s) => {
    if (!s.valid) return false;
    const ts = new Date(s.valid).getTime();
    return ts >= since.getTime() && ts <= Date.now() &&
      (state ? s.state === state : true) &&
      ((s.type === "HAIL" && (s.mag ?? 0) >= 1.0) ||
       ((s.type ?? "").includes("WND") && (s.mag ?? 0) >= 60) ||
       s.type === "TORNADO");
  }).sort((a, b) => (b.valid ?? "").localeCompare(a.valid ?? "")).slice(0, 5);

  const newResurrection = resurrection.filter((r) => {
    const sd = r.strongestStorm?.stormDate;
    return sd && sd >= sinceStr;
  });

  const n = recapData?.numbers;
  const rec = recapData?.receivables;

  // Copy as HTML
  const handleCopyHTML = async () => {
    const el = document.getElementById("riq-weekly-recap-content");
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.outerHTML);
    } catch {
      // ignore
    }
  };

  // Download HTML
  const handleDownload = () => {
    const el = document.getElementById("riq-weekly-recap-content");
    if (!el) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Recap</title></head><body style="font-family:sans-serif;background:#1a1612;color:#f0ebe2;padding:24px">${el.outerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-recap-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {/* Controls */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "14px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          Window
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit" }}
          >
            <option value={7}>Past 7 days</option>
            <option value={14}>Past 14 days</option>
            <option value={30}>Past 30 days</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
          State filter
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit" }}
          >
            <option value="">All</option>
            <option value="VA">VA</option>
            <option value="MD">MD</option>
            <option value="PA">PA</option>
          </select>
        </label>
        <button
          onClick={() => window.print()}
          style={{ background: "var(--riq-accent)", color: "#1a1612", border: "none", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Print / Save as PDF
        </button>
        <button
          onClick={handleCopyHTML}
          style={{ background: "transparent", color: "var(--riq-accent)", border: "1px solid var(--riq-accent)", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Copy as HTML
        </button>
        <button
          onClick={handleDownload}
          style={{ background: "transparent", color: "var(--riq-accent)", border: "1px solid var(--riq-accent)", borderRadius: 4, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          Download HTML
        </button>
      </div>

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading data…</div>
      )}
      {error && (
        <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>
      )}

      {!loading && !error && recapData && (
        <div
          id="riq-weekly-recap-content"
          style={{
            background: "var(--riq-surface)",
            border: "1px solid var(--riq-border)",
            borderRadius: 10,
            padding: "32px",
          }}
        >
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 4px", color: "var(--riq-accent)" }}>
            RIQ 21 — Weekly Recap
          </h1>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 24 }}>
            {weekLabel}{state ? ` · ${state} only` : ""} · {days}-day window
          </div>

          {/* Numbers */}
          <h2 style={sectionHead}>The Numbers <span style={{ fontSize: 11, padding: "2px 8px", background: "var(--riq-accent)", color: "#1a1612", borderRadius: 10, fontWeight: 700, marginLeft: 8 }}>Past {days} days</span></h2>
          {n && (
            <div style={kpiRow}>
              <div style={kpiBox}>
                <div style={kpiLabel}>New signed</div>
                <div style={kpiValue}>{n.newSigned}</div>
                <div style={{ ...kpiDelta, color: n.deltaSigned >= 0 ? "#10b981" : "#ef4444" }}>
                  {n.deltaSigned >= 0 ? "+" : ""}{n.deltaSigned} vs prior
                </div>
              </div>
              <div style={kpiBox}>
                <div style={kpiLabel}>Newly completed</div>
                <div style={kpiValue}>{n.newCompleted}</div>
              </div>
              <div style={kpiBox}>
                <div style={kpiLabel}>Newly dead</div>
                <div style={kpiValue}>{n.newDead}</div>
              </div>
              <div style={kpiBox}>
                <div style={kpiLabel}>Revenue closed</div>
                <div style={kpiValue}>{fmtMoney(n.closedRev)}</div>
                <div style={{ ...kpiDelta, color: n.deltaRev >= 0 ? "#10b981" : "#ef4444" }}>
                  {n.deltaRev >= 0 ? "+" : ""}{fmtMoney(n.deltaRev)} vs prior
                </div>
              </div>
              {rec && (
                <div style={kpiBox}>
                  <div style={kpiLabel}>Open AR</div>
                  <div style={kpiValue}>{fmtMoney(rec.arTotal)}</div>
                  <div style={{ ...kpiDelta, color: "var(--riq-text-muted)" }}>{rec.accountsTotal} accounts</div>
                </div>
              )}
            </div>
          )}

          {/* Top reps */}
          <h2 style={sectionHead}>Top Reps This Week</h2>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginBottom: 4 }}>
            Closed revenue from this week's signs is usually $0 — those jobs haven't completed yet. Use Signed count as the leading indicator.
          </div>
          {recapData.topReps.length === 0 ? (
            <div style={{ color: "var(--riq-text-muted)", fontStyle: "italic" }}>No new signs this window.</div>
          ) : (
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Rep</th>
                  <th style={thNum}>Signed</th>
                  <th style={thNum}>Closed $ (so far)</th>
                </tr>
              </thead>
              <tbody>
                {recapData.topReps.map((r) => (
                  <tr key={r.name}>
                    <td style={td}>{r.name}</td>
                    <td style={tdNum}>{r.signed}</td>
                    <td style={{ ...tdNum, color: "#10b981" }}>{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Strong storms */}
          <h2 style={sectionHead}>Strong Storms This Week</h2>
          {strongStorms.length === 0 ? (
            <div style={{ color: "var(--riq-text-muted)", fontStyle: "italic" }}>No major hail/wind events in window.</div>
          ) : (
            <table style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Type</th>
                  <th style={th}>Mag</th>
                  <th style={th}>Where</th>
                  <th style={thNum}>Customers in 3mi</th>
                </tr>
              </thead>
              <tbody>
                {strongStorms.map((s, i) => (
                  <tr key={i}>
                    <td style={td}>{(s.valid ?? "").slice(0, 10)}</td>
                    <td style={td}>
                      <span style={{ ...stormTypePill(s.type), background: s.type === "HAIL" ? "rgba(168,139,250,0.2)" : s.type === "TORNADO" ? "rgba(239,68,68,0.2)" : "rgba(94,200,255,0.2)", color: stormPillColor(s.type), padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>
                        {s.type}
                      </span>
                    </td>
                    <td style={td}>{s.mag ?? "—"} {s.type === "HAIL" ? "in" : s.type?.includes("WND") ? "mph" : ""}</td>
                    <td style={td}>{s.city ?? ""}, {s.state ?? ""}</td>
                    <td style={tdNum}>{stormNearby[i] ?? "…"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* New resurrection */}
          <h2 style={sectionHead}>
            New Resurrection Candidates{" "}
            <span style={{ fontSize: 11, padding: "2px 8px", background: "var(--riq-accent)", color: "#1a1612", borderRadius: 10, fontWeight: 700, marginLeft: 8 }}>
              {newResurrection.length} new
            </span>
          </h2>
          {newResurrection.length === 0 ? (
            <div style={{ color: "var(--riq-text-muted)", fontStyle: "italic" }}>No new dead-job-hit-by-storm matches this week.</div>
          ) : (
            <>
              <ul style={{ paddingLeft: 22, margin: "8px 0" }}>
                {newResurrection.slice(0, 10).map((r) => (
                  <li key={r.jobId} style={{ marginBottom: 4, fontSize: 13, lineHeight: 1.5 }}>
                    <strong>{r.customer || "—"}</strong> · {r.address} · {r.insurance || "—"} (dead {r.lastTouchDate}) →{" "}
                    {r.strongestStorm?.stormType} {r.strongestStorm?.stormMagnitude ?? ""} hit{" "}
                    {(r.strongestStorm?.stormDate ?? "").slice(0, 10)} at{" "}
                    {r.strongestStorm?.stormDistanceMiles?.toFixed(1)} mi
                  </li>
                ))}
              </ul>
              {newResurrection.length > 10 && (
                <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 6 }}>
                  +{newResurrection.length - 10} more —{" "}
                  <button
                    onClick={() => navigate("resurrection")}
                    style={{ color: "var(--riq-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                  >
                    see Resurrection list
                  </button>
                </div>
              )}
            </>
          )}

          {/* AR Watch */}
          {rec && (
            <>
              <h2 style={sectionHead}>AR Watch</h2>
              <div style={kpiRow}>
                <div style={kpiBox}>
                  <div style={kpiLabel}>CF Pending / Sent</div>
                  <div style={kpiValue}>{rec.cfPending}</div>
                </div>
                <div style={kpiBox}>
                  <div style={kpiLabel}>Total open accounts</div>
                  <div style={kpiValue}>{rec.accountsTotal}</div>
                </div>
                <div style={kpiBox}>
                  <div style={kpiLabel}>Downpayments awaiting</div>
                  <div style={kpiValue}>{rec.downpaymentsAwaiting}</div>
                </div>
              </div>
            </>
          )}

          {/* Action items */}
          <h2 style={sectionHead}>Action Items For This Week</h2>
          <ul style={{ paddingLeft: 22, margin: "8px 0" }}>
            {newResurrection.length > 0 && (
              <li style={{ marginBottom: 4, fontSize: 13 }}>
                Call/text the {newResurrection.length} new resurrection candidate(s). Same-storm hook — see specific addresses above.
              </li>
            )}
            {strongStorms.length > 0 && (
              <li style={{ marginBottom: 4, fontSize: 13 }}>
                {strongStorms.length} strong storm(s) hit this week. Generate ride-out lists from{" "}
                <button onClick={() => navigate("storm-playbook")} style={{ color: "var(--riq-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>Storm Playbook</button>.
              </li>
            )}
            {rec && rec.cfPending > 0 && (
              <li style={{ marginBottom: 4, fontSize: 13 }}>
                {rec.cfPending} CF Pending/Sent — push completion funds collection from{" "}
                <button onClick={() => navigate("receivables")} style={{ color: "var(--riq-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>AR page</button>.
              </li>
            )}
            {n && n.newDead > 0 && (
              <li style={{ marginBottom: 4, fontSize: 13 }}>
                {n.newDead} job(s) went dead this week — review for resurrection setup.
              </li>
            )}
            <li style={{ marginBottom: 4, fontSize: 13 }}>
              Open{" "}
              <button onClick={() => navigate("exec")} style={{ color: "var(--riq-accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>Exec Snapshot</button>{" "}
              for full intelligence brief.
            </li>
          </ul>

          <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 30, borderTop: "1px solid var(--riq-border)", paddingTop: 12 }}>
            Generated {new Date().toLocaleString()} · {allStorms.length.toLocaleString()} storm events tracked
          </div>
        </div>
      )}
    </div>
  );
}
