/**
 * Predictor — first native React component in the intel layer.
 *
 * Mirrors public/predictor.html but loads patterns via the auth-gated
 * /api/intel/patterns endpoint and is fully composable into the storm-maps
 * React app.
 *
 * Algorithm: blends historical lookup (carrier × zip, carrier × state,
 * adjuster × carrier) with industry-research-encoded modifiers (hail tier,
 * speed-to-sign, roof age, state legal differences).
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
  const [error, setError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Inputs>({
    carrier: '',
    state: '',
    zip: '',
    adjuster: '',
    hail: '',
    days: '',
    rep: '',
    age: '',
  });
  const [result, setResult] = useState<null | {
    score: number;
    confidence: 'low' | 'medium' | 'high';
    predValue: number;
    factors: Factor[];
    recs: Rec[];
  }>(null);

  useEffect(() => {
    fetch('/api/intel/patterns')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p: Patterns) => setPatterns(p))
      .catch((e: Error) => setError(e.message));
  }, []);

  const topCarriers = useMemo(() => (patterns?.carriers || []).slice(0, 50), [patterns]);
  const topReps = useMemo(() => (patterns?.reps || []).slice(0, 60), [patterns]);

  function predict() {
    if (!patterns) return;
    const { carrier, state, zip, adjuster, hail, days, rep, age } = inputs;
    const hailNum = Number(hail || 0);
    const daysNum = Number(days || 0);
    const ageNum = Number(age || 0);
    const factors: Factor[] = [];
    const recs: Rec[] = [];

    const baseRate = 0.726;
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
      factors.push({
        name: `${carrier} in ${state} — ${csKey.jobs} jobs`,
        impact: `${(csKey.approvalRate * 100).toFixed(1)}%`,
        dir: csKey.approvalRate >= carrierRate ? 'up' : 'down',
      });
      carrierRate = csKey.approvalRate;
      confidence = 'medium';
    }

    const czKey = patterns.carrierByZip.find((c) => c.carrier === carrier && c.zip === zip.slice(0, 5));
    if (czKey) {
      factors.push({
        name: `${carrier} in ZIP ${zip.slice(0, 5)} — ${czKey.jobs} prior jobs`,
        impact: `${(czKey.approvalRate * 100).toFixed(1)}%`,
        dir: czKey.approvalRate >= carrierRate ? 'up' : 'down',
      });
      carrierRate = czKey.approvalRate;
      confidence = 'high';
    }

    if (adjuster) {
      const adjData = patterns.adjusters.find(
        (a) => a.name.toLowerCase() === adjuster.toLowerCase() && a.carrier === carrier,
      );
      if (adjData) {
        factors.push({
          name: `Adjuster ${adjData.name} (${carrier}) — ${adjData.jobs} jobs`,
          impact: `${(adjData.approvalRate * 100).toFixed(1)}%`,
          dir: adjData.approvalRate >= carrierRate ? 'up' : 'down',
        });
        carrierRate = (carrierRate + adjData.approvalRate * 2) / 3;
        confidence = 'high';
      }
    }

    let hailMod = 0;
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
        factors.push({
          name: `Hail ${hailNum}" tier — ${tier.jobs} jobs`,
          impact: `${(tier.approvalRate * 100).toFixed(1)}%`,
          dir: tier.approvalRate >= 0.65 ? 'up' : 'down',
        });
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
        factors.push({
          name: `Speed: ${daysNum}d (${bucket}) — ${tier.jobs} jobs`,
          impact: `${(tier.approvalRate * 100).toFixed(1)}%`,
          dir: tier.approvalRate >= 0.7 ? 'up' : 'down',
        });
        speedMod = tier.approvalRate - baseRate;
      }
    }

    if (rep) {
      const repData = patterns.reps.find((r) => r.name === rep);
      if (repData) {
        factors.push({
          name: `Rep ${rep} — ${repData.jobs} jobs`,
          impact: `${(repData.approvalRate * 100).toFixed(1)}%`,
          dir: repData.approvalRate >= baseRate ? 'up' : 'down',
        });
        if (repData.bestCarrier && repData.bestCarrier.carrier === carrier) {
          factors.push({
            name: `${rep}'s best carrier IS ${carrier}`,
            impact: `${(repData.bestCarrier.approvalRate * 100).toFixed(1)}%`,
            dir: 'up',
          });
        }
      }
    }

    if (ageNum > 0) {
      if (ageNum >= 15) {
        factors.push({ name: `Roof age ${ageNum}y ≥ 15y reinspection cliff`, impact: '−10%', dir: 'down' });
        hailMod -= 0.1;
      } else if (ageNum >= 10) {
        factors.push({ name: `Roof age ${ageNum}y triggers RCV→ACV`, impact: '−5%', dir: 'down' });
        hailMod -= 0.05;
      } else {
        factors.push({ name: `Roof age ${ageNum}y — favorable`, impact: '+5%', dir: 'up' });
        hailMod += 0.05;
      }
    }

    if (state === 'PA') {
      factors.push({ name: 'PA matching law adverse (Greene v. USAA)', impact: '−5%', dir: 'down' });
      hailMod -= 0.05;
      recs.push({
        tone: 'warn',
        html: '<strong>PA:</strong> matching law adverse. Build slope-only estimates first; argue Collins exception if applicable.',
      });
    } else if (state === 'MD') {
      factors.push({ name: 'MD §27-303 leverage', impact: '+3%', dir: 'up' });
      hailMod += 0.03;
      recs.push({
        tone: '',
        html: '<strong>MD:</strong> cite §27-303 (arbitrary/capricious denial → $2,500-$125,000 penalty) on first denial.',
      });
    } else if (state === 'VA') {
      recs.push({
        tone: '',
        html: '<strong>VA:</strong> long 5-year SOL but weak bad-faith leverage (§38.2-209). Use procedural escalation.',
      });
    }

    let finalRate = Math.max(0.05, Math.min(0.95, carrierRate + hailMod + speedMod));
    const finalScore = Math.round(finalRate * 100);

    let predValue = carrierData?.avgApprovedJob || 25000;
    if (czKey) {
      const zipObj = patterns.zips.find((z) => z.zip === zip.slice(0, 5));
      if (zipObj) predValue = (predValue + zipObj.avgApprovedJob) / 2;
    }

    if (finalRate >= 0.7)
      recs.unshift({ tone: 'good', html: '<strong>High-probability lead.</strong> Get to the door fast. Schedule inspection within 7 days.' });
    else if (finalRate >= 0.5)
      recs.unshift({ tone: '', html: '<strong>Moderate.</strong> Pre-document aggressively. Pre-inspect on foot with chalk + phone macro photos before adjuster arrives.' });
    else
      recs.unshift({ tone: 'warn', html: '<strong>Lower probability.</strong> Pre-inspection essential. Consider invoking PA from day one.' });

    if (hailNum >= 1.25 && hailNum < 1.5)
      recs.push({ tone: 'warn', html: '<strong>Engineer-zone hail (1.25-1.5").</strong> Bring an independent HAAG-certified inspector.' });
    if (daysNum > 180)
      recs.push({ tone: 'warn', html: `<strong>Stale claim (${daysNum}d).</strong> Approval drops past 180d. Check policy SOL (PA = 2y).` });
    if (czKey && czKey.approvalRate >= 0.8 && czKey.jobs >= 10)
      recs.push({
        tone: 'good',
        html: `<strong>${carrier} pays in ZIP ${zip.slice(0, 5)}</strong> (${(czKey.approvalRate * 100).toFixed(0)}% over ${czKey.jobs} jobs).`,
      });
    if (carrier === 'State Farm')
      recs.push({
        tone: '',
        html: '<strong>State Farm:</strong> Demand Xactimate "Restoration" pricing (not "New Construction"). Highest NAIC complaint volume.',
      });
    if (carrier === 'Allstate')
      recs.push({
        tone: 'warn',
        html: '<strong>Allstate:</strong> 50.9% close without payment (Weiss 2024). Document aggressively; check cosmetic damage endorsement.',
      });
    if (carrier === 'Travelers' && hailNum > 0)
      recs.push({
        tone: 'warn',
        html: '<strong>Travelers:</strong> Heavy engineer use (HAAG/Donan). Bring independent inspector.',
      });

    setResult({ score: finalScore, confidence, predValue, factors, recs });
  }

  if (error) return <div style={{ padding: 40, color: 'var(--riq-danger)' }}>Failed to load patterns: {error}</div>;
  if (!patterns) return <div style={{ padding: 40, color: 'var(--riq-accent)', textAlign: 'center' }}>Loading patterns…</div>;

  const cls = result && result.score >= 70 ? 'var(--riq-success)' : result && result.score >= 45 ? 'var(--riq-warn)' : 'var(--riq-danger)';

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <section
        style={{
          background: 'var(--riq-surface)',
          border: '1px solid var(--riq-border)',
          borderRadius: 8,
          padding: '20px 24px',
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--riq-accent)' }}>
          🔮 Score a lead before you knock
        </h2>
        <p style={{ color: 'var(--riq-text-muted)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
          Cross-references 16k jobs + 48k storm events + research-backed industry thresholds.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
          <Field label="Carrier">
            <select
              value={inputs.carrier}
              onChange={(e) => setInputs({ ...inputs, carrier: e.target.value })}
              style={selectStyle}
            >
              <option value="">— pick —</option>
              {topCarriers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.jobs} jobs · {(c.approvalRate * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
          </Field>
          <Field label="State">
            <select
              value={inputs.state}
              onChange={(e) => setInputs({ ...inputs, state: e.target.value })}
              style={selectStyle}
            >
              <option value="">—</option>
              <option>VA</option>
              <option>MD</option>
              <option>PA</option>
              <option>DC</option>
            </select>
          </Field>
          <Field label="ZIP code">
            <input
              value={inputs.zip}
              onChange={(e) => setInputs({ ...inputs, zip: e.target.value })}
              placeholder="20170"
              maxLength={5}
              style={inputStyle}
            />
          </Field>
          <Field label="Adjuster name (optional)">
            <input
              value={inputs.adjuster}
              onChange={(e) => setInputs({ ...inputs, adjuster: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Hail magnitude (in)">
            <input
              type="number"
              step="0.25"
              value={inputs.hail}
              onChange={(e) => setInputs({ ...inputs, hail: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Days since loss">
            <input
              type="number"
              value={inputs.days}
              onChange={(e) => setInputs({ ...inputs, days: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Sales rep">
            <select
              value={inputs.rep}
              onChange={(e) => setInputs({ ...inputs, rep: e.target.value })}
              style={selectStyle}
            >
              <option value="">— optional —</option>
              {topReps.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} ({r.jobs} jobs · {(r.approvalRate * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Roof age (years)">
            <input
              type="number"
              value={inputs.age}
              onChange={(e) => setInputs({ ...inputs, age: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </div>
        <button onClick={predict} style={btnStyle}>
          Score this lead
        </button>
      </section>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <section style={sectionStyle}>
            <h2 style={h2Style}>Predicted Approval</h2>
            <div
              style={{
                background: 'linear-gradient(135deg, var(--riq-surface-elev) 0%, var(--riq-surface) 100%)',
                border: '1px solid var(--riq-border)',
                borderRadius: 10,
                padding: 24,
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, color: cls }}>{result.score}%</div>
              <div style={{ fontSize: 12, color: 'var(--riq-text-muted)', textTransform: 'uppercase', marginTop: 4 }}>
                Approval probability · Confidence: {result.confidence}
              </div>
            </div>
            <div style={{ textAlign: 'center', marginBottom: 12, fontWeight: 600 }}>
              Estimated approved $ if won:{' '}
              <span style={{ color: 'var(--riq-success)' }}>${Math.round(result.predValue).toLocaleString()}</span>
            </div>
            <h2 style={{ ...h2Style, fontSize: 14 }}>Factors that moved the score</h2>
            {result.factors.map((f, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--riq-surface-elev)',
                  padding: '10px 14px',
                  borderRadius: 6,
                  marginBottom: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                }}
              >
                <span style={{ color: 'var(--riq-text-muted)', flex: 1 }}>{f.name}</span>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: f.dir === 'up' ? 'var(--riq-success)' : f.dir === 'down' ? 'var(--riq-danger)' : 'var(--riq-accent)',
                  }}
                >
                  {f.impact}
                </span>
              </div>
            ))}
          </section>
          <section style={sectionStyle}>
            <h2 style={h2Style}>Recommended Plays</h2>
            {result.recs.map((r, i) => (
              <div
                key={i}
                style={{
                  background:
                    r.tone === 'good'
                      ? 'rgba(16,185,129,0.08)'
                      : r.tone === 'warn'
                        ? 'rgba(245,158,11,0.08)'
                        : r.tone === 'bad'
                          ? 'rgba(239,68,68,0.08)'
                          : 'rgba(94,200,255,0.08)',
                  borderLeft:
                    '3px solid ' +
                    (r.tone === 'good'
                      ? 'var(--riq-success)'
                      : r.tone === 'warn'
                        ? 'var(--riq-warn)'
                        : r.tone === 'bad'
                          ? 'var(--riq-danger)'
                          : 'var(--riq-accent)'),
                  padding: '12px 16px',
                  borderRadius: '0 6px 6px 0',
                  marginBottom: 8,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
                dangerouslySetInnerHTML={{ __html: r.html }}
              />
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--riq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--riq-surface-elev)',
  color: 'var(--riq-text)',
  border: '1px solid var(--riq-border)',
  borderRadius: 4,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
};
const selectStyle = inputStyle;
const btnStyle: React.CSSProperties = {
  background: 'var(--riq-accent)',
  color: 'var(--riq-bg)',
  border: 'none',
  borderRadius: 6,
  padding: '10px 22px',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const sectionStyle: React.CSSProperties = {
  background: 'var(--riq-surface)',
  border: '1px solid var(--riq-border)',
  borderRadius: 8,
  padding: '20px 24px',
};
const h2Style: React.CSSProperties = { margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--riq-accent)' };
