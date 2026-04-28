/**
 * Shared process-level circuit breaker for NCEI SWDI endpoints.
 *
 * The SWDI CSV/JSON services can become unreachable for minutes at a time.
 * Without this guard every prewarm pair pays the full request timeout against
 * the same down host. Five consecutive upstream failures open a short cooldown
 * window; the first request after cooldown probes the host and either resets
 * the breaker on success or opens it again.
 */

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 5 * 60_000;

let consecutiveFailures = 0;
let cooldownUntil = 0;

export function swdiHostDown(now = Date.now()): boolean {
  return now < cooldownUntil;
}

export function recordSwdiSuccess(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}

export function recordSwdiFailure(source = 'swdi', now = Date.now()): void {
  if (swdiHostDown(now)) return;

  consecutiveFailures += 1;
  if (consecutiveFailures < FAILURE_THRESHOLD) return;

  cooldownUntil = now + COOLDOWN_MS;
  console.warn(
    `[swdi-cb] NCEI SWDI host marked down for ${Math.round(
      COOLDOWN_MS / 60_000,
    )} min after ${consecutiveFailures} consecutive failures; latest=${source}`,
  );
}

