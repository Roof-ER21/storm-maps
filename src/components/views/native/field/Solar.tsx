/**
 * Solar — native React replacement for public/solar.html
 *
 * Endpoint (verified against live prod):
 *   GET /api/intel/solar-candidates
 *     → {
 *         candidates: SolarCandidate[],
 *         total,
 *         took_ms
 *       }
 *
 * SolarCandidate keys (verified):
 *   customer, addressLine1, city, state, zip, lat, lng, email, phone,
 *   completedDate, ageYears, jobTotal, carrier, houseType, rep, trades,
 *   customerKey
 *
 * Filters: search, state, roof age (fresh/mid/old), house type, carrier.
 * Sort all columns. CSV export.
 */
import { useState } from "react";
import { useFetch, fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface SolarCandidate {
  customer: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  email: string | null;
  phone: string | null;
  completedDate: string | null;
  ageYears: number;
  jobTotal: number;
  carrier: string | null;
  houseType: string | null;
  rep: string | null;
  trades: string[];
  customerKey: string;
}

interface SolarResponse {
  candidates: SolarCandidate[];
  total: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function exportCSV(rows: SolarCandidate[]) {
  const headers = ["Customer","Email","Phone","Address","City","State","Zip","Lat","Lng","RoofCompleted","AgeYears","JobTotal","Carrier","HouseType","Trades","Rep"];
  const lines = [headers.join(",")];
  for (const c of rows) {
    const row = [
      c.customer, c.email, c.phone, c.addressLine1, c.city, c.state, c.zip, c.lat, c.lng,
      c.completedDate, c.ageYears.toFixed(1), Math.round(c.jobTotal || 0),
      c.carrier, c.houseType, (c.trades || []).join(";"), c.rep,
    ].map((v) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`);
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roofdocs-solar-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", color: "var(--riq-text-muted)", fontWeight: 500, fontSize: 11,
  textTransform: "uppercase", padding: "8px 6px", borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer", userSelect: "none",
};
const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "6px", borderBottom: "1px solid var(--riq-surface)", verticalAlign: "top" };
const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const inputStyle: React.CSSProperties = {
  background: "#342c23", color: "var(--riq-text)", border: "1px solid var(--riq-border)",
  borderRadius: 4, padding: "6px 10px", fontSize: 13, fontFamily: "inherit",
};
const ORANGE = "#fb923c";

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = "customer" | "addressLine1" | "state" | "completedDate" | "ageYears" | "jobTotal" | "carrier" | "houseType";
type SortDir = "asc" | "desc";

function sortCandidates(rows: SolarCandidate[], key: SortKey, dir: SortDir): SolarCandidate[] {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Solar({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const { data, error, loading } = useFetch<SolarResponse>("/api/intel/solar-candidates");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [age, setAge] = useState("");
  const [houseType, setHouseType] = useState("");
  const [carrier, setCarrier] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ageYears");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const candidates = data?.candidates ?? [];

  // Derive filter options from data
  const states = [...new Set(candidates.map((c) => c.state).filter((x): x is string => Boolean(x)))].sort();
  const houseTypes = [...new Set(candidates.map((c) => c.houseType).filter((x): x is string => Boolean(x)))].sort();
  const carriers = [...new Set(candidates.map((c) => c.carrier).filter((x): x is string => Boolean(x)))].sort();

  // Filtered rows
  let filtered = [...candidates];
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((c) =>
      (c.customer || "").toLowerCase().includes(q) ||
      (c.addressLine1 || "").toLowerCase().includes(q) ||
      (c.city || "").toLowerCase().includes(q) ||
      (c.carrier || "").toLowerCase().includes(q)
    );
  }
  if (state) filtered = filtered.filter((c) => c.state === state);
  if (age === "fresh") filtered = filtered.filter((c) => c.ageYears <= 3);
  else if (age === "mid") filtered = filtered.filter((c) => c.ageYears > 3 && c.ageYears <= 7);
  else if (age === "old") filtered = filtered.filter((c) => c.ageYears > 7);
  if (houseType) filtered = filtered.filter((c) => c.houseType === houseType);
  if (carrier) filtered = filtered.filter((c) => c.carrier === carrier);

  const sorted = sortCandidates(filtered, sortKey, sortDir);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  const arrow = (k: SortKey) =>
    sortKey === k ? <span style={{ color: ORANGE, marginLeft: 4 }}>{sortDir === "asc" ? "▲" : "▼"}</span> : null;

  // KPIs
  const fresh = candidates.filter((c) => c.ageYears <= 3).length;
  const mid = candidates.filter((c) => c.ageYears > 3 && c.ageYears <= 7).length;
  const withEmail = candidates.filter((c) => c.email).length;
  const withPhone = candidates.filter((c) => c.phone).length;

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>;
  if (error) return <div style={{ padding: 20, color: "#ef4444" }}>Failed: {error}</div>;

  return (
    <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700, color: ORANGE }}>
        Solar Candidate Funnel — Roof customers ready for solar mount
      </h2>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
        {([
          { label: "Total roof customers", value: candidates.length },
          { label: "Ideal solar candidates", value: fresh + mid, sub: "Roof age 1–7y" },
          { label: "Fresh roofs (≤3y)", value: fresh },
          { label: "Mid roofs (4–7y)", value: mid },
          { label: "With email", value: withEmail },
          { label: "With phone", value: withPhone },
        ] as { label: string; value: number; sub?: string }[]).map((k) => (
          <div key={k.label} style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ color: "var(--riq-text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{k.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: ORANGE, marginTop: 4 }}>{k.value.toLocaleString()}</div>
            {k.sub && <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Table section */}
      <div style={{ background: "var(--riq-surface)", border: "1px solid var(--riq-border)", borderRadius: 8, padding: "16px 20px" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600 }}>Customers with completed roof — ideal solar candidates</h3>
        <p style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
          Solar panels work best on roofs 1–7 years old. Sorted by roof age (newest first).
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="customer / city / carrier" style={{ ...inputStyle, width: 240 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>State</label>
            <select value={state} onChange={(e) => setState(e.target.value)} style={inputStyle}>
              <option value="">All</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Roof age</label>
            <select value={age} onChange={(e) => setAge(e.target.value)} style={inputStyle}>
              <option value="">All</option>
              <option value="fresh">Fresh (≤3y)</option>
              <option value="mid">Mid (4-7y)</option>
              <option value="old">Old (8y+)</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>House type</label>
            <select value={houseType} onChange={(e) => setHouseType(e.target.value)} style={inputStyle}>
              <option value="">All</option>
              {houseTypes.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)" }}>Carrier</label>
            <select value={carrier} onChange={(e) => setCarrier(e.target.value)} style={inputStyle}>
              <option value="">All</option>
              {carriers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button
            onClick={() => exportCSV(sorted)}
            style={{ background: ORANGE, color: "#1a1612", border: "none", borderRadius: 4, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
          >
            Export CSV for solar partner
          </button>
        </div>
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
          {sorted.length.toLocaleString()} candidates
        </div>
        <div style={{ maxHeight: 760, overflowY: "auto" }}>
          <table style={tblStyle}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => toggleSort("customer")}>Customer{arrow("customer")}</th>
                <th style={thStyle} onClick={() => toggleSort("addressLine1")}>Address{arrow("addressLine1")}</th>
                <th style={thStyle} onClick={() => toggleSort("state")}>St{arrow("state")}</th>
                <th style={thStyle} onClick={() => toggleSort("completedDate")}>Roof completed{arrow("completedDate")}</th>
                <th style={thNumStyle} onClick={() => toggleSort("ageYears")}>Age (y){arrow("ageYears")}</th>
                <th style={thNumStyle} onClick={() => toggleSort("jobTotal")}>Job ${arrow("jobTotal")}</th>
                <th style={thStyle} onClick={() => toggleSort("carrier")}>Carrier{arrow("carrier")}</th>
                <th style={thStyle} onClick={() => toggleSort("houseType")}>House{arrow("houseType")}</th>
                <th style={thStyle}>Contact</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 800).map((c, i) => {
                const ageCls = c.ageYears <= 3 ? "#10b981" : c.ageYears <= 7 ? "#f59e0b" : "var(--riq-accent)";
                const ageBg = c.ageYears <= 3 ? "rgba(16,185,129,0.2)" : c.ageYears <= 7 ? "rgba(245,158,11,0.2)" : "rgba(94,200,255,0.15)";
                return (
                  <tr key={i}>
                    <td style={tdStyle}><strong>{c.customer || "—"}</strong></td>
                    <td style={tdStyle}>
                      {c.addressLine1 || "—"}
                      <div style={{ color: "var(--riq-text-muted)", fontSize: 11 }}>{c.city} {c.zip}</div>
                    </td>
                    <td style={tdStyle}>{c.state || "—"}</td>
                    <td style={tdStyle}>{c.completedDate || "—"}</td>
                    <td style={tdNumStyle}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, background: ageBg, color: ageCls }}>
                        {c.ageYears.toFixed(1)}y
                      </span>
                    </td>
                    <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(c.jobTotal)}</td>
                    <td style={tdStyle}>{c.carrier || "—"}</td>
                    <td style={tdStyle}>{c.houseType || "—"}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11 }}>
                        {c.email || ""}
                        {c.email && c.phone ? <br /> : null}
                        {c.phone || ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
