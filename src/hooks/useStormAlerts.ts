/**
 * useStormAlerts — Background polling for new storm activity.
 *
 * Each poll cycle runs two checks in parallel:
 *   1. Historical hail events via NCEI SWDI / optional search backend.
 *   2. NWS Active Alerts for live Severe Thunderstorm Warnings with hail.
 *
 * Fires push notifications when:
 *   - New historical hail events are detected near the user's location.
 *   - A NWS active warning with hail >= 0.75" is found near the user
 *     (high-priority notification; deduplicated by alert ID across sessions).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, StormEvent } from '../types/storm';
import { searchByCoordinates } from '../services/stormApi';
import { fetchAlertsByArea, type NwsAlert } from '../services/nwsAlerts';
import { showHailZoneNotification } from '../services/notificationService';

const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOOKBACK_MONTHS = 1; // Check last ~30 days
const ALERT_RADIUS_MILES = 30;
const STORAGE_KEY = 'hail-yes:storm-alert-watermark';

/**
 * NWS alert hail threshold for triggering a high-priority notification.
 * Warnings below this size are still shown in-app but do not push-notify.
 */
const NWS_NOTIFY_THRESHOLD_INCHES = 0.75;

export interface StormAlert {
  id: string;
  message: string;
  eventCount: number;
  maxHailInches: number;
  stormDate: string;
  detectedAt: string;
  dismissed: boolean;
  /** When true this alert originated from a NWS live warning (not historical). */
  isLiveWarning?: boolean;
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

// ---------------------------------------------------------------------------
// Watermark persistence
// ---------------------------------------------------------------------------

interface Watermark {
  /** IDs of historical storm events already surfaced to the user. */
  seenEventIds: Set<string>;
  /** IDs of NWS active alert IDs already notified (prevents repeat pushes). */
  seenNwsIds: Set<string>;
  lastChecked: string | null;
}

function loadWatermark(): Watermark {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { seenEventIds: new Set(), seenNwsIds: new Set(), lastChecked: null };
    const parsed = JSON.parse(stored);
    return {
      seenEventIds: new Set(parsed.seenEventIds || []),
      seenNwsIds: new Set(parsed.seenNwsIds || []),
      lastChecked: parsed.lastChecked || null,
    };
  } catch {
    return { seenEventIds: new Set(), seenNwsIds: new Set(), lastChecked: null };
  }
}

