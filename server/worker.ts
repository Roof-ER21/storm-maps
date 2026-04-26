/**
 * Hail Yes — standalone worker entry.
 *
 * Runs only the background work that doesn't need to be on the request path:
 *   - prewarm scheduler (6h cycle: wind / hail / events / hot props /
 *     consilience for VA/MD/PA hot properties)
 *   - NWS warning push fan-out (90s poll → SVR/TOR push)
 *   - Live MRMS alert worker (5min poll → hail-band escalation push)
 *
 * Why separate from server/index.ts: a single worker hiccup (network drop
 * to upstream feed, OOM during MRMS GRIB decode, slow consilience compute)
 * shouldn't slow rep-facing API requests. Run this on its own Railway
 * service ("hail-yes-worker") with `npm run worker`.
 *
 * The main server/index.ts still embeds workers by default for convenience
 * in dev/staging. To disable embedded workers when this worker service is
 * running, set HAIL_YES_DISABLE_WORKERS=1 on the web service.
 *
 * Boots a tiny health-check HTTP listener on PORT so Railway's healthcheck
 * passes — pure worker containers can use this pattern without the full
 * Express tree.
 */

import http from 'node:http';
import { startPrewarmScheduler, getPrewarmStatus } from './storm/scheduler.js';
import { startPushFanout, getPushFanoutStatus } from './storm/pushFanout.js';
import {
  startLiveMrmsAlertWorker,
  getLiveMrmsAlertStatus,
} from './storm/liveMrmsAlertWorker.js';

const PORT = parseInt(process.env.PORT || '3200', 10);

process.on('unhandledRejection', (reason: unknown) => {
  console.error('[worker] unhandledRejection', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[worker] uncaughtException', err.stack);
});

const server = http.createServer((req, res) => {
  if (req.url === '/api/health' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        role: 'worker',
        timestamp: new Date().toISOString(),
        prewarm: getPrewarmStatus(true),
        pushFanout: getPushFanoutStatus(),
        liveMrms: getLiveMrmsAlertStatus(),
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('worker — only /health is exposed');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[worker] Hail Yes! worker running on port ${PORT}`);
  startPrewarmScheduler();
  startPushFanout();
  startLiveMrmsAlertWorker();
});
