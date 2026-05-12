# RIQ 21 AI Combat Suite — V2 Handoff
**Date:** 2026-05-12
**Status:** V1 live at https://riq21-production.up.railway.app
**Next pickup:** PDF/image intake → real denial corpus → self-learning loop

---

## What's live right now (V1)

| Tool | Endpoint | Page | Status |
|------|----------|------|--------|
| Patent Decoder | `GET /api/intel/carrier-patents` | `/cheat-sheet.html` (carrier view) | ✅ 22 patents |
| Denial Analyzer | `POST /api/intel/analyze-denial` | `/denial-analyzer.html` | ✅ Working, paste-text only |
| Adjuster Twin | `GET/POST /api/intel/adjuster-twin/*` | `/adjuster-twin.html` | ✅ 48 adjusters profiled |
| Lifetime Touch | `GET /api/intel/lifetime-touch` | `/lifetime-touch.html` | ✅ 1,951 customers, 86 reps |

**Limitations of V1:**
- Denial Analyzer requires paste-text (no PDF/image upload yet)
- Adjuster Twin doesn't accept photos for vision-based scope check
- Patent corpus has 6 weak extracts (0 decision rules) — generic framework patents
- No real denial corpus → analyzer is purely patent-derived, not pattern-validated
- No outcome tracking → can't tell which counter-letter strategies actually work

---

## The "Does this need training data?" question

**Short answer: No fine-tuning needed. But it WILL get sharper with a real-denial corpus.**

| Approach | Need? | Why / Why not |
|----------|-------|---------------|
| **Fine-tune Gemini** on our denials | ❌ Skip | Expensive, slow, locks in patterns. Carriers shift AI tactics quarterly — fine-tune drifts. |
| **Public denial dataset** purchase | ❌ Skip | Doesn't exist at quality. The few academic sets are auto, not property. |
| **Build our own denial corpus** | ✅ Yes | 20-30 real denials = enough for few-shot prompting + per-carrier boilerplate detection. |
| **Few-shot prompting** with 3-5 examples per request | ✅ Highest ROI | Drop 3 relevant past denials + their successful counter-letters into each prompt. Quality jumps without retraining. |
| **RAG (retrieval-augmented)** over denial archive | ⚠️ Later | After we have 50+ denials, do semantic search over them at query time. |
| **Regex/keyword library** for known boilerplate | ✅ Easy win | Deterministic pattern detector ("the damage is consistent with wear and tear") runs alongside Gemini. Catches obvious AI tells with zero LLM cost. |

**Bottom line:** Start collecting denials NOW. The first ~30 letters unlock few-shot prompting and per-carrier boilerplate detection. The next ~100 unlock outcome tracking and A/B testing of counter-strategies. The next ~500 unlock RAG.

---

## V2 Roadmap (in build order)

### Phase 1 — Denial Intake & Storage (1-2 days)
**Goal:** Start collecting real denials so every analysis builds the corpus.

- [ ] `denial_letters` Postgres table: id, uploadedBy, carrier, adjusterName, claimNumber, denialDate, letterText, sourceFormat (paste/pdf/image), uploadedAt
- [ ] `denial_analyses` table: id, denialLetterId, geminiResponse jsonb, patentsConsidered, generatedAt
- [ ] `denial_outcomes` table: id, denialLetterId, counterLetterSent, sentAt, outcome (approved/partial/denied/pending), notes
- [ ] `POST /api/intel/denial-letters` — upload + store endpoint
- [ ] Modify denial-analyzer.html: after analysis, prompt "Save this analysis to your archive?" → stores the letter + analysis
- [ ] Outcome capture UI: when user marks an analysis "appeal sent", show button "Mark outcome" with approve/deny/partial dropdown
- [ ] Search interface: `/denial-archive.html` to browse past denials by carrier/adjuster/outcome

**Why this is Phase 1:** Everything else depends on having a corpus.

### Phase 2 — PDF/Image Upload (1 day)
**Goal:** Reps screenshot or upload PDFs instead of typing.

- [ ] Add `multer` for multipart upload (50MB cap)
- [ ] For PDFs: use `pdf-parse` to extract text server-side
- [ ] For images: Gemini 2.0 Flash native vision call (`inlineData` with base64) — extract letter text then run analyzer
- [ ] Update denial-analyzer.html: drag-drop zone for PDF/image OR paste-text textbox
- [ ] Handle multi-page PDFs (combine all pages → letterText)

**Files:**
- `server/intel/denial-upload.ts` — new
- Update `denial-analyzer.html` UI

### Phase 3 — Per-Carrier Boilerplate Detector (2-3 days, blocked on Phase 1 having ~20 denials)
**Goal:** Deterministic detection of carrier-specific AI tells.

- [ ] `scripts/roofdocs/extract-boilerplate.mjs` — runs nightly, scans denial_letters table, finds repeated phrases per carrier (n-gram analysis)
- [ ] Output: `data/carrier-boilerplate.json` keyed by carrier → list of {phrase, occurrenceCount, exampleDenialIds}
- [ ] In denial-analyzer.ts: before Gemini call, run boilerplate regex against the letter. Flag matches deterministically. Pass to Gemini as "Known boilerplate detected: X, Y, Z" so it builds bad-faith argument on top.
- [ ] New section on `/cheat-sheet.html` carrier view: "Known AI Boilerplate" — list of phrases this carrier reuses across denials

