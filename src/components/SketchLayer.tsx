/**
 * SketchLayer — field-inspection drawing tools.
 *
 * When `enabled`, attaches Google Maps DrawingManager so reps can mark:
 *   - Polylines for hail streaks / damage paths
 *   - Polygons for impact zones / inspection boundaries
 *   - Markers for individual ding/dent observations
 *
 * Sketches are persisted to localStorage keyed by (lat, lng, dateOfLoss)
 * so a rep stepping away and coming back later sees their last marks
 * still on the map. No server roundtrip — these are personal field
 * notes, not part of the adjuster PDF.
 *
 * To save into the PDF as evidence: tap Save → exports each sketch
 * with its lat/lng + a generated thumbnail (deferred — not in this cut).
 */

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

interface SketchLayerProps {
  enabled: boolean;
  /** Storage key components — sketches stick to a property+date. */
  propertyLat: number | null;
  propertyLng: number | null;
  dateOfLoss: string | null;
}

interface SerializedSketch {
  type: 'polyline' | 'polygon' | 'marker' | 'circle';
  /** lng/lat pairs for poly types; single [lng,lat] for marker. */
  coords: number[][];
  /** Radius (meters) for circle. */
  radiusM?: number;
  color: string;
  ts: number;
}

const STORAGE_PREFIX = 'hailyes:sketch:';

