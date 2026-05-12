/**
 * StormFeed — lightweight Hail Yes feed widget for the Intel home pane.
 *
 * Pulls recent storm events from hailyes.up.railway.app (the live Hail Yes
 * product) so this app doesn't need its own MRMS/NEXRAD/radar stack. Click a
 * row → opens Hail Yes in a new tab.
 *
 * Why this exists: when we pivoted storm-maps into the Intel platform, we cut
 * the heavy storm-map UI. Reps still need to see "what storms happened lately"
 * for resurrection + playbook work, but they don't need their own map here —
 * Hail Yes already has the best version. So we just embed a feed.
 */
import { useEffect, useState } from 'react';

const HAIL_YES_BASE = 'https://hailyes.up.railway.app';

type Event = {
  id: number;
  state: string;
  event_date: string;
  tier: number;
  peak_hail_inches: number | null;
  peak_wind_mph: number | null;
  source_ncei: boolean;
  source_swdi: boolean;
  source_iem: boolean;
  source_hailtrace: boolean;
  source_ihm: boolean;
  has_mrms_swath: boolean;
  has_wind_swath: boolean;
};

const FOCUS_STATES = new Set(['VA', 'MD', 'PA', 'DC', 'WV', 'DE']);

export function StormFeed() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${HAIL_YES_BASE}/api/events?days=14`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => {
        if (cancelled) return;
        setEvents((d.events || []).filter((e: Event) => FOCUS_STATES.has(e.state)).slice(0, 25));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div style={panel}>
        <div style={hdr}>⚡ Live Storm Activity</div>
        <div style={{ color: 'var(--riq-danger)', fontSize: 12 }}>Hail Yes unreachable: {error}</div>
      </div>
    );
  }
  if (!events) {
    return (
      <div style={panel}>
        <div style={hdr}>⚡ Live Storm Activity</div>
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>Loading feed from Hail Yes…</div>
      </div>
    );
  }
  if (!events.length) {
    return (
      <div style={panel}>
        <div style={hdr}>⚡ Live Storm Activity</div>
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>No DMV/PA storms in last 14 days.</div>
      </div>
    );
  }

  // Source-count badge — more sources = more credible event
  const corroboration = (e: Event) =>
    [e.source_ncei, e.source_swdi, e.source_iem, e.source_hailtrace, e.source_ihm].filter(Boolean)
      .length;

  return (
    <div style={panel}>
      <div style={hdr}>
        ⚡ Live Storm Activity{' '}
        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--riq-text-muted)' }}>
          · last 14 days · DMV/PA · feed from{' '}
          <a href={HAIL_YES_BASE} target="_blank" rel="noreferrer" style={{ color: 'var(--riq-accent)' }}>
            Hail Yes
          </a>
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {events.map((e) => (
          <a
            key={e.id}
            href={`${HAIL_YES_BASE}/event/${e.id}`}
            target="_blank"
            rel="noreferrer"
            style={row}
            onMouseEnter={(ev) => (ev.currentTarget.style.borderColor = 'var(--riq-accent)')}
            onMouseLeave={(ev) => (ev.currentTarget.style.borderColor = 'var(--riq-border)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{e.state}</span>
              <span style={{ fontSize: 11, color: 'var(--riq-text-muted)' }}>{e.event_date}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--riq-text)', marginTop: 4 }}>
              {e.peak_hail_inches ? `🧊 ${e.peak_hail_inches.toFixed(2)}" hail` : ''}
              {e.peak_hail_inches && e.peak_wind_mph ? ' · ' : ''}
              {e.peak_wind_mph ? `💨 ${e.peak_wind_mph} mph` : ''}
              {!e.peak_hail_inches && !e.peak_wind_mph ? <span style={{ color: 'var(--riq-text-muted)' }}>swath only</span> : null}
            </div>
            <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginTop: 4 }}>
              {corroboration(e)}/5 sources
              {e.has_mrms_swath ? ' · MRMS' : ''}
              {e.has_wind_swath ? ' · wind' : ''}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: 'var(--riq-surface)',
  border: '1px solid var(--riq-border)',
  borderRadius: 8,
  padding: '14px 18px',
  marginBottom: 16,
};
const hdr: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--riq-accent)',
  marginBottom: 12,
};
const row: React.CSSProperties = {
  display: 'block',
  background: 'var(--riq-bg)',
  border: '1px solid var(--riq-border)',
  borderRadius: 6,
  padding: '8px 10px',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'border-color 0.15s',
};
