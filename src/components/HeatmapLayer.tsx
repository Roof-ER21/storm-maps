/**
 * HeatmapLayer -- Real Google Maps Heatmap visualization.
 *
 * Uses google.maps.visualization.HeatmapLayer for smooth, GPU-accelerated
 * density rendering that auto-adjusts with zoom. Replaces the old
 * AdvancedMarker circle approach.
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

interface HeatmapLayerProps {
  points: HeatmapPoint[];
  visible: boolean;
  /** Radius in pixels (default 30) */
  radius?: number;
  /** Opacity 0-1 (default 0.7) */
  opacity?: number;
  /** Custom gradient colors — array of CSS color strings */
  gradient?: string[];
}

/** Orange-red-purple gradient matching the Hail Yes brand */
const DEFAULT_GRADIENT = [
  'rgba(0, 0, 0, 0)',
  'rgba(34, 197, 94, 0.4)',   // green — low density
  'rgba(250, 204, 21, 0.6)',  // yellow
  'rgba(249, 115, 22, 0.7)',  // orange
  'rgba(239, 68, 68, 0.8)',   // red
  'rgba(168, 85, 247, 0.85)', // purple
  'rgba(124, 58, 237, 0.9)',  // violet — high density
];

export default function HeatmapLayer({
  points,
  visible,
  radius = 30,
  opacity = 0.7,
  gradient,
}: HeatmapLayerProps) {
  const map = useMap();
  const layerRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  // Create / destroy the layer
  useEffect(() => {
    if (!map || !visible || !google.maps.visualization) return;

    const data = points.map(
      (p) =>
        ({
          location: new google.maps.LatLng(p.lat, p.lng),
          weight: p.weight,
        }) as google.maps.visualization.WeightedLocation,
    );

    if (layerRef.current) {
      // Update existing layer
      layerRef.current.setData(data);
      layerRef.current.setMap(map);
    } else {
      layerRef.current = new google.maps.visualization.HeatmapLayer({
        data,
        map,
        radius,
        opacity,
        gradient: gradient || DEFAULT_GRADIENT,
        dissipating: true,
        maxIntensity: 8,
      });
    }

    return () => {
      if (layerRef.current) {
        layerRef.current.setMap(null);
      }
    };
  }, [map, points, visible, radius, opacity, gradient]);

  // Toggle visibility
  useEffect(() => {
    if (!layerRef.current) return;
    layerRef.current.setMap(visible ? map : null);
  }, [map, visible]);

  // Update radius reactively
  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.set('radius', radius);
    }
  }, [radius]);

  // Update opacity reactively
  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.set('opacity', opacity);
    }
  }, [opacity]);

  return null;
}