**Why deterministic:** A regex match is more defensible in a bad-faith argument than "an AI said so." Carriers can't argue with their own repeated language.

### Phase 4 — Few-Shot Prompting (1 day, blocked on Phase 1 having ~20 denials with outcomes)
**Goal:** Inject 3-5 real past denial+counter pairs into each prompt.

- [ ] In denial-analyzer.ts: before building the prompt, query `denial_letters` for top 3 most similar past denials (by carrier + denial category) where outcome=approved
- [ ] Inject as "EXAMPLES — past denials and counter-letters that worked:" block in the prompt
- [ ] Same approach for Adjuster Twin: inject 2-3 past jobs from THIS adjuster as examples

**Expected impact:** Counter-letter quality jumps 30-50% subjectively. Quotes will sound like Roof Docs's actual style, not generic.

### Phase 5 — Outcome Loop / A/B Testing (ongoing, after Phase 1)
**Goal:** Know which counter-strategies actually flip denials.

- [ ] In analyzer prompt: randomize between 2-3 "stance" variations (firm-legal, collaborative-evidence, escalation-focused)
- [ ] Store stance variant on each analysis
- [ ] When outcome marked: increment win-rate per stance per carrier
- [ ] After ~50 outcomes, switch to "use the highest win-rate stance per carrier" mode
- [ ] Dashboard: `/denial-stats.html` — counter-letter performance by carrier × stance × adjuster

### Phase 6 — Court Filing Aggregator (1 week)
**Goal:** Cite actual lawsuits, not abstract precedent, in counter-letters.

- [ ] PACER bulk-data subscription (~$0.10/page, $100/mo cap) — federal court records
- [ ] `scripts/roofdocs/pull-pacer-cases.mjs` — pull filings naming State Farm + AI + denial. Already 600+ cases in OK.
- [ ] Extract: case caption, court, filing date, key allegation, citation page
- [ ] `data/court-filings.json` keyed by carrier
- [ ] In denial-analyzer counter-letter: cite real cases ("See e.g. Smith v. State Farm, W.D. Okla. 2026 Case No. 5:26-cv-12345 alleging AI-only denials without human review constitute bad faith")
- [ ] New page: `/litigation-watchlist.html` — searchable court filing archive per carrier

**Stretch:** Daily PACER monitor → alert if new lawsuit names a Roof Docs carrier. Build pre-emptive coverage.

### Phase 7 — Adjuster Twin V2 with Vision (2-3 days)
**Goal:** Drop photos into Adjuster Twin → vision-based scope simulation.

- [ ] Upload UI: 1-10 roof photos per submission
- [ ] Gemini multimodal: send images as inline data alongside scope text
- [ ] Vision prompt: "Look at these photos. Score visible hail damage, granule loss, manufacturing defect signatures. Then predict adjuster response given their history + carrier patents."
- [ ] New output fields: `visualEvidenceStrengths`, `visualGapsInScope`, `photoBasedRedFlags`

**Why this matters:** Adjusters increasingly request photo packages BEFORE scheduling. If we can predict their photo-based response, we can stage photos to maximize approval.

### Phase 8 — CC21 / Susan Integration (1 day)
**Goal:** Reps work in CC21, not RIQ. Push intel to where they live.

- [ ] CC21 customer-detail page: "RIQ Intelligence" section
  - Pull customer's lat/lng → Lifetime Touch score
  - Pull customer's carrier → Patent Decoder summary
  - Pull customer's adjuster → Adjuster Twin quick-look
- [ ] Susan slack/SMS command: `/denial-analyze <paste>` → returns short analysis + counter-letter draft
- [ ] CC21 alert: when rep marks a denial received, push to RIQ Denial Analyzer with one tap

---

## Quick-win 1-day items (no Phase blocking)

- [ ] Re-extract the 6 weak patents (US10089396, US10497289, US11216889, US11410230, US11720971, US11348134) with a refined prompt that handles "framework" patents — ask for "default behaviors" instead of "rules" since those patents describe systems not decisions
- [ ] Add 10-15 more high-value patents:
  - Liberty Mutual (under-represented — 3 search results found)
  - Travelers (drone-program patents — they have 238 filed)
  - Cape Analytics, ZestyAI (vendors with carrier dependencies)
- [ ] Adjuster Twin: when a "lenient" adjuster is selected, surface their lenient stance more prominently in the UI (currently buried)
- [ ] Lifetime Touch: add "Last contact attempt" field (mine from notes.json) — don't recommend touching someone we tried to reach 30 days ago
- [ ] Cheat-sheet adjuster view: link to "Run Adjuster Twin →" for this adjuster
- [ ] Index dashboard: "AI Combat Suite" as its own category section instead of mixed with executive tiles

---

## Strategic plays (multi-day, high impact)