function saveWatermark(watermark: Watermark): void {
  try {
    // Keep only last 500 IDs per set to avoid localStorage bloat
    const eventIds = [...watermark.seenEventIds].slice(-500);
    const nwsIds = [...watermark.seenNwsIds].slice(-200);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        seenEventIds: eventIds,
        seenNwsIds: nwsIds,
        lastChecked: watermark.lastChecked,
      }),
    );
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStormAlerts({
  location,
  enabled,
  notificationsGranted,
}: UseStormAlertsParams): UseStormAlertsReturn {
  const [alerts, setAlerts] = useState<StormAlert[]>([]);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const watermarkRef = useRef<Watermark>(loadWatermark());

  const checkForNewStorms = useCallback(async () => {
    if (!location || !enabled) return;

    setChecking(true);
    try {
      const controller = new AbortController();
      // Allow 25 s total for the combined fetch; each sub-request has its own
      // internal timeout so this outer abort is just a safety net.
      const timeout = setTimeout(() => controller.abort(), 25_000);

      // Run historical SWDI/search check and NWS live alert check in parallel.
      const [events, nwsAlerts] = await Promise.allSettled([
        searchByCoordinates(
          location.lat,
          location.lng,
          LOOKBACK_MONTHS,
          ALERT_RADIUS_MILES,
          controller.signal,
        ),
        fetchAlertsByArea(location.lat, location.lng, ALERT_RADIUS_MILES, controller.signal),
      ]);

      clearTimeout(timeout);

      const now = new Date().toISOString();
      const newAlerts: StormAlert[] = [];
      const watermark = watermarkRef.current;

      // ------------------------------------------------------------------
      // 1. Process historical hail events (SWDI / search backend)
      // ------------------------------------------------------------------
      if (events.status === 'fulfilled') {
        const hailEvents = events.value.filter(
          (e: StormEvent) => e.eventType === 'Hail' && e.magnitude >= 0.25,
        );

        const newHistoricalEvents = hailEvents.filter(
          (e: StormEvent) => !watermark.seenEventIds.has(e.id),
        );

        if (newHistoricalEvents.length > 0) {
          // Group new events by date for one alert per storm day.
          const byDate = new Map<string, StormEvent[]>();
          for (const event of newHistoricalEvents) {
            const dateKey = event.beginDate.slice(0, 10);
            if (!byDate.has(dateKey)) byDate.set(dateKey, []);
            byDate.get(dateKey)!.push(event);
          }

          for (const [date, dateEvents] of byDate) {
            const maxHail = Math.max(...dateEvents.map((e) => e.magnitude));
            const counties = [...new Set(dateEvents.map((e) => e.county).filter(Boolean))];
            const countyLabel = counties.slice(0, 3).join(', ') || 'your area';
            const message =
              `${dateEvents.length} new hail report${dateEvents.length > 1 ? 's' : ''}` +
              ` near ${countyLabel} — up to ${maxHail}" hail on ${date}`;

            newAlerts.push({
              id: `alert-${date}-${now}`,
              message,
              eventCount: dateEvents.length,
              maxHailInches: maxHail,
              stormDate: date,
              detectedAt: now,
              dismissed: false,
              isLiveWarning: false,
            });

            if (notificationsGranted) {
              void showHailZoneNotification({
                title: `New Hail Activity — ${maxHail}" detected`,
                body: message,
                tag: `storm-alert-${date}`,
              });
            }
          }
        }

        // Advance watermark with all IDs seen this cycle.
        const updatedEventIds = new Set(watermark.seenEventIds);
        for (const e of hailEvents) updatedEventIds.add(e.id);
        watermark.seenEventIds = updatedEventIds;
      } else {
        console.warn('[useStormAlerts] Historical storm check failed:', events.reason);
      }

      // ------------------------------------------------------------------
      // 2. Process NWS live active alerts
      // ------------------------------------------------------------------
      if (nwsAlerts.status === 'fulfilled' && nwsAlerts.value.length > 0) {
        const updatedNwsIds = new Set(watermark.seenNwsIds);

        for (const nwsAlert of nwsAlerts.value) {
          const isNew = !watermark.seenNwsIds.has(nwsAlert.id);
          updatedNwsIds.add(nwsAlert.id);

          // Always surface a new active warning in the in-app alert list.
          if (isNew) {
            const stormDate = nwsAlert.onset
              ? nwsAlert.onset.slice(0, 10)
              : now.slice(0, 10);

            const hailLabel = nwsAlert.maxHailInches > 0
              ? `${nwsAlert.maxHailInches}" hail`
              : 'hail';
            const windLabel = nwsAlert.maxWindMph
              ? ` / ${nwsAlert.maxWindMph} mph wind`
              : '';
            const areaLabel = nwsAlert.areaDesc
              ? nwsAlert.areaDesc.slice(0, 80) + (nwsAlert.areaDesc.length > 80 ? '…' : '')
              : 'your area';

            const message =
              `LIVE WARNING: ${hailLabel}${windLabel} — ${areaLabel}`;

            newAlerts.push({
              id: `nws-${nwsAlert.id}`,
              message,
              eventCount: 1,
              maxHailInches: nwsAlert.maxHailInches,
              stormDate: stormDate,
              detectedAt: now,
              dismissed: false,
              isLiveWarning: true,
            });

            // Push notify only when hail meets the priority threshold.
            if (notificationsGranted && nwsAlert.maxHailInches >= NWS_NOTIFY_THRESHOLD_INCHES) {
              void showHailZoneNotification({
                title: `LIVE: Severe Thunderstorm Warning — ${nwsAlert.maxHailInches}" hail`,
                body: message,
                tag: `nws-warning-${nwsAlert.id}`,
              });
            }
          }
        }

        watermark.seenNwsIds = updatedNwsIds;
      } else if (nwsAlerts.status === 'rejected') {
        console.warn('[useStormAlerts] NWS live alert check failed:', nwsAlerts.reason);
      }

      // Merge new alerts into state (newest first, capped at 20).
      if (newAlerts.length > 0) {
        setAlerts((prev) => [...newAlerts, ...prev].slice(0, 20));
      }

      const checkedAt = new Date().toISOString();
      watermark.lastChecked = checkedAt;
      watermarkRef.current = watermark;
      saveWatermark(watermark);
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
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed: true } : a)));
  }, []);

  const dismissAll = useCallback(() => {
    setAlerts((prev) => prev.map((a) => ({ ...a, dismissed: true })));
  }, []);

  return { alerts, dismissAlert, dismissAll, checking, lastCheckedAt };
}
