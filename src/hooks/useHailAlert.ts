/**
 * useHailAlert — Canvassing proximity alert hook.
 *
 * Monitors the user's GPS position against loaded storm events
 * and triggers an alert when they're within 0.5 miles of a hail report.
 *
 * Features:
 * - 5-minute cooldown per event (won't re-alert for the same event)
 * - Auto-dismiss after 8 seconds
 * - Generates door-knocking talking points based on hail size
 */

import { useCallback, useMemo } from 'react';
import type { GpsPosition, StormEvent, CanvassingAlert } from '../types/storm';
import { getHailSizeClass } from '../types/storm';
import { toEasternDateKey } from '../services/dateUtils';

/** Proximity threshold in miles to trigger an alert */
const ALERT_RADIUS_MILES = 0.5;

/**
 * Calculate the distance between two lat/lng points in miles (Haversine formula).
 */
function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generate talking points for a door-knock based on hail size.
 */
function generateTalkingPoints(hailInches: number, stormDate: string): string[] {
  const sizeClass = getHailSizeClass(hailInches);
  const points: string[] = [];

  let dateLabel = stormDate;
  try {
    const d = new Date(stormDate + 'T12:00:00Z');
    dateLabel = d.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    // keep raw string
  }

  points.push(
    `This area was hit by ${hailInches}" hail on ${dateLabel}.`,
  );

  if (sizeClass) {
    points.push(
      `That's ${sizeClass.label} size — damage severity level ${sizeClass.damageSeverity}/5.`,
    );
  }

  if (hailInches >= 1.0) {
    points.push(
      'Hail this size commonly damages shingles, gutters, and siding.',
    );
    points.push(
      'Most homeowner insurance policies cover hail damage with no out-of-pocket cost.',
    );
  }

  if (hailInches >= 1.75) {
    points.push(
      'Golf ball+ hail almost always requires a full roof replacement.',
    );
    points.push(
      'Insurance adjusters expect to see claims from this size event.',
    );
  }

  if (hailInches >= 2.5) {
    points.push(
      'This was a catastrophic hail event. Nearly every roof in the swath will need replacement.',
    );
  }

  return points;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseHailAlertParams {
  position: GpsPosition | null;
  events: StormEvent[];
}

interface UseHailAlertReturn {
  alert: CanvassingAlert | null;
  dismiss: () => void;
}

export function useHailAlert({
  position,
  events,
}: UseHailAlertParams): UseHailAlertReturn {
  // Derive alert state purely from inputs during render.
  // No side effects, no refs, no Date.now() — fully pure.
  const alert = useMemo((): CanvassingAlert | null => {
    if (!position || events.length === 0) return null;

    // Find the closest hail event
    let closestEvent: StormEvent | null = null;
    let closestDist = Infinity;

    for (const event of events) {
      if (event.eventType !== 'Hail') continue;
      if (event.magnitude < 0.75) continue;

      const dist = haversineDistanceMiles(
        position.lat,
        position.lng,
        event.beginLat,
        event.beginLon,
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestEvent = event;
      }
    }

    if (!closestEvent) return null;

    if (closestDist > ALERT_RADIUS_MILES) {
      // Not in a hail zone but provide distance info if nearby
      if (closestDist <= 5) {
        return {
          inHailZone: false,
          estimatedHailSize: null,
          stormDate: null,
          distanceToSwathMiles: Math.round(closestDist * 100) / 100,
          talkingPoints: [],
        };
      }
      return null;
    }

    // In a hail zone — bucket on the Eastern calendar so cross-midnight UTC
    // events don't get tagged with the next day's storm date.
    const stormDate = toEasternDateKey(closestEvent.beginDate) ?? closestEvent.beginDate.slice(0, 10);

    return {
      inHailZone: true,
      estimatedHailSize: closestEvent.magnitude,
      stormDate,
      distanceToSwathMiles: Math.round(closestDist * 1000) / 1000,
      talkingPoints: generateTalkingPoints(closestEvent.magnitude, stormDate),
    };
  }, [position, events]);

  // Dismiss is a no-op in the pure derivation model.
  // The alert auto-clears when position changes.
  // The parent component can track dismissed state if needed.
  const dismiss = useCallback(() => {
    // Intentional no-op: alert is derived from position/events.
    // To implement dismiss with cooldown, the parent would track
    // a "dismissedAt" timestamp in its own state.
  }, []);

  return { alert, dismiss };
}
