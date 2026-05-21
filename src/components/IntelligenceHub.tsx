/**
 * Intelligence Hub — root container for the Roof Docs intel layer.
 * Lazy-loads static HTML pages via iframe.
 */
import { useState, useCallback } from 'react';
import { Predictor } from './intel/Predictor';
import { StormFeed } from './intel/StormFeed';
import { RefreshButton } from './intel/RefreshButton';

type IntelView =
  | 'home'
  | 'master-guide'
  | 'predictor'
  // Executive
  | 'exec'
  | 'weekly-recap'
  | 'analytics'
  // Smart Brain
  | 'field-guide'
  | 'cheat-sheet'
  | 'lead-score'
  | 'pipeline-intel'
  // AI Combat Suite
  | 'denial-analyzer'
  | 'denial-archive'
  | 'denial-stats'
  | 'carrier-playbook'
  | 'carrier-algorithms'
  | 'adjuster-twin'
  | 'lifetime-touch'
  | 'insurance-intel'
  // Maps & Geo
  | 'map'
  | 'hot-zips'
  | 'zip-intel'
  | 'property-lookup'
  // Outreach
  | 'resurrection'
  | 'storm-exposure'
  | 'storm-playbook'
  | 'storm-intel'
  | 'campaigns'
  | 'solar'
  | 'customers'
  | 'customer-detail'
  | 'leads'
  | 'leads-intel'
  // Intelligence
  | 'adjusters'
  | 'adjuster-detail'
  | 'carrier-detail'
  | 'carrier-trades'
  | 'reps'
  | 'rep-response'
  | 'ops-team'
  | 'notes'
  // Operations
  | 'receivables'
  | 'active-work'
  | 'scheduling'
  | 'ops-surveillance'
  | 'pricing-margins'
  | 'pricing-library'
  | 'sms-reminders'
  | 'carrier-orphans';

const VIEW_FILES: Record<Exclude<IntelView, 'home' | 'predictor'>, string> = {
  'master-guide':      'master.html',
  // Executive
  'exec':              'exec.html',
  'weekly-recap':      'weekly-recap.html',
  'analytics':         'analytics.html',
  // Smart Brain
  'field-guide':       'field-guide.html',
  'cheat-sheet':       'cheat-sheet.html',
  'lead-score':        'lead-score.html',
  'pipeline-intel':    'pipeline-intel.html',
  // AI Combat Suite
  'denial-analyzer':   'denial-analyzer.html',
  'denial-archive':    'denial-archive.html',
  'denial-stats':      'denial-stats.html',
  'carrier-playbook':  'carrier-playbook.html',
  'carrier-algorithms':'carrier-algorithms.html',
  'adjuster-twin':     'adjuster-twin.html',
  'lifetime-touch':    'lifetime-touch.html',
  'insurance-intel':   'insurance-intel.html',
  // Maps & Geo
  'map':               'roofdocs-map.html',
  'hot-zips':          'hot-zips.html',
  'zip-intel':         'zip-intel.html',
  'property-lookup':   'property-lookup.html',
  // Outreach
  'resurrection':      'resurrection.html',
  'storm-exposure':    'storm-exposure.html',
  'storm-playbook':    'storm-playbook.html',
  'storm-intel':       'storm-intel.html',
  'campaigns':         'upgrade-campaigns.html',
  'solar':             'solar.html',
  'customers':         'customers.html',
  'customer-detail':   'customer-detail.html',
  'leads':             'leads.html',
  'leads-intel':       'leads-intel.html',
  // Intelligence
  'adjusters':         'adjusters.html',
  'adjuster-detail':   'adjuster-detail.html',
  'carrier-detail':    'carrier-detail.html',
  'carrier-trades':    'carrier-trades.html',
  'reps':              'reps.html',
  'rep-response':      'rep-response.html',
  'ops-team':          'ops-team.html',
  'notes':             'notes.html',
  // Operations
  'receivables':       'receivables.html',
  'active-work':       'active-work.html',
  'scheduling':        'scheduling.html',
  'ops-surveillance':  'ops-surveillance.html',
  'pricing-margins':   'pricing-margins.html',
  'pricing-library':   'pricing-library.html',
  'sms-reminders':     'sms-reminders.html',
  'carrier-orphans':   'carrier-orphans.html',
};

