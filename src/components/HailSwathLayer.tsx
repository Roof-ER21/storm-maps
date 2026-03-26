/**
 * HailSwathLayer -- Renders NHP MESH swath polygons on Google Maps.
 *
 * Uses the useMap() hook to draw polygons directly via the Google Maps
 * JS API. Severity-colored polygons with click handlers for info windows.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { MeshSwath } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface HailSwathLayerProps {
  swaths: MeshSwath[];
  selectedDate: string | null;
}

/** Geometry classification for rendering strategy */
type GeometryKind = 'polygon' | 'line' | 'unknown';

function classifyGeometry(geom: MeshSwath['geometry']): GeometryKind {
  if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') return 'polygon';
  if (geom.type === 'LineString' || geom.type === 'MultiLineString') return 'line';
  return 'unknown';
}

/**
 * Convert GeoJSON coordinates to Google Maps LatLng paths.
 * GeoJSON is [lng, lat], Google Maps wants {lat, lng}.
 * Handles Polygon, MultiPolygon, LineString, and MultiLineString.
 */
function geoJsonToGooglePaths(
  swath: MeshSwath,
): google.maps.LatLngLiteral[][] {
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

export default function HailSwathLayer({
  swaths,
  selectedDate,
}: HailSwathLayerProps) {
  const map = useMap();
  const shapesRef = useRef<(google.maps.Polygon | google.maps.Polyline)[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const clearShapes = useCallback(() => {
    for (const shape of shapesRef.current) {
      shape.setMap(null);
    }
    shapesRef.current = [];
    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }
  }, []);

  useEffect(() => {
    if (!map) return;

    clearShapes();

    // Filter swaths by selected date
    const visible = selectedDate
      ? swaths.filter((s) => s.date === selectedDate)
      : swaths;

    // Create info window once
    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
    }

    for (const swath of visible) {
      const paths = geoJsonToGooglePaths(swath);
      if (paths.length === 0) continue;

      const sizeClass = getHailSizeClass(swath.maxMeshInches);
      const color = sizeClass?.color || '#FFA500';
      const kind = classifyGeometry(swath.geometry);

      // Build the info window click handler (shared by both shape types)
      const handleClick = (e: google.maps.MapMouseEvent) => {
        const severity = sizeClass
          ? `${sizeClass.label} (severity ${sizeClass.damageSeverity}/5)`
          : 'Unknown';

        const content = `
          <div style="font-family: system-ui, sans-serif; padding: 4px; max-width: 280px;">
            <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: ${color};">
              MESH Hail Swath
            </div>
            <div style="font-size: 12px; color: #374151; line-height: 1.5;">
              <div><strong>Date:</strong> ${swath.date}</div>
              <div><strong>Max MESH:</strong> ${swath.maxMeshInches}" ${severity}</div>
              <div><strong>Avg MESH:</strong> ${swath.avgMeshInches}"</div>
              ${swath.areaSqMiles > 0 ? `<div><strong>Area:</strong> ${swath.areaSqMiles.toFixed(1)} sq mi</div>` : ''}
              ${swath.statesAffected.length > 0 ? `<div><strong>States:</strong> ${swath.statesAffected.join(', ')}</div>` : ''}
            </div>
          </div>
        `;

        infoWindowRef.current!.setContent(content);
        infoWindowRef.current!.setPosition(
          e.latLng || { lat: 0, lng: 0 },
        );
        infoWindowRef.current!.open(map);
      };

      if (kind === 'line') {
        // Render LineString / MultiLineString as Polylines
        for (const path of paths) {
          const polyline = new google.maps.Polyline({
            path,
            strokeColor: color,
            strokeOpacity: 0.9,
            strokeWeight: 4,
            map,
            zIndex: 10,
          });
          polyline.addListener('click', handleClick);
          shapesRef.current.push(polyline);
        }
      } else {
        // Render Polygon / MultiPolygon as filled Polygons
        const polygon = new google.maps.Polygon({
          paths,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.25,
          map,
          zIndex: 10,
        });
        polygon.addListener('click', handleClick);
        shapesRef.current.push(polygon);
      }
    }

    return () => {
      clearShapes();
    };
  }, [map, swaths, selectedDate, clearShapes]);

  // This component renders imperatively; no JSX output needed
  return null;
}
