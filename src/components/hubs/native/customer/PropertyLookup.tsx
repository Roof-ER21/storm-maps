/**
 * Customer Hub — Property Lookup tab (native React, Phase 2c)
 *
 * Replaces the iframe of public/property-lookup.html.
 *
 * Data flow (matches the HTML exactly):
 *   1. On lookup: US Census Geocoder API (client-side)
 *      GET https://geocoding.geo.census.gov/geocoder/locations/onelineaddress
 *      ?address=<addr>&benchmark=Public_AR_Current&format=json
 *   2. GET /api/intel/jobs-nearby?lat=<lat>&lng=<lng>&radius=0.5
 *   3. GET /api/intel/storms-light   → GeoJSON FeatureCollection; parsed client-side
 *      (loaded once on mount, same as HTML)
 *
 * Entity selection: address text input + "Look Up" button.
 * Map: real Leaflet map — target property (red circle), neighbor/own jobs
 *      (green=completed, red=dead, amber=open), storm points
 *      (purple=hail, red=tornado, amber=wind). Matches original HTML exactly.
 * No props — owns all state.
 */
import { useState, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import {
  KpiCard,
  CardRow,
  Panel,
  fmtMoney,
} from "../../../homes/HomeCommon";

// ---------------------------------------------------------------------------
// Type interfaces
// ---------------------------------------------------------------------------

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

interface StormFeatureProps {
  typetext?: string;
  magf?: number | null;
  magnitude?: number | null;
  unit?: string;
  valid?: string;
  city?: string;
  state?: string;
}

interface StormFeature {
  type: string;
  geometry: { type: string; coordinates: [number, number] };
  properties: StormFeatureProps;
}

interface StormsLightResponse {
  type?: string;
  features?: StormFeature[];
}

interface StormPoint {
  type: string;
  mag: number | null;
  unit: string | undefined;
  valid: string | undefined;
  city: string | undefined;
  state: string | undefined;
  lat: number;
  lng: number;
  distance?: number;
}

interface GeocodeResult {
  lat: number;
  lng: number;
  matchedAddress: string;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function isCompleted(j: NearbyJob): boolean {
  return /completed|finalized/i.test(j.stage ?? "");
}

function isDead(j: NearbyJob): boolean {
  return /dead|cancel/i.test(j.stage ?? "");
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.7613;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlam = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(address: string): Promise<GeocodeResult> {
  const url = `/api/intel/geocode?address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const body = await res.json() as {
    result?: { addressMatches?: Array<{ coordinates: { x: number; y: number }; matchedAddress: string }> };
  };
  const matches = body.result?.addressMatches ?? [];
  if (matches.length === 0) throw new Error("Address not found");
  return {
    lat: matches[0].coordinates.y,
    lng: matches[0].coordinates.x,
    matchedAddress: matches[0].matchedAddress,
  };
}

function parseCustKey(j: NearbyJob): string {
  return (
    (j.customer ?? "").toLowerCase() + "|" +
    (j.addressLine1 ?? "").toLowerCase() + "|" +
    (j.city ?? "").toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Shared table styles
// ---------------------------------------------------------------------------

const tblStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  color: "var(--riq-text-muted)",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  padding: "6px",
  borderBottom: "1px solid var(--riq-border)",
};

const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  padding: "6px",
  borderBottom: "1px solid var(--riq-bg)",
  verticalAlign: "top",
  fontSize: 13,
};

const tdNumStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const scrollBox: React.CSSProperties = { maxHeight: 400, overflowY: "auto" };

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

function StormPill({ type }: { type: string }) {
  const style: React.CSSProperties =
    type === "HAIL"
      ? { background: "rgba(168,139,250,0.2)", color: "#a78bfa" }
      : type === "TORNADO"
      ? { background: "rgba(239,68,68,0.2)", color: "#ef4444" }
      : { background: "rgba(94,200,255,0.2)", color: "var(--riq-accent)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 11,
        marginRight: 3,
        ...style,
      }}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Leaflet map — matches original property-lookup.html map section
// ---------------------------------------------------------------------------

function LookupMap({
  result,
}: {
  result: LookupResult;
}) {
  const { coords, ourJobs, neighborJobs, stormsHit } = result;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let localMap: L.Map | null = null;

    import("leaflet").then((Leaflet) => {
      if (!containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const map = Leaflet.map(containerRef.current, { preferCanvas: true }).setView(
        [coords.lat, coords.lng],
        14,
      );
      Leaflet.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        { attribution: "&copy; OSM &copy; CARTO", maxZoom: 19 },
      ).addTo(map);

      // Target property — red, matching original
      Leaflet.circleMarker([coords.lat, coords.lng], {
        radius: 12,
        fillColor: "#ef4444",
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9,
      })
        .bindPopup(`<strong>Target property</strong><br>${coords.matchedAddress}`)
        .addTo(map);

      // Our jobs + neighbor jobs (up to 80 neighbours, same as original)
      const allJobsToPlot = [...ourJobs, ...neighborJobs.slice(0, 80)];
      for (const j of allJobsToPlot) {
        if (!Number.isFinite(j.lat) || !Number.isFinite(j.lng)) continue;
        const c = isCompleted(j) ? "#10b981" : isDead(j) ? "#ef4444" : "#f4a738";
        Leaflet.circleMarker([j.lat, j.lng], {
          radius: 5,
          fillColor: c,
          color: "#fff",
          weight: 1,
          fillOpacity: 0.85,
        })
          .bindPopup(
            `<strong>${j.customer ?? "—"}</strong><br>${j.addressLine1 ?? ""}<br>` +
            `${j.insurance ?? ""} · ${j.stage ?? ""}`,
          )
          .addTo(map);
      }

      // Storm points (up to 100, same as original) — purple=hail, red=tornado, amber=wind
      for (const s of stormsHit.slice(0, 100)) {
        if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
        const c =
          s.type === "HAIL" ? "#a78bfa" : s.type === "TORNADO" ? "#ef4444" : "#f4a738";
        Leaflet.circleMarker([s.lat, s.lng], {
          radius: 4,
          fillColor: c,
          color: c,
          weight: 1,
          fillOpacity: 0.6,
        })
          .bindPopup(
            `<strong>${s.type}</strong> ${s.mag ?? ""} ${s.unit ?? ""}<br>` +
            `${(s.valid ?? "").slice(0, 10)}`,
          )
          .addTo(map);
      }

      mapRef.current = map;
      localMap = map;
    });

    return () => {
      if (localMap) {
        localMap.remove();
        mapRef.current = null;
      }
    };
  }, [coords, ourJobs, neighborJobs, stormsHit]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: 380,
        background: "var(--riq-bg)",
        border: "1px solid var(--riq-border)",
        borderRadius: 6,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Result panel
// ---------------------------------------------------------------------------

interface LookupResult {
  coords: GeocodeResult;
  ourJobs: NearbyJob[];
  neighborJobs: NearbyJob[];
  stormsHit: StormPoint[];
  neighborWins: number;
  topNeighborCarrier: [string, number] | null;
  recommendation: string;
}

function ResultPanel({ result }: { result: LookupResult }) {
  const { ourJobs, neighborJobs, stormsHit, neighborWins, topNeighborCarrier, recommendation } = result;

  const sortedOurJobs = [...ourJobs].sort((a, b) =>
    (b.signedDate ?? "").localeCompare(a.signedDate ?? "")
  );

  return (
    <div>
      {/* Recommendation */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600 }}>Quick Recommendation</h2>
        <div
          style={{
            background: "rgba(94,200,255,0.08)",
            borderLeft: "3px solid var(--riq-accent)",
            padding: "14px 18px",
            borderRadius: "0 6px 6px 0",
            fontSize: 14,
            lineHeight: 1.5,
          }}
          dangerouslySetInnerHTML={{ __html: recommendation }}
        />
      </div>

      {/* Jobs + Storms grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Left: jobs at address + neighbor KPIs */}
        <Panel title="Roof Docs history at this address">
          {ourJobs.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>
              No jobs at this exact property
            </div>
          ) : (
            <div style={scrollBox}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Customer</th>
                    <th style={thStyle}>Stage</th>
                    <th style={thStyle}>Carrier</th>
                    <th style={thStyle}>Rep</th>
                    <th style={thNumStyle}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOurJobs.map((j) => (
                    <tr key={j.id}>
                      <td style={tdStyle}>{j.signedDate ?? "—"}</td>
                      <td style={tdStyle}>
                        <a
                          href={`/customer-detail.html?k=${encodeURIComponent(parseCustKey(j))}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--riq-accent)" }}
                        >
                          {j.customer ?? "—"}
                        </a>
                      </td>
                      <td style={tdStyle}>{j.stage ?? "—"}</td>
                      <td style={tdStyle}>{j.insurance ?? "—"}</td>
                      <td style={tdStyle}>{j.salesRep ?? "—"}</td>
                      <td style={{ ...tdNumStyle, color: "#10b981" }}>{fmtMoney(j.jobTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2 style={{ margin: "20px 0 8px", fontSize: 13, fontWeight: 600 }}>
            Roof Docs neighbors within 0.5 mi
          </h2>
          <CardRow>
            <KpiCard label="Neighbor jobs" value={neighborJobs.length} />
            <KpiCard label="Approved" value={neighborWins} />
            <KpiCard
              label="Dominant carrier"
              value={topNeighborCarrier ? topNeighborCarrier[0] : "—"}
            />
          </CardRow>
        </Panel>

        {/* Right: storms */}
        <Panel title="Storms within 2 mi (last 5 years)">
          <CardRow>
            <KpiCard label="Strong storms" value={stormsHit.length} />
            <KpiCard label="Hail events" value={stormsHit.filter((s) => s.type === "HAIL").length} />
            <KpiCard
              label="Last 2 years"
              value={
                stormsHit.filter(
                  (s) =>
                    (Date.now() - new Date(s.valid ?? "").getTime()) / 86400000 < 730
                ).length
              }
            />
          </CardRow>
          <div style={{ marginTop: 12 }}>
            {stormsHit.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--riq-text-muted)" }}>
                No strong storms within 2 miles in last 5 years
              </div>
            ) : (
              <div style={scrollBox}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Mag</th>
                      <th style={thNumStyle}>Dist (mi)</th>
                      <th style={thStyle}>Where</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stormsHit.slice(0, 30).map((s, i) => (
                      <tr key={i}>
                        <td style={tdStyle}>{(s.valid ?? "").slice(0, 10)}</td>
                        <td style={tdStyle}>
                          <StormPill type={s.type} />
                        </td>
                        <td style={tdStyle}>{s.mag ?? "—"} {s.unit ?? ""}</td>
                        <td style={tdNumStyle}>{(s.distance ?? 0).toFixed(2)}</td>
                        <td style={tdStyle}>{s.city ?? ""}, {s.state ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* Leaflet map — matching original property-lookup.html */}
      <Panel title="Map">
        <LookupMap result={result} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PROP_RADIUS = 0.1;
const NEIGHBOR_RADIUS = 0.5;
const STORM_RADIUS = 2;

export function PropertyLookup() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Storm data — loaded once on mount (matches HTML behavior)
  const allStormsRef = useRef<StormPoint[]>([]);
  const stormsLoadedRef = useRef(false);

  useEffect(() => {
    if (stormsLoadedRef.current) return;
    stormsLoadedRef.current = true;
    fetch("/api/intel/storms-light", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data: StormsLightResponse | StormFeature[] | null) => {
        if (!data) return;
        const features: StormFeature[] = Array.isArray(data)
          ? (data as StormFeature[])
          : ((data as StormsLightResponse).features ?? []);
        allStormsRef.current = features
          .map((f) => {
            const p = f.properties ?? {};
            const c = f.geometry?.coordinates;
            if (!Array.isArray(c)) return null;
            return {
              type: p.typetext ?? "UNKNOWN",
              mag: p.magf != null ? Number(p.magf) : p.magnitude != null ? Number(p.magnitude) : null,
              unit: p.unit,
              valid: p.valid,
              city: p.city,
              state: p.state,
              lat: c[1] as number,
              lng: c[0] as number,
            } satisfies StormPoint;
          })
          .filter((x): x is StormPoint => x !== null);
      });
  }, []);

  async function handleLookup(addr: string) {
    const trimmed = addr.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    setStatus("Geocoding…");

    let coords: GeocodeResult;
    try {
      coords = await geocode(trimmed);
    } catch (e: unknown) {
      setStatus(`❌ ${(e as Error).message}`);
      setLoading(false);
      return;
    }

    setStatus(`Found ${coords.matchedAddress} (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`);

    let allNearby: NearbyJob[] = [];
    try {
      const res = await fetch(
        `/api/intel/jobs-nearby?lat=${coords.lat}&lng=${coords.lng}&radius=${NEIGHBOR_RADIUS}`,
        { credentials: "include" }
      );
      const json = (await res.json()) as JobsNearbyResponse;
      allNearby = json.jobs ?? [];
    } catch (e: unknown) {
      setStatus(`❌ jobs-nearby failed: ${(e as Error).message}`);
      setLoading(false);
      return;
    }

    const ourJobs = allNearby.filter((j) => j.distance <= PROP_RADIUS);
    const neighborJobs = allNearby.filter((j) => j.distance > PROP_RADIUS);

    // Storms within STORM_RADIUS miles, last 5 years
    const fiveYearsAgo = Date.now() - 5 * 365 * 86400000;
    const stormsHit: StormPoint[] = [];
    for (const s of allStormsRef.current) {
      const d = haversine(coords.lat, coords.lng, s.lat, s.lng);
      if (d > STORM_RADIUS) continue;
      const sd = new Date(s.valid ?? "").getTime();
      if (!Number.isFinite(sd) || sd < fiveYearsAgo) continue;
      stormsHit.push({ ...s, distance: d });
    }
    stormsHit.sort(
      (a, b) => new Date(b.valid ?? "").getTime() - new Date(a.valid ?? "").getTime()
    );

    const neighborWins = neighborJobs.filter(isCompleted).length;
    const neighborCarriers: Record<string, number> = {};
    for (const n of neighborJobs) {
      if (n.insurance) neighborCarriers[n.insurance] = (neighborCarriers[n.insurance] ?? 0) + 1;
    }
    const topNeighborCarrier =
      Object.entries(neighborCarriers).sort((a, b) => b[1] - a[1])[0] ?? null;

    // Recommendation (mirrors HTML logic exactly)
    let recommendation = "";
    if (ourJobs.length > 0) {
      const last = [...ourJobs].sort((a, b) =>
        (b.signedDate ?? "").localeCompare(a.signedDate ?? "")
      )[0];
      const k = encodeURIComponent(parseCustKey(last));
      recommendation = `<strong>Existing customer.</strong> ${ourJobs.length} job(s) at this property. Last: ${last.signedDate ?? "—"}. <a href="/customer-detail.html?k=${k}" style="color:var(--riq-accent)">Open customer detail →</a>`;
    } else if (stormsHit.length > 0 && neighborWins > 0) {
      const hail = stormsHit.filter((s) => s.type === "HAIL");
      recommendation = `<strong>Strong knock candidate.</strong> ${stormsHit.length} strong storm(s) within 2mi in last 5y (${hail.length} hail). ${neighborWins} approved Roof Docs jobs within 0.5mi (dominant carrier: ${topNeighborCarrier ? topNeighborCarrier[0] : "—"}). Pitch with most recent storm: ${(stormsHit[0].valid ?? "").slice(0, 10)} ${stormsHit[0].type} ${stormsHit[0].mag ?? ""} ${stormsHit[0].unit ?? ""}.`;
    } else if (stormsHit.length > 0) {
      recommendation = `<strong>Storm exposure detected.</strong> ${stormsHit.length} strong storm(s) within 2mi. No Roof Docs density nearby — virgin territory.`;
    } else if (neighborWins > 0) {
      recommendation = `<strong>Established neighborhood.</strong> ${neighborWins} approved Roof Docs jobs within 0.5mi. No recent strong storms. Cold canvass.`;
    } else {
      recommendation = `No Roof Docs activity within 0.5mi and no strong storms within 2mi in last 5y. Low-priority territory.`;
    }

    setResult({ coords, ourJobs, neighborJobs, stormsHit, neighborWins, topNeighborCarrier, recommendation });
    setLoading(false);
  }

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        color: "var(--riq-text)",
      }}
    >
      {/* Search section */}
      <div
        style={{
          background: "var(--riq-surface)",
          border: "1px solid var(--riq-border)",
          borderRadius: 8,
          padding: "16px 20px",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>Look up any address</h2>
        <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginBottom: 12 }}>
          Search for any property — in our book OR not. We'll show all Roof Docs history at this
          address, all storms within 2 miles since 2018, and a recommendation. Use full address:
          street, city, state.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={address}
            placeholder="e.g. 14312 Piccadilly Rd, Silver Spring, MD 20906"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLookup(address);
            }}
            style={{
              flex: 1,
              background: "var(--riq-bg)",
              color: "var(--riq-text)",
              border: "1px solid var(--riq-border)",
              borderRadius: 6,
              padding: "12px 16px",
              fontSize: 15,
              fontFamily: "inherit",
              outline: "none",
            }}
          />
          <button
            onClick={() => handleLookup(address)}
            disabled={loading}
            style={{
              background: loading ? "var(--riq-border)" : "var(--riq-accent)",
              color: "#1a1612",
              border: "none",
              borderRadius: 6,
              padding: "10px 22px",
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Looking up…" : "Look Up"}
          </button>
        </div>
        {status && (
          <div style={{ color: "var(--riq-text-muted)", fontSize: 12, marginTop: 8 }}>
            {status}
          </div>
        )}
      </div>

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}
