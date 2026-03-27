import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { StormEvent } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface HistoricalFootprintLayerProps {
  visible: boolean;
  events: StormEvent[];
}

function getRadiusMeters(magnitudeInches: number): number {
  if (magnitudeInches >= 3) return 14000;
  if (magnitudeInches >= 2.5) return 11000;
  if (magnitudeInches >= 2) return 9000;
  if (magnitudeInches >= 1.5) return 7000;
  if (magnitudeInches >= 1) return 5000;
  return 3200;
}

function buildCapsulePath(
  beginLat: number,
  beginLon: number,
  endLat: number,
  endLon: number,
  radiusMeters: number,
): google.maps.LatLngLiteral[] {
  const metersPerLat = 111_320;
  const metersPerLng = 111_320 * Math.cos((beginLat * Math.PI) / 180);
  const dx = (endLon - beginLon) * metersPerLng;
  const dy = (endLat - beginLat) * metersPerLat;
  const pathAngle = Math.atan2(dy, dx);
  const points: google.maps.LatLngLiteral[] = [];
  const arcSteps = 12;

  const offsetLatLng = (
    lat: number,
    lng: number,
    angle: number,
    r: number,
  ): google.maps.LatLngLiteral => ({
    lat: lat + (Math.sin(angle) * r) / metersPerLat,
    lng: lng + (Math.cos(angle) * r) / metersPerLng,
  });

  for (let i = 0; i <= arcSteps; i += 1) {
    const a = pathAngle + Math.PI / 2 + (Math.PI * i) / arcSteps;
    points.push(offsetLatLng(beginLat, beginLon, a, radiusMeters));
  }
  for (let i = 0; i <= arcSteps; i += 1) {
    const a = pathAngle - Math.PI / 2 + (Math.PI * i) / arcSteps;
    points.push(offsetLatLng(endLat, endLon, a, radiusMeters));
  }

  return points;
}

export default function HistoricalFootprintLayer({
  visible,
  events,
}: HistoricalFootprintLayerProps) {
  const map = useMap();
  const shapesRef = useRef<(google.maps.Circle | google.maps.Polygon)[]>([]);

  useEffect(() => {
    for (const shape of shapesRef.current) {
      shape.setMap(null);
    }
    shapesRef.current = [];

    if (!map || !visible) {
      return;
    }

    for (const event of events) {
      if (event.eventType !== 'Hail') {
        continue;
      }

      const color = getHailSizeClass(event.magnitude)?.color || '#2563eb';
      const radius = getRadiusMeters(event.magnitude);

      const hasEnd =
        Number.isFinite(event.endLat) &&
        Number.isFinite(event.endLon) &&
        (Math.abs(event.endLat - event.beginLat) > 0.001 ||
          Math.abs(event.endLon - event.beginLon) > 0.001);

      if (hasEnd) {
        const path = buildCapsulePath(
          event.beginLat,
          event.beginLon,
          event.endLat,
          event.endLon,
          radius,
        );
        const polygon = new google.maps.Polygon({
          map,
          paths: path,
          strokeColor: color,
          strokeOpacity: 0.28,
          strokeWeight: 1,
          fillColor: color,
          fillOpacity: 0.14,
          zIndex: 17,
          clickable: false,
        });
        shapesRef.current.push(polygon);
      } else {
        const circle = new google.maps.Circle({
          map,
          center: { lat: event.beginLat, lng: event.beginLon },
          radius,
          strokeColor: color,
          strokeOpacity: 0.28,
          strokeWeight: 1,
          fillColor: color,
          fillOpacity: 0.14,
          zIndex: 17,
          clickable: false,
        });
        shapesRef.current.push(circle);
      }
    }

    return () => {
      for (const shape of shapesRef.current) {
        shape.setMap(null);
      }
      shapesRef.current = [];
    };
  }, [events, map, visible]);

  return null;
}
