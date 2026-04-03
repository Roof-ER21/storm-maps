/**
 * NWS Active Alerts Service
 *
 * Polls api.weather.gov for active severe thunderstorm warnings
 * that mention hail. Free, no API key required.
 * Docs: https://www.weather.gov/documentation/services-web-api
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NWS_BASE = 'https://api.weather.gov';
const NWS_HEADERS = { 'User-Agent': '(HailYes, contact@roofer21.com)' };
const REQUEST_TIMEOUT_MS = 15_000;

/** Minimum hail size (inches) that qualifies as a match. */
const MIN_HAIL_INCHES = 0.25;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface NwsAlert {
  /** Unique alert identifier (UGC or UUID string from the NWS API). */
  id: string;
  /** One-line headline such as "Severe Thunderstorm Warning issued…" */
  headline: string;
  /** Human-readable area description, e.g. "Southern Cook; Northern Will". */
  areaDesc: string;
  /** Maximum hail size in inches parsed from the alert parameters/description. */
  maxHailInches: number;
  /** Maximum wind gust in mph parsed from the alert parameters, or null if not reported. */
  maxWindMph: number | null;
  /** ISO 8601 onset time for the warning period. */
  onset: string;
  /** ISO 8601 expiration time for the warning period. */
  expires: string;
  /** True when the current time is between onset and expires. */
  isActive: boolean;
  /**
   * GeoJSON geometry of the warning polygon/multipolygon.
   * May be null for point-based alerts.
   */
  geometry: NwsGeometry | null;
}

/** Minimal GeoJSON geometry subset covering Polygon and MultiPolygon. */
export type NwsGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Point'; coordinates: [number, number] };

// ---------------------------------------------------------------------------
// Internal NWS API types
// ---------------------------------------------------------------------------

interface NwsApiAlertProperties {
  '@id'?: string;
  id?: string;
  event: string;
  headline?: string | null;
  description?: string | null;
  areaDesc?: string | null;
  onset?: string | null;
  expires?: string | null;
  parameters?: {
    maxHailSize?: string[];
    maxWindGust?: string[];
    [key: string]: unknown;
  } | null;
}

interface NwsApiFeature {
  id?: string;
  geometry?: NwsGeometry | null;
  properties: NwsApiAlertProperties;
}

interface NwsApiResponse {
  features?: NwsApiFeature[];
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse hail size from the maxHailSize parameter array.
 * The API returns values like ["1.75"] or ["1.00 IN"].
 */
function parseMaxHailParam(maxHailSize?: string[] | null): number | null {
  if (!maxHailSize || maxHailSize.length === 0) return null;
  const raw = maxHailSize[0];
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) ? val : null;
}

/**
 * Scan the description text for a hail size mention.
 * Looks for patterns like "HAIL...2.00 IN", "HAIL UP TO 1 3/4 INCHES", etc.
 */
function extractHailFromDescription(description: string | null | undefined): number | null {
  if (!description) return null;

  const upper = description.toUpperCase();

  // Pattern 1: "HAIL...X.XX IN" or "HAIL...X IN"
  const dotPattern = upper.match(/HAIL[. ]+(\d+(?:\.\d+)?)\s*IN/);
  if (dotPattern) {
    const val = parseFloat(dotPattern[1]);
    if (Number.isFinite(val)) return val;
  }

  // Pattern 2: fractional inches like "1 3/4 INCH" or "1 3/4 IN"
  const fracPattern = upper.match(/(\d+)\s+(\d+)\/(\d+)\s*(?:INCH|IN)/);
  if (fracPattern) {
    const whole = parseInt(fracPattern[1], 10);
    const num = parseInt(fracPattern[2], 10);
    const den = parseInt(fracPattern[3], 10);
    if (den !== 0) {
      const val = whole + num / den;
      if (Number.isFinite(val)) return val;
    }
  }

  // Pattern 3: "X.XX-INCH HAIL" or "X INCH HAIL"
  const inchFirst = upper.match(/(\d+(?:\.\d+)?)-?INCH\s+HAIL/);
  if (inchFirst) {
    const val = parseFloat(inchFirst[1]);
    if (Number.isFinite(val)) return val;
  }

  return null;
}

/**
 * Parse wind gust from the maxWindGust parameter array.
 * The API returns values like ["55MPH"] or ["55 MPH"].
 */
function parseMaxWindParam(maxWindGust?: string[] | null): number | null {
  if (!maxWindGust || maxWindGust.length === 0) return null;
  const raw = maxWindGust[0];
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return Number.isFinite(val) ? val : null;
}

/**
 * Returns true if the description text contains the word "HAIL".
 */
function descriptionMentionsHail(description: string | null | undefined): boolean {
  return Boolean(description && description.toUpperCase().includes('HAIL'));
}

/**
 * Convert one NWS API feature to an NwsAlert, returning null when the alert
 * does not meet the hail threshold.
 */
