import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { StormEvent } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface HistoricalHailContourLayerProps {
  visible: boolean;
  events: StormEvent[];
}

interface ProjectedPoint {
  x: number;
  y: number;
}

interface ClusterEvent extends StormEvent {
  radiusMiles: number;
}

function getRadiusMiles(magnitudeInches: number): number {
  if (magnitudeInches >= 3) return 7;
  if (magnitudeInches >= 2.5) return 5.5;
  if (magnitudeInches >= 2) return 4.5;
  if (magnitudeInches >= 1.5) return 3.5;
  if (magnitudeInches >= 1) return 2.5;
  return 1.75;
}

function getDistanceMiles(a: StormEvent, b: StormEvent): number {
  const meanLat = ((a.beginLat + b.beginLat) / 2) * (Math.PI / 180);
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.cos(meanLat);
  const dx = (a.beginLon - b.beginLon) * milesPerLng;
  const dy = (a.beginLat - b.beginLat) * milesPerLat;
  return Math.hypot(dx, dy);
}

function clusterEvents(events: StormEvent[]): ClusterEvent[][] {
  const clusters: ClusterEvent[][] = [];
  const visited = new Set<string>();

  for (const event of events) {
    if (visited.has(event.id)) {
      continue;
    }

    const seed: ClusterEvent = {
      ...event,
      radiusMiles: getRadiusMiles(event.magnitude),
    };
    const cluster: ClusterEvent[] = [seed];
    visited.add(event.id);

    let expanded = true;
    while (expanded) {
      expanded = false;

      for (const candidate of events) {
        if (visited.has(candidate.id)) {
          continue;
        }

        const candidateRadius = getRadiusMiles(candidate.magnitude);
        const threshold = Math.max(10, candidateRadius * 2.5);

        if (
          cluster.some((member) => getDistanceMiles(member, candidate) <= threshold)
        ) {
          cluster.push({
            ...candidate,
            radiusMiles: candidateRadius,
          });
          visited.add(candidate.id);
          expanded = true;
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function toProjectedPoint(
  lat: number,
  lng: number,
  referenceLat: number,
  referenceLng: number,
): ProjectedPoint {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.cos((referenceLat * Math.PI) / 180);

  return {
    x: (lng - referenceLng) * milesPerLng,
    y: (lat - referenceLat) * milesPerLat,
  };
}

function toLatLng(
  point: ProjectedPoint,
  referenceLat: number,
  referenceLng: number,
): google.maps.LatLngLiteral {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.cos((referenceLat * Math.PI) / 180);

  return {
    lat: referenceLat + point.y / milesPerLat,
    lng: referenceLng + point.x / milesPerLng,
  };
}

function sampleEventFootprint(
  event: ClusterEvent,
  referenceLat: number,
  referenceLng: number,
): ProjectedPoint[] {
  const begin = toProjectedPoint(
    event.beginLat,
    event.beginLon,
    referenceLat,
    referenceLng,
  );

  const hasEnd =
    Number.isFinite(event.endLat) &&
    Number.isFinite(event.endLon) &&
    (Math.abs(event.endLat - event.beginLat) > 0.001 ||
      Math.abs(event.endLon - event.beginLon) > 0.001);

  if (!hasEnd) {
    // No travel path — fall back to a simple circle
    const ring: ProjectedPoint[] = [];
    const steps = 20;
    for (let i = 0; i < steps; i += 1) {
      const angle = (Math.PI * 2 * i) / steps;
      ring.push({
        x: begin.x + Math.cos(angle) * event.radiusMiles,
        y: begin.y + Math.sin(angle) * event.radiusMiles,
      });
    }
    return ring;
  }

  // Build a capsule (stadium shape) along the storm travel path.
  // The width is the hail-size radius; the length follows begin→end.
  const end = toProjectedPoint(
    event.endLat,
    event.endLon,
    referenceLat,
    referenceLng,
  );

  const dx = end.x - begin.x;
  const dy = end.y - begin.y;
  const pathAngle = Math.atan2(dy, dx);
  const halfWidth = event.radiusMiles;
  const points: ProjectedPoint[] = [];
  const arcSteps = 10;

  // Semicircle around the begin point (facing away from end)
  for (let i = 0; i <= arcSteps; i += 1) {
    const a = pathAngle + Math.PI / 2 + (Math.PI * i) / arcSteps;
    points.push({
      x: begin.x + Math.cos(a) * halfWidth,
      y: begin.y + Math.sin(a) * halfWidth,
    });
  }

  // Semicircle around the end point (facing away from begin)
  for (let i = 0; i <= arcSteps; i += 1) {
    const a = pathAngle - Math.PI / 2 + (Math.PI * i) / arcSteps;
    points.push({
      x: end.x + Math.cos(a) * halfWidth,
      y: end.y + Math.sin(a) * halfWidth,
    });
  }

  return points;
}

function cross(o: ProjectedPoint, a: ProjectedPoint, b: ProjectedPoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function buildConvexHull(points: ProjectedPoint[]): ProjectedPoint[] {
  if (points.length <= 1) {
    return points;
  }

  const sorted = [...points].sort((a, b) => {
    if (a.x === b.x) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  const lower: ProjectedPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: ProjectedPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export default function HistoricalHailContourLayer({
  visible,
  events,
}: HistoricalHailContourLayerProps) {
  const map = useMap();
  const polygonsRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    for (const polygon of polygonsRef.current) {
      polygon.setMap(null);
    }
    polygonsRef.current = [];

    if (!map || !visible) {
      return;
    }

    const hailEvents = events.filter(
      (event) =>
        event.eventType === 'Hail' &&
        Number.isFinite(event.beginLat) &&
        Number.isFinite(event.beginLon),
    );

    for (const cluster of clusterEvents(hailEvents)) {
      if (cluster.length === 0) {
        continue;
      }

      const referenceLat =
        cluster.reduce((sum, event) => sum + event.beginLat, 0) / cluster.length;
      const referenceLng =
        cluster.reduce((sum, event) => sum + event.beginLon, 0) / cluster.length;

      const sampledPoints = cluster.flatMap((event) =>
        sampleEventFootprint(event, referenceLat, referenceLng),
      );
      const hull = buildConvexHull(sampledPoints);

      if (hull.length < 3) {
        continue;
      }

      const maxMagnitude = Math.max(...cluster.map((event) => event.magnitude));
      const color = getHailSizeClass(maxMagnitude)?.color || '#FFA500';
      const polygonPath = hull.map((point) =>
        toLatLng(point, referenceLat, referenceLng),
      );

      const polygon = new google.maps.Polygon({
        map,
        paths: polygonPath,
        strokeColor: color,
        strokeOpacity: 0.82,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.22,
        zIndex: 16,
        clickable: false,
      });

      polygonsRef.current.push(polygon);
    }

    return () => {
      for (const polygon of polygonsRef.current) {
        polygon.setMap(null);
      }
      polygonsRef.current = [];
    };
  }, [events, map, visible]);

  return null;
}