const VIEW_LABELS: Partial<Record<IntelView, string>> = {
  'home': '🏠 Home',
  'master-guide': '📋 Master Guide',
  'predictor': '🔮 Predictor',
  'exec': '📊 Exec Snapshot',
  'weekly-recap': '📰 Weekly Recap',
  'analytics': '📈 Analytics',
  'field-guide': '📖 Field Guide',
  'cheat-sheet': '🎓 Cheat Sheet',
  'lead-score': '🎯 Lead Score',
  'pipeline-intel': '🧬 Pipeline DNA',
  'denial-analyzer': '⚖️ Denial Analyzer',
  'denial-archive': '📂 Denial Archive',
  'denial-stats': '📊 Denial Stats',
  'carrier-playbook': '📕 Carrier Playbook',
  'carrier-algorithms': '🧠 Algorithm Decoder',
  'adjuster-twin': '🪞 Adjuster Twin',
  'lifetime-touch': '💞 Touch Engine',
  'insurance-intel': '🛡 Market Intelligence',
  'map': '📍 Project Map',
  'hot-zips': '🔥 Hot ZIPs',
  'zip-intel': '📋 ZIP Intel',
  'property-lookup': '🔍 Property Lookup',
  'resurrection': '🪦 Resurrection',
  'storm-exposure': '⚡ Storm Exposure',
  'storm-playbook': '🎯 Storm Playbook',
  'storm-intel': '🌪 Storm Intel',
  'campaigns': '📨 Campaigns',
  'solar': '☀️ Solar Funnel',
  'customers': '👥 Customers',
  'customer-detail': '👤 Customer Detail',
  'leads': '🚪 Leads List',
  'leads-intel': '📍 Leads Intelligence',
  'adjusters': '📋 Adjusters',
  'adjuster-detail': '🔍 Adjuster Detail',
  'carrier-detail': '🏢 Carrier Deep Dive',
  'carrier-trades': '🧾 Carrier × Trade',
  'reps': '🎯 Reps',
  'rep-response': '⏱ Rep Response',
  'ops-team': '👥 Ops Team',
  'notes': '📝 Notes',
  'receivables': '💰 AR / Money',
  'active-work': '🔧 Active Work',
  'scheduling': '📅 Scheduling',
  'ops-surveillance': '📋 Ops Surveillance',
  'pricing-margins': '💰 Pricing Margins',
  'pricing-library': '📚 Pricing Library',
  'sms-reminders': '📱 SMS Reminders',
  'carrier-orphans': '🚧 Carrier Orphans',
};

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: IntelView; label: string }> }> = [
  {
    label: 'Executive',
    items: [
      { id: 'home',         label: '🏠 Home' },
      { id: 'exec',         label: '📊 Exec Snapshot' },
      { id: 'weekly-recap', label: '📰 Weekly Recap' },
      { id: 'analytics',    label: '📈 Analytics' },
    ],
  },
  {
    label: 'Smart Brain',
    items: [
      { id: 'predictor',    label: '🔮 Predictor (native)' },
      { id: 'cheat-sheet',  label: '🎓 Cheat Sheet' },
      { id: 'field-guide',  label: '📖 Field Guide' },
      { id: 'lead-score',   label: '🎯 Lead Score' },
      { id: 'pipeline-intel', label: '🧬 Pipeline DNA' },
    ],
  },
  {
    label: 'AI Combat Suite',
    items: [
      { id: 'denial-analyzer',    label: '⚖️ Denial Analyzer' },
      { id: 'denial-archive',     label: '📂 Denial Archive' },
      { id: 'denial-stats',       label: '📊 Denial Stats' },
      { id: 'carrier-playbook',   label: '📕 Carrier Playbook' },
      { id: 'carrier-algorithms', label: '🧠 Algorithm Decoder' },
      { id: 'adjuster-twin',      label: '🪞 Adjuster Twin V2' },
      { id: 'lifetime-touch',     label: '💞 Touch Engine' },
      { id: 'insurance-intel',    label: '🛡 Market Intelligence' },
    ],
  },
  {
    label: 'Maps & Geo',
    items: [
      { id: 'map',            label: '📍 Project Map' },
      { id: 'hot-zips',       label: '🔥 Hot ZIPs' },
      { id: 'zip-intel',      label: '📋 ZIP Intel' },
      { id: 'property-lookup',label: '🔍 Property Lookup' },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { id: 'resurrection',   label: '🪦 Resurrection' },
      { id: 'storm-exposure', label: '⚡ Storm Exposure' },
      { id: 'storm-playbook', label: '🎯 Storm Playbook' },
      { id: 'storm-intel',    label: '🌪 Storm Intel' },
      { id: 'campaigns',      label: '📨 Campaigns' },
      { id: 'solar',          label: '☀️ Solar Funnel' },
      { id: 'customers',      label: '👥 Customers' },
      { id: 'customer-detail',label: '👤 Customer Detail' },
      { id: 'leads',          label: '🚪 Leads List' },
      { id: 'leads-intel',    label: '📍 Leads Intelligence' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'adjusters',      label: '📋 Adjusters' },
      { id: 'adjuster-detail',label: '🔍 Adjuster Detail' },
      { id: 'carrier-detail', label: '🏢 Carrier Deep Dive' },
      { id: 'carrier-trades', label: '🧾 Carrier × Trade' },
      { id: 'reps',           label: '🎯 Reps' },
      { id: 'rep-response',   label: '⏱ Rep Response' },
      { id: 'ops-team',       label: '👥 Ops Team' },
      { id: 'notes',          label: '📝 Notes' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'receivables',      label: '💰 AR / Money' },
      { id: 'active-work',      label: '🔧 Active Work' },
      { id: 'scheduling',       label: '📅 Scheduling' },
      { id: 'ops-surveillance', label: '📋 Ops Surveillance' },
      { id: 'pricing-margins',  label: '💰 Pricing Margins' },
      { id: 'pricing-library',  label: '📚 Pricing Library' },
      { id: 'sms-reminders',    label: '📱 SMS Reminders' },
      { id: 'carrier-orphans',  label: '🚧 Carrier Orphans' },
    ],
  },
];

