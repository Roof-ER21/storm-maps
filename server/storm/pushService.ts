/**
 * Web push subscription store + sender.
 *
 * The HANDOFF P1 item was "push notifications when GPS detects rep entering
 * a hail-impacted area" — this module provides the server side. The browser
 * subscription is stored per-device (one row per `endpoint`); the fan-out
 * worker (`pushFanout.ts`) reads + filters by territory + sends.
 *
 * VAPID key requirement:
 *   The frontend `subscribeToPushNotifications()` call needs the public key.
 *   Server uses both halves to sign the push payload.
 *
 *   Generate once with:
 *     npx web-push generate-vapid-keys --json
 *
 *   Then set:
 *     VAPID_PUBLIC_KEY  (frontend reads this via VITE_VAPID_PUBLIC_KEY)
 *     VAPID_PRIVATE_KEY
 *     VAPID_SUBJECT     (e.g. 'mailto:contact@roofer21.com')
 *
 * Without VAPID env vars the module is no-op-safe — `sendPushPayload` returns
 * `{ ok: false, reason: 'no-vapid' }` and the rest of the app keeps working.
 */

import webpush from 'web-push';
import { sql as pgSql } from '../db.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || '';
const VAPID_SUBJECT =
  process.env.VAPID_SUBJECT?.trim() || 'mailto:contact@roofer21.com';

let vapidConfigured = false;
try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  }
} catch (err) {
  console.warn('[push] VAPID setup failed', err);
}

export function getPublicVapidKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return vapidConfigured;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  repId?: string | null;
  territoryStates?: string[];
  userAgent?: string;
  label?: string;
}

interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  territory_states: string[] | null;
}

/**
 * Idempotent upsert keyed on `endpoint`. The same browser hitting Subscribe
 * twice updates rather than duplicates.
 */
export async function upsertPushSubscription(
  sub: PushSubscriptionInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { ok: false, error: 'invalid subscription shape' };
  }
  if (!pgSql) return { ok: false, error: 'no db' };
  try {
    type PgJson = Parameters<typeof pgSql.json>[0];
    const states = pgSql.json(
      (sub.territoryStates ?? []) as unknown as PgJson,
    );
    const rows = await pgSql<Array<{ id: number }>>`
      INSERT INTO push_subscriptions (
        endpoint, p256dh, auth, rep_id, territory_states, user_agent, label
      ) VALUES (
        ${sub.endpoint},
        ${sub.keys.p256dh},
        ${sub.keys.auth},
        ${sub.repId ?? null},
        ${states},
        ${sub.userAgent ?? null},
        ${sub.label ?? null}
      )
      ON CONFLICT (endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        rep_id = EXCLUDED.rep_id,
        territory_states = EXCLUDED.territory_states,
        user_agent = EXCLUDED.user_agent,
        label = EXCLUDED.label,
        updated_at = NOW(),
        invalidated_at = NULL
      RETURNING id
    `;
    return { ok: true, id: rows[0]?.id };
  } catch (err) {
    console.warn('[push] upsert failed', err);
    return { ok: false, error: 'db error' };
  }
}

export async function deletePushSubscription(
  endpoint: string,
): Promise<{ ok: boolean }> {
  if (!pgSql) return { ok: false };
  try {
    await pgSql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
    return { ok: true };
  } catch (err) {
    console.warn('[push] delete failed', err);
    return { ok: false };
  }
}

interface FetchSubsForStatesOpts {
  states: string[];
  alertId?: string;
}

/**
 * Read live subscriptions whose territory_states intersect any of the given
 * state codes. Skips subs where lastAlertId already matches (avoids
 * double-pushing the same NWS warning).
 */
export async function listSubscriptionsForStates(
  opts: FetchSubsForStatesOpts,
): Promise<PushSubscriptionRow[]> {
  if (!pgSql) return [];
  const upperStates = opts.states.map((s) => s.toUpperCase());
  try {
    type PgJson = Parameters<typeof pgSql.json>[0];
    const statesJson = pgSql.json(upperStates as unknown as PgJson);
    const rows = await pgSql<PushSubscriptionRow[]>`
      SELECT id, endpoint, p256dh, auth, territory_states
        FROM push_subscriptions
       WHERE invalidated_at IS NULL
         AND territory_states ?| ARRAY(SELECT jsonb_array_elements_text(${statesJson}::jsonb))
         AND (${opts.alertId ?? null}::text IS NULL OR last_alert_id IS DISTINCT FROM ${opts.alertId ?? null}::text)
    `;
    return rows;
  } catch (err) {
    console.warn('[push] listSubscriptionsForStates failed', err);
    return [];
  }
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
}

interface PushResult {
  ok: boolean;
  reason?: 'no-vapid' | 'gone' | 'failed';
  status?: number;
}

/**
 * Send a payload to one subscription. Marks the row invalid on 404/410 so the
 * fan-out worker stops retrying dead subs.
 */
export async function sendPushPayload(
  sub: PushSubscriptionRow,
  payload: PushPayload,
  opts?: { alertId?: string },
): Promise<PushResult> {
  if (!vapidConfigured) return { ok: false, reason: 'no-vapid' };
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      { TTL: 600 },
    );
    if (pgSql) {
      try {
        await pgSql`
          UPDATE push_subscriptions
             SET last_pushed_at = NOW(),
                 last_alert_id  = ${opts?.alertId ?? null}
           WHERE id = ${sub.id}
        `;
      } catch {
        // bookkeeping write — non-fatal
      }
    }
    return { ok: true };
  } catch (err: unknown) {
    const status =
      typeof err === 'object' && err !== null && 'statusCode' in err
        ? (err as { statusCode: number }).statusCode
        : 0;
    if (status === 404 || status === 410) {
      if (pgSql) {
        try {
          await pgSql`UPDATE push_subscriptions SET invalidated_at = NOW() WHERE id = ${sub.id}`;
        } catch {
          // non-fatal
        }
      }
      return { ok: false, reason: 'gone', status };
    }
    return { ok: false, reason: 'failed', status };
  }
}
