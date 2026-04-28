# Handoff for Codex — NCEI SWDI log noise + circuit-breaker

**Repo:** `/Users/a21/Desktop/storm-maps` (deployed at https://hailyes.up.railway.app)
**Date:** 2026-04-28
**Severity:** Cosmetic right now (logs only) but may be hiding a real outage. Server is up and serving traffic; this is about cleaning the log feed and adding a circuit-breaker so a third-party outage doesn't burn 70+ requests/cycle.

---

## What you'll see in the Railway logs

```
[swdi]   fetch failed (suppressing further): fetch failed
[nx3mda] fetch failed: fetch failed
[nx3mda] fetch failed: fetch failed
[nx3mda] fetch failed: fetch failed
... (70+ identical lines)
[nx3mda] fetch failed: This operation was aborted
[iem-vtec] fetch failed (suppressing further): fetch failed
```

`swdi` and `iem-vtec` log **once per process** (suppression already in place).
`nx3mda` logs **every single failure** — ~120 lines per prewarm cycle when NCEI is down.

The site at `https://www.ncei.noaa.gov/swdiws/csv/...` was returning HTTP 000 (no response, network unreachable) at the time these logs were captured — confirmed via `curl -m 6` from outside Railway:

```
$ curl -s -m 6 -o /dev/null -w "HTTP %{http_code} | %{time_total}s\n" \
    "https://www.ncei.noaa.gov/swdiws/csv/nx3mda/202404150000:202404160000?bbox=-78,38,-77,39"
HTTP 000 | 6.005245s
```

So the upstream was genuinely down or unreachable. The bug is that nx3mda hammers it 120×/cycle and logs every failure.

---

## Two things to fix

### 1. Log suppression for `nx3mda` (1-line bug, 30s fix)

Mirror the pattern that `ncerSwdiClient.ts` and `iemVtecClient.ts` already use.

**File:** `server/storm/nceiNx3MdaClient.ts`

**Current** (lines 80–91):
```ts
    if (!res.ok) {
      console.warn(`[nx3mda] HTTP ${res.status}`);
      return [];
    }
    const csv = await res.text();
    return parseMesoCsv(csv, q.minStrength ?? 5);
  } catch (err) {
    console.warn('[nx3mda] fetch failed:', (err as Error).message);
    return [];
  }
}
```

**Reference** (already implemented in `ncerSwdiClient.ts` lines 80–95):
```ts
    if (!res.ok) {
      if (!swdiHttpWarned.has(res.status)) {
        swdiHttpWarned.add(res.status);
        console.warn(`[swdi] HTTP ${res.status} — suppressing further warnings for this status`);
      }
      return [];
    }
    ...
  } catch (err) {
    if (!swdiFetchWarned) {
      swdiFetchWarned = true;
      console.warn('[swdi] fetch failed (suppressing further):', (err as Error).message);
    }
    return [];
  }
}

const swdiHttpWarned = new Set<number>();
let swdiFetchWarned = false;
```

Apply the same shape to `nceiNx3MdaClient.ts`. Add `nx3mdaHttpWarned: Set<number>` and `nx3mdaFetchWarned: boolean` module-level state, gate both warnings on them.

### 2. Circuit breaker shared across NCEI SWDI clients

`nx3mda`, `nx3hail` (= `ncerSwdiClient`), and any other `swdiws/csv/*` clients all hit the same upstream host (`www.ncei.noaa.gov/swdiws`). When that host is down, **every** prewarm cycle still pays the 6-8s timeout per client per (property,date) pair.

For 30 hot properties × 4 dates × ~3 SWDI clients = ~360 calls × 6-8s = **30+ minutes of dead-wait per cycle** — even though we suppress the logs, the wait still happens and pushes downstream `Promise.all` builds out by minutes.

**Suggested approach (implementer's choice):**

Add a tiny shared circuit-breaker module, e.g. `server/storm/swdiCircuitBreaker.ts`:

```ts
// Returns true while the host is in cooldown after a streak of failures.
let consecutiveFailures = 0;
let cooldownUntil = 0;
const FAILURE_THRESHOLD = 5;          // 5 consecutive fails → trip
const COOLDOWN_MS = 5 * 60_000;       // 5 min cooldown

export function swdiHostDown(): boolean {
  return Date.now() < cooldownUntil;
}
export function recordSwdiSuccess(): void {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}
export function recordSwdiFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    console.warn('[swdi-cb] host marked down — cooldown 5 min');
  }
}
```

Then in each SWDI fetcher (`fetchMesocyclones`, `fetchSwdiHailReports`, etc.):
- Short-circuit at the top: `if (swdiHostDown()) return [];`
- On success: `recordSwdiSuccess()`
- In the catch: `recordSwdiFailure()`

When the host comes back, the next post-cooldown call either succeeds (resets the counter) or trips again.

**Alternative simpler approach** (if you prefer): just guard `fetchMesocyclones` with a per-module `lastFailureMs` and skip if within 5 minutes. Less DRY but only one file changes.

---

## How to verify your fix

```bash
cd /Users/a21/Desktop/storm-maps

# 1. TS compiles
npm run build

# 2. Existing tests still pass
npx tsx scripts/test-display-cap.ts        # 65 passing
npx tsx scripts/test-storm-metrics.ts      # 29 passing

# 3. Local smoke — boot the server and hit the consilience prewarm path.
#    The consilience builder is exported and pure-ish; you can call it
#    directly without spinning the full server:
node --import tsx -e "
import('./server/storm/consilienceService.ts').then(async (m) => {
  const r = await m.buildConsilience({
    lat: 38.9215, lng: -77.2342, date: '2024-04-15', radiusMiles: 15,
  });
  console.log('confirmedCount:', r?.confirmedCount, 'sources:', r?.confirmedSources);
});
"

# 4. Deploy + check the log noise is gone
railway up --detach
# wait ~2 min, then:
# scroll Railway logs — should see at most ONE [nx3mda] line per process,
# plus a [swdi-cb] cooldown line if you implemented the circuit breaker.
```

A good visible win: tail the live logs for 10 minutes after deploy and verify you see **≤ 2 `[nx3mda]` lines total** (one fetch-failed, one circuit-trip), instead of the current 120/cycle.

---

## Files involved

| File | Why |
|---|---|
| `server/storm/nceiNx3MdaClient.ts` | The one with no log suppression — primary edit target |
| `server/storm/ncerSwdiClient.ts` | Reference pattern (suppression already done) |
| `server/storm/iemVtecClient.ts` | Reference pattern (suppression already done) |
| `server/storm/consilienceService.ts` (line 266) | Calls `fetchMesocyclones` from a `Promise.all` — circuit-broken caller |
| `server/storm/scheduler.ts` (lines 340-425) | The 30-properties × 4-dates prewarm that amplifies the problem |
| `server/storm/swdiCircuitBreaker.ts` | **NEW FILE** if you go with the shared-CB approach |

---

## Background context (so you don't have to dig)

- **Storm-maps** = "Hail Yes!" — adjuster-facing storm intelligence platform. Reps pin properties, app pre-warms 10-source consilience corroboration so the dashboard loads in <50ms instead of running 8s of concurrent network fetches per render.
- **Consilience** = a 10-source agreement check (NCEI Storm Events, IEM LSR, MRMS swath, NCEI SWDI nx3hail, NCEI SWDI **nx3mda** ← this one, NWS warnings, mPING, CoCoRaHS, SPC hail, Synoptic mesonet). Each adds a "vote." ≥3/10 → "certified" badge. nx3mda contributes the supercell-rotation vote.
- **Why the prewarm runs at all**: dashboard would be unusably slow without it. Reps complained of 5-8s page loads in early March 2026; consilience prewarm fixed that. Memory ref: `automation-overhaul-apr18.md`.
- **Why NCEI was down today**: unknown. Could be NOAA infra outage, expired cert, or a Railway egress issue. Don't try to fix the upstream — just make our side handle the outage gracefully.
- **Don't widen the fix to other suppressed clients**: `swdi` and `iem-vtec` already suppress correctly. `mping` and `cocorahs` already self-disable at module load on 404 (`endpoint returns 404 — disabling source for this process`). No-op those.

---

## Recent related commits (for context, not for cherry-pick)

```
9b252b8 test: cover computePeakTimeFromPoints + computeDurationFromPoints
ff33c1b fix(pdf): align Size of Hail Detected with narrative — prefer at-pin signals
4bd7c5e chore: rebrand Census proxy User-Agent header to Hail Yes Storm Intelligence
a1a8266 fix: widen Size of Hail Detected fallback + prevent iOS auto-zoom on inputs
699dce5 fix(pdf): extract clean City, ST from address for narrative location
1f1a429 fix(pdf): fall back Size of Hail Detected to closest ground report ≤1mi
ee21ee6 fix(pdf): default frontend company name to Hail Yes Storm Intelligence
fc2afa5 fix(pdf): default rep name to Hail Yes Rep, not Roof-ER21 Rep
1055b54 fix(pdf): populate Hail Impact Details + rebrand Roof-ER → Hail Yes/HYSI
7764540 fix(map): mobile overlap + fullscreen toggle + live-cells cache + Census proxy
```

The PDF + mobile work above is settled; this handoff is about logging hygiene only. Don't touch the PDF or mobile code.

---

## Acceptance criteria

- [ ] `[nx3mda] fetch failed: ...` appears at most ONCE per process (not 70+).
- [ ] `[nx3mda] HTTP <code>` appears at most once per status code per process.
- [ ] `npm run build` is clean.
- [ ] `npx tsx scripts/test-display-cap.ts` still 65/65.
- [ ] `npx tsx scripts/test-storm-metrics.ts` still 29/29.
- [ ] If you add the circuit breaker: when `nx3mda` is down, the prewarm cycle finishes in seconds instead of minutes (visible in `[prewarm] cycle 1 done` line latency).
- [ ] When the upstream comes back, the next call after cooldown succeeds and the breaker resets (don't leave a stuck-open breaker).

## Out of scope

- Don't try to fix the NCEI outage (it's their infra, we have no control).
- Don't change the `mping` / `cocorahs` 404-disable behavior (intentional).
- Don't touch the PDF code, mobile UX, or Census proxy — separate workstreams.
- Don't change the consilience scoring or prewarm cap.
