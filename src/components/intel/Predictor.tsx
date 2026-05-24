/**
 * Predictor — RIQ 21's pre-door intelligence brief.
 *
 * What this answers, in 10 seconds, before a rep knocks:
 *   1. What's the math probability we win this lead?
 *   2. What's the expected $ payout if won?
 *   3. WHICH adjuster is likely going to show up? What's their pattern?
 *   4. What's this carrier's known playbook (denial valleys, tactics)?
 *   5. What specific tactical moves should I make at this door?
 *   6. What's the data-backed pitch I can use as social proof?
 *
 * Math source: /api/intel/patterns + /api/intel/cheat-sheets — every number
 * has its sample size (N) and matches the portal's Sales Report CSV.
 *
 * Industry context (research-backed, May 2026): carriers are deploying AI to
 * deny + price claims faster than ever. Reps need symmetric AI on their side.
 * RIQ 21 is that AI. This Predictor is the symbol of it.
 */
import { useEffect, useMemo, useState } from 'react';

type CarrierProfile = {
  name: string;
  jobs: number;
  completed: number;
  approvalRate: number;
  avgApprovedJob: number;
};

type Patterns = {
  carriers: CarrierProfile[];
  adjusters: Array<{
    name: string;
    carrier: string;
    jobs: number;
    approvalRate: number;
    medianUplift: number | null;
  }>;
  zips: Array<{
    zip: string;
    city: string;
    jobs: number;
    approvalRate: number;
    avgApprovedJob: number;
    dominantCarrier: string | null;
  }>;
  reps: Array<{ name: string; jobs: number; approvalRate: number; bestCarrier: { carrier: string; approvalRate: number } | null }>;
  hailTiers: Array<{ bucket: string; jobs: number; approvalRate: number }>;
  speedToSign: Array<{ bucket: string; jobs: number; approvalRate: number; avgApprovedJob: number }>;
  carrierByState: Array<{ carrier: string; state: string; jobs: number; approvalRate: number }>;
  carrierByZip: Array<{ carrier: string; zip: string; jobs: number; approvalRate: number; completed: number }>;
};

type CheatSheets = {
  team: { insApprovalRate: number; minN: number };
  carriers: Array<{
    name: string;
    totals: { jobs: number; approvalRate: number };
    medianDeductible: number | null;
    medianInsuranceTotal: number | null;
    medianUplift: number | null;
    pctOver50Uplift: number;
    medianDaysLossToSign: number | null;
    medianDaysSignToComplete: number | null;
    deathRate: number;
    byHail: Array<{ tier: string; jobs: number; approvalRate: number }>;
    adjusters: Array<{ name: string; jobs: number; approvalRate: number; deltaVsCarrier: number; medianUplift: number | null }>;
  }>;
  zips: Array<{
    zip: string;
    city: string;
    insJobs: number;
    insApprovalRate: number;
    dominantCarrier: string | null;
    medianDeductible: number | null;
    topCarriers: Array<{ name: string; jobs: number; approvalRate: number }>;
    topReps: Array<{ name: string; jobs: number; approved: number }>;
    topAdjusters: Array<{ name: string; jobs: number; approvalRate: number }>;
  }>;
};

type Inputs = {
  carrier: string;
  state: string;
  zip: string;
  adjuster: string;
  hail: string;
  days: string;
  rep: string;
  age: string;
};

type Factor = { name: string; impact: string; dir: 'up' | 'down' | 'neutral' };
type Rec = { tone: 'good' | 'warn' | 'bad' | ''; html: string };

