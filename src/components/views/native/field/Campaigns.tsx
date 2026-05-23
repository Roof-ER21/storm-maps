/**
 * Campaigns — native React replacement for public/upgrade-campaigns.html
 *
 * Endpoint (verified against live prod):
 *   GET /api/intel/customers-list
 *     → {
 *         customers: CustomerRow[],
 *         total,
 *         took_ms
 *       }
 *
 * CustomerRow keys (verified):
 *   name, addressLine1, city, state, zip, lat, lng, jobCount, completedJobs,
 *   deadJobs, openJobs, totalRev, completedRev, firstDate, lastDate, daysSince,
 *   trades: string[], tradeCount, carriers: string[], reps: string[],
 *   hasCompletedRoof, lastCompletedRoofDate, maxDeductible
 *
 * 9 campaigns defined (same logic as HTML):
 *   siding-upsell, roof-upsell, solar, gutter-upsell, skylight-upsell,
 *   premium-followup, multi-job-repeat, multi-trade-complete, high-deductible
 *
 * Filters: search, state, min total job value. Sort all columns. CSV export.
 */
import { useState } from "react";
import { useFetch, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface CustomerRow {
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  jobCount: number;
  completedJobs: number;
  deadJobs: number;
  openJobs: number;
  totalRev: number;
  completedRev: number;
  firstDate: string | null;
  lastDate: string | null;
  daysSince: number | null;
  trades: string[];
  tradeCount: number;
  carriers: string[];
  reps: string[];
  hasCompletedRoof: boolean;
  lastCompletedRoofDate: string | null;
  maxDeductible: number | null;
}

interface CustomersListResponse {
  customers: CustomerRow[];
  total: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Campaigns definitions (mirrors HTML logic)
// ---------------------------------------------------------------------------

const ROOF_TRADES = ["Roofing", "Metal Roofing", "Flat Roofing", "Cedar Shake Roofing", "Slate Roofing"];

interface Campaign {
  label: string;
  shortLabel: string;
  desc: string;
  filter: (c: CustomerRow) => boolean;
}

const CAMPAIGNS: Record<string, Campaign> = {
  "siding-upsell": {
    shortLabel: "Siding Upsell",
    label: "Siding Upsell — Roof done, no Siding",
    desc: "Customers who have completed roofing work with Roof Docs but never had siding done.",
    filter: (c) => c.trades.some((t) => ROOF_TRADES.includes(t)) && !c.trades.includes("Siding"),
  },
  "roof-upsell": {
    shortLabel: "Roof Upsell",
    label: "Roof Upsell — Siding done, no Roof",
    desc: "Customers who had siding work but never a roof.",
    filter: (c) => c.trades.includes("Siding") && !c.trades.some((t) => ROOF_TRADES.includes(t)),
  },
  "solar": {
    shortLabel: "Solar Candidates",
    label: "Solar Candidates — Completed roof 1-7 years old",
    desc: "Customers with a completed Roof Docs roof installed 1-7 years ago.",
    filter: (c) => {
      if (!c.hasCompletedRoof || !c.lastCompletedRoofDate) return false;
      const completedMs = new Date(c.lastCompletedRoofDate).getTime();
      if (!Number.isFinite(completedMs)) return false;
      const ageYears = (Date.now() - completedMs) / (365 * 86400 * 1000);
      return ageYears >= 1 && ageYears <= 7;
    },
  },
  "gutter-upsell": {
    shortLabel: "Gutter Upsell",
    label: "Gutter Upsell — Roof done, no Gutters",
    desc: "Roof customers who never added gutters/downspouts.",
    filter: (c) => c.trades.some((t) => ROOF_TRADES.includes(t)) && !c.trades.includes("Gutters & Downspouts"),
  },
  "skylight-upsell": {
    shortLabel: "Skylight Upsell",
    label: "Skylight Upsell — Roof done, no Skylights",
    desc: "Existing roof customers who never installed skylights.",
    filter: (c) => c.trades.some((t) => ROOF_TRADES.includes(t)) && !c.trades.includes("Skylights"),
  },
  "premium-followup": {
    shortLabel: "Premium Follow-up",
    label: "Premium Customer Follow-up — Total >$30k",
    desc: "High-value customers who have spent $30k+ with Roof Docs.",
    filter: (c) => c.totalRev >= 30000,
  },
  "multi-job-repeat": {
    shortLabel: "Repeat Customers",
    label: "Repeat Customers — 2+ jobs",
    desc: "Customers who came back for more work. Strongest referral candidates.",
    filter: (c) => (c.jobCount || 0) >= 2,
  },
  "multi-trade-complete": {
    shortLabel: "Full Stack",
    label: "Full Stack Customers — Roof + Siding + Gutter",
    desc: "Customers who got the full exterior treatment.",
    filter: (c) => c.trades.some((t) => ROOF_TRADES.includes(t)) && c.trades.includes("Siding") && c.trades.includes("Gutters & Downspouts"),
  },
  "high-deductible": {
    shortLabel: "High Deductible",
    label: "High Deductible — $2500+",
    desc: "Customers whose insurance had a $2,500+ deductible.",
    filter: (c) => (c.maxDeductible || 0) >= 2500,
  },
};

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: CustomerRow[], campaignId: string) {
  const headers = ["Customer","Address","City","State","Zip","Trades","Carriers","Reps","Jobs","Prior Revenue","Last Contact","Lat","Lng"];
  const lines = [headers.join(",")];
  for (const c of rows) {
    const row = [
      c.name, c.addressLine1, c.city, c.state, c.zip,
      c.trades.sort().join(";"), c.carriers.sort().join(";"), c.reps.sort().join(";"),
      c.jobCount, Math.round(c.totalRev), c.lastDate, c.lat, c.lng,
    ].map((v) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-${campaignId}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = "name" | "addr" | "state" | "trades" | "carriers" | "jobCount" | "totalRev" | "lastDate";
type SortDir = "asc" | "desc";

function sortVal(c: CustomerRow, k: SortKey): string | number {
  if (k === "name") return c.name || "";
  if (k === "addr") return [c.addressLine1, c.city, c.state, c.zip].filter(Boolean).join(", ");
  if (k === "state") return c.state || "";
  if (k === "trades") return c.trades.sort().join(",");
  if (k === "carriers") return c.carriers.sort().join(",");
  if (k === "jobCount") return c.jobCount || 0;
  if (k === "totalRev") return c.totalRev || 0;
  if (k === "lastDate") return c.lastDate || "";
  return "";
}

// ---------------------------------------------------------------------------
// Table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 11,
  textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 6px",
  borderBottom: "1px solid var(--riq-border)", cursor: "pointer", userSelect: "none",
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "6px", borderBottom: "1px solid var(--riq-surface)" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const inputStyle: React.CSSProperties = {
  background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
  borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Campaigns({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const { data, error, loading } = useFetch<CustomersListResponse>("/api/intel/customers-list");
  const [activeCampaign, setActiveCampaign] = useState<string | null>("siding-upsell");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [minVal, setMinVal] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("totalRev");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const customers = data?.customers ?? [];

  // Campaign counts for the summary row
  const campaignCounts: Record<string, { count: number; rev: number }> = {};
  for (const [id, cmp] of Object.entries(CAMPAIGNS)) {
    const matches = customers.filter(cmp.filter);
    campaignCounts[id] = { count: matches.length, rev: matches.reduce((s, c) => s + c.totalRev, 0) };
  }

  // Filtered + sorted rows for active campaign
  const campaignRows = (() => {
    if (!activeCampaign) return [];
    const cmp = CAMPAIGNS[activeCampaign];
    let rows = customers.filter(cmp.filter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((c) =>
        (c.name || "").toLowerCase().includes(q) ||
        [c.addressLine1, c.city, c.state, c.zip].join(" ").toLowerCase().includes(q) ||
        c.reps.some((r) => r.toLowerCase().includes(q)) ||
        c.carriers.some((r) => r.toLowerCase().includes(q))
      );
    }
    if (state) rows = rows.filter((c) => c.state === state);
    const mv = Number(minVal || 0);
    if (mv) rows = rows.filter((c) => c.totalRev >= mv);
    rows = [...rows].sort((a, b) => {
      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return rows;
  })();

  const states = [...new Set(customers.map((c) => c.state).filter(Boolean))].sort();

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  const arrow = (k: SortKey) =>
    sortKey === k ? (
      <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null;

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: "var(--riq-accent)" }}>
        Upgrade Campaigns — Customer Segmentation for Marketing
      </h2>

      {/* Campaign tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 24 }}>
        {Object.entries(CAMPAIGNS).map(([id, cmp]) => {
          const { count, rev } = campaignCounts[id] || { count: 0, rev: 0 };
          const isActive = activeCampaign === id;
          return (
            <div
              key={id}
              onClick={() => { setActiveCampaign(id); setSortKey("totalRev"); setSortDir("desc"); setSearch(""); setState(""); setMinVal(""); }}
              style={{
                background: isActive ? "#342c23" : "var(--riq-surface)",
                border: `1px solid ${isActive ? "var(--riq-accent)" : "var(--riq-border)"}`,
                borderRadius: 8,
                padding: 16,
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ color: "var(--riq-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                {cmp.shortLabel}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--riq-accent)" }}>{count.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: "var(--riq-text)", marginTop: 6, lineHeight: 1.4 }}>
                {cmp.label.split(" — ")[1] || cmp.label}
              </div>
              <div style={{ fontSize: 12, color: "#10b981", marginTop: 4 }}>{fmtMoney(rev)} prior revenue</div>
            </div>
          );
        })}
      </div>

      {/* Campaign detail table */}
      {activeCampaign && (
        <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "16px 20px" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>{CAMPAIGNS[activeCampaign].label}</h3>
          <p style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>{CAMPAIGNS[activeCampaign].desc}</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="customer / address / rep / carrier"
                style={{ ...inputStyle, width: 340 }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>State</label>
              <select value={state} onChange={(e) => setState(e.target.value)} style={inputStyle}>
                <option value="">All</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Min total job value</label>
              <input
                type="number"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
                placeholder="0"
                style={{ ...inputStyle, width: 120 }}
              />
            </div>
            <button
              onClick={() => exportCSV(campaignRows, activeCampaign)}
              style={{ background: "var(--riq-accent)", color: "#1a1612", border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Export CSV
            </button>
          </div>
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
            {campaignRows.length.toLocaleString()} customers · {fmtMoney(campaignRows.reduce((s, c) => s + c.totalRev, 0))} prior revenue
          </div>
          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  <th style={thStyle} onClick={() => toggleSort("name")}>Customer{arrow("name")}</th>
                  <th style={thStyle} onClick={() => toggleSort("addr")}>Address{arrow("addr")}</th>
                  <th style={thStyle} onClick={() => toggleSort("state")}>State{arrow("state")}</th>
                  <th style={thStyle} onClick={() => toggleSort("trades")}>Trades on file{arrow("trades")}</th>
                  <th style={thStyle} onClick={() => toggleSort("carriers")}>Carriers{arrow("carriers")}</th>
                  <th style={thNumStyle} onClick={() => toggleSort("jobCount")}>Jobs{arrow("jobCount")}</th>
                  <th style={thNumStyle} onClick={() => toggleSort("totalRev")}>Prior Revenue{arrow("totalRev")}</th>
                  <th style={thNumStyle} onClick={() => toggleSort("lastDate")}>Last Contact{arrow("lastDate")}</th>
                </tr>
              </thead>
              <tbody>
                {campaignRows.length === 0 && (
                  <tr><td colSpan={8} style={{ ...tdStyle, padding: 40, textAlign: "center", color: "var(--riq-text-muted)" }}>No customers match this campaign + filters.</td></tr>
                )}
                {campaignRows.slice(0, 2000).map((c, i) => {
                  const addr = [c.addressLine1, c.city, c.state, c.zip].filter(Boolean).join(", ");
                  return (
                    <tr key={i}>
                      <td style={tdStyle}><strong>{c.name}</strong></td>
                      <td style={tdStyle}>{addr || "—"}</td>
                      <td style={tdStyle}>{c.state || "—"}</td>
                      <td style={tdStyle}><span style={{ fontSize: 11 }}>{c.trades.sort().join(", ") || "—"}</span></td>
                      <td style={tdStyle}><span style={{ fontSize: 11 }}>{c.carriers.sort().join(", ") || "—"}</span></td>
                      <td style={tdNumStyle}>{c.jobCount}</td>
                      <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(c.totalRev)}</td>
                      <td style={tdNumStyle}>{c.lastDate || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