### A. The "License the corpus" play
The patent decoder + 22-patent extracted dataset has commercial value to other roofers.
- Roofers in TX, FL, NC have the same carrier problems we do
- License at $99-299/month per non-competing region
- Locks competitors INTO our system instead of building their own
- Owner: Ahmed makes the call. Doesn't require code — requires a sales process.

### B. The "Public-facing bad-faith report" play
After 50+ analyses, publish anonymized stats:
- "State Farm denials in our archive cite 'wear and tear' in 73% of cases — but only 22% of those denials cited specific shingle damage type per their own patent US20220414781"
- Press-release the report. Industry trade publications pick it up. Carriers hate it. Lawsuit citations cite OUR report.
- Builds RIQ as the authority. Inbound consultations.

### C. The "Class action support" play
If a State Farm class action picks up steam, our denial archive + analyzer becomes Material Evidence. Plaintiffs' attorneys would pay for:
- Anonymized denial corpus
- Boilerplate pattern detection across thousands of denials
- Expert affidavits citing patent-vs-denial contradictions
- This is multi-six-figure consulting revenue if it goes well.

---

## Open decisions / questions

1. **Where do collected denials live?** Same `intel_blobs` table as a new key, OR dedicated `denial_letters` table with proper schema? Recommend: dedicated table (search + indexing matter).
2. **Privacy on denial archive** — denials contain homeowner names + addresses. Need redaction logic OR access control. Currently RIQ is rep-only via session/token. Probably fine — but if licensing, must scrub.
3. **PACER subscription cost** — $100/mo cap can blow up with bulk pulls. Need budget approval before Phase 6.
4. **Vision model choice** — Gemini 2.0 Flash supports vision but capped at ~3000 tokens output. Photos cost more per call. Phase 7 may need Gemini 1.5 Pro for higher-quality photo analysis ($10x cost). Decision deferred until we have a corpus.
5. **Boilerplate detection: regex vs embedding similarity?** — Regex is deterministic + defensible. Embedding is fuzzier but catches paraphrases. Recommend: regex first, embeddings after if regex misses too much.

---

## Files / paths reference

```
/Users/a21/Desktop/storm-maps/
├── server/intel/
│   ├── denial-analyzer.ts     # V1 paste-text → patent-matched analysis
│   ├── adjuster-twin.ts       # V1 adjuster predictor
│   └── routes.ts              # Endpoint registration
├── scripts/roofdocs/
│   ├── carrier-patents-seed.json     # 23 patent IDs (1 fails to fetch)
│   ├── harvest-carrier-patents.mjs   # Google Patents HTML scrape
│   ├── extract-patent-logic.mjs      # Gemini structured extraction
│   ├── build-lifetime-touch.mjs      # Customer ripeness scoring
│   ├── import-to-postgres.mjs        # Stage data into intel_blobs
│   └── refresh-railway.mjs           # Nightly cron entry
├── data/
│   ├── carrier-patents.json          # 65KB, 22 patents extracted
│   ├── carrier-patents-raw/*.json    # Raw harvested HTML text
│   └── lifetime-touch.json           # 2.2MB, 1,951 customers scored
└── public/
    ├── denial-analyzer.html          # V1 paste-text UI
    ├── adjuster-twin.html            # V1 adjuster predictor UI
    └── lifetime-touch.html           # Rep queue with filters + CSV
```

**Railway:**
- Service: `riq21` (project "Old Map", svc id `015b8f9c-b3e8-4f5a-8b78-bd0b09bccf0a`)
- Required env: `DATABASE_URL`, `GEMINI_API_KEY`, `RIQ_API_KEYS`
- Public URL: https://riq21-production.up.railway.app
- DB public hostname for local→Railway: pull `DATABASE_PUBLIC_URL` from Postgres service vars

**Commands:**
```bash
# Local dev
cd /Users/a21/Desktop/storm-maps
npm run dev:server   # port 3001 by default

# Push data to Railway after local rebuild
DATABASE_URL=$(railway variables --service Postgres --json | python3 -c "import json,sys;print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])") \
  node scripts/roofdocs/import-to-postgres.mjs

# Re-harvest + extract patents after seed updates
node scripts/roofdocs/harvest-carrier-patents.mjs
node scripts/roofdocs/extract-patent-logic.mjs   # needs GEMINI_API_KEY in env

# Deploy
railway up --service riq21 --detach
```

---

## Suggested next-session order

If picking this up fresh, do in this order for maximum value:

1. **Quick win (30 min):** Re-extract the 6 weak patents with refined prompt — improves V1 quality immediately, no new infra
2. **Phase 1 (half day):** Build denial intake — start collecting corpus
3. **Phase 2 (half day):** PDF/image upload — reps will actually use it once they don't have to type
4. **One week of normal use** — accumulate ~20-30 denials in the wild
5. **Phase 3 + Phase 4 (2-3 days):** Boilerplate detection + few-shot prompting — V2 of analyzer
6. **Phase 7 (2-3 days):** Adjuster Twin V2 with photos — biggest field utility

Everything past that depends on what the field reports back.
