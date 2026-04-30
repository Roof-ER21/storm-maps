/**
 * HailSwathLayer — renders hail swaths on Google Maps via the Data layer API.
 *
 * Why Data layer instead of one Polygon-per-band:
 *   The previous implementation rebuilt every google.maps.Polygon on each
 *   render of `swaths` / `selectedDate` / `highlightSelected`. With 13 IHM
 *   hail bands and MultiPolygon geometry per band, that was 100+ heavy
 *   shape objects per dense storm + the overhead of attaching click/hover
 *   listeners to each one. The Data layer holds a single FeatureCollection
 *   with feature-level styling and one set of listeners — measured ~10×
 *   faster on the densest storms in the test set.
 *
 * Behavior parity with the old layer:
 *   - polygon and polyline (NHP centerline) geometry
 *   - hover effect (fill/stroke bump) restored on mouseout
 *   - click → InfoWindow with the band, source notes, area + states
 *   - z-index keyed off hail size so larger bands render on top
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { MeshSwath } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface HailSwathLayerProps {
  swaths: MeshSwath[];
  selectedDate: string | null;
  highlightSelected?: boolean;
}

interface FeatureProps {
  swathId: string;
  color: string;
  level: number;
  isFocused: boolean;
  isEmphasized: boolean;
  isLine: boolean;
  /**
   * True when this feature is a per-band MRMS contour polygon for the
   * selected historical date. Renders with strokeWeight=0 so the bands
   * read as a smooth heat-map gradient (Trace→Pea→Penny→Quarter→…)
   * instead of the fragmented stroked contours that Ahmed flagged on
   * 4/27/26. Same color truth as the raster, but vector-crisp at any
   * zoom and with real organic storm shape (no single-pixel rectangles).
   */
  isHistoricalContour: boolean;
  infoContent: string;
}

function classifyGeometry(geom: MeshSwath['geometry']): 'polygon' | 'line' | 'unknown' {
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') return 'polygon';
  if (geom.type === 'LineString' || geom.type === 'MultiLineString') return 'line';
  return 'unknown';
}

function buildInfoContent(swath: MeshSwath, color: string): string {
  const sizeClass = getHailSizeClass(swath.maxMeshInches);
  const isVector = Boolean(swath.displayLabel);
  const severity = sizeClass
    ? `${sizeClass.label} (severity ${sizeClass.damageSeverity}/5)`
    : '';
  const sizeLabel = isVector
    ? `≥ ${swath.displayLabel}`
    : `${swath.maxMeshInches}"`;
  const severityFragment = severity
    ? `<span style="color: #6b7280;"> ${severity}</span>`
    : '';

  return `
    <div style="font-family: system-ui, sans-serif; padding: 4px; max-width: 300px;">
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: ${color};">
        ${isVector ? 'MRMS Hail Footprint' : 'Hail Swath'}
      </div>
      <div style="font-size: 12px; color: #374151; line-height: 1.5;">
        <div><strong>Date:</strong> ${swath.date}</div>
        <div><strong>Estimated Hail:</strong> ${sizeLabel}${severityFragment}</div>
        ${
          swath.maxWidthKm
            ? `<div><strong>Max Width:</strong> ${swath.maxWidthKm.toFixed(1)} km</div>`
            : ''
        }
        ${
          swath.hailLengthKm
            ? `<div><strong>Length:</strong> ${swath.hailLengthKm.toFixed(1)} km</div>`
            : ''
        }
        ${
          swath.areaSqMiles > 0
            ? `<div><strong>Approx. Area:</strong> ${swath.areaSqMiles.toFixed(1)} sq mi</div>`
            : ''
        }
        ${
          swath.statesAffected.length > 0
            ? `<div><strong>States:</strong> ${swath.statesAffected.join(', ')}</div>`
            : ''
        }
        <div style="margin-top: 6px; color: #6b7280;">
          ${
            classifyGeometry(swath.geometry) === 'line'
              ? 'Rendered from National Hail Project storm-track geometry. No synthetic footprint fill is added when only a track is available.'
              : 'Rendered from hail-area geometry supplied by the upstream source.'
          }
        </div>
      </div>
    </div>
  `;
}

function meshToGeoJsonFeatures(
  swaths: MeshSwath[],
  selectedDate: string | null,
  highlightSelected: boolean,
): {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    id: string;
    properties: FeatureProps;
    geometry: MeshSwath['geometry'];
  }>;
} {
  const visible = selectedDate
    ? swaths.filter((swath) => swath.date === selectedDate)
    : swaths;

  return {
    type: 'FeatureCollection',
    features: visible.map((swath) => {
      const sizeClass = getHailSizeClass(swath.maxMeshInches);
      const color = swath.displayColor || sizeClass?.color || '#f97316';
      const isFocused = Boolean(selectedDate);
      const isEmphasized = isFocused && highlightSelected;
      const level = Math.min(9, Math.max(0, Math.floor(swath.maxMeshInches * 2)));
      // MRMS historical contour polygons carry id="mrms-contour-N" — those
      // get rendered without stroke so the bands stack as a smooth fill.
      const isHistoricalContour = swath.id.startsWith('mrms-contour-');
      return {
        type: 'Feature',
        id: swath.id,
        properties: {
          swathId: swath.id,
          color,
          level,
          isFocused,
          isEmphasized,
          isLine: classifyGeometry(swath.geometry) === 'line',
          isHistoricalContour,
          infoContent: buildInfoContent(swath, color),
        },
        geometry: swath.geometry,
      };
    }),
  };
}