export function IntelligenceHub() {
  const [view, setViewState] = useState<IntelView>('home');
  const [history, setHistory] = useState<IntelView[]>([]);

  // Navigate with history tracking
  const navigate = useCallback((next: IntelView) => {
    setHistory(h => [...h, view]);
    setViewState(next);
  }, [view]);

  // Go back one step
  const goBack = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setViewState(prev);
      return h.slice(0, -1);
    });
  }, []);

  const canGoBack = history.length > 0;

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--riq-bg)', color: 'var(--riq-text)' }}>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: 240,
          background: 'var(--riq-surface)',
          borderRight: '1px solid var(--riq-border)',
          padding: '16px 12px',
          overflowY: 'auto',
          flexShrink: 0,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--riq-accent)', marginBottom: 2, letterSpacing: '0.02em' }}>
          RIQ 21
        </div>
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 11, marginBottom: 12 }}>
          Roofing IQ · 16k jobs + 48k storms
        </div>

        {/* Master Guide pinned at top */}
        <button
          onClick={() => navigate('master-guide')}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            background: view === 'master-guide' ? 'rgba(244,167,56,0.18)' : 'rgba(244,167,56,0.10)',
            border: `1px solid ${view === 'master-guide' ? 'var(--riq-accent)' : 'rgba(244,167,56,0.4)'}`,
            color: 'var(--riq-accent)', borderRadius: 6, padding: '9px 12px',
            fontSize: 13, fontWeight: 800, cursor: 'pointer', marginBottom: 14,
            fontFamily: 'inherit', letterSpacing: '-0.01em',
          }}
        >
          📋 Master Guide
          <div style={{ fontSize: 10, fontWeight: 400, color: 'rgba(244,167,56,0.7)', marginTop: 2 }}>
            All 47 pages · new user start here
          </div>
        </button>

        {NAV_GROUPS.map((g) => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--riq-text-muted)', marginBottom: 6, padding: '0 4px',
            }}>
              {g.label}
            </div>
            {g.items.map((it) => (
              <button
                key={it.id}
                onClick={() => navigate(it.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: view === it.id ? 'var(--riq-surface-elev)' : 'transparent',
                  border: view === it.id ? '1px solid var(--riq-accent)' : '1px solid transparent',
                  color: view === it.id ? 'var(--riq-accent)' : 'var(--riq-text)',
                  borderRadius: 4, padding: '6px 10px', fontSize: 12,
                  cursor: 'pointer', marginBottom: 2, fontFamily: 'inherit',
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar with back button */}
        {canGoBack && (
          <div style={{
            background: 'var(--riq-surface)',
            borderBottom: '1px solid var(--riq-border)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={goBack}
              style={{
                background: 'transparent',
                border: '1px solid var(--riq-border)',
                color: 'var(--riq-text)',
                borderRadius: 5,
                padding: '5px 12px',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--riq-accent)';
                e.currentTarget.style.color = 'var(--riq-accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--riq-border)';
                e.currentTarget.style.color = 'var(--riq-text)';
              }}
            >
              ← Back
            </button>
            <span style={{ fontSize: 12, color: 'var(--riq-text-muted)' }}>
              {VIEW_LABELS[view] || view}
            </span>
          </div>
        )}

        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {view === 'home' && <HomePane navigate={navigate} />}
          {view === 'predictor' && <Predictor />}
          {view !== 'home' && view !== 'predictor' && (
            <iframe
              key={view}
              src={`/${VIEW_FILES[view as Exclude<IntelView, 'home' | 'predictor'>]}`}
              style={{ width: '100%', height: '100%', border: 0, background: 'var(--riq-bg)' }}
              title={view}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function HomePane({ navigate }: { navigate: (v: IntelView) => void }) {
  return (
    <div style={{ padding: '32px 36px', overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--riq-accent)', margin: 0, letterSpacing: '-0.01em' }}>
        RIQ 21 — Roofing IQ Command Center
      </h1>
      <p style={{ color: 'var(--riq-text-muted)', fontSize: 13, marginTop: 6, marginBottom: 20 }}>
        Internal sales + ops intelligence for The Roof Docs. Refreshes nightly from the portal.
      </p>

      {/* Master Guide banner */}
      <button
        onClick={() => navigate('master-guide')}
        style={{
          display: 'flex', alignItems: 'center', gap: 16, width: '100%',
          background: 'rgba(244,167,56,0.10)', border: '2px solid rgba(244,167,56,0.5)',
          borderRadius: 10, padding: '16px 22px', cursor: 'pointer',
          fontFamily: 'inherit', color: 'inherit', textAlign: 'left',
          marginBottom: 24, transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(244,167,56,0.18)';
          e.currentTarget.style.borderColor = 'var(--riq-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(244,167,56,0.10)';
          e.currentTarget.style.borderColor = 'rgba(244,167,56,0.5)';
        }}
      >
        <span style={{ fontSize: 32, flexShrink: 0 }}>📋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--riq-accent)', marginBottom: 3 }}>
            Master Guide — New User? Start Here
          </div>
          <div style={{ fontSize: 12, color: 'var(--riq-text-muted)', lineHeight: 1.4 }}>
            All 47 pages explained · 8 categories · 6-step quick start · live search
          </div>
        </div>
        <span style={{ fontSize: 20, color: 'var(--riq-accent)', flexShrink: 0, fontWeight: 800 }}>→</span>
      </button>

      <RefreshButton />
      <StormFeed />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        <Tile icon="🔮" title="Score a Lead" desc="Carrier × ZIP × hail × adjuster → approval probability + playbook." onClick={() => navigate('predictor')} />
        <Tile icon="🧬" title="Pipeline DNA" desc="83.4% vs 11.7% — supplement signal, bottlenecks, automation triggers." onClick={() => navigate('pipeline-intel')} />
        <Tile icon="🛡" title="Market Intelligence" desc="Carrier threat matrix, 1,000 at-risk customers, MD non-renewal zones." onClick={() => navigate('insurance-intel')} />
        <Tile icon="🪦" title="Resurrection List" desc="Dead insurance jobs with NEW storm activity since they died." onClick={() => navigate('resurrection')} />
        <Tile icon="⚡" title="Storm Exposure" desc="Customers whose homes got hit by strong storms since first contact." onClick={() => navigate('storm-exposure')} />
        <Tile icon="🎯" title="Storm Playbook" desc="Pick a storm → trade-gap call list per affected customer." onClick={() => navigate('storm-playbook')} />
        <Tile icon="⚖️" title="Denial Analyzer" desc="Paste denial letter → matched against 26 patents → counter-letter." onClick={() => navigate('denial-analyzer')} />
        <Tile icon="📅" title="Scheduling" desc="354 overdue installs, 141 ready with no date. Full install pipeline." onClick={() => navigate('scheduling')} />
        <Tile icon="📋" title="Ops Surveillance" desc="589 open supplements, 344 overdue, 104 cross-sell bids ($3.2M)." onClick={() => navigate('ops-surveillance')} />
      </div>

      <div style={{ background: 'var(--riq-surface)', border: '1px solid var(--riq-border)', borderRadius: 8, padding: '16px 20px', fontSize: 13, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--riq-accent)' }}>About RIQ 21:</strong> 16k real jobs · 48k storm events · 26 carrier AI patents decoded.
        Data refreshes nightly. Live storm feed from{' '}
        <a href="https://hailyes.up.railway.app" target="_blank" rel="noreferrer" style={{ color: 'var(--riq-orange)' }}>Hail Yes</a>.
      </div>
    </div>
  );
}

function Tile({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--riq-surface)', border: '1px solid var(--riq-border)',
        borderRadius: 10, padding: '18px 22px', textAlign: 'left',
        color: 'inherit', cursor: 'pointer', fontFamily: 'inherit',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--riq-accent)';
        e.currentTarget.style.background = 'var(--riq-surface-elev)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--riq-border)';
        e.currentTarget.style.background = 'var(--riq-surface)';
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>{desc}</div>
    </button>
  );
}