function mapFeatureToAlert(feature: NwsApiFeature): NwsAlert | null {
  const props = feature.properties;
  const description = props.description ?? null;

  // Determine hail size — prefer the structured parameter, fall back to text parsing.
  const paramHail = parseMaxHailParam(props.parameters?.maxHailSize);
  const descHail = extractHailFromDescription(description);
  const maxHailInches = paramHail ?? descHail ?? 0;

  // Require at least MIN_HAIL_INCHES and that "HAIL" appears somewhere.
  const hasHail =
    maxHailInches >= MIN_HAIL_INCHES || descriptionMentionsHail(description);
  if (!hasHail || maxHailInches < MIN_HAIL_INCHES) return null;

  const now = Date.now();
  const onsetMs = props.onset ? new Date(props.onset).getTime() : 0;
  const expiresMs = props.expires ? new Date(props.expires).getTime() : Infinity;
  const isActive = now >= onsetMs && now < expiresMs;

  // Resolve the alert ID — prefer the @id URL, then id field, then the feature id.
  const rawId = props['@id'] ?? props.id ?? feature.id ?? '';
  // Extract a compact identifier from the URL if present.
  const id = rawId.includes('/')
    ? rawId.slice(rawId.lastIndexOf('/') + 1)
    : rawId || `nws-${Date.now()}`;

  return {
    id,
    headline: props.headline ?? props.event ?? 'Severe Thunderstorm Warning',
    areaDesc: props.areaDesc ?? '',
    maxHailInches,
    maxWindMph: parseMaxWindParam(props.parameters?.maxWindGust),
    onset: props.onset ?? '',
    expires: props.expires ?? '',
    isActive,
    geometry: feature.geometry ?? null,
  };
}

function buildTimeoutSignal(signal?: AbortSignal): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch all currently active Severe Thunderstorm Warning alerts from NWS,
 * filtered to those that mention hail >= 0.25".
 *
 * Endpoint:
 *   GET https://api.weather.gov/alerts/active
 *       ?event=Severe%20Thunderstorm%20Warning
 *       &status=actual
 *       &message_type=alert
 *
 * @param signal Optional AbortSignal to cancel the request.
 * @returns Array of NwsAlert objects sorted by maxHailInches descending.
 */
export async function fetchActiveHailAlerts(signal?: AbortSignal): Promise<NwsAlert[]> {
  const params = new URLSearchParams({
    event: 'Severe Thunderstorm Warning',
    status: 'actual',
    message_type: 'alert',
  });

  const url = `${NWS_BASE}/alerts/active?${params.toString()}`;

  const res = await fetch(url, {
    headers: NWS_HEADERS,
    signal: buildTimeoutSignal(signal),
  });

  if (!res.ok) {
    throw new Error(`NWS Alerts API returned ${res.status} ${res.statusText}`);
  }

  const data: NwsApiResponse = await res.json();
  const features = data.features ?? [];

  const alerts: NwsAlert[] = [];
  for (const feature of features) {
    const alert = mapFeatureToAlert(feature);
    if (alert) alerts.push(alert);
  }

  // Sort highest hail first so callers can quickly find the most severe.
  alerts.sort((a, b) => b.maxHailInches - a.maxHailInches);
  return alerts;
}

/**
 * Fetch active Severe Thunderstorm Warning alerts that affect the grid point
 * nearest to the supplied coordinates. Only alerts mentioning hail >= 0.25"
 * are returned.
 *
 * Endpoint:
 *   GET https://api.weather.gov/alerts/active?point={lat},{lng}
 *
 * Note: The NWS /alerts/active?point= endpoint filters to alerts whose
 * polygon contains (or is associated with) that forecast zone. It does NOT
 * filter by a geographic radius — use fetchActiveHailAlerts() with your own
 * geometry check when you need precise distance filtering.
 *
 * @param lat          Latitude in decimal degrees.
 * @param lng          Longitude in decimal degrees.
 * @param _radiusMiles Reserved for future use; the NWS point endpoint does
 *                     not accept a radius parameter.
 * @param signal       Optional AbortSignal.
 * @returns Array of NwsAlert objects sorted by maxHailInches descending.
 */
export async function fetchAlertsByArea(
  lat: number,
  lng: number,
  _radiusMiles?: number,
  signal?: AbortSignal,
): Promise<NwsAlert[]> {
  // NWS expects up to 4 decimal places for point coordinates.
  const latStr = lat.toFixed(4);
  const lngStr = lng.toFixed(4);
  const url = `${NWS_BASE}/alerts/active?point=${latStr},${lngStr}`;

  const res = await fetch(url, {
    headers: NWS_HEADERS,
    signal: buildTimeoutSignal(signal),
  });

  if (!res.ok) {
    // 404 means the point is outside US coverage — return empty gracefully.
    if (res.status === 404) return [];
    throw new Error(`NWS Alerts API (point) returned ${res.status} ${res.statusText}`);
  }

  const data: NwsApiResponse = await res.json();
  const features = data.features ?? [];

  const alerts: NwsAlert[] = [];
  for (const feature of features) {
    const alert = mapFeatureToAlert(feature);
    if (alert) alerts.push(alert);
  }

  alerts.sort((a, b) => b.maxHailInches - a.maxHailInches);
  return alerts;
}
