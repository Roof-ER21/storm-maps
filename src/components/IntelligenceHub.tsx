/**
 * Intelligence Hub — root container for the Roof Docs intel layer.
 * Lazy-loads static HTML pages via iframe. Phase 2b adds role-aware nav,
 * 4 role homes, 9 consolidated hubs, and a one-time onboarding interstitial.
 */
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Predictor } from './intel/Predictor';
import { StormFeed } from './intel/StormFeed';
import { RefreshButton } from './intel/RefreshButton';
import { useUser } from '../auth/UserContext';
import { canAccess, ROLE_HOME } from '../auth/roles';
import { getHub } from './hubs/hubs';
import { HubWrapper } from './hubs/HubWrapper';
import { NATIVE_VIEWS } from './views/native/registry';
import { AdminHome } from './homes/AdminHome';
import { ExecHome } from './homes/ExecHome';
import { MyDay } from './homes/MyDay';
import { DataRoom } from './homes/DataRoom';
import { OnboardingInterstitial } from './OnboardingInterstitial';
import { ChatDrawer, dispatchDrawerToggle } from '../ai/ChatDrawer';

type IntelView =
  | 'home'
  | 'master-guide'
  | 'predictor'
  // Phase 2b role homes
  | 'admin-home'
  | 'exec-home'
  | 'my-day'
  | 'data-room'
  // Phase 2b consolidated hubs (tabbed)
  | 'carrier-hub'
  | 'storm-hub'
  | 'denial-hub'
  | 'adjuster-hub'
  | 'rep-hub'
  | 'customer-hub'
  | 'leads-hub'
  | 'pricing-hub'
  | 'zip-hub'
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

// VIEW_FILES is a partial map — new role-home + hub views are rendered as
// native React components in `renderView`, not as iframes, so they're absent.
const VIEW_FILES: Partial<Record<IntelView, string>> = {
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
    label: 'My View',
    items: [
      { id: 'admin-home',   label: '⚙️ Admin Console' },
      { id: 'exec-home',    label: '📊 Exec Home' },
      { id: 'my-day',       label: '☀️ My Day' },
      { id: 'data-room',    label: '🔬 Data Room' },
      { id: 'home',         label: '🏠 Legacy Home' },
    ],
  },
  {
    label: 'Hubs',
    items: [
      { id: 'carrier-hub',  label: '🏢 Carrier Hub' },
      { id: 'storm-hub',    label: '🌪 Storm Hub' },
      { id: 'denial-hub',   label: '⚖️ Denial Hub' },
      { id: 'adjuster-hub', label: '🪞 Adjuster Hub' },
      { id: 'rep-hub',      label: '🎯 Rep Hub' },
      { id: 'customer-hub', label: '👥 Customer Hub' },
      { id: 'leads-hub',    label: '🚪 Leads Hub' },
      { id: 'pricing-hub',  label: '💰 Pricing Hub' },
      { id: 'zip-hub',      label: '📍 ZIP Hub' },
    ],
  },
  {
    label: 'Executive',
    items: [
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

/** Deep-link entry: honor `?view=<hub>` on first load (e.g. from a 301 of a
 *  retired `/x.html` URL). Only hub views are accepted; HubWrapper reads `?tab=`
 *  for the sub-tab. A URL-set view is non-'home', so the role-home landing
 *  effect below skips it automatically. */
function readViewFromUrl(): IntelView | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('view');
  return v && getHub(v) ? (v as IntelView) : null;
}

export function IntelligenceHub() {
  const { user } = useUser();
  const [view, setViewState] = useState<IntelView>(() => readViewFromUrl() ?? 'home');
  const [history, setHistory] = useState<IntelView[]>([]);

  // Once the user loads, land on their role's default home (unless they've
  // already navigated somewhere). Skip if not authenticated yet.
  const [didLandOnRoleHome, setDidLandOnRoleHome] = useState(false);
  useEffect(() => {
    if (!user || didLandOnRoleHome) return;
    const home = (ROLE_HOME[user.role] as IntelView) ?? 'home';
    if (view === 'home') setViewState(home);
    setDidLandOnRoleHome(true);
  }, [user, didLandOnRoleHome, view]);

  // Filter NAV_GROUPS by role. Anonymous = show everything (legacy admin
  // bootstrap may make this case rare in practice).
  const visibleNav = useMemo(() => {
    if (!user) return NAV_GROUPS;
    return NAV_GROUPS
      .map((g) => ({
        label: g.label,
        items: g.items.filter((it) => canAccess(it.id, { role: user.role, is_root_admin: user.is_root_admin })),
      }))
      .filter((g) => g.items.length > 0);
  }, [user]);

  // Navigate with history tracking. Defensive: if user can't access target, ignore.
  const navigate = useCallback((next: IntelView) => {
    if (user && !canAccess(next, { role: user.role, is_root_admin: user.is_root_admin })) return;
    setHistory(h => [...h, view]);
    setViewState(next);
  }, [view, user]);

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

        {visibleNav.map((g) => (
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
          {renderView(view, navigate)}
        </main>
      </div>
      <OnboardingInterstitial onTakeTour={() => navigate('master-guide')} />

      {/* Phase 6 AI Assistant — drawer + floating FAB */}
      <ChatDrawer pageContext={view} />
      <button
        onClick={() => dispatchDrawerToggle()}
        aria-label="Open AI assistant"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1098,
          background: 'var(--riq-accent)',
          color: '#0c0c0e',
          border: 'none',
          borderRadius: 100,
          padding: '11px 20px',
          fontSize: 14,
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: 'inherit',
          boxShadow: '0 4px 20px rgba(244,167,56,0.40)',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          letterSpacing: '-0.01em',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.05)';
          e.currentTarget.style.boxShadow = '0 6px 28px rgba(244,167,56,0.55)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(244,167,56,0.40)';
        }}
      >
        ✦ Ask AI
      </button>
    </div>
  );
}

// View renderer. Native components first, then hub wrappers, then legacy iframe fallback.
function renderView(view: IntelView, navigate: (v: IntelView) => void) {
  if (view === 'home')        return <HomePane navigate={navigate} />;
  if (view === 'predictor')   return <Predictor />;
  if (view === 'admin-home')  return <AdminHome navigate={navigate as (v: string) => void} />;
  if (view === 'exec-home')   return <ExecHome navigate={navigate as (v: string) => void} />;
  if (view === 'my-day')      return <MyDay navigate={navigate as (v: string) => void} />;
  if (view === 'data-room')   return <DataRoom navigate={navigate as (v: string) => void} />;

  const hub = getHub(view);
  if (hub) return <HubWrapper hub={hub} />;

  const NativeView = NATIVE_VIEWS[view];
  if (NativeView) return <NativeView navigate={navigate as (v: string) => void} />;

  const file = VIEW_FILES[view as Exclude<IntelView, 'home' | 'predictor' | 'admin-home' | 'exec-home' | 'my-day' | 'data-room' | 'carrier-hub' | 'storm-hub' | 'denial-hub' | 'adjuster-hub' | 'rep-hub' | 'customer-hub' | 'leads-hub' | 'pricing-hub' | 'zip-hub'>];
  if (!file) return <div style={{ padding: 20, color: 'var(--riq-text-muted)' }}>view {view} not yet wired</div>;
  return (
    <iframe
      key={view}
      src={`/${file}`}
      style={{ width: '100%', height: '100%', border: 0, background: 'var(--riq-bg)' }}
      title={view}
    />
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
