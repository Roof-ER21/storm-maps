/**
 * NexradOverlay -- NEXRAD radar tiles on Google Maps.
 *
 * Uses Iowa Environmental Mesonet (IEM) WMS as a tile overlay.
 * The overlay renders NEXRAD base reflectivity (n0r) data.
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

interface NexradOverlayProps {
  visible: boolean;
}

export default function NexradOverlay({ visible }: NexradOverlayProps) {
  const map = useMap();
  const overlayRef = useRef<google.maps.ImageMapType | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create the IEM NEXRAD tile overlay once
    if (!overlayRef.current) {
      overlayRef.current = new google.maps.ImageMapType({
        getTileUrl: (coord, zoom) => {
          // IEM WMS nexrad composite reflectivity tile URL
          // Uses TMS-style tile addressing via WMS bbox calculation
          const proj = map.getProjection();
          if (!proj) return '';

          const tileSize = 256;
          const s = Math.pow(2, zoom);

          // Calculate bounding box for this tile
          const swPoint = proj.fromPointToLatLng(
            new google.maps.Point(
              (coord.x * tileSize) / s,
              ((coord.y + 1) * tileSize) / s,
            ),
          );
          const nePoint = proj.fromPointToLatLng(
            new google.maps.Point(
              ((coord.x + 1) * tileSize) / s,
              (coord.y * tileSize) / s,
            ),
          );

          if (!swPoint || !nePoint) return '';

          const bbox = `${swPoint.lng()},${swPoint.lat()},${nePoint.lng()},${nePoint.lat()}`;

          return (
            `https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi?` +
            `SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&` +
            `FORMAT=image/png&TRANSPARENT=true&` +
            `LAYERS=nexrad-n0r&` +
            `SRS=EPSG:4326&` +
            `WIDTH=${tileSize}&HEIGHT=${tileSize}&` +
            `BBOX=${bbox}`
          );
        },
        tileSize: new google.maps.Size(256, 256),
        opacity: 0.6,
        name: 'NEXRAD',
        maxZoom: 18,
        minZoom: 3,
      });
    }

    if (visible) {
      // Add overlay if not already present
      const overlays = map.overlayMapTypes;
      let found = false;
      for (let i = 0; i < overlays.getLength(); i++) {
        if (overlays.getAt(i) === overlayRef.current) {
          found = true;
          break;
        }
      }
      if (!found) {
        overlays.push(overlayRef.current);
      }
    } else {
      // Remove overlay
      const overlays = map.overlayMapTypes;
      for (let i = overlays.getLength() - 1; i >= 0; i--) {
        if (overlays.getAt(i) === overlayRef.current) {
          overlays.removeAt(i);
        }
      }
    }

    return () => {
      if (overlayRef.current) {
        const overlays = map.overlayMapTypes;
        for (let i = overlays.getLength() - 1; i >= 0; i--) {
          if (overlays.getAt(i) === overlayRef.current) {
            overlays.removeAt(i);
          }
        }
      }
    };
  }, [map, visible]);

  return null;
}
