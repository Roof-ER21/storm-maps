/**
 * LifetimeTouch — native React replacement for public/lifetime-touch.html
 *
 * Endpoints (verified against live prod):
 *   GET /api/intel/lifetime-touch-query?include=stats,reps
 *     → { rows: TouchRow[], total, took_ms, stats: Stats, reps: { rep, count }[] }
 *   GET /api/intel/lifetime-touch-query?rep=<rep>&tier=<tier>&reason=<reason>
 *     → { rows: TouchRow[], total, took_ms }
 *
 * Row shape (verified):
 *   key, lat, lng, zip, city, score, state, trades, address, customer,
 *   jobCount, salesRep, insurance, tradeGaps, portalLink, customerCell,
 *   customerEmail, lastCompleted, contactQuality, firstCompleted,
 *   scoreBreakdown, suggestedPitch, yearsSinceLast, hailHitsSinceLast,
 *   stormHitsSinceLast, strongestStormSinceLast
 *
 * Client-side snooze (mark contacted for 30 days) stored in localStorage.
 * Paginated 50/page. Sortable columns. Filterable by rep/tier/reason/search.
 * CSV export.
 */
import { useState, useEffect, useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface TouchStats {
  totalCustomers: number;
  topTierCount: number;
  midTierCount: number;
  withStormSince: number;
  oldRoofCount: number;
  contactableCount: number;
  byRepCount: number;
}

interface RepMeta { rep: string; count: number; }

interface TouchMetaResponse {
  rows: TouchRow[];
  total: number;
  took_ms: number;
  stats: TouchStats;
  reps: RepMeta[];
}

interface TouchRow {
  key: string;
  customer: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  score: number;
  trades: string[];
  tradeGaps: string[];
  salesRep: string | null;
  insurance: string | null;
  customerCell: string | null;
  customerEmail: string | null;
  portalLink: string | null;
  contactQuality: string;
  suggestedPitch: string | null;
  yearsSinceLast: number | null;
  stormHitsSinceLast: number;
  hailHitsSinceLast: number;
  strongestStormSinceLast: { type: string; mag?: number | null } | null;
  jobCount: number;
  lastCompleted: string | null;
  firstCompleted: string | null;
}

// ---------------------------------------------------------------------------
// Snooze (localStorage — 30 days)
// ---------------------------------------------------------------------------

const SNOOZE_KEY = "riq21_touch_snoozed";
function loadSnoozed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}"); } catch { return {}; }
}
function saveSnoozed(obj: Record<string, number>) {
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(obj));
}
function isSnoozed(id: string): boolean {
  const obj = loadSnoozed();
  const ts = obj[id];
  if (!ts) return false;
  return Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
}
function snooze(id: string) {
  const obj = loadSnoozed();
  obj[id] = Date.now();
  saveSnoozed(obj);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: TouchRow[]) {
  const headers = ["Score","Customer","Address","City","State","Zip","Cell","Email","Years Since","Storm Hits","Trade Gaps","Pitch"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const row = [r.score, r.customer, r.address, r.city, r.state, r.zip, r.customerCell, r.customerEmail, r.yearsSinceLast, r.stormHitsSinceLast, (r.tradeGaps || []).join("; "), r.suggestedPitch];
    lines.push(row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lifetime-touch-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const selectStyle: React.CSSProperties = {
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 5,
  padding: "7px 11px",
  fontSize: 13,
  fontFamily: "inherit",
};

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 10,
  textTransform: "uppercase", padding: "8px 6px", borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer", userSelect: "none",
};
const tdStyle: React.CSSProperties = { padding: "7px 6px", borderBottom: "1px solid var(--riq-surface)", verticalAlign: "top" };

const PAGE_SIZE = 50;
type SortCol = "score" | "customer" | "address" | "yearsSinceLast" | "contactQuality";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LifetimeTouch({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [meta, setMeta] = useState<{ stats: TouchStats; reps: RepMeta[] } | null>(null);
  const [rows, setRows] = useState<TouchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingRows, setFetchingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: "score", dir: -1 });
  const [, setSnoozeRev] = useState(0); // re-render trigger after snooze

  // Filters
  const [rep, setRep] = useState("(top)");
  const [tier, setTier] = useState("all");
  const [reason, setReason] = useState("all");
  const [snoozeMode, setSnoozeMode] = useState("show");
  const [search, setSearch] = useState("");

  const inflightRef = useRef(0);

  // Load meta (stats + reps) once
  useEffect(() => {
    fetch("/api/intel/lifetime-touch-query?include=stats,reps", { credentials: "include" })
      .then((r) => r.json() as Promise<TouchMetaResponse>)
      .then((d) => {
        setMeta({ stats: d.stats, reps: d.reps });
        // Pre-select Ahmed if available
        const ahmed = d.reps.find((r) => r.rep.toLowerCase().includes("ahmed"));
        if (ahmed) setRep(ahmed.rep);
        setLoading(false);
      })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  // Fetch rows when server-side filters change
  useEffect(() => {
    if (!meta) return;
    const token = ++inflightRef.current;
    setFetchingRows(true);
    const params = new URLSearchParams();
    if (rep) params.set("rep", rep);
    if (tier) params.set("tier", tier);
    if (reason) params.set("reason", reason);
    fetch(`/api/intel/lifetime-touch-query?${params.toString()}`, { credentials: "include" })
      .then((r) => r.json() as Promise<{ rows: TouchRow[]; total: number; took_ms: number }>)
      .then((d) => {
        if (token !== inflightRef.current) return;
        setRows(d.rows || []);
        setPage(0);
        setFetchingRows(false);
      })
      .catch(() => { setFetchingRows(false); });
  }, [meta, rep, tier, reason]);

  const handleSnooze = useCallback((id: string) => {
    snooze(id);
    setSnoozeRev((v) => v + 1);
  }, []);

  // Client-side filtering + sorting
  const filtered = (() => {
    let r = [...rows];
    // Snooze filter
    if (snoozeMode !== "show") {
      r = r.filter((row) => {
        const snoozed = isSnoozed(row.key || row.customer);
        return snoozeMode === "hide" ? !snoozed : snoozed;
      });
    }
    // Text search
    if (search) {
      const q = search.toLowerCase();
      r = r.filter((row) =>
        [row.customer, row.address, row.city, row.zip, row.suggestedPitch].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }
    // Sort
    r.sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return r;
  })();

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  function toggleSort(col: SortCol) {
    setSort((s) => s.col === col ? { col, dir: (s.dir * -1) as 1 | -1 } : { col, dir: (col === "customer" || col === "address" || col === "contactQuality") ? 1 : -1 });
    setPage(0);
  }

  const thArrow = (col: SortCol) =>
    sort.col === col ? (
      <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>{sort.dir === 1 ? "▲" : "▼"}</span>
    ) : null;

  if (loading) return <div style={{ padding: 50, textAlign: "center", color: "var(--riq-accent)" }}>Loading touch engine…</div>;
  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>;

  const stats = meta!.stats;
  const reps = meta!.reps;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      {/* Stats section */}
      <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px", marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Touch Engine — math-prioritized re-engagement</h2>
        <p style={{ color: "var(--riq-text-muted)", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
          Completed customers ranked by ripeness: roof lifecycle position + storm exposure since their job + trade gaps + contact info quality.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          {([
            ["Customers Scored", stats.totalCustomers],
            ["High-Priority (60+)", stats.topTierCount],
            ["Mid-Priority (40-59)", stats.midTierCount],
            ["Storm Hit Since Last", stats.withStormSince],
            ["Stale (4+ yr)", stats.oldRoofCount],
            ["Reps with Lists", stats.byRepCount],
          ] as [string, number][]).map(([label, value]) => (
            <div key={label} style={{ background: "#342c23", borderRadius: 6, padding: "12px 14px" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--riq-accent)", fontVariantNumeric: "tabular-nums" }}>
                {(value || 0).toLocaleString()}
              </div>
              <div style={{ color: "var(--riq-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Touch queue section */}
      <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "18px 22px" }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "var(--riq-accent)" }}>Your touch queue</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <select value={rep} onChange={(e) => setRep(e.target.value)} style={selectStyle}>
            <option value="(top)">Top 100 across all reps</option>
            {reps.slice().sort((a, b) => a.rep.localeCompare(b.rep)).map((r) => (
              <option key={r.rep} value={r.rep}>{r.rep} ({r.count})</option>
            ))}
          </select>
          <select value={tier} onChange={(e) => setTier(e.target.value)} style={selectStyle}>
            <option value="all">All scores</option>
            <option value="high">High (60+)</option>
            <option value="mid">Mid (40-59)</option>
            <option value="low">Low (&lt; 40)</option>
          </select>
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={selectStyle}>
            <option value="all">All reasons</option>
            <option value="storm">Storm hit</option>
            <option value="old">Stale 4+ yr since last contact</option>
            <option value="gap">Trade gap</option>
          </select>
          <select value={snoozeMode} onChange={(e) => setSnoozeMode(e.target.value)} style={selectStyle}>
            <option value="show">Show all</option>
            <option value="hide">Hide recently contacted (30d)</option>
            <option value="only">Only recently contacted</option>
          </select>
          <input
            placeholder="Search name/address/city/zip…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...selectStyle, minWidth: 240, flex: 1 }}
          />
          <button
            onClick={() => exportCSV(filtered)}
            style={{ background: "var(--riq-accent)", color: "#1a1612", border: "none", padding: "7px 14px", borderRadius: 5, fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
          >
            Export CSV
          </button>
        </div>

        {fetchingRows && <div style={{ padding: 20, textAlign: "center", color: "var(--riq-accent)", fontSize: 13 }}>Loading…</div>}
        {!fetchingRows && (
          <div style={{ overflowX: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => toggleSort("score")}>Score{thArrow("score")}</th>
                  <th style={thStyle} onClick={() => toggleSort("customer")}>Customer{thArrow("customer")}</th>
                  <th style={thStyle} onClick={() => toggleSort("address")}>Address{thArrow("address")}</th>
                  <th style={thStyle} onClick={() => toggleSort("yearsSinceLast")}>Yrs Since{thArrow("yearsSinceLast")}</th>
                  <th style={thStyle}>Signals</th>
                  <th style={thStyle} onClick={() => toggleSort("contactQuality")}>Contact{thArrow("contactQuality")}</th>
                  <th style={thStyle}>Pitch</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr><td colSpan={8} style={{ ...tdStyle, padding: "60px 20px", textAlign: "center", color: "var(--riq-text-muted)" }}>No customers match these filters.</td></tr>
                )}
                {pageRows.map((r) => {
                  const cls = r.score >= 60 ? "high" : r.score >= 40 ? "mid" : "low";
                  const barColor = cls === "high" ? "#10b981" : cls === "mid" ? "#f59e0b" : "var(--riq-text-muted)";
                  const snoozed = isSnoozed(r.key || r.customer);
                  return (
                    <tr key={r.key}>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-block", width: 70, height: 8, background: "var(--riq-surface)", borderRadius: 3, overflow: "hidden", verticalAlign: "middle", marginRight: 6 }}>
                          <span style={{ display: "block", height: "100%", background: barColor, width: `${Math.min(100, r.score)}%` }} />
                        </span>
                        <strong>{r.score}</strong>
                      </td>
                      <td style={tdStyle}><strong>{r.customer}</strong></td>
                      <td style={tdStyle}>
                        {r.address || "—"}
                        <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>
                          {r.city}, {r.state} {r.zip}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                        {r.yearsSinceLast != null ? r.yearsSinceLast.toFixed(0) : "—"}
                      </td>
                      <td style={tdStyle}>
                        {r.stormHitsSinceLast >= 1 && (
                          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "rgba(167,139,250,0.2)", color: "#a78bfa", marginRight: 3 }}>
                            {r.stormHitsSinceLast} storms
                          </span>
                        )}
                        {(r.yearsSinceLast || 0) >= 4 && (
                          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "rgba(245,158,11,0.2)", color: "#f59e0b", marginRight: 3 }}>
                            {(r.yearsSinceLast || 0).toFixed(0)}yr
                          </span>
                        )}
                        {(r.tradeGaps || []).length >= 3 && (
                          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "rgba(96,165,250,0.2)", color: "#60a5fa", marginRight: 3 }}>
                            +{r.tradeGaps.length} gaps
                          </span>
                        )}
                        {r.contactQuality === "full" && (
                          <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600, background: "rgba(16,185,129,0.2)", color: "#10b981" }}>
                            full contact
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {r.customerCell ? (
                          <a href={`tel:${r.customerCell}`} style={{ color: "#10b981", fontSize: 12 }}>{r.customerCell}</a>
                        ) : (
                          <span style={{ color: "var(--riq-text-muted)", fontSize: 12 }}>none</span>
                        )}
                        {r.customerEmail && (
                          <div>
                            <a href={`mailto:${r.customerEmail}`} style={{ color: "var(--riq-accent)", fontSize: 11 }}>{r.customerEmail}</a>
                          </div>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ color: "var(--riq-text-muted)", fontSize: 11, lineHeight: 1.4, maxWidth: 240 }}>
                          {r.suggestedPitch || "—"}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        {r.customerCell && (
                          <a href={`tel:${r.customerCell}`} style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 8, fontSize: 12 }}>Call</a>
                        )}
                        {r.customerCell && (
                          <a
                            href={`sms:${r.customerCell}&body=${encodeURIComponent(r.suggestedPitch || "")}`}
                            style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 8, fontSize: 12 }}
                          >
                            SMS
                          </a>
                        )}
                        {r.portalLink && (
                          <a href={r.portalLink} target="_blank" rel="noreferrer" style={{ color: "var(--riq-accent)", textDecoration: "none", marginRight: 8, fontSize: 12 }}>Portal</a>
                        )}
                        <button
                          onClick={() => { handleSnooze(r.key || r.customer); }}
                          style={{ background: "none", border: "none", color: "var(--riq-accent)", cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}
                        >
                          {snoozed ? "Contacted" : "Mark contacted"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, fontSize: 13 }}>
            <button onClick={() => setPage(0)} disabled={page === 0} style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>First</button>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>Prev</button>
            <span style={{ color: "var(--riq-text-muted)", padding: "6px 12px" }}>Page {page + 1} of {totalPages} · {filtered.length} customers</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>Next</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} style={{ background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)", padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>Last</button>
          </div>
        )}
      </div>
    </div>
  );
}
