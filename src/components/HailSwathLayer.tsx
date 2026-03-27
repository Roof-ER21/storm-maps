/**
 * HailSwathLayer -- Renders hail swaths on Google Maps.
 *
 * This layer only fills true polygon geometry. If the upstream dataset only
 * provides a centerline, it is rendered as a track instead of inventing a
 * symmetric footprint that was not present in the source data.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { MeshSwath } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface HailSwathLayerProps {
  swaths: MeshSwath[];
  selectedDate: string | null;
  highlightSelected?: boolean;
}

type GeometryKind = 'polygon' | 'line' | 'unknown';
type ShapeInstance = google.maps.Polygon | google.maps.Polyline;

function classifyGeometry(geom: MeshSwath['geometry']): GeometryKind {
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') return 'polygon';
  if (geom.type === 'LineString' || geom.type === 'MultiLineString') return 'line';
  return 'unknown';
}

function geoJsonToGooglePaths(swath: MeshSwath): google.maps.LatLngLiteral[][] {
  const geom = swath.geometry;
  const paths: google.maps.LatLngLiteral[][] = [];

  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      paths.push(ring.map(([lng, lat]) => ({ lat, lng })));
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const polygon of geom.coordinates) {
      for (const ring of polygon) {
        paths.push(ring.map(([lng, lat]) => ({ lat, lng })));
      }
    }
  } else if (geom.type === 'LineString') {
    paths.push(geom.coordinates.map(([lng, lat]) => ({ lat, lng })));
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) {
      paths.push(line.map(([lng, lat]) => ({ lat, lng })));
    }
  }

  return paths;
}
function getPolygonStyle(
  isFocused: boolean,
  highlightSelected: boolean,
) {
  if (highlightSelected) {
    return {
      fillOpacity: 0.3,
      strokeOpacity: 0.88,
      strokeWeight: 3,
    };
  }

  if (isFocused) {
    return {
      fillOpacity: 0.24,
      strokeOpacity: 0.76,
      strokeWeight: 2.5,
    };
  }

  return {
    fillOpacity: 0.18,
    strokeOpacity: 0.58,
    strokeWeight: 2,
  };
}

function getLineStyle(
  isFocused: boolean,
  highlightSelected: boolean,
) {
  if (highlightSelected) {
    return { strokeOpacity: 1, strokeWeight: 5 };
  }

  if (isFocused) {
    return { strokeOpacity: 0.92, strokeWeight: 4 };
  }

  return { strokeOpacity: 0.8, strokeWeight: 3 };
}

function createInfoContent(swath: MeshSwath, color: string): string {
  const sizeClass = getHailSizeClass(swath.maxMeshInches);
  const severity = sizeClass
    ? `${sizeClass.label} (severity ${sizeClass.damageSeverity}/5)`
    : 'Unknown';

  return `
    <div style="font-family: system-ui, sans-serif; padding: 4px; max-width: 300px;">
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: ${color};">
        Hail Swath
      </div>
      <div style="font-size: 12px; color: #374151; line-height: 1.5;">
        <div><strong>Date:</strong> ${swath.date}</div>
        <div><strong>Estimated Hail:</strong> ${swath.maxMeshInches}" ${severity}</div>
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

export default function HailSwathLayer({
  swaths,
  selectedDate,
  highlightSelected = false,
}: HailSwathLayerProps) {
  const map = useMap();
  const shapesRef = useRef<ShapeInstance[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const clearShapes = useCallback(() => {
    for (const shape of shapesRef.current) {
      shape.setMap(null);
    }
    shapesRef.current = [];
    infoWindowRef.current?.close();
  }, []);

  useEffect(() => {
    if (!map) return;

    clearShapes();

    const visible = selectedDate
      ? swaths.filter((swath) => swath.date === selectedDate)
      : swaths;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    for (const swath of visible) {
      const paths = geoJsonToGooglePaths(swath);
      if (paths.length === 0) continue;

      const sizeClass = getHailSizeClass(swath.maxMeshInches);
      const color = sizeClass?.color || '#f97316';
      const kind = classifyGeometry(swath.geometry);
      const isFocused = Boolean(selectedDate);
      const isEmphasized = isFocused && highlightSelected;
      const infoContent = createInfoContent(swath, color);

      const handleClick = (event: google.maps.MapMouseEvent) => {
        infoWindowRef.current!.setContent(infoContent);
        infoWindowRef.current!.setPosition(event.latLng || paths[0][0]);
        infoWindowRef.current!.open(map);
      };

      if (kind === 'line') {
        const lineStyle = getLineStyle(isFocused, isEmphasized);
        for (const path of paths) {
          const coreLine = new google.maps.Polyline({
            path,
            strokeColor: color,
            strokeOpacity: lineStyle.strokeOpacity,
            strokeWeight: lineStyle.strokeWeight,
            map,
            zIndex: isEmphasized ? 19 : isFocused ? 15 : 11,
          });
          coreLine.addListener('click', handleClick);
          shapesRef.current.push(coreLine);
        }

        continue;
      }

      const polygonStyle = getPolygonStyle(isFocused, isEmphasized);
      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: color,
        strokeOpacity: polygonStyle.strokeOpacity,
        strokeWeight: polygonStyle.strokeWeight,
        fillColor: color,
        fillOpacity: polygonStyle.fillOpacity,
        map,
        zIndex: isEmphasized ? 18 : isFocused ? 14 : 10,
      });
      polygon.addListener('click', handleClick);
      shapesRef.current.push(polygon);
    }

    return () => {
      clearShapes();
    };
  }, [map, swaths, selectedDate, highlightSelected, clearShapes]);

  return null;
}
