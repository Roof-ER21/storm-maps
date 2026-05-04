/**
 * NWS VTEC warnings (Severe Thunderstorm / Tornado / Flash Flood) via IEM.
 *
 * IEM mirrors every NWS VTEC product issued back to ~2002. We fetch them
 * by Eastern calendar day for the property's WFO region (radius around
 * the lat/lng) and surface them in the adjuster PDF + consilience score.
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py
 *     ?year1=Y&month1=M&day1=D&year2=Y&month2=M&day2=D&hour1=0&minute1=0
 *     &hour2=23&minute2=59&format=geojson
 *
 * No token required. ~5s typical latency.
 */

// IEM v1 API endpoint that returns SBW (storm-based warning) polygons in
// proper GeoJSON. Replaces the deprecated cgi-bin/request/gis/watchwarn.py
// pipeline, which switched to shapefile-only output sometime in 2026
// (the `format=geojson` param now returns 200 OK with a ZIP body, not
// JSON — silently broke our "Property inside NWS warning?" check.)
//
// Docs: https://mesonet.agron.iastate.edu/api/1/docs#/vtec/get_vtec_sbw_interval
const IEM_SBW_BASE = "https://mesonet.agron.iastate.edu/api/1/vtec/sbw_interval.geojson";
const FETCH_TIMEOUT_MS = 12_000;

export interface NwsWarning {
  /** WFO + product (e.g. "LWX-SV"). */
  id: string;
  /** "Severe Thunderstorm Warning" / "Tornado Warning" / "Flash Flood Warning". */
  phenomenon: string;
  /** Plain-English title. */
  title: string;
  /** ISO timestamp of issuance. */
  issued_at: string;
  /** ISO timestamp of expiration. */
  expires_at: string;
  /** Issuing forecast office (e.g. "LWX"). */
  wfo: string;
  /** Hail size in inches (parsed from VTEC fields when present). */
  hail_size_inches: number | null;
  /** Wind gust mph. */
  wind_mph: number | null;
  /** Tornado damage indicator (NWS DAM tag). */
  tornado_damage: string | null;
  /** Free-form NWS narrative text. */
  narrative: string;
  /** Polygon GeoJSON if available — for map renders. */
  polygon: { type: "Polygon"; coordinates: number[][][] } | null;
  /** True if the property point is inside the warning polygon. */
  contains_property: boolean;
  /** VTEC string (e.g. "/O.NEW.KLWX.SV.W.0123.260401T2343Z-260402T0030Z/"). */
  vtec: string | null;
}

