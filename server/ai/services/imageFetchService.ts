export interface StreetViewAngle {
  heading: number;
  buffer: Buffer;
  url: string;
  label: string; // "front", "right", "back", "left", "roof_closeup"
}

export interface PropertyImages {
  streetViewAngles: StreetViewAngle[]; // up to 5 angles
  streetView: Buffer | null; // primary (front-facing) for backward compat
  streetViewUrl: string | null;
  satellite: Buffer | null;
  satelliteUrl: string | null;
  satelliteCloseup: Buffer | null; // zoom 21 closeup of just the roof
  streetViewAvailable: boolean;
  streetViewDate: string | null;
}

/** Check Street View coverage, get capture date and camera position */
async function getStreetViewMeta(
  lat: number,
  lng: number,
  apiKey: string
): Promise<{
  available: boolean;
  date: string | null;
  cameraLat: number | null;
  cameraLng: number | null;
  panoId: string | null;
}> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/streetview/metadata"
  );
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { available: false, date: null, cameraLat: null, cameraLng: null, panoId: null };
    const data = await res.json();
    return {
      available: data.status === "OK",
      date: data.date || null,
      cameraLat: data.location?.lat || null,
      cameraLng: data.location?.lng || null,
      panoId: data.pano_id || null,
    };
  } catch {
    return { available: false, date: null, cameraLat: null, cameraLng: null, panoId: null };
  }
}

/**
 * Calculate the heading FROM a camera position TO the property.
 * This ensures the Street View image actually faces the building.
 */
function calculateHeading(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const dLng = ((toLng - fromLng) * Math.PI) / 180;
  const fromLatRad = (fromLat * Math.PI) / 180;
  const toLatRad = (toLat * Math.PI) / 180;

  const x = Math.sin(dLng) * Math.cos(toLatRad);
  const y =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLng);

  const heading = (Math.atan2(x, y) * 180) / Math.PI;
  return (heading + 360) % 360; // normalize to 0-360
}

/** Fetch a single Street View image at a specific heading and pitch */
async function fetchStreetViewAngle(
  lat: number,
  lng: number,
  heading: number,
  pitch: number,
  fov: number,
  apiKey: string,
  panoId?: string
): Promise<{ buffer: Buffer; url: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("size", "640x480");
  // Use pano_id if available for exact camera position
  if (panoId) {
    url.searchParams.set("pano", panoId);
  } else {
    url.searchParams.set("location", `${lat},${lng}`);
  }
  url.searchParams.set("heading", String(Math.round(heading)));
  url.searchParams.set("pitch", String(pitch));
  url.searchParams.set("fov", String(fov));
  url.searchParams.set("scale", "2");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), url: url.toString() };
  } catch {
    return null;
  }
}

/**
 * Fetch Street View angles aimed at the actual property.
 *
 * Instead of fixed N/S/E/W headings, we:
 * 1. Get the Street View camera's actual position from metadata
 * 2. Calculate the heading FROM camera TO the property coords
 * 3. Use that as the "front" heading, then offset ±90° and 180° for sides/back
 * 4. Add a roof closeup at +40° pitch aimed at the front
 *
 * This means the "front" image always shows the property, not the neighbor.
 */
async function fetchSmartStreetView(
  propertyLat: number,
  propertyLng: number,
  apiKey: string,
  cameraLat: number | null,
  cameraLng: number | null,
  panoId: string | null
): Promise<StreetViewAngle[]> {
  // Calculate the heading from camera to property
  let frontHeading: number;
  if (cameraLat && cameraLng) {
    frontHeading = calculateHeading(cameraLat, cameraLng, propertyLat, propertyLng);
  } else {
    frontHeading = 0; // fallback to north if no camera position
  }

  const angles = [
    { offset: 0, pitch: 20, fov: 80, label: "front" },
    { offset: 90, pitch: 20, fov: 80, label: "right" },
    { offset: 180, pitch: 15, fov: 80, label: "back" },
    { offset: 270, pitch: 20, fov: 80, label: "left" },
    // Roof closeup — aimed at building, higher pitch for roof detail
    { offset: 0, pitch: 40, fov: 60, label: "roof_closeup" },
  ];

  const results = await Promise.all(
    angles.map(async ({ offset, pitch, fov, label }) => {
      const heading = (frontHeading + offset) % 360;
      const result = await fetchStreetViewAngle(
        propertyLat,
        propertyLng,
        heading,
        pitch,
        fov,
        apiKey,
        panoId || undefined
      );
      if (!result) return null;
      return { heading, buffer: result.buffer, url: result.url, label };
    })
  );

  return results.filter((r): r is StreetViewAngle => r !== null);
}

/** Fetch satellite aerial view */
async function fetchSatellite(
  lat: number,
  lng: number,
  zoom: number,
  apiKey: string
): Promise<{ buffer: Buffer; url: string } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", "640x640");
  url.searchParams.set("maptype", "satellite");
  url.searchParams.set("scale", "2");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), url: url.toString() };
  } catch {
    return null;
  }
}

/** Fetch all property images: smart street view angles + 2 satellite zooms */
export async function fetchPropertyImages(
  lat: number,
  lng: number,
  apiKey: string
): Promise<PropertyImages> {
  // Get metadata first — we need camera position for smart heading
  const meta = await getStreetViewMeta(lat, lng, apiKey);

  const [streetViewAngles, satellite, satelliteCloseup] = await Promise.all([
    meta.available
      ? fetchSmartStreetView(lat, lng, apiKey, meta.cameraLat, meta.cameraLng, meta.panoId)
      : Promise.resolve([]),
    fetchSatellite(lat, lng, 20, apiKey).then(
      (r) => r || fetchSatellite(lat, lng, 19, apiKey)
    ),
    fetchSatellite(lat, lng, 21, apiKey), // ultra closeup for texture
  ]);

  // Primary street view = front angle for backward compat
  const primary =
    streetViewAngles.find((a) => a.label === "front") ||
    streetViewAngles[0] ||
    null;

  return {
    streetViewAngles,
    streetView: primary?.buffer ?? null,
    streetViewUrl: primary?.url ?? null,
    satellite: satellite?.buffer ?? null,
    satelliteUrl: satellite?.url ?? null,
    satelliteCloseup: satelliteCloseup?.buffer ?? null,
    streetViewAvailable: meta.available,
    streetViewDate: meta.date,
  };
}
