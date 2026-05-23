/**
 * Storm Hub — Intel tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/storm-intel.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. GET /api/intel/storms-light → GeoJSON FeatureCollection or flat array
 *      Normalized to StormEvent[]. Client-side filtering (window/type/mag/state).
 *   2. On storm select → GET /api/intel/jobs-nearby?lat=<lat>&lng=<lng>&radius=<radius>
 *      Returns { jobs: NearbyJob[]; total: number; radius: number; took_ms: number }
 *
 * Storm selection: internal picker (filter bar + list, auto-select first match).
 * Map: real Leaflet map with storm center (red circle) + nearby customers
 *      (green=completed, red=dead, amber=open). Matches the original HTML map exactly.
 * No props — owns all state.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import { useFetch, fmtMoney, KpiCard, CardRow } from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

// storms-light is a GeoJSON FeatureCollection or a plain array
interface StormFeature {
  id?: string | number;
  type?: string;
  geometry?: { type: string; coordinates: [number, number] };
  properties?: {
    valid?: string | null;
    typetext?: string | null;
    magf?: number | null;
    magnitude?: number | null;
    remark?: string | null;
    city?: string | null;
    county?: string | null;
    state?: string | null;
    source?: string | null;
  };
}

interface StormsLightResponse {
  type?: string;
  features?: StormFeature[];
  [key: string]: unknown;
}

interface StormEvent {
  stormId: string | number | null;
  valid: string | null;
  type: string;
  mag: number;
  unit: string;
  remark: string;
  city: string;
  county: string;
  state: string;
  source: string;
  lat: number | null;
  lng: number | null;
}

interface NearbyJob {
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
  salesRep: string | null;
  stage: string | null;
  jobType: string | null;
  signedDate: string | null;
  completedDate: string | null;
  jobTotal: number | null;
  customerEmail: string | null;
  customerCell: string | null;
  trades: string[];
  distance: number;
}

interface JobsNearbyResponse {
  jobs: NearbyJob[];
  total: number;
  radius: number;
  took_ms: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isCompleted = (j: NearbyJob) => /completed|finalized/i.test(j.stage ?? "");
const isDead = (j: NearbyJob) => /dead|cancel/i.test(j.stage ?? "");

function bucketStatus(j: NearbyJob): "completed" | "dead" | "open" {
  if (isCompleted(j)) return "completed";
  if (isDead(j)) return "dead";
  return "open";
}

function pillFor(t: string): string {
  if (t === "HAIL") return "hail";
  if (t === "TORNADO" || t === "FUNNEL CLOUD") return "tornado";
  return "wind";
}

function normalizeStorm(f: StormFeature): StormEvent {
  const p = f.properties ?? {};
  const t = (p.typetext ?? "").toUpperCase();
  const coords = f.geometry?.coordinates ?? [null, null];
  const stormType =
    t === "HAIL" || t === "TORNADO" || t === "FUNNEL CLOUD" || t.includes("WND") ? t : "";
  const mag =
    typeof p.magf === "number" ? p.magf : typeof p.magnitude === "number" ? p.magnitude : 0;
  return {
    stormId: f.id ?? null,
    valid: p.valid ?? null,
    type: stormType,
    mag,
    unit: stormType === "HAIL" ? "in" : stormType.includes("WND") ? "mph" : "",
    remark: p.remark ?? "",
    city: p.city ?? "",
    county: p.county ?? "",
    state: p.state ?? "",
    source: p.source ?? "",
    lat: coords[1] ?? null,
    lng: coords[0] ?? null,
  };
}

function isSignificantStorm(s: StormEvent): boolean {
  if (s.type === "HAIL" && s.mag >= 0.75) return true;
  if (s.type.includes("WND") && s.mag >= 55) return true;
  if (s.type === "TORNADO" || s.type === "FUNNEL CLOUD") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 10,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
  cursor: "pointer",
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--riq-surface)",
  fontSize: 12,
  verticalAlign: "top",
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

// ---------------------------------------------------------------------------
// Leaflet map component — matches original storm-intel.html renderMap()
// ---------------------------------------------------------------------------

function StormMap({
  storm,
  nearbyJobs,
}: {
  storm: StormEvent | null;
  nearbyJobs: NearbyJob[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current) return;
    import("leaflet").then((Leaflet) => {
      if (mapRef.current) return; // already created
      const map = Leaflet.map(containerRef.current!, { preferCanvas: true });
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; OSM &copy; CARTO", maxZoom: 19 },
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

  // Update markers when storm/nearbyJobs change
  useEffect(() => {
    if (!mapRef.current || !storm) return;
    const map = mapRef.current;

    // Remove previous data layers
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    import("leaflet").then((Leaflet) => {
      if (!mapRef.current) return;

      if (storm.lat == null || storm.lng == null) return;

      // Storm center — red, matching the original
      const stormCircle = Leaflet.circleMarker([storm.lat, storm.lng], {
        radius: 12,
        fillColor: "#ef4444",
        color: "#fff",
        weight: 2,
        fillOpacity: 0.95,
      })
        .bindPopup(
          `<strong>${storm.type} ${storm.mag || ""} ${storm.unit || ""}</strong><br>` +
          `${(storm.valid ?? "").slice(0, 16)}<br>${storm.city || ""}, ${storm.state || ""}`,
        )
        .addTo(map);
      layersRef.current.push(stormCircle);

      // Nearby customers — green=completed, red=dead, amber=open
      for (const j of nearbyJobs) {
        if (!Number.isFinite(j.lat) || !Number.isFinite(j.lng)) continue;
        const cls = isCompleted(j) ? "#10b981" : isDead(j) ? "#ef4444" : "#f4a738";
        const cm = Leaflet.circleMarker([j.lat, j.lng], {
          radius: 4,
          fillColor: cls,
          color: cls,
          weight: 1,
          fillOpacity: 0.8,
        })
          .bindPopup(
            `<strong>${j.customer ?? "—"}</strong><br>${j.addressLine1 ?? ""}<br>${j.insurance ?? ""}`,
          )
          .addTo(map);
        layersRef.current.push(cm);
      }

      map.setView([storm.lat, storm.lng], 11);
    });
  }, [storm, nearbyJobs]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: 540,
        background: "var(--riq-bg)",
        border: "1px solid var(--riq-border)",
        borderRadius: 6,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCustomerCSV(jobs: NearbyJob[], storm: StormEvent, bucket: string) {
  const headers = [
    "Customer", "Email", "Phone", "Address", "City", "State", "Zip",
    "Carrier", "Rep", "Stage", "DistanceMi", "JobTotal", "Trades",
    "StormDate", "StormType", "StormMag",
  ];
  const lines = [headers.join(",")];
  for (const j of jobs) {
    const row = [
      j.customer, j.customerEmail, j.customerCell,
      j.addressLine1, j.city, j.state, j.zip,
      j.insurance, j.salesRep, j.stage,
      j.distance.toFixed(2), Math.round(j.jobTotal ?? 0),
      (j.trades ?? []).join(";"),
      (storm.valid ?? "").slice(0, 10), storm.type, storm.mag,
    ].map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`));
    lines.push(row.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `storm-${(storm.valid ?? "").slice(0, 10)}-${storm.type}-${bucket}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Storm detail panel — fires jobs-nearby fetch
// ---------------------------------------------------------------------------

type SortKey = "customer" | "addressLine1" | "insurance" | "salesRep" | "stage" | "distance" | "jobTotal";

function StormDetail({
  storm,
  radius,
  onJobsLoaded,
}: {
  storm: StormEvent;
  radius: number;
  onJobsLoaded: (jobs: NearbyJob[]) => void;
}) {
  const [nearbyData, setNearbyData] = useState<JobsNearbyResponse | null>(null);
  const [nearbyErr, setNearbyErr] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [activeBucket, setActiveBucket] = useState<"all" | "completed" | "dead" | "open">("all");
  const [custSearch, setCustSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("distance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    if (storm.lat == null || storm.lng == null) return;
    setNearbyLoading(true);
    setNearbyData(null);
    setNearbyErr(null);
    fetch(
      `/api/intel/jobs-nearby?lat=${storm.lat}&lng=${storm.lng}&radius=${radius}`,
      { credentials: "include" },
    )
      .then((r) => r.json() as Promise<JobsNearbyResponse>)
      .then((d) => {
        setNearbyData(d);
        onJobsLoaded(d.jobs ?? []);
        setNearbyLoading(false);
      })
      .catch((e: unknown) => {
        setNearbyErr((e as Error).message ?? String(e));
        setNearbyLoading(false);
      });
  }, [storm, radius, onJobsLoaded]);

  const allJobs = nearbyData?.jobs ?? [];
  const completed = allJobs.filter(isCompleted);
  const dead = allJobs.filter(isDead);
  const open = allJobs.filter((j) => !isCompleted(j) && !isDead(j));
  const revenue = completed.reduce((s, j) => s + (j.jobTotal ?? 0), 0);

  const filteredJobs = useMemo(() => {
    let rows = allJobs;
    if (activeBucket !== "all") rows = rows.filter((j) => bucketStatus(j) === activeBucket);
    const q = custSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (j) =>
          (j.customer ?? "").toLowerCase().includes(q) ||
          (j.addressLine1 ?? "").toLowerCase().includes(q) ||
          (j.insurance ?? "").toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      const va = a[sortKey] as number | string | null;
      const vb = b[sortKey] as number | string | null;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [allJobs, activeBucket, custSearch, sortKey, sortDir]);

  const typeTag = pillFor(storm.type);
  const typeColor =
    typeTag === "hail" ? "#a78bfa" : typeTag === "tornado" ? "#ef4444" : "var(--riq-accent)";
  const typeBg =
    typeTag === "hail"
      ? "rgba(168,139,250,0.2)"
      : typeTag === "tornado"
      ? "rgba(239,68,68,0.2)"
      : "rgba(94,200,255,0.2)";

  const tabs: Array<{ id: "all" | "completed" | "dead" | "open"; label: string }> = [
    { id: "all", label: "All customers in storm area" },
    { id: "completed", label: "Completed (proof carrier paid)" },
    { id: "dead", label: "Dead (resurrection candidates)" },
    { id: "open", label: "Open / In-progress" },
  ];

  const COLS: Array<{ k: SortKey; l: string; num?: boolean; money?: boolean }> = [
    { k: "customer", l: "Customer" },
    { k: "addressLine1", l: "Address" },
    { k: "insurance", l: "Carrier" },
    { k: "salesRep", l: "Rep" },
    { k: "stage", l: "Stage" },
    { k: "distance", l: "Dist (mi)", num: true },
    { k: "jobTotal", l: "Total", num: true, money: true },
  ];

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  return (
    <div
      style={{
        background: "var(--riq-surface)",
        border: "1px solid var(--riq-border)",
        borderRadius: 8,
        padding: "16px 20px",
        marginTop: 16,
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--riq-text)" }}>
        {(storm.valid ?? "").slice(0, 10)} ·{" "}
        <span
          style={{
            display: "inline-block",
            background: typeBg,
            color: typeColor,
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          {storm.type}
        </span>{" "}
        {storm.mag || ""} {storm.unit || ""} · {storm.city}, {storm.state}
      </h2>

      {nearbyLoading && (
        <div style={{ padding: 20, textAlign: "center", color: "var(--riq-accent)", fontSize: 13 }}>
          Loading nearby jobs…
        </div>
      )}
      {nearbyErr && (
        <div style={{ padding: 20, color: "#ef4444", fontSize: 12 }}>
          Failed: {nearbyErr}
        </div>
      )}

      {!nearbyLoading && !nearbyErr && nearbyData && (
        <>
          <CardRow>
            <KpiCard label={`Customers within ${radius}mi`} value={allJobs.length} />
            <KpiCard label="Already approved" value={completed.length} hint={<span style={{ color: "#10b981" }}>{fmtMoney(revenue)}</span>} />
            <KpiCard label="Dead / cancelled" value={dead.length} />
            <KpiCard label="In progress" value={open.length} emphasis />
          </CardRow>

          {/* Bucket tabs */}
          <div
            style={{
              display: "flex",
              gap: 4,
              margin: "14px 0",
              borderBottom: "1px solid var(--riq-border)",
            }}
          >
            {tabs.map((t) => (
              <div
                key={t.id}
                onClick={() => setActiveBucket(t.id)}
                style={{
                  padding: "8px 16px",
                  cursor: "pointer",
                  color: t.id === activeBucket ? "var(--riq-accent)" : "var(--riq-text-muted)",
                  borderBottom: `2px solid ${t.id === activeBucket ? "var(--riq-accent)" : "transparent"}`,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Search + export */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
              Search
              <input
                type="text"
                placeholder="customer / address / carrier"
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
                style={{
                  width: 280,
                  background: "var(--riq-bg)",
                  color: "var(--riq-text)",
                  border: "1px solid var(--riq-border)",
                  borderRadius: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <button
              onClick={() => exportCustomerCSV(filteredJobs, storm, activeBucket)}
              style={{
                background: "var(--riq-accent)",
                color: "#1a1612",
                border: "none",
                borderRadius: 4,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Export pitch list CSV
            </button>
          </div>

          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 8 }}>
            {filteredJobs.length} customers · {activeBucket} bucket
          </div>

          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            <table style={tblStyle}>
              <thead>
                <tr>
                  {COLS.map((c) => (
                    <th
                      key={c.k}
                      style={{ ...thStyle, textAlign: c.num ? "right" : "left" }}
                      onClick={() => toggleSort(c.k)}
                    >
                      {c.l}
                      {sortKey === c.k && (
                        <span style={{ color: "var(--riq-accent)", marginLeft: 4 }}>
                          {sortDir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </th>
                  ))}
                  <th style={thStyle}>Contact</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.slice(0, 500).map((j) => {
                  const bkt = bucketStatus(j);
                  const bktColor =
                    bkt === "completed" ? "#10b981" : bkt === "dead" ? "#ef4444" : "var(--riq-accent)";
                  const bktBg =
                    bkt === "completed"
                      ? "rgba(16,185,129,0.2)"
                      : bkt === "dead"
                      ? "rgba(239,68,68,0.2)"
                      : "rgba(94,200,255,0.2)";
                  return (
                    <tr key={j.id}>
                      <td style={tdStyle}>
                        <strong>{j.customer ?? "—"}</strong>
                        <br />
                        <span
                          style={{
                            display: "inline-block",
                            background: bktBg,
                            color: bktColor,
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontSize: 11,
                          }}
                        >
                          {bkt.toUpperCase()}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {[j.addressLine1, j.city, j.state, j.zip].filter(Boolean).join(", ")}
                      </td>
                      <td style={tdStyle}>{j.insurance ?? "—"}</td>
                      <td style={tdStyle}>{j.salesRep ?? "—"}</td>
                      <td style={tdStyle}>{j.stage ?? "—"}</td>
                      <td style={tdNumStyle}>{j.distance.toFixed(2)}</td>
                      <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(j.jobTotal)}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11 }}>
                          {j.customerEmail ?? ""}
                          {j.customerEmail && j.customerCell ? <br /> : null}
                          {j.customerCell ?? ""}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function StormIntel() {
  const { data: rawData, loading, error } = useFetch<StormsLightResponse | StormFeature[]>(
    "/api/intel/storms-light",
  );

  const [windowMonths, setWindowMonths] = useState(24);
  const [typeFilter, setTypeFilter] = useState("");
  const [minHail, setMinHail] = useState(1.0);
  const [minWind, setMinWind] = useState(60);
  const [stateFilter, setStateFilter] = useState("");
  const [radius, setRadius] = useState(3);
  const [activeStorm, setActiveStorm] = useState<StormEvent | null>(null);
  const [mapJobs, setMapJobs] = useState<NearbyJob[]>([]);

  // Stable callback to avoid re-triggering the jobs fetch effect in StormDetail
  const handleJobsLoaded = useRef((jobs: NearbyJob[]) => setMapJobs(jobs));
  useEffect(() => {
    handleJobsLoaded.current = (jobs: NearbyJob[]) => setMapJobs(jobs);
  });
  // Also reset map jobs when storm changes so old markers don't linger
  useEffect(() => { setMapJobs([]); }, [activeStorm]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounce = (fn: () => void, ms: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fn, ms);
  };

  // Normalize all storms
  const allStorms = useMemo<StormEvent[]>(() => {
    if (!rawData) return [];
    const features = Array.isArray(rawData)
      ? rawData
      : ((rawData as StormsLightResponse).features ?? []);
    return (features as StormFeature[])
      .map(normalizeStorm)
      .filter(isSignificantStorm);
  }, [rawData]);

  // Apply filters
  const filteredStorms = useMemo<StormEvent[]>(() => {
    const cutoff = Date.now() - windowMonths * 30 * 86_400_000;
    return allStorms
      .filter((s) => {
        if (!s.valid) return false;
        const ts = new Date(s.valid).getTime();
        if (!Number.isFinite(ts) || ts < cutoff || ts > Date.now()) return false;
        if (stateFilter && s.state !== stateFilter) return false;
        if (typeFilter === "HAIL" && s.type !== "HAIL") return false;
        if (typeFilter === "WND" && !s.type.includes("WND")) return false;
        if (typeFilter === "TORNADO" && s.type !== "TORNADO") return false;
        const mag = s.mag ?? 0;
        if (s.type === "HAIL" && mag < minHail) return false;
        if (s.type.includes("WND") && mag < minWind) return false;
        return true;
      })
      .sort((a, b) => (b.valid ?? "").localeCompare(a.valid ?? ""));
  }, [allStorms, windowMonths, typeFilter, minHail, minWind, stateFilter]);

  // Auto-select first after filter
  useEffect(() => {
    if (filteredStorms.length > 0) {
      setActiveStorm((prev) => {
        if (prev && filteredStorms.includes(prev)) return prev;
        return filteredStorms[0];
      });
    } else {
      setActiveStorm(null);
    }
  }, [filteredStorms]);

  const pillColor = (t: string) => {
    const p = pillFor(t);
    if (p === "hail") return { color: "#a78bfa", bg: "rgba(168,139,250,0.2)" };
    if (p === "tornado") return { color: "#ef4444", bg: "rgba(239,68,68,0.2)" };
    return { color: "var(--riq-accent)", bg: "rgba(94,200,255,0.2)" };
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--riq-bg)",
    color: "var(--riq-text)",
    border: "1px solid var(--riq-border)",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
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
        <div style={{ padding: 40, textAlign: "center", color: "var(--riq-accent)" }}>Loading…</div>
      )}
      {error && (
        <div style={{ padding: 20, color: "#ef4444" }}>Failed to load storms: {error}</div>
      )}
      {!loading && !error && (
        <>
          {/* Filter bar */}
          <div
            style={{
              background: "var(--riq-surface)",
              border: "1px solid var(--riq-border)",
              borderRadius: 8,
              padding: "16px 20px",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Storm window (months back)
                <input
                  type="number"
                  value={windowMonths}
                  min={1}
                  max={96}
                  style={{ ...inputStyle, width: 90 }}
                  onChange={(e) => debounce(() => setWindowMonths(Number(e.target.value) || 24), 200)}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Storm type
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}>
                  <option value="">All</option>
                  <option value="HAIL">Hail</option>
                  <option value="WND">Wind</option>
                  <option value="TORNADO">Tornado</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min hail (in)
                <input
                  type="number"
                  step={0.25}
                  value={minHail}
                  style={{ ...inputStyle, width: 80 }}
                  onChange={(e) => debounce(() => setMinHail(Number(e.target.value) || 0), 200)}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                Min wind (mph)
                <input
                  type="number"
                  value={minWind}
                  style={{ ...inputStyle, width: 80 }}
                  onChange={(e) => debounce(() => setMinWind(Number(e.target.value) || 0), 200)}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                State
                <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={inputStyle}>
                  <option value="">All</option>
                  {["VA", "MD", "PA", "DC"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Storm list + count */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr",
                gap: 16,
                marginTop: 16,
                alignItems: "start",
              }}
            >
              <div>
                <h2 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--riq-text)" }}>
                  {filteredStorms.length.toLocaleString()} storms in window
                </h2>
                <div style={{ maxHeight: 540, overflowY: "auto" }}>
                  {filteredStorms.slice(0, 400).map((s, i) => {
                    const { color, bg } = pillColor(s.type);
                    return (
                      <div
                        key={i}
                        onClick={() => setActiveStorm(s)}
                        style={{
                          padding: "10px 12px",
                          border: `1px solid ${s === activeStorm ? "var(--riq-accent)" : "var(--riq-border)"}`,
                          background: s === activeStorm ? "rgba(244,167,56,0.08)" : "transparent",
                          borderRadius: 6,
                          marginBottom: 6,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ color: "var(--riq-accent)", fontWeight: 600, fontSize: 13 }}>
                          {(s.valid ?? "").slice(0, 10)}
                        </div>
                        <div style={{ color: "var(--riq-text-muted)", fontSize: 11, marginTop: 2 }}>
                          <span
                            style={{
                              display: "inline-block",
                              background: bg,
                              color,
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: 11,
                              marginRight: 6,
                            }}
                          >
                            {s.type}
                          </span>
                          {s.mag || "—"} {s.unit || ""} · {s.city || ""}, {s.state || ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Map column — radius control + live Leaflet map */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                  <label style={{ fontSize: 12, color: "var(--riq-text-muted)", display: "flex", flexDirection: "column", gap: 4 }}>
                    Radius (mi)
                    <input
                      type="number"
                      value={radius}
                      step={0.5}
                      min={0.5}
                      max={50}
                      style={{ ...inputStyle, width: 80 }}
                      onChange={(e) => setRadius(Number(e.target.value) || 3)}
                    />
                  </label>
                  {!activeStorm && (
                    <div style={{ fontSize: 13, color: "var(--riq-text-muted)" }}>
                      Select a storm to load the map.
                    </div>
                  )}
                </div>
                {/* The map always renders; StormMap handles null storm gracefully */}
                <StormMap storm={activeStorm} nearbyJobs={mapJobs} />
              </div>
            </div>
          </div>

          {/* Detail panel */}
          {activeStorm && (
            <StormDetail
              key={`${activeStorm.stormId}-${radius}`}
              storm={activeStorm}
              radius={radius}
              onJobsLoaded={handleJobsLoaded.current}
            />
          )}
        </>
      )}
    </div>
  );
}
