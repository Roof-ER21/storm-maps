# DESKTOP-SETUP.md — RIQ 21 dev from Desktop (Windows + WSL)

Setup notes for running RIQ 21 locally from the desktop workstation. Mac's setup uses a local Postgres clone; Desktop connects directly to Railway prod Postgres via the public proxy. Both are valid — pick the pattern that matches the machine.

## TL;DR

```powershell
# From C:\Users\Alima\storm-maps in PowerShell
git checkout riq21
git pull --ff-only origin riq21

# Pull prod DB URL from the Postgres service (NOT the riq21 service — see "Gotchas")
$env:DATABASE_URL = (railway variables --service Postgres --kv | sls '^DATABASE_PUBLIC_URL=').Line.Split('=',2)[1]

npm install     # first time only
npm run dev:server    # backend on :3100, NO `railway run` wrapper
```

In a second terminal:

```powershell
npm run dev    # vite frontend on :5180
```

Verify: `curl http://localhost:3100/health` → `{"ok":true,"service":"riq21"}`

## Repo + branch

- **Repo:** `https://github.com/Roof-ER21/storm-maps` (dir name is `storm-maps`; brand + app are RIQ 21)
- **Working branch:** `riq21` — all active work lives here. `origin/main` is stale; do NOT branch off it.
- **Both machines stay on `riq21`** and sync via `origin/riq21`. When `riq21` is stable enough to promote, merge → `main` together (no unilateral merges).

## Railway project naming

This trips everyone. The Railway *project* is named **"Old Map"** (legacy). The *service* inside it is `riq21`. The hostname `riq21-production.up.railway.app` comes from the service name, not a project named riq21.

| What | Value |
|---|---|
| Railway project | `Old Map` (id `0325c87e-48a0-40ec-8ac9-fd8392abc86e`) |
| Railway service (app) | `riq21` (id `015b8f9c-b3e8-4f5a-8b78-bd0b09bccf0a`) |
| Railway service (db) | `Postgres` |
| Public URL | `https://riq21-production.up.railway.app` |

To link this clone:

```powershell
railway link -w "roof-er21's Projects" -p "Old Map" -e production -s riq21
```

## Database connection patterns

The server reads `DATABASE_URL` (see `server/db.ts`). Two valid ways to provide it:

### Pattern A — Desktop default (no local Postgres)

Pull the public proxy URL from the `Postgres` service at session start:

```powershell
$env:DATABASE_URL = (railway variables --service Postgres --kv | sls '^DATABASE_PUBLIC_URL=').Line.Split('=',2)[1]
npm run dev:server
```

You are now reading + writing **prod Postgres** directly. Be careful — destructive queries hit real data.

### Pattern B — Mac default (local Postgres clone)

Mac's `.env.local` sets `DATABASE_URL=postgresql://a21@localhost:5432/hailyes` against a local Postgres with a cloned dataset. This is faster and safer for experimentation but requires installing Postgres and seeding the db. Not recommended for Desktop unless we want to set up a parallel local clone there too.

### What does NOT work

```powershell
# ❌ DON'T
railway run npm run dev:server
```

The `riq21` service's `DATABASE_URL` is Railway's internal VPC hostname (`postgres.railway.internal`), which only resolves inside Railway's network. `railway run` injects it into the child process, overriding anything you exported. Result: `getaddrinfo ENOTFOUND postgres.railway.internal` and `denial-intake.ensureIntakeTables` fails on boot.

Only the `Postgres` service exposes `DATABASE_PUBLIC_URL`. That's why Pattern A pulls from `--service Postgres`, not `--service riq21`.

## Ports

| Service | Port | Process |
|---|---|---|
| Backend (Express) | 3100 | `npm run dev:server` (`tsx watch`) |
| Frontend (Vite) | 5180 | `npm run dev` |
| Prod URL | — | `https://riq21-production.up.railway.app` |