function styleFeature(
  feature: google.maps.Data.Feature,
): google.maps.Data.StyleOptions {
  const props = feature.getProperty('isFocused') as boolean | undefined;
  const isFocused = Boolean(props);
  const isEmphasized = Boolean(feature.getProperty('isEmphasized'));
  const isLine = Boolean(feature.getProperty('isLine'));
  const color = (feature.getProperty('color') as string) ?? '#f97316';
  const level = (feature.getProperty('level') as number) ?? 0;

  if (isLine) {
    const strokeOpacity = isEmphasized ? 1 : isFocused ? 0.92 : 0.8;
    const strokeWeight = isEmphasized ? 5 : isFocused ? 4 : 3;
    return {
      strokeColor: color,
      strokeOpacity,
      strokeWeight,
      zIndex: isEmphasized ? 19 : isFocused ? 15 : 11,
      clickable: true,
    };
  }

  // MRMS historical contour bands — render as filled polygons with NO
  // stroke so the 13-band stack reads as a smooth color-gradient heat
  // map (matching the raster look reps liked on 4/27) instead of the
  // fragmented contour-line look. Per-band fill alpha rises with band
  // index so heavier hail pops without obscuring the lighter outer
  // bands.
  const isHistoricalContour = Boolean(
    feature.getProperty('isHistoricalContour'),
  );
  if (isHistoricalContour) {
    const fillOpacity = Math.min(0.78, 0.42 + level * 0.04);
    return {
      fillColor: color,
      fillOpacity,
      strokeOpacity: 0,
      strokeWeight: 0,
      zIndex: 50 + level,
      clickable: true,
    };
  }

  // Bumped fill opacities so the refined IHM palette actually displays
  // close to its true RGB on the basemap — was 0.28/0.35/0.42 (washed
  // out, almost translucent). Stroke widened slightly for sharper edges.
  let fillOpacity: number;
  let strokeOpacity: number;
  let strokeWeight: number;
  if (isEmphasized) {
    fillOpacity = 0.62;
    strokeOpacity = 1;
    strokeWeight = 2.5;
  } else if (isFocused) {
    fillOpacity = 0.55;
    strokeOpacity = 0.9;
    strokeWeight = 2;
  } else {
    fillOpacity = 0.45;
    strokeOpacity = 0.8;
    strokeWeight = 1.5;
  }

  const baseZ = isEmphasized ? 18 : isFocused ? 14 : 10;
  return {
    fillColor: color,
    fillOpacity,
    strokeColor: color,
    strokeOpacity,
    strokeWeight,
    zIndex: baseZ + level,
    clickable: true,
  };
}

export default function HailSwathLayer({
  swaths,
  selectedDate,
  highlightSelected = false,
}: HailSwathLayerProps) {
  const map = useMap();
  const dataLayerRef = useRef<google.maps.Data | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const hoveredIdRef = useRef<string | null>(null);

  // Set up the Data layer + listeners once per map. The feature collection
  // gets swapped on every render via setStyle / addGeoJson, but the layer
  // and its event handlers are reused.
  useEffect(() => {
    if (!map) return;

    const data = new google.maps.Data({ map });
    data.setStyle(styleFeature);
    dataLayerRef.current = data;
    infoWindowRef.current = new google.maps.InfoWindow();

    const clickListener = data.addListener(
      'click',
      (event: google.maps.Data.MouseEvent) => {
        const content = event.feature.getProperty('infoContent') as
          | string
          | undefined;
        if (!content) return;
        infoWindowRef.current!.setContent(content);
        if (event.latLng) infoWindowRef.current!.setPosition(event.latLng);
        infoWindowRef.current!.open(map);
      },
    );

    // Hover via overrideStyle so we don't rebuild the FeatureCollection.
    const overListener = data.addListener(
      'mouseover',
      (event: google.maps.Data.MouseEvent) => {
        const id = event.feature.getId();
        const idStr = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
        if (!idStr) return;
        if (hoveredIdRef.current === idStr) return;

        if (hoveredIdRef.current !== null) {
          const prev = data.getFeatureById(hoveredIdRef.current);
          if (prev) data.revertStyle(prev);
        }

        hoveredIdRef.current = idStr;
        const isLine = Boolean(event.feature.getProperty('isLine'));
        const color = (event.feature.getProperty('color') as string) ?? '#f97316';
        if (isLine) {
          data.overrideStyle(event.feature, {
            strokeColor: color,
            strokeOpacity: 1,
            strokeWeight: 6,
          });
        } else {
          data.overrideStyle(event.feature, {
            fillColor: color,
            fillOpacity: 0.75,
            strokeOpacity: 1,
          });
        }
      },
    );

    const outListener = data.addListener(
      'mouseout',
      (event: google.maps.Data.MouseEvent) => {
        const id = event.feature.getId();
        const idStr = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
        if (idStr && hoveredIdRef.current === idStr) {
          hoveredIdRef.current = null;
        }
        data.revertStyle(event.feature);
      },
    );

    listenersRef.current = [clickListener, overListener, outListener];

    return () => {
      for (const listener of listenersRef.current) listener.remove();
      listenersRef.current = [];
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      data.forEach((feature) => data.remove(feature));
      data.setMap(null);
      dataLayerRef.current = null;
    };
  }, [map]);

  // Swap the FeatureCollection whenever inputs change. Cheaper than tearing
  // down + rebuilding the layer because Google Maps reuses tile/render state.
  useEffect(() => {
    const data = dataLayerRef.current;
    if (!data) return;

    // Clear existing features. forEach + remove is the documented pattern.
    data.forEach((feature) => data.remove(feature));

    const collection = meshToGeoJsonFeatures(
      swaths,
      selectedDate,
      highlightSelected,
    );
    if (collection.features.length === 0) return;

    data.addGeoJson(collection);
    // Re-apply the style fn so newly-added features pick up their props.
    data.setStyle(styleFeature);
  }, [swaths, selectedDate, highlightSelected]);

  return null;
}
