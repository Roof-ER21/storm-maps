# Deploy Guide

End-to-end deployment notes for the storm-maps app on Railway (or any
Node 22+ host with Postgres).

## What runs in this repo

| Component | Path | Notes |
|---|---|---|
| React frontend | `src/` → built into `dist/` | Single SPA |
| Express server | `server/index.ts` | Serves `dist/` + `/api/*` |
| Postgres schema | `server/migrate.ts` | Idempotent — runs on every `start` |
| In-repo MRMS GRIB pipeline | `server/storm/mrms*.ts` | No native deps |
| Wind swath service | `server/storm/windSwath*.ts` | SPC + IEM + NWS |
| Storm event aggregator | `server/storm/eventService.ts` | Cached |
| PDF fallback | `server/storm/reportPdf.ts` | PDFKit |
| Push fan-out worker | `server/storm/pushFanout.ts` | NWS warnings → web-push |
| Prewarm scheduler | `server/storm/scheduler.ts` | 6-hour cycle |

The historical Susan21 dependency (`sa21.up.railway.app`) is now optional —
every storm-map path falls back to in-repo. See "Optional integrations".

## Required environment variables

| Var | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | App still boots without it; cache + leads/evidence break |
| `VITE_GOOGLE_MAPS_API_KEY` | Frontend Google Maps load | Build-time only |
| `JWT_SECRET` | Signs login JWTs | Use a random 32+ char string in prod |

## Recommended environment variables

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3100` |
| `NODE_ENV=production` | Enables prewarm + push fan-out implicitly | unset |
| `ADMIN_TOKEN` | Locks `/api/admin/*` (cache, prewarm, push status) | unset → endpoints world-readable, server logs warning |
| `ADMIN_EMAILS` | Comma-list of admin emails for the JWT path | `ahmed@theroofdocs.com` |

## Push notifications

Required to enable `/api/push/subscribe` + the NWS fan-out worker that
pushes severe-warning alerts to subscribed reps.

| Var | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Browser-side push subscribe key (server also needs it) |
| `VAPID_PRIVATE_KEY` | Signs push payloads to the browser endpoint |
| `VAPID_SUBJECT` | `mailto:contact@roofer21.com` (any contact URL) |
| `VITE_VAPID_PUBLIC_KEY` | Optional build-time copy of the public key — frontend will fetch from `/api/push/vapid-public` if unset |

Generate keys once:

```bash
npx web-push generate-vapid-keys --json
```

Toggles:

| Var | Purpose |
|---|---|
| `HAIL_YES_PUSH=1` | Force-enable the fan-out worker (implicitly on with `NODE_ENV=production`) |

## Cache + prewarm

| Var | Purpose |
|---|---|
| `HAIL_YES_PREWARM=1` | Force-enable the scheduler (implicitly on with `NODE_ENV=production`) |

Runs on a 6-hour cycle. First cycle fires 60 s after boot. What's warmed:

- Wind swaths × 30 days × VA / MD+DC / PA
- Hail swaths (only days with SPC reports in bounds)
- Event-cache for the 3 region centers at 12-month range
- Top 25 hot properties (most-recently-used `properties` rows) at their
  individual radius/range

Manual prewarm is also available:

```bash
npm run cache:prewarm
```

## Optional integrations

| Var | Purpose |
|---|---|
| `GOOGLE_STATIC_MAPS_API_KEY` (or reuses `GOOGLE_MAPS_API_KEY`) | PDF report basemap. Without it, the swath map renders against a flat dark rectangle |
| `STRIPE_SECRET_KEY` | Stripe billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_COMPANY` | Plan price IDs |
| `VITE_HAIL_YES_API_BASE` | Override the legacy Susan21 fallback base URL (`https://sa21.up.railway.app/api`) |
| `VITE_STORM_SEARCH_API_BASE` | Optional alternate storm-search backend (legacy Susan21 path) |

## Build / start

```bash
npm install
npm run build           # tsc + vite build → dist/
npm start               # node migrate + node server/index.ts
```

Railway: set the environment variables above, push to the deploy branch,
Railway runs `npm start` automatically. The `start` script runs `migrate`
first so schema is always up to date.

## Health + status

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | Liveness |
| `GET /api/admin/cache-status` | admin | swath_cache counts + freshness |
| `POST /api/admin/cache-purge` | admin | Drop expired rows |
| `GET /api/admin/prewarm-status` | admin | Last cycle stats |
| `GET /api/admin/push-status` | admin | NWS fan-out cycles + push counts |
| `GET /api/push/vapid-public` | none | Frontend fetches the public VAPID key |

The `/admin` SPA route renders all four. Bookmark
`https://your-app.com/#admin` — it's intentionally not in the main nav.
Paste `ADMIN_TOKEN` once and it's stored in `sessionStorage` for the tab.

## Rate limits (defaults)

| Path | Limit |
|---|---|
| `/api/*` | 300 req / 15 min / IP |
| `/api/admin/*` | 60 req / 15 min / IP |
| `/api/push/subscribe` | 20 req / hr / IP |

## Postgres tables

`server/migrate.ts` creates these on every boot (idempotent):

```
reps                       leads                  evidence
properties                 archives               shareable_reports
users                      swath_cache            event_cache
push_subscriptions
```

Plus the AI property-analysis tables registered via `ensureAiTables`.

## Sanity checks after deploy

```bash
# storm map basics
curl https://your-app.com/api/health

# real GRIB pipeline (cold path ~3-5s, warm <50ms)
curl 'https://your-app.com/api/hail/mrms-vector?date=2024-08-29&north=39.5&south=38.0&east=-76.0&west=-78.0' \
  | jq '.features | length'

# wind aggregator
curl 'https://your-app.com/api/wind/swath-polygons?date=2024-08-29&north=39.5&south=38.0&east=-76.0&west=-78.0' \
  | jq '.metadata'

# event cache
curl 'https://your-app.com/api/storm/events?lat=38.79&lng=-77.13&radius=35&months=12' \
  | jq '.metadata'

# admin (after setting ADMIN_TOKEN)
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-app.com/api/admin/cache-status | jq
```

## Common gotchas

- **Push subscribe fails with `no-vapid-key`.** Set `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` and redeploy. The frontend either
  uses `VITE_VAPID_PUBLIC_KEY` at build time or fetches `/api/push/vapid-public`
  at runtime.
- **MRMS endpoint 502.** IEM MTArchive may be slow or the file may not
  exist yet for "today". The frontend falls through to the SPC/LSR-based
  swath fallback, so the map still has polygons.
- **Prewarm scheduler "disabled" in production.** Either `HAIL_YES_PREWARM=1`
  or `NODE_ENV=production` enables it. Check `/api/admin/prewarm-status`.
- **Admin endpoints return 401.** Set `ADMIN_TOKEN` and paste it into the
  `/admin` page (saved in sessionStorage). Or log in as a user whose email
  is in `ADMIN_EMAILS` (or whose `plan = 'company'`).
