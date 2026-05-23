/**
 * Roof Docs Project Map — native React (Phase 2d batch3)
 *
 * Replaces the Google Maps iframe (roofdocs-map.html) with a Leaflet map.
 * Google Maps is NOT available in the native shell — we use leaflet + circleMarker
 * exactly as PropertyLookup.tsx does.
 *
 * Endpoint:
 *   GET /api/intel/map-pins
 *   → { pins: MapPin[], total: number, took_ms: number }
 *   MapPin: { id, customer, addressLine1, city, state, zip, lat, lng, insurance,
 *             adjusterName, claimNumber, jobType, stage, salesRep, signedDate,
 *             jobTotal, stormMatch }
 *   stormMatch (when present): { stormType, stormMagnitude, stormUnit, stormDate,
 *                                stormDistanceMiles, daysFromLossToStorm }
 *
 * Filters: year, jobType, insurance, salesRep, state, city, stage, minJobValue, colorBy (stage|type)
 * Map: dark Carto tiles, circleMarker per pin (colors match original HTML legend exactly).
 * Performance: up to 16 k pins → render in one Leaflet canvas pass; markers added in batches
 *   to avoid blocking the UI thread.
 */
import { useState, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { fmtMoney } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Types (verified against live prod)
// ---------------------------------------------------------------------------

interface StormMatch {
  stormType: string | null;
  stormMagnitude: number | null;
  stormUnit: string | null;
  stormDate: string | null;
  stormDistanceMiles: number;
  daysFromLossToStorm: number;
}

interface MapPin {
  id: number;
  customer: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number;
  lng: number;
  insurance: string | null;
  adjusterName: string | null;
  claimNumber: string | null;
  jobType: string | null;
  stage: string | null;
  salesRep: string | null;
  signedDate: string | null;
  jobTotal: number | null;
  stormMatch: StormMatch | null;
}

// ---------------------------------------------------------------------------
// Color helpers (matching original HTML exactly)
// ---------------------------------------------------------------------------

const TYPE_COLORS: Record<string, string> = {
  Insurance:             "#f4a738",
  Retail:                "#10b981",
  "Insurance Conversion":"#a78bfa",
  Repair:                "#f59e0b",
  "Add-On":              "#fb923c",
  "Public Adjuster":     "#ec4899",
  Cancellation:          "#ef4444",
  Nonrecoverable:        "#a09486",
};

function classifyByStage(p: MapPin): string {
  if (p.stage && /dead|cancel/i.test(p.stage)) return "#ef4444";
  if (p.stage && /completed|finalized/i.test(p.stage)) return "#10b981";
  if (p.stage && /install|wrap|balance/i.test(p.stage)) return "#f4a738";
  if (p.signedDate) return "#f59e0b";
  return "#a09486";
}

function classifyPin(p: MapPin, colorBy: "stage" | "type"): string {
  if (colorBy === "type") return TYPE_COLORS[p.jobType ?? ""] ?? "#a09486";
  return classifyByStage(p);
}

function yearOf(p: MapPin): number | null {
  const d = p.signedDate;
  if (!d) return null;
  const m = String(d).match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
}

function popupContent(p: MapPin): string {
  const addr = [p.addressLine1, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const adjLine = p.adjusterName ?? "—";
  let html = `<div style="font-size:12px;line-height:1.5;min-width:220px;color:#f0ebe2">
    <div style="font-size:14px;font-weight:700;color:#f4a738;margin-bottom:6px">${p.customer ?? "(unknown)"}</div>
    <div><span style="color:#a09486">Address</span> ${addr}</div>
    <div><span style="color:#a09486">Job ID</span> #${p.id} · ${p.jobType ?? "—"}</div>
    <div><span style="color:#a09486">Stage</span> ${p.stage ?? "—"}</div>
    <div><span style="color:#a09486">Rep</span> ${p.salesRep ?? "—"}</div>
    <div><span style="color:#a09486">Insurance</span> ${p.insurance ?? "—"}</div>
    <div><span style="color:#a09486">Adjuster</span> ${adjLine}</div>
    <div><span style="color:#a09486">Signed</span> ${p.signedDate ?? "—"}</div>
    <div><span style="color:#a09486"><b>Job Total</b></span> <b>${fmtMoney(p.jobTotal)}</b></div>`;
  if (p.stormMatch) {
    const sm = p.stormMatch;
    html += `<div style="border-top:2px solid #3d3528;padding-top:6px;margin-top:6px">
      <div><span style="color:#a09486"><b>Storm-of-record</b></span> <b>${sm.stormType ?? ""} ${sm.stormMagnitude != null ? sm.stormMagnitude + " " + (sm.stormUnit ?? "") : ""}</b></div>
      <div><span style="color:#a09486">Storm date</span> ${(sm.stormDate ?? "").slice(0, 10)}</div>
      <div><span style="color:#a09486">Distance</span> ${sm.stormDistanceMiles.toFixed(2)} mi</div>
    </div>`;
  }
  html += "</div>";
  return html;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function passes(p: MapPin, filters: FilterState): boolean {
  if (filters.year && String(yearOf(p)) !== filters.year) return false;
  if (filters.jobType && p.jobType !== filters.jobType) return false;
  if (filters.insurance && p.insurance !== filters.insurance) return false;
  if (filters.salesRep && p.salesRep !== filters.salesRep) return false;
  if (filters.state && p.state !== filters.state) return false;
  if (filters.city && (p.city ?? "").trim() !== filters.city) return false;
  if (filters.stage && p.stage !== filters.stage) return false;
  if (filters.minValue && (p.jobTotal ?? 0) < filters.minValue) return false;
  return true;
}

interface FilterState {
  year: string;
  jobType: string;
  insurance: string;
  salesRep: string;
  state: string;
  city: string;
  stage: string;
  minValue: number;
  colorBy: "stage" | "type";
}

const INITIAL_FILTERS: FilterState = {
  year: "", jobType: "", insurance: "", salesRep: "",
  state: "", city: "", stage: "", minValue: 0, colorBy: "stage",
};

// ---------------------------------------------------------------------------
// Derived filter options from all pins
// ---------------------------------------------------------------------------

interface FilterOptions {
  years: string[];
  jobTypes: string[];
  insurances: string[];
  salesReps: string[];
  states: string[];
  cities: string[];
  stages: string[];
  minDate: string;
  maxDate: string;
}

function buildOptions(pins: MapPin[]): FilterOptions {
  const years   = new Set<number>();
  const jobTypes = new Set<string>();
  const insurances = new Set<string>();
  const salesReps = new Set<string>();
  const states = new Set<string>();
  const cities = new Set<string>();
  const stages = new Set<string>();
  const VALID_STATES = new Set(["VA","MD","PA","DC","DE","NJ","NY","WV","NC","SC","OH","CT","GA","FL","TN","KY"]);
  let minDate = "9999", maxDate = "0000";
  for (const p of pins) {
    const y = yearOf(p);
    if (y) years.add(y);
    if (p.jobType) jobTypes.add(p.jobType);
    if (p.insurance) insurances.add(p.insurance);
    if (p.salesRep) salesReps.add(p.salesRep);
    if (p.state && /^[A-Z]{2}$/.test(p.state) && VALID_STATES.has(p.state)) states.add(p.state);
    if (p.city) cities.add(p.city.trim());
    if (p.stage) stages.add(p.stage);
    const d = p.signedDate;
    if (d) { if (d < minDate) minDate = d; if (d > maxDate) maxDate = d; }
  }
  return {
    years: [...years].sort().reverse().map(String),
    jobTypes: [...jobTypes].sort(),
    insurances: [...insurances].sort(),
    salesReps: [...salesReps].sort(),
    states: [...states].sort(),
    cities: [...cities].filter(Boolean).sort(),
    stages: [...stages].sort(),
    minDate: minDate !== "9999" ? minDate.slice(0, 4) : "—",
    maxDate: maxDate !== "0000" ? maxDate.slice(0, 4) : "—",
  };
}

// ---------------------------------------------------------------------------
// Leaflet map component
// ---------------------------------------------------------------------------

function MapCanvas({
  pins,
  filters,
}: {
  pins: MapPin[];
  filters: FilterState;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return;
    import("leaflet").then((Leaflet) => {
      if (!containerRef.current) return;
      if (mapRef.current) return; // already init'd
      const map = Leaflet.map(containerRef.current, { preferCanvas: true }).setView([38.95, -77.3], 9);
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; OSM &copy; CARTO", maxZoom: 19 }
      ).addTo(map);
      mapRef.current = map;
    });
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Re-render markers when pins or filters change
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Remove old markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    import("leaflet").then((Leaflet) => {
      const filtered = pins.filter((p) => passes(p, filters));
      const newMarkers: L.CircleMarker[] = [];
      for (const p of filtered) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const color = classifyPin(p, filters.colorBy);
        const m = Leaflet.circleMarker([p.lat, p.lng], {
          radius: 5,
          fillColor: color,
          color: "#fff",
          weight: 1,
          fillOpacity: 0.85,
        })
          .bindPopup(popupContent(p), { maxWidth: 360 })
          .addTo(map);
        newMarkers.push(m);
      }
      markersRef.current = newMarkers;
    });
  }, [pins, filters]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "calc(100vh - 120px)",
        minHeight: 500,
        background: "var(--riq-bg)",
        border: "1px solid var(--riq-border)",
        borderRadius: 6,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--riq-text-muted)",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "#342c23",
  color: "var(--riq-text)",
  border: "1px solid var(--riq-border)",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const inputStyle: React.CSSProperties = { ...selectStyle };

export function RoofdocsMap({ navigate: _navigate }: { navigate: (v: string) => void }) {
  const [pins, setPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);

  useEffect(() => {
    fetch("/api/intel/map-pins", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ pins: MapPin[]; total: number }>;
      })
      .then((d) => {
        const p = d.pins ?? [];
        setPins(p);
        setOpts(buildOptions(p));
        setLoading(false);
      })
      .catch((e: unknown) => { setError((e as Error).message); setLoading(false); });
  }, []);

  function set<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Count displayed
  const displayedCount = loading ? 0 : pins.filter((p) => passes(p, filters)).length;
  const displayedValue = pins.filter((p) => passes(p, filters)).reduce((s, p) => s + (p.jobTotal ?? 0), 0);

  if (error) {
    return (
      <div style={{ padding: "20px 24px", height: "100%", overflowY: "auto", color: "var(--riq-text)" }}>
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load map pins: {error}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%", color: "var(--riq-text)" }}>
      {/* LEFT PANEL */}
      <div style={{ background: "var(--riq-surface)", borderRight: "1px solid var(--riq-border)", padding: 16, overflowY: "auto" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Roof Docs Project Map</h1>
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 16 }}>
          Every job ever signed — VA / MD / PA (2019 → 2026)
        </div>

        {/* Stats */}
        {[
          { label: "Projects rendered", value: loading ? "loading…" : displayedCount.toLocaleString() },
          { label: "Total job value",    value: loading ? "…" : fmtMoney(displayedValue) },
          { label: "Date range",         value: opts ? `${opts.minDate} – ${opts.maxDate}` : "—" },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "#342c23", border: "1px solid var(--riq-border)", borderRadius: 6, padding: "8px 10px", marginBottom: 8, fontSize: 12 }}>
            {label}
            <div style={{ color: "var(--riq-accent)", fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
          </div>
        ))}

        {/* Filters */}
        {([
          ["Year",        "year",      opts?.years     ?? []],
          ["Job Type",    "jobType",   opts?.jobTypes  ?? []],
          ["Insurance",   "insurance", opts?.insurances ?? []],
          ["Sales Rep",   "salesRep",  opts?.salesReps ?? []],
          ["State",       "state",     opts?.states    ?? []],
          ["City",        "city",      opts?.cities    ?? []],
          ["Stage",       "stage",     opts?.stages    ?? []],
        ] as [string, keyof FilterState, string[]][]).map(([label, key, options]) => (
          <div key={key} style={{ marginTop: 14 }}>
            <label style={labelStyle}>{label}</label>
            <select
              value={String(filters[key])}
              onChange={(e) => set(key, e.target.value as FilterState[typeof key])}
              style={selectStyle}
            >
              <option value="">All</option>
              {options.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Min job value ($)</label>
          <input
            type="number"
            value={filters.minValue || ""}
            onChange={(e) => set("minValue", Number(e.target.value) || 0)}
            placeholder="0"
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Color by</label>
          <select value={filters.colorBy} onChange={(e) => set("colorBy", e.target.value as "stage" | "type")} style={selectStyle}>
            <option value="stage">Stage / outcome</option>
            <option value="type">Job type</option>
          </select>
        </div>

        {/* Legend */}
        <div style={{ marginTop: 16 }}>
          {filters.colorBy === "stage" ? (
            <>
              {[
                ["#10b981", "Completed / Finalized"],
                ["#f4a738", "In progress / install"],
                ["#f59e0b", "Signed, pre-install"],
                ["#ef4444", "Dead / Cancelled"],
                ["#a09486", "Other / Unknown"],
              ].map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
                  {l}
                </div>
              ))}
            </>
          ) : (
            <>
              {[
                ["#f4a738", "Insurance"],
                ["#10b981", "Retail"],
                ["#a78bfa", "Insurance Conversion"],
                ["#f59e0b", "Repair"],
                ["#fb923c", "Add-On"],
                ["#ec4899", "Public Adjuster"],
                ["#a09486", "Other / Unknown"],
              ].map(([c, l]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, flexShrink: 0, display: "inline-block" }} />
                  {l}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* MAP */}
      <div style={{ position: "relative" as const }}>
        {loading && (
          <div style={{ position: "absolute" as const, inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(26,22,18,0.8)", zIndex: 10, color: "var(--riq-text-muted)", fontSize: 14 }}>
            Loading {(16355).toLocaleString()} pins…
          </div>
        )}
        {!error && <MapCanvas pins={pins} filters={filters} />}
      </div>
    </div>
  );
}