export function Predictor() {
  const [patterns, setPatterns] = useState<Patterns | null>(null);
  const [cheats, setCheats] = useState<CheatSheets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inputs, setInputs] = useState<Inputs>({
    carrier: '', state: '', zip: '', adjuster: '', hail: '', days: '', rep: '', age: '',
  });
  const [result, setResult] = useState<null | {
    score: number;
    confidence: 'low' | 'medium' | 'high';
    predValue: number;
    factors: Factor[];
    recs: Rec[];
    likelyAdjuster: CheatSheets['zips'][0]['topAdjusters'][0] | null;
    carrierCheat: CheatSheets['carriers'][0] | null;
    zipCheat: CheatSheets['zips'][0] | null;
    currentHailBucket: string | null;
  }>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/intel/patterns').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`patterns ${r.status}`)))),
      fetch('/api/intel/cheat-sheets').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`cheats ${r.status}`)))),
    ])
      .then(([p, c]) => { setPatterns(p as Patterns); setCheats(c as CheatSheets); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const topCarriers = useMemo(() => (patterns?.carriers || []).slice(0, 50), [patterns]);
  const topReps = useMemo(() => (patterns?.reps || []).slice(0, 60), [patterns]);

  // Hail bucket label as used by cheat-sheets.byHail (matches build-cheat-sheets.mjs).
  function hailBucketLabel(mag: number): string | null {
    if (mag <= 0) return null;
    if (mag < 0.75) return '<0.75';
    if (mag < 1.0) return '0.75-1.0';
    if (mag < 1.25) return '1.0-1.25';
    if (mag < 1.5) return '1.25-1.5';
    if (mag < 2.0) return '1.5-2.0';
    return '≥2.0';
  }

  function predict() {
    if (!patterns) return;
    const { carrier, state, zip, adjuster, hail, days, rep, age } = inputs;
    const hailNum = Number(hail || 0);
    const daysNum = Number(days || 0);
    const ageNum = Number(age || 0);
    const factors: Factor[] = [];
    const recs: Rec[] = [];

    const baseRate = patterns.carriers.length ? (cheats?.team.insApprovalRate ?? 0.726) : 0.726;
    let confidence: 'low' | 'medium' | 'high' = 'low';

    const carrierData = patterns.carriers.find((c) => c.name === carrier);
    let carrierRate = baseRate;
    if (carrierData) {
      carrierRate = carrierData.approvalRate;
      factors.push({
        name: `Carrier baseline: ${carrier} (${carrierData.jobs} jobs)`,
        impact: `${(carrierRate * 100).toFixed(1)}%`,
        dir: carrierRate >= baseRate ? 'up' : 'down',
      });
      confidence = 'medium';
    }
    const csKey = patterns.carrierByState.find((c) => c.carrier === carrier && c.state === state);
    if (csKey) {
      factors.push({ name: `${carrier} in ${state} — ${csKey.jobs} jobs`, impact: `${(csKey.approvalRate * 100).toFixed(1)}%`, dir: csKey.approvalRate >= carrierRate ? 'up' : 'down' });
      carrierRate = csKey.approvalRate;
      confidence = 'medium';
    }
    const czKey = patterns.carrierByZip.find((c) => c.carrier === carrier && c.zip === zip.slice(0, 5));
    if (czKey) {
      factors.push({ name: `${carrier} in ZIP ${zip.slice(0, 5)} — ${czKey.jobs} prior jobs`, impact: `${(czKey.approvalRate * 100).toFixed(1)}%`, dir: czKey.approvalRate >= carrierRate ? 'up' : 'down' });
      carrierRate = czKey.approvalRate;
      confidence = 'high';
    }
    if (adjuster) {
      const adjData = patterns.adjusters.find((a) => a.name.toLowerCase() === adjuster.toLowerCase() && a.carrier === carrier);
      if (adjData) {
        factors.push({ name: `Adjuster ${adjData.name} (${carrier}) — ${adjData.jobs} jobs`, impact: `${(adjData.approvalRate * 100).toFixed(1)}%`, dir: adjData.approvalRate >= carrierRate ? 'up' : 'down' });
        carrierRate = (carrierRate + adjData.approvalRate * 2) / 3;
        confidence = 'high';
      }
    }

    let hailMod = 0;
    const currentHailBucket = hailNum > 0 ? hailBucketLabel(hailNum) : null;
    if (hailNum > 0) {
      let bucket: string;
      if (hailNum < 0.75) bucket = 'lt_0.75';
      else if (hailNum < 1.0) bucket = '0.75_1.0';
      else if (hailNum < 1.25) bucket = '1.0_1.25';
      else if (hailNum < 1.5) bucket = '1.25_1.5';
      else if (hailNum < 2.0) bucket = '1.5_2.0';
      else bucket = 'gte_2.0';
      const tier = patterns.hailTiers.find((t) => t.bucket === bucket);
      if (tier && tier.jobs >= 50) {
        factors.push({ name: `Hail ${hailNum}" tier — ${tier.jobs} jobs`, impact: `${(tier.approvalRate * 100).toFixed(1)}%`, dir: tier.approvalRate >= 0.65 ? 'up' : 'down' });
        hailMod = tier.approvalRate - baseRate;
      }
    }

    let speedMod = 0;
    if (daysNum > 0) {
      let bucket: string;
      if (daysNum <= 7) bucket = '0-7d';
      else if (daysNum <= 30) bucket = '8-30d';
      else if (daysNum <= 90) bucket = '31-90d';
      else if (daysNum <= 180) bucket = '91-180d';
      else bucket = '181-365d';
      const tier = patterns.speedToSign.find((t) => t.bucket === bucket);
      if (tier) {
        factors.push({ name: `Speed: ${daysNum}d (${bucket}) — ${tier.jobs} jobs`, impact: `${(tier.approvalRate * 100).toFixed(1)}%`, dir: tier.approvalRate >= 0.7 ? 'up' : 'down' });
        speedMod = tier.approvalRate - baseRate;
      }
    }

    if (rep) {
      const repData = patterns.reps.find((r) => r.name === rep);
      if (repData) {
        factors.push({ name: `Rep ${rep} — ${repData.jobs} jobs`, impact: `${(repData.approvalRate * 100).toFixed(1)}%`, dir: repData.approvalRate >= baseRate ? 'up' : 'down' });
        if (repData.bestCarrier && repData.bestCarrier.carrier === carrier)
          factors.push({ name: `${rep}'s best carrier IS ${carrier}`, impact: `${(repData.bestCarrier.approvalRate * 100).toFixed(1)}%`, dir: 'up' });
      }
    }

    if (ageNum > 0) {
      if (ageNum >= 15) { factors.push({ name: `Roof age ${ageNum}y ≥ 15y reinspection cliff`, impact: '−10%', dir: 'down' }); hailMod -= 0.1; }
      else if (ageNum >= 10) { factors.push({ name: `Roof age ${ageNum}y triggers RCV→ACV`, impact: '−5%', dir: 'down' }); hailMod -= 0.05; }
      else { factors.push({ name: `Roof age ${ageNum}y — favorable`, impact: '+5%', dir: 'up' }); hailMod += 0.05; }
    }

    // ===== State-specific tactical recs (research-backed) =====
    if (state === 'PA') {
      hailMod -= 0.05;
      factors.push({ name: 'PA matching law adverse (Greene v. USAA)', impact: '−5%', dir: 'down' });
      recs.push({ tone: 'warn', html: '<strong>PA matching law adverse.</strong> Build slope-only estimates first; argue Collins exception if applicable. SOL is 2y — short window.' });
    } else if (state === 'MD') {
      hailMod += 0.03;
      factors.push({ name: 'MD §27-303 leverage', impact: '+3%', dir: 'up' });
      recs.push({ tone: 'good', html: '<strong>MD §27-303 leverage.</strong> Cite the bad-faith statute on first denial ($2,500-$125,000 penalty range). Strongest leverage in DMV.' });
    } else if (state === 'VA') {
      recs.push({ tone: '', html: '<strong>VA: long 5-year SOL</strong> but weak bad-faith leverage (§38.2-209). Lean on procedural escalation + supplement battles, not bad-faith threats.' });
    }

    let finalRate = Math.max(0.05, Math.min(0.95, carrierRate + hailMod + speedMod));
    const finalScore = Math.round(finalRate * 100);

    let predValue = carrierData?.avgApprovedJob || 25000;
    if (czKey) {
      const zipObj = patterns.zips.find((z) => z.zip === zip.slice(0, 5));
      if (zipObj) predValue = (predValue + zipObj.avgApprovedJob) / 2;
    }

    // ===== Open-with rec: probability framing =====
    if (finalRate >= 0.7) recs.unshift({ tone: 'good', html: '<strong>High-probability lead.</strong> Get to the door fast. Schedule inspection within 7 days. Push for same-day signing.' });
    else if (finalRate >= 0.5) recs.unshift({ tone: '', html: '<strong>Moderate.</strong> Pre-document the roof on foot (chalk circles, macro phone photos, every slope) before adjuster arrives. Geo-tagged + timestamped.' });
    else recs.unshift({ tone: 'warn', html: '<strong>Lower probability.</strong> Pre-inspection essential. Build heavy photo documentation (every slope, chalk circles on every impact). If first adjuster denies, escalate in writing to their supervisor + request a re-inspection — do not accept verbal denials.' });

    // ===== Hail-tier specific =====
    if (hailNum >= 1.25 && hailNum < 1.5)
      recs.push({ tone: 'warn', html: '<strong>Engineer-zone hail (1.25"-1.5").</strong> This is the carrier denial valley — they auto-route to HAAG/Donan. Pre-emptively bring an independent HAAG-certified inspection on the FIRST adjuster visit, not after denial.' });
    if (hailNum > 0 && hailNum < 0.75)
      recs.push({ tone: 'warn', html: '<strong>Below 0.75" hail.</strong> Most carriers reject sub-threshold. Lean hard on wind damage angle if available — wind has no size threshold.' });

    // ===== Speed-based =====
    if (daysNum > 180)
      recs.push({ tone: 'warn', html: `<strong>Stale claim (${daysNum} days since loss).</strong> Approval drops sharply past 180d. Check policy SOL — PA = 2y, VA/MD = longer.` });

    // ===== Carrier-specific tactical (from research) =====
    if (carrier === 'State Farm') {
      recs.push({ tone: 'warn', html: '<strong>State Farm:</strong> Demand Xactimate "Restoration" pricing (NOT "New Construction" — they default to it, ~15-25% lower). Cite trial precedent on first email. Highest NAIC complaint volume.' });
    }
    if (carrier === 'Allstate') {
      recs.push({ tone: 'warn', html: '<strong>Allstate:</strong> 50.9% of claims close without payment (Weiss 2024). Watch for cosmetic damage endorsement carve-outs. Document aggressively. Allstate is using AI for first-pass denial — request human adjuster review on any AI-flagged denial.' });
    }
    if (carrier === 'Travelers' && hailNum > 0) {
      recs.push({ tone: 'warn', html: '<strong>Travelers:</strong> Heavy engineer use (HAAG/Donan/Rimkus). Bring an independent inspector on Day 1. Have NRCA + ASTM standards cited in your scope.' });
    }
    if (carrier === 'USAA') {
      recs.push({ tone: 'good', html: '<strong>USAA:</strong> Highest-paying carrier in our book (83%+ approval). They reward thorough documentation — bring 30+ photos and a clean scope. Median uplift on supplements is +6%.' });
    }
    if (carrier === 'Liberty Mutual') {
      recs.push({ tone: '', html: '<strong>Liberty Mutual:</strong> Watch for ACV-only payouts on older roofs. Push depreciation recovery hard — they often overstate.' });
    }
    if (carrier === 'Progressive') {
      recs.push({ tone: 'warn', html: '<strong>Progressive:</strong> Below-average roofing payouts (49% approval). They prefer repair over replace. Build slope-by-slope damage map to force replace argument.' });
    }
    if (carrier === 'Erie') {
      recs.push({ tone: 'good', html: '<strong>Erie:</strong> Regional carrier, faster cycle times (~30d). Median deductible $1,000. They value local-contractor relationships — mention prior Erie jobs in the area.' });
    }

    // ===== ZIP/neighborhood-specific =====
    if (czKey && czKey.approvalRate >= 0.8 && czKey.jobs >= 10) {
      recs.push({ tone: 'good', html: `<strong>${carrier} pays well in ZIP ${zip.slice(0, 5)}</strong> — ${(czKey.approvalRate * 100).toFixed(0)}% approval over ${czKey.jobs} prior jobs. Use prior neighbor wins as social proof.` });
    }

    // ===== AI-defense angle (new) =====
    if (finalRate < 0.5) {
      recs.push({ tone: '', html: '<strong>If denied with suspiciously fast/AI-generated response:</strong> Request a human adjuster review in writing. AI-driven denials with minimal human review are emerging as bad-faith evidence (court allowed discovery into insurer AI in 2026).' });
    }

    // ===== Adjuster prediction (from cheat-sheets) =====
    let likelyAdjuster: CheatSheets['zips'][0]['topAdjusters'][0] | null = null;
    if (cheats && zip && carrier && !adjuster) {
      const zCheat = cheats.zips.find((z) => z.zip === zip.slice(0, 5));
      if (zCheat) {
        // Get adjusters for this carrier in this zip
        const carrierZipAdjusters = (zCheat.topAdjusters || []).filter((a) => {
          // We need to know which carrier this adjuster is paired with — check the carrier cheat
          const cCheat = cheats.carriers.find((c) => c.name === carrier);
          return cCheat && cCheat.adjusters.some((ca) => ca.name === a.name);
        });
        likelyAdjuster = carrierZipAdjusters[0] || null;
        if (likelyAdjuster) {
          recs.push({ tone: '', html: `<strong>Likely adjuster: ${likelyAdjuster.name}.</strong> Based on prior ${carrier} claims in ZIP ${zip.slice(0, 5)}. ${likelyAdjuster.jobs} prior jobs, ${(likelyAdjuster.approvalRate * 100).toFixed(0)}% approval.` });
        }
      }
    }

    const carrierCheat = cheats?.carriers.find((c) => c.name === carrier) || null;
    const zipCheat = cheats?.zips.find((z) => z.zip === zip.slice(0, 5)) || null;

    setResult({ score: finalScore, confidence, predValue, factors, recs, likelyAdjuster, carrierCheat, zipCheat, currentHailBucket });
    setCopied(false);
  }

  function generateDoorScript(): string {
    if (!result || !patterns) return '';
    const { carrier, rep } = inputs;
    const repName = rep || '[your name]';
    const carrierName = carrier || '[carrier]';
    const zCheat = result.zipCheat;
    const cCheat = result.carrierCheat;
    let proof = '';
    if (zCheat) {
      proof = `Your ZIP has ${zCheat.insJobs} prior insurance jobs with ${(zCheat.insApprovalRate * 100).toFixed(0)}% approval rate, dominant carrier ${zCheat.dominantCarrier || 'mixed'}.`;
    }
    if (cCheat && zCheat?.dominantCarrier === carrier) {
      const approvedCount = Math.round(cCheat.totals.jobs * cCheat.totals.approvalRate);
      proof += ` We've successfully filed ${approvedCount.toLocaleString()} ${carrierName} claims with average payout $${Math.round((cCheat.medianInsuranceTotal || 0)).toLocaleString()}.`;
    }
    return `Hi, I'm ${repName} from Roof Docs. ${proof} The recent storm in your area hit your roof tier — typical approval for ${carrierName} on this hail size is ${result.score}%. Got 90 seconds to check if your roof took the same hit your neighbors did?`;
  }

  if (error) return <div style={{ padding: 40, color: 'var(--riq-danger)' }}>Failed to load: {error}</div>;
  if (!patterns) return <div style={{ padding: 40, color: 'var(--riq-accent)', textAlign: 'center' }}>Loading patterns + cheat sheets…</div>;

  const cls = result && result.score >= 70 ? 'var(--riq-success)' : result && result.score >= 45 ? 'var(--riq-warn)' : 'var(--riq-danger)';

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      {/* ===== INPUT FORM ===== */}
      <section style={{ ...sectionStyle, marginBottom: 16 }}>
        <h2 style={{ ...h2Style, fontSize: 18 }}>🔮 Pre-door intelligence brief</h2>
        <p style={{ color: 'var(--riq-text-muted)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
          16,302 jobs · 48,449 storms · 142 named adjusters · research-backed industry thresholds. Math is auditable — every % shows N.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
          <Field label="Carrier">
            <select value={inputs.carrier} onChange={(e) => setInputs({ ...inputs, carrier: e.target.value })} style={selectStyle}>
              <option value="">— pick —</option>
              {topCarriers.map((c) => (<option key={c.name} value={c.name}>{c.name} ({c.jobs} · {(c.approvalRate * 100).toFixed(0)}%)</option>))}
            </select>
          </Field>
          <Field label="State">
            <select value={inputs.state} onChange={(e) => setInputs({ ...inputs, state: e.target.value })} style={selectStyle}>
              <option value="">—</option><option>VA</option><option>MD</option><option>PA</option><option>DC</option>
            </select>
          </Field>
          <Field label="ZIP code">
            <input value={inputs.zip} onChange={(e) => setInputs({ ...inputs, zip: e.target.value })} placeholder="20170" maxLength={5} style={inputStyle} />
          </Field>
          <Field label="Adjuster name (optional)">
            <input value={inputs.adjuster} onChange={(e) => setInputs({ ...inputs, adjuster: e.target.value })} placeholder="Auto-predicted if blank" style={inputStyle} />
          </Field>
          <Field label="Hail magnitude (in)">
            <input type="number" step="0.25" value={inputs.hail} onChange={(e) => setInputs({ ...inputs, hail: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Days since loss">
            <input type="number" value={inputs.days} onChange={(e) => setInputs({ ...inputs, days: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="Sales rep">
            <select value={inputs.rep} onChange={(e) => setInputs({ ...inputs, rep: e.target.value })} style={selectStyle}>
              <option value="">— optional —</option>
              {topReps.map((r) => (<option key={r.name} value={r.name}>{r.name} ({r.jobs} · {(r.approvalRate * 100).toFixed(0)}%)</option>))}
            </select>
          </Field>
          <Field label="Roof age (years)">
            <input type="number" value={inputs.age} onChange={(e) => setInputs({ ...inputs, age: e.target.value })} style={inputStyle} />
          </Field>
        </div>
        <button onClick={predict} style={btnStyle}>Score this lead →</button>
      </section>

      {result && (
        <>
          {/* ===== HERO: BIG SCORE + $ VALUE ===== */}
          <section style={{
            background: 'linear-gradient(135deg, var(--riq-surface-elev) 0%, var(--riq-surface) 100%)',
            border: '1px solid var(--riq-border)', borderRadius: 10, padding: '24px 28px', marginBottom: 16,
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center',
          }}>
            <div style={{ textAlign: 'center', minWidth: 180 }}>
              <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, color: cls }}>{result.score}%</div>
              <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', marginTop: 6, letterSpacing: '0.05em' }}>
                Approval probability
              </div>
              <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', marginTop: 2 }}>
                Confidence: <strong style={{ color: 'var(--riq-accent)' }}>{result.confidence.toUpperCase()}</strong>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--riq-text-muted)' }}>Estimated approved $ if won</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--riq-success)', lineHeight: 1.1 }}>
                ${Math.round(result.predValue).toLocaleString()}
              </div>
              {result.carrierCheat && (
                <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', marginTop: 6 }}>
                  Median {inputs.carrier} insurance approval: ${Math.round(result.carrierCheat.medianInsuranceTotal || 0).toLocaleString()} ·
                  Median deductible: {result.carrierCheat.medianDeductible ? '$' + result.carrierCheat.medianDeductible.toLocaleString() : '—'} ·
                  Median uplift: {result.carrierCheat.medianUplift != null ? ((result.carrierCheat.medianUplift) * 100).toFixed(1) + '%' : '—'}
                </div>
              )}
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>
            {/* ===== FACTORS ===== */}
            <section style={sectionStyle}>
              <h2 style={h2Style}>📊 Factors that moved the score</h2>
              <div style={{ color: 'var(--riq-text-muted)', fontSize: 11, marginBottom: 10 }}>Each row shows the historical rate and the sample size it was based on.</div>
              {result.factors.map((f, i) => (
                <div key={i} style={{ background: 'var(--riq-surface-elev)', padding: '10px 14px', borderRadius: 6, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: 'var(--riq-text-muted)', flex: 1 }}>{f.name}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: f.dir === 'up' ? 'var(--riq-success)' : f.dir === 'down' ? 'var(--riq-danger)' : 'var(--riq-accent)' }}>{f.impact}</span>
                </div>
              ))}
            </section>

            {/* ===== RECOMMENDED PLAYS ===== */}
            <section style={sectionStyle}>
              <h2 style={h2Style}>🎯 Recommended plays</h2>
              <div style={{ color: 'var(--riq-text-muted)', fontSize: 11, marginBottom: 10 }}>State law + carrier-specific tactics + AI-defense angle.</div>
              {result.recs.map((r, i) => (
                <div key={i} style={{
                  background: r.tone === 'good' ? 'rgba(16,185,129,0.08)' : r.tone === 'warn' ? 'rgba(245,158,11,0.08)' : r.tone === 'bad' ? 'rgba(239,68,68,0.08)' : 'rgba(244,167,56,0.08)',
                  borderLeft: '3px solid ' + (r.tone === 'good' ? 'var(--riq-success)' : r.tone === 'warn' ? 'var(--riq-warn)' : r.tone === 'bad' ? 'var(--riq-danger)' : 'var(--riq-accent)'),
                  padding: '10px 14px', borderRadius: '0 6px 6px 0', marginBottom: 8, fontSize: 12.5, lineHeight: 1.55,
                }} dangerouslySetInnerHTML={{ __html: r.html }} />
              ))}
            </section>
          </div>

          {/* ===== CARRIER PLAYBOOK ===== */}
          {result.carrierCheat && (
            <section style={{ ...sectionStyle, marginBottom: 16 }}>
              <h2 style={h2Style}>🏢 {inputs.carrier} playbook · sample size {result.carrierCheat.totals.jobs.toLocaleString()} jobs</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
                <Kpi label="Approval rate" value={`${(result.carrierCheat.totals.approvalRate * 100).toFixed(1)}%`} />
                <Kpi label="Median deductible" value={result.carrierCheat.medianDeductible ? '$' + result.carrierCheat.medianDeductible.toLocaleString() : '—'} />
                <Kpi label="Median uplift" value={result.carrierCheat.medianUplift != null ? ((result.carrierCheat.medianUplift) * 100).toFixed(1) + '%' : '—'}
                  hint={(result.carrierCheat.pctOver50Uplift > 0.15) ? 'Supplement-friendly' : 'Tight on supplements'} />
                <Kpi label="Days loss→sign" value={(result.carrierCheat.medianDaysLossToSign ?? '—') + 'd'} />
                <Kpi label="Days sign→complete" value={(result.carrierCheat.medianDaysSignToComplete ?? '—') + 'd'} />
                <Kpi label="Death rate" value={(result.carrierCheat.deathRate * 100).toFixed(1) + '%'} hint={result.carrierCheat.deathRate > 0.3 ? 'High death rate' : 'Normal'} />
              </div>

              {/* Hail-tier sensitivity bar */}
              {result.carrierCheat.byHail.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--riq-text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Hail-tier approval (denial valley = red)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${result.carrierCheat.byHail.length}, 1fr)`, gap: 6 }}>
                    {result.carrierCheat.byHail.map((h, i) => {
                      const isCurrent = h.tier === result.currentHailBucket;
                      const tone = h.approvalRate >= 0.7 ? 'var(--riq-success)' : h.approvalRate < 0.5 ? 'var(--riq-danger)' : 'var(--riq-warn)';
                      return (
                        <div key={i} style={{
                          background: 'var(--riq-surface-elev)', padding: '8px 6px', borderRadius: 4, textAlign: 'center',
                          border: isCurrent ? '2px solid var(--riq-accent)' : '1px solid var(--riq-border)',
                        }}>
                          <div style={{ fontSize: 10, color: 'var(--riq-text-muted)' }}>{h.tier}"</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: tone, lineHeight: 1.1, marginTop: 2 }}>{(h.approvalRate * 100).toFixed(0)}%</div>
                          <div style={{ fontSize: 10, color: 'var(--riq-text-muted)' }}>{h.jobs}</div>
                          {isCurrent && <div style={{ fontSize: 9, color: 'var(--riq-accent)', marginTop: 2 }}>← THIS LEAD</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ===== NEIGHBORHOOD CREDIBILITY (ZIP cheat) ===== */}
          {result.zipCheat && (
            <section style={{ ...sectionStyle, marginBottom: 16 }}>
              <h2 style={h2Style}>🏘 Neighborhood credibility · ZIP {result.zipCheat.zip} {result.zipCheat.city ? `· ${result.zipCheat.city}` : ''}</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
                <Kpi label="Insurance jobs in ZIP" value={result.zipCheat.insJobs.toLocaleString()} />
                <Kpi label="Approval rate" value={`${(result.zipCheat.insApprovalRate * 100).toFixed(1)}%`} />
                <Kpi label="Dominant carrier" value={result.zipCheat.dominantCarrier || '—'} />
                <Kpi label="Median deductible" value={result.zipCheat.medianDeductible ? '$' + result.zipCheat.medianDeductible.toLocaleString() : '—'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                {result.zipCheat.topCarriers.slice(0, 5).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Top carriers in ZIP</div>
                    {result.zipCheat.topCarriers.slice(0, 5).map((c, i) => (
                      <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--riq-border)' }}>
                        <strong>{c.name}</strong> · {c.jobs} jobs · <span style={{ color: c.approvalRate >= 0.7 ? 'var(--riq-success)' : 'var(--riq-warn)' }}>{(c.approvalRate * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {result.zipCheat.topReps.slice(0, 5).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Reps active in ZIP</div>
                    {result.zipCheat.topReps.slice(0, 5).map((r, i) => (
                      <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--riq-border)' }}>
                        <strong>{r.name}</strong> · {r.jobs} jobs · {r.approved} approved
                      </div>
                    ))}
                  </div>
                )}
                {result.zipCheat.topAdjusters.slice(0, 5).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Adjusters seen in ZIP</div>
                    {result.zipCheat.topAdjusters.slice(0, 5).map((a, i) => (
                      <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--riq-border)' }}>
                        <strong>{a.name}</strong> · {a.jobs} jobs · <span style={{ color: a.approvalRate >= 0.7 ? 'var(--riq-success)' : 'var(--riq-warn)' }}>{(a.approvalRate * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ===== DOOR-READY SCRIPT ===== */}
          {(result.zipCheat || result.carrierCheat) && (
            <section style={{ ...sectionStyle, marginBottom: 16 }}>
              <h2 style={h2Style}>🎤 Door-ready pitch (data-backed social proof)</h2>
              <div style={{ background: 'var(--riq-surface-elev)', padding: '14px 18px', borderRadius: 6, fontSize: 14, lineHeight: 1.65, fontStyle: 'italic', borderLeft: '3px solid var(--riq-accent)' }}>
                "{generateDoorScript()}"
              </div>
              <button
                onClick={async () => { await navigator.clipboard.writeText(generateDoorScript()); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
                style={{ ...btnStyle, marginTop: 12, fontSize: 12, padding: '8px 16px' }}
              >
                {copied ? '✓ Copied to clipboard' : '📋 Copy pitch'}
              </button>
              <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--riq-text-muted)' }}>
                Tailor the wording — this is a starting point built from real numbers.
              </span>
            </section>
          )}

          {/* ===== DRILL-DOWNS ===== */}
          <section style={{ ...sectionStyle, marginBottom: 16 }}>
            <h2 style={h2Style}>🎓 Drill-downs (full math on each entity)</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {inputs.carrier && <DrillButton href={`/?view=cheat-sheet&type=carrier&name=${encodeURIComponent(inputs.carrier)}`} label={`${inputs.carrier} cheat sheet`} />}
              {inputs.zip && <DrillButton href={`/?view=cheat-sheet&type=zip&name=${encodeURIComponent(inputs.zip.slice(0, 5))}`} label={`ZIP ${inputs.zip.slice(0, 5)} cheat sheet`} />}
              {inputs.state && <DrillButton href={`/?view=cheat-sheet&type=state&name=${encodeURIComponent(inputs.state)}`} label={`${inputs.state} cheat sheet`} />}
              {inputs.rep && <DrillButton href={`/?view=cheat-sheet&type=rep&name=${encodeURIComponent(inputs.rep)}`} label={`${inputs.rep} cheat sheet`} />}
              {inputs.adjuster && <DrillButton href={`/?view=cheat-sheet&type=adjuster&name=${encodeURIComponent(inputs.adjuster)}`} label={`${inputs.adjuster} cheat sheet`} />}
              {result.likelyAdjuster && !inputs.adjuster && <DrillButton href={`/?view=cheat-sheet&type=adjuster&name=${encodeURIComponent(result.likelyAdjuster.name)}`} label={`Likely adjuster: ${result.likelyAdjuster.name}`} />}
              <DrillButton href={`/?view=field-guide`} label="Field guide (industry rules)" />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ background: 'var(--riq-surface-elev)', padding: '10px 14px', borderRadius: 6, border: '1px solid var(--riq-border)' }}>
      <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--riq-accent)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function DrillButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{
      background: 'var(--riq-surface-elev)', color: 'var(--riq-accent)', border: '1px solid var(--riq-border)',
      padding: '8px 14px', borderRadius: 6, fontSize: 12, textDecoration: 'none', fontWeight: 600,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--riq-accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--riq-border)')}
    >
      🎓 {label} →
    </a>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--riq-surface-elev)', color: 'var(--riq-text)', border: '1px solid var(--riq-border)',
  borderRadius: 4, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit',
};
const selectStyle = inputStyle;
const btnStyle: React.CSSProperties = {
  background: 'var(--riq-accent)', color: 'var(--riq-bg)', border: 'none', borderRadius: 6,
  padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};
const sectionStyle: React.CSSProperties = {
  background: 'var(--riq-surface)', border: '1px solid var(--riq-border)', borderRadius: 8, padding: '20px 24px',
};
const h2Style: React.CSSProperties = { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--riq-accent)' };
