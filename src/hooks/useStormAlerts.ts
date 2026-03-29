/**
 * useStormAlerts — Background polling for new storm activity.
 *
 * Checks every 15 minutes for hail events in the last 48 hours
 * near the current search location. Fires push notifications
 * when new events are detected that weren't in the previous check.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, StormEvent } from '../types/storm';
import { searchByCoordinates } from '../services/stormApi';
import { showHailZoneNotification } from '../services/notificationService';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOOKBACK_MONTHS = 1; // Check last ~30 days
const ALERT_RADIUS_MILES = 30;
const STORAGE_KEY = 'hail-yes:storm-alert-watermark';

export interface StormAlert {
  id: string;
  message: string;
  eventCount: number;
  maxHailInches: number;
  stormDate: string;
  detectedAt: string;
  dismissed: boolean;
}

interface UseStormAlertsParams {
  location: LatLng | null;
  enabled: boolean;
  notificationsGranted: boolean;
}

interface UseStormAlertsReturn {
  alerts: StormAlert[];
  dismissAlert: (id: string) => void;
  dismissAll: () => void;
  checking: boolean;
  lastCheckedAt: string | null;
}

function loadWatermark(): { seenEventIds: Set<string>; lastChecked: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { seenEventIds: new Set(), lastChecked: null };
    const parsed = JSON.parse(stored);
    return {
      seenEventIds: new Set(parsed.seenEventIds || []),
      lastChecked: parsed.lastChecked || null,
    };
  } catch {
    return { seenEventIds: new Set(), lastChecked: null };
  }
}

function saveWatermark(seenEventIds: Set<string>, lastChecked: string) {
  try {
    // Keep only last 500 IDs to avoid localStorage bloat
    const ids = [...seenEventIds].slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ seenEventIds: ids, lastChecked }));
  } catch {
    // Silently fail
  }
}

export function useStormAlerts({
  location,
  enabled,
  notificationsGranted,
}: UseStormAlertsParams): UseStormAlertsReturn {
  const [alerts, setAlerts] = useState<StormAlert[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const watermarkRef = useRef(loadWatermark());

  const checkForNewStorms = useCallback(async () => {
    if (!location || !enabled) return;

    setChecking(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);

      const events = await searchByCoordinates(
        location.lat,
        location.lng,
        LOOKBACK_MONTHS,
        ALERT_RADIUS_MILES,
        controller.signal,
      );
      clearTimeout(timeout);

      // Filter to hail events only
      const hailEvents = events.filter((e) => e.eventType === 'Hail' && e.magnitude >= 1.0);

      // Find events we haven't seen before
      const { seenEventIds } = watermarkRef.current;
      const newEvents = hailEvents.filter((e) => !seenEventIds.has(e.id));

      if (newEvents.length > 0) {
        // Group new events by date
        const byDate = new Map<string, StormEvent[]>();
        for (const event of newEvents) {
          const dateKey = event.beginDate.slice(0, 10);
          if (!byDate.has(dateKey)) byDate.set(dateKey, []);
          byDate.get(dateKey)!.push(event);
        }

        const now = new Date().toISOString();
        const newAlerts: StormAlert[] = [];

        for (const [date, dateEvents] of byDate) {
          const maxHail = Math.max(...dateEvents.map((e) => e.magnitude));
          const counties = [...new Set(dateEvents.map((e) => e.county).filter(Boolean))];
          const countyLabel = counties.slice(0, 3).join(', ') || 'your area';
          const message = `${dateEvents.length} new hail report${dateEvents.length > 1 ? 's' : ''} near ${countyLabel} — up to ${maxHail}" hail on ${date}`;

          const alert: StormAlert = {
            id: `alert-${date}-${now}`,
            message,
            eventCount: dateEvents.length,
            maxHailInches: maxHail,
            stormDate: date,
            detectedAt: now,
            dismissed: false,
          };
          newAlerts.push(alert);

          // Fire push notification
          if (notificationsGranted) {
            void showHailZoneNotification({
              title: `New Hail Activity — ${maxHail}" detected`,
              body: message,
              tag: `storm-alert-${date}`,
            });
          }
        }

        setAlerts((prev) => [...newAlerts, ...prev].slice(0, 20));
      }

      // Update watermark with ALL current event IDs
      const allIds = new Set(watermarkRef.current.seenEventIds);
      for (const e of hailEvents) allIds.add(e.id);
      const checkedAt = new Date().toISOString();
      watermarkRef.current = { seenEventIds: allIds, lastChecked: checkedAt };
      saveWatermark(allIds, checkedAt);
      setLastCheckedAt(checkedAt);
    } catch {
      // Silently fail — will retry next interval
    } finally {
      setChecking(false);
    }
  }, [enabled, location, notificationsGranted]);

  // Initial check + interval polling
  useEffect(() => {
    if (!enabled || !location) return;

    // Check immediately on mount
    void checkForNewStorms();

    const interval = setInterval(() => {
      void checkForNewStorms();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [checkForNewStorms, enabled, location]);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, dismissed: true } : a));
  }, []);

  const dismissAll = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, dismissed: true })));
  }, []);

  return { alerts, dismissAlert, dismissAll, checking, lastCheckedAt };
}