If port 3100 is busy, kill the prior `tsx watch` process before restarting (don't run two backends against prod Postgres simultaneously).

## Other env vars (optional but useful)

These are nice-to-haves; the server boots without them but some features degrade.

```powershell
$env:RIQ_API_KEYS = "riq_79aefbc2863218647b869aea0052bbc99c1b5178f32cd513"
$env:RIQ_CORS_ORIGINS = "https://cc21-web-production.up.railway.app,http://localhost:5180"
$env:GEMINI_API_KEY = "<from Bitwarden / ask Ahmed>"
$env:BOOTSTRAP_PIN = "<only for admin bootstrap; leave unset normally>"
```

For frontend (`vite`), set `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` (gitignored). Get a key from Google Cloud Console with Maps JavaScript + Places + Geocoding APIs enabled, or copy from Mac's `.env.local`.

## Daily refresh scheduler

When backend boots you'll see:

```
[scheduler] Daily refresh scheduled for 09:33 UTC
```

That's the in-process daily refresh of intel tables (`intel_projects`, `intel_customer_exposure`, `intel_lifetime_touch`). Runs in prod automatically; in local dev it will also fire if you leave the backend running across 09:33 UTC. Usually harmless — it just re-aggregates. If you want to skip, kill the backend before that time.

There's also a parallel launchd job on Mac (`com.theroofdocs.intel-refresh`) that runs weekday business hours with random jitter for stealth refresh. Desktop has no equivalent — not needed.

## Git sync protocol (Mac ↔ Desktop)

Both machines work on the `riq21` branch. Protocol:

1. **Pull first:** `git pull --ff-only origin riq21` before starting work.
2. **Commit early + often,** even WIP. Small commits are easier to rebase than big ones.
3. **Push immediately:** `git push origin riq21`.
4. **Before editing canonical files,** ping coord (`D:\shadow21\COORD-YYYY-MM-DD.md`) so the other side doesn't push on top.
5. **No unilateral merges to `main`** — promote together.

### Canonical files (extra care)

- `server/intel/carrier-normalize.mjs` — single source of truth for carrier name matching. NEVER inline carrier matching elsewhere. See `riq21-carrier-dedup-2026-05-13` memory.
- `data/naic-complaint-index.json` — NAIC complaint data. Refreshed periodically; if both sides touch it the same day, coordinate.
- `server/db.ts` — DB connection config.
- `package.json` — coordinate dependency changes (lockfile conflicts are painful).

## Editor / IDE notes

- TypeScript build: `npm run build` (= `tsc -b && vite build`). Run this before pushing — `tsc --noEmit` is a no-op in this repo because root `tsconfig.json` has `files: []` (see `feedback_storm-maps-tsc-noemit-noop` memory). Don't skip the full build.
- ESLint: `npm run lint`.

## Troubleshooting

### Backend boots then immediately exits / `denial-intake.ensureIntakeTables` ENOTFOUND

Your `DATABASE_URL` is the internal Railway hostname. See "What does NOT work" above. Fix: re-export `DATABASE_URL` from `DATABASE_PUBLIC_URL` of the `Postgres` service, then re-run without `railway run`.

### `railway link` says project not found

The project is "Old Map" with a space. Quote it:

```powershell
railway link -w "roof-er21's Projects" -p "Old Map" -e production -s riq21
```

### Frontend can't reach backend

Vite dev server is :5180, backend is :3100. The frontend proxies `/api/*` to localhost:3100 via `vite.config.ts`. If you hit CORS in browser console, check `RIQ_CORS_ORIGINS` includes `http://localhost:5180`.

### Postgres connection slow / times out

Public proxy (`gondola.proxy.rlwy.net:48564`) is slower than local. If a query takes >5s locally that runs in 50ms on Railway, that's the proxy, not the code. For heavy work, ship to Railway and test in prod.

### "Mac works but Desktop doesn't"

90% of the time this is env var differences. Compare `printenv | grep -E 'DATABASE|RIQ|GEMINI'` (Mac) vs `gci env: | ? Name -match 'DATABASE|RIQ|GEMINI'` (Desktop). Mac's `.env.local` is gitignored, so it's an invisible source of drift.

## Cross-CC coordination

Coord file: `D:\shadow21\COORD-YYYY-MM-DD.md` (per `feedback_shadow21-cross-cc-coord` memory). When both Mac CC and Desktop CC are active, append progress + claims there so we don't write past each other. Today's file = today's UTC-ish date; new file at midnight local.

## See also

- Memory: `riq21-platform.md` — single source of truth for URLs, IDs, API key
- Memory: `feedback_moving-project-off-desktop.md` — why repo lives at `~/storm-maps` not `~/Desktop/storm-maps` on Mac
- Memory: `feedback_storm-maps-tsc-noemit-noop.md` — build-verify gotcha
- Memory: `riq21-carrier-dedup-2026-05-13.md` — carrier-normalize.mjs canon
- `RIQ-API.md` — endpoint catalog
- `DEPLOY.md` — Railway deploy instructions
