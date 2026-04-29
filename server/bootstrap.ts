/**
 * Hail Yes — entry-point router.
 *
 * Lets the same `npm start` command boot either the web service or the
 * background-worker service based on HAIL_YES_ROLE. Used so we can run
 * one Railway service for rep-facing API traffic and a second one for
 * prewarm / push-fanout / live-MRMS-alert workers, without per-service
 * start command overrides in the Railway dashboard.
 *
 *   HAIL_YES_ROLE unset / 'web'  → server/index.ts (Express + workers)
 *   HAIL_YES_ROLE='worker'       → server/worker.ts (workers + tiny health)
 */

const role = (process.env.HAIL_YES_ROLE ?? 'web').trim().toLowerCase();

if (role === 'worker') {
  console.log('[bootstrap] HAIL_YES_ROLE=worker — booting worker entry');
  await import('./worker.js');
} else {
  if (role !== 'web' && role !== '') {
    console.warn(
      `[bootstrap] unknown HAIL_YES_ROLE='${role}' — falling back to web`,
    );
  }
  await import('./index.js');
}
