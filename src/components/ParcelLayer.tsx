/**
 * ParcelLayer — outlines the searched property's lot polygon on the map.
 *
 * Renders only when the searched property falls inside a county we have
 * an ArcGIS parcel endpoint for (currently DC + 7 NoVA / Maryland
 * counties). Outside coverage the layer stays empty — silent fallthrough.
 *
 * Visual: dashed orange outline + tiny fill. Distinguishes the actual
 * lot from the search-radius circle and the property pin.
 */

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

interface ParcelLayerProps {
  /** Searched property location — null hides the layer. */
  lat: number | null;
  lng: number | null;
}

interface ParcelGeometry {
  rings: number[][][];
  /** OSM tag — "house", "residential", "yes", etc. */
  buildingType?: string;
  osmId?: number;
  centroid: { lat: number; lng: number };
  source?: string;
}

export default function ParcelLayer({ lat, lng }: ParcelLayerProps): null {
  const map = useMap();
  const [parcel, setParcel] = useState<ParcelGeometry | null>(null);
  const polysRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (lat === null || lng === null) {
      setParcel((prev) => (prev === null ? prev : null));
      return;
    }
    let cancelled = false;
    fetch(`/api/property/parcel?lat=${lat}&lng=${lng}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { parcel?: ParcelGeometry | null }) => {
        if (cancelled) return;
        setParcel(data.parcel ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[ParcelLayer] fetch failed:', (err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  useEffect(() => {
    if (!map) return;
    for (const p of polysRef.current) p.setMap(null);
    polysRef.current = [];
    if (!parcel) return;

    for (const ring of parcel.rings) {
      // ArcGIS rings are [lng, lat]; google.maps.Polygon takes {lat, lng}.
      const path = ring
        .filter((v) => Number.isFinite(v[0]) && Number.isFinite(v[1]))
        .map(([rLng, rLat]) => ({ lat: rLat, lng: rLng }));
      if (path.length < 3) continue;
      const polygon = new google.maps.Polygon({
        map,
        paths: path,
        strokeColor: '#f97316',
        strokeOpacity: 0.85,
        strokeWeight: 2,
        // Dashed look via a low-opacity fill + dashed stroke pattern (Google
        // Maps Polygon doesn't natively support dashed strokes, so we use
        // a visible border + faint fill instead).
        fillColor: '#f97316',
        fillOpacity: 0.08,
        clickable: false,
        zIndex: 2,
      });
      polysRef.current.push(polygon);
    }

    return () => {
      for (const p of polysRef.current) p.setMap(null);
      polysRef.current = [];
    };
  }, [map, parcel]);

  return null;
}