// IEM /api/1/vtec/sbw_interval.geojson uses lower-case property keys.
interface VtecRawFeature {
  type: "Feature";
  properties: {
    phenomena?: string;         // "SV" (severe TS), "TO" (tornado), "FF" (flash flood)
    significance?: string;      // "W" (warning), "A" (watch), "Y" (advisory)
    wfo?: string;
    issue?: string;             // ISO 8601
    expire?: string;
    hailtag?: string | number;
    windtag?: string | number;
    tornadotag?: string;
    damagtag?: string;
    product_id?: string;
    eventid?: number;
    // Legacy keys preserved so we don't break if IEM ever flips back
    PHENOM?: string;
    SIG?: string;
    WFO?: string;
    ISSUED?: string;
    EXPIRED?: string;
    HAILTAG?: string;
    WINDTAG?: string;
    TORNADOTAG?: string;
    DAMAGTAG?: string;
    PRODUCT_ID?: string;
    URL?: string;
    HVTEC_NWSLI?: string;
  };
  geometry?: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const PHENOM_LABEL: Record<string, string> = {
  SV: "Severe Thunderstorm",
  TO: "Tornado",
  FF: "Flash Flood",
  TR: "Tropical Storm",
  HU: "Hurricane",
};

const SIG_LABEL: Record<string, string> = {
  W: "Warning", A: "Watch", Y: "Advisory",
};

function parseTagFloat(tag: string | undefined): number | null {
  if (!tag) return null;
  const m = String(tag).match(/[\d.]+/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return Number.isFinite(v) ? v : null;
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    const xi = a[0]!, yi = a[1]!, xj = b[0]!, yj = b[1]!;
    const intersect =
      (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeom(lat: number, lng: number, geom: VtecRawFeature["geometry"]): boolean {
  if (!geom) return false;
  if (geom.type === "Polygon") {
    const polygons = geom.coordinates as number[][][];
    if (polygons.length === 0) return false;
    return pointInRing(lat, lng, polygons[0]!);
  }
  if (geom.type === "MultiPolygon") {
    const polygons = geom.coordinates as number[][][][];
    return polygons.some((p) => p.length > 0 && pointInRing(lat, lng, p[0]!));
  }
  return false;
}

/**
 * Fetch every NWS VTEC product whose polygon contains (lat, lng) on the
 * given Eastern calendar date. Returns warnings + watches + advisories.
 */
export async function fetchNwsWarningsForDateAndPoint(opts: {
  date: string;          // YYYY-MM-DD (ET)
  lat: number;
  lng: number;
  /** Bounding box pad miles for IEM query. Default 0 — point query. */
  padMiles?: number;
}): Promise<NwsWarning[]> {
  const [year, month, day] = opts.date.split("-").map(Number);
  if (!year || !month || !day) return [];

  const sts = `${opts.date}T00:00:00Z`;
  const ets = `${opts.date}T23:59:59Z`;
  const params = new URLSearchParams({
    sts, ets,
    only_new: "true",   // dedupe so we don't see updates as separate warnings
  });
  const url = `${IEM_SBW_BASE}?${params.toString()}`;
  let json: { features?: VtecRawFeature[] };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "storm-archive/0.2 (storm-intelligence)" },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    json = (await res.json()) as { features?: VtecRawFeature[] };
  } catch {
    return [];
  }

  const features = json.features ?? [];
  const out: NwsWarning[] = [];
  for (const f of features) {
    // Accept both new lower-case and legacy upper-case property keys.
    const phen = (f.properties.phenomena ?? f.properties.PHENOM ?? "").toUpperCase();
    const sig = (f.properties.significance ?? f.properties.SIG ?? "").toUpperCase();
    const wfo = f.properties.wfo ?? f.properties.WFO ?? "";
    const issued = f.properties.issue ?? f.properties.ISSUED ?? "";
    const expired = f.properties.expire ?? f.properties.EXPIRED ?? "";
    const hailtag = f.properties.hailtag ?? f.properties.HAILTAG;
    const windtag = f.properties.windtag ?? f.properties.WINDTAG;
    const tornadoTag = f.properties.tornadotag ?? f.properties.TORNADOTAG ?? null;
    const productId = f.properties.product_id ?? f.properties.PRODUCT_ID ?? "";

    if (!["W", "A", "Y"].includes(sig)) continue;
    // Surface only the products reps actually care about
    if (!["SV", "TO", "FF", "TR", "HU"].includes(phen)) continue;

    const contains = pointInGeom(opts.lat, opts.lng, f.geometry);
    if (!contains) continue;

    const phenomenonLabel = PHENOM_LABEL[phen] ?? phen;
    const sigLabel = SIG_LABEL[sig] ?? sig;
    const title = `${phenomenonLabel} ${sigLabel}`;

    const polygon = f.geometry?.type === "Polygon"
      ? { type: "Polygon" as const, coordinates: f.geometry.coordinates as number[][][] }
      : null;

    out.push({
      id: `${wfo}-${phen}.${sig}-${issued.slice(0, 16)}`,
      phenomenon: phenomenonLabel,
      title,
      issued_at: issued,
      expires_at: expired,
      wfo,
      hail_size_inches: parseTagFloat(typeof hailtag === "number" ? String(hailtag) : hailtag),
      wind_mph: parseTagFloat(typeof windtag === "number" ? String(windtag) : windtag),
      tornado_damage: tornadoTag,
      narrative: productId,
      polygon,
      contains_property: true,
      vtec: f.properties.HVTEC_NWSLI ?? null,
    });
  }

  // Sort by issuance time, most recent first
  out.sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  return out;
}