function storageKey(lat: number, lng: number, date: string): string {
  // Quantize to ~110m so micro-jitter from re-search doesn't lose sketches.
  return `${STORAGE_PREFIX}${date}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

const DEFAULT_COLOR = '#dc2626';

export default function SketchLayer({
  enabled,
  propertyLat,
  propertyLng,
  dateOfLoss,
}: SketchLayerProps): null {
  const map = useMap();
  const dmRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);
  const [drawingApi, setDrawingApi] =
    useState<typeof google.maps.drawing | null>(null);

  // Lazy-load the drawing library on first activation.
  useEffect(() => {
    if (!enabled || drawingApi) return;
    if (typeof google === 'undefined' || !google.maps) return;
    let cancelled = false;
    void (async () => {
      try {
        const lib = (await google.maps.importLibrary('drawing')) as
          | typeof google.maps.drawing
          | undefined;
        if (!cancelled && lib) setDrawingApi(lib);
      } catch (err) {
        console.warn('[SketchLayer] drawing import failed:', (err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, drawingApi]);

  const persistKey =
    propertyLat !== null && propertyLng !== null && dateOfLoss
      ? storageKey(propertyLat, propertyLng, dateOfLoss)
      : null;

  // Restore prior sketches when (re-)enabled at the same property+date.
  useEffect(() => {
    if (!map || !enabled || !persistKey) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(persistKey);
    } catch {
      raw = null;
    }
    if (!raw) return;
    let parsed: SerializedSketch[] = [];
    try {
      parsed = JSON.parse(raw) as SerializedSketch[];
    } catch {
      return;
    }
    for (const s of parsed) {
      if (s.type === 'marker' && s.coords[0]) {
        const m = new google.maps.Marker({
          map,
          position: { lat: s.coords[0][1], lng: s.coords[0][0] },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 5,
            fillColor: s.color,
            fillOpacity: 0.95,
            strokeColor: '#fff',
            strokeWeight: 1.5,
          },
          title: 'Field note',
          zIndex: 4500,
        });
        overlaysRef.current.push(m);
      } else if (s.type === 'polyline') {
        const path = s.coords.map(([lng, lat]) => ({ lat, lng }));
        const pl = new google.maps.Polyline({
          map,
          path,
          strokeColor: s.color,
          strokeOpacity: 0.9,
          strokeWeight: 3,
          zIndex: 4500,
        });
        overlaysRef.current.push(pl);
      } else if (s.type === 'polygon') {
        const path = s.coords.map(([lng, lat]) => ({ lat, lng }));
        const pg = new google.maps.Polygon({
          map,
          paths: path,
          strokeColor: s.color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: s.color,
          fillOpacity: 0.18,
          zIndex: 4500,
        });
        overlaysRef.current.push(pg);
      } else if (s.type === 'circle' && s.coords[0] && s.radiusM) {
        const c = new google.maps.Circle({
          map,
          center: { lat: s.coords[0][1], lng: s.coords[0][0] },
          radius: s.radiusM,
          strokeColor: s.color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: s.color,
          fillOpacity: 0.16,
          zIndex: 4500,
        });
        overlaysRef.current.push(c);
      }
    }
    return () => {
      for (const o of overlaysRef.current) {
        // Each shape type accepts setMap(null) to detach.
        (o as unknown as { setMap?: (m: google.maps.Map | null) => void }).setMap?.(null);
      }
      overlaysRef.current = [];
    };
  }, [map, enabled, persistKey]);

  // Activate / deactivate DrawingManager when toggled.
  useEffect(() => {
    if (!map || !enabled || !drawingApi) {
      if (dmRef.current) {
        dmRef.current.setMap(null);
        dmRef.current = null;
      }
      return;
    }
    const dm = new drawingApi.DrawingManager({
      drawingMode: null,
      drawingControl: true,
      drawingControlOptions: {
        position: google.maps.ControlPosition.TOP_CENTER,
        drawingModes: [
          drawingApi.OverlayType.MARKER,
          drawingApi.OverlayType.POLYLINE,
          drawingApi.OverlayType.POLYGON,
          drawingApi.OverlayType.CIRCLE,
        ],
      },
      markerOptions: {
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: DEFAULT_COLOR,
          fillOpacity: 0.95,
          strokeColor: '#fff',
          strokeWeight: 1.5,
        },
      },
      polylineOptions: {
        strokeColor: DEFAULT_COLOR,
        strokeOpacity: 0.9,
        strokeWeight: 3,
      },
      polygonOptions: {
        strokeColor: DEFAULT_COLOR,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: DEFAULT_COLOR,
        fillOpacity: 0.18,
      },
      circleOptions: {
        strokeColor: DEFAULT_COLOR,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: DEFAULT_COLOR,
        fillOpacity: 0.16,
      },
    });
    dm.setMap(map);
    dmRef.current = dm;

    const persist = () => {
      if (!persistKey) return;
      const sketches: SerializedSketch[] = [];
      for (const o of overlaysRef.current) {
        if (o instanceof google.maps.Marker) {
          const p = o.getPosition();
          if (p) sketches.push({ type: 'marker', coords: [[p.lng(), p.lat()]], color: DEFAULT_COLOR, ts: Date.now() });
        } else if (o instanceof google.maps.Polyline) {
          const path = o.getPath().getArray().map((ll) => [ll.lng(), ll.lat()]);
          sketches.push({ type: 'polyline', coords: path, color: DEFAULT_COLOR, ts: Date.now() });
        } else if (o instanceof google.maps.Polygon) {
          const path = o.getPath().getArray().map((ll) => [ll.lng(), ll.lat()]);
          sketches.push({ type: 'polygon', coords: path, color: DEFAULT_COLOR, ts: Date.now() });
        } else if (o instanceof google.maps.Circle) {
          const c = o.getCenter();
          if (c) sketches.push({
            type: 'circle',
            coords: [[c.lng(), c.lat()]],
            radiusM: o.getRadius(),
            color: DEFAULT_COLOR,
            ts: Date.now(),
          });
        }
      }
      try {
        window.localStorage.setItem(persistKey, JSON.stringify(sketches));
      } catch {
        /* quota exceeded — ignore */
      }
    };

    const completeListener = google.maps.event.addListener(
      dm,
      'overlaycomplete',
      (e: google.maps.drawing.OverlayCompleteEvent) => {
        const overlay = e.overlay as google.maps.MVCObject;
        overlaysRef.current.push(overlay);
        // Reset to no-tool so a single click after drawing doesn't keep
        // adding shapes.
        dm.setDrawingMode(null);
        persist();
        // Wire move/edit listeners for poly types so dragging vertices
        // re-saves.
        if (e.type === drawingApi.OverlayType.POLYLINE || e.type === drawingApi.OverlayType.POLYGON) {
          const path = (overlay as google.maps.Polyline | google.maps.Polygon).getPath();
          google.maps.event.addListener(path, 'set_at', persist);
          google.maps.event.addListener(path, 'insert_at', persist);
          google.maps.event.addListener(path, 'remove_at', persist);
        }
      },
    );

    return () => {
      google.maps.event.removeListener(completeListener);
      dm.setMap(null);
      dmRef.current = null;
    };
  }, [map, enabled, drawingApi, persistKey]);

  return null;
}
