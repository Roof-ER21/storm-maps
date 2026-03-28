import type { ReactNode } from 'react';
import type {
  PinnedProperty,
  PropertySearchSummary,
  StormDate,
  StormEvent,
} from '../types/storm';

interface DashboardPageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  events: StormEvent[];
  pinnedProperties: PinnedProperty[];
  onOpenMap: () => void;
  onOpenPinned: () => void;
  onOpenEvidence: () => void;
  onOpenReports: () => void;
}

export default function DashboardPage({
  searchSummary,
  stormDates,
  events,
  pinnedProperties,
  onOpenMap,
  onOpenPinned,
  onOpenEvidence,
  onOpenReports,
}: DashboardPageProps) {
  const hailEvents = events.filter((event) => event.eventType === 'Hail');
  const windEvents = events.filter(
    (event) => event.eventType === 'Thunderstorm Wind',
  );
  const severeEvents = events.filter(
    (event) =>
      (event.eventType === 'Hail' && event.magnitude >= 1.75) ||
      (event.eventType === 'Thunderstorm Wind' && event.magnitude >= 60),
  );
  const totalDamage = events.reduce(
    (sum, event) => sum + Math.max(0, event.damageProperty || 0),
    0,
  );

  const stateCounts = Array.from(
    events.reduce((map, event) => {
      const key = event.state || 'Unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);

  const recentEvents = [...events]
    .sort((left, right) => right.beginDate.localeCompare(left.beginDate))
    .slice(0, 5);

  const heroLabel =
    searchSummary?.locationLabel ?? 'VA, MD, PA hail reconnaissance workspace';
  const heroSubcopy = searchSummary
    ? `Current property workspace centered on ${searchSummary.locationLabel}.`
    : 'Comprehensive hail and wind reconnaissance for Virginia, Maryland, and Pennsylvania.';

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.18),_transparent_24%),radial-gradient(circle_at_75%_10%,_rgba(124,58,237,0.18),_transparent_22%),linear-gradient(180deg,_#12071d_0%,_#090412_42%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-7">
        <section className="relative overflow-hidden rounded-[30px] border border-slate-800 bg-slate-950/88 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
          <div className="absolute -right-16 top-0 h-56 w-56 rounded-full bg-orange-500/14 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-44 w-44 rounded-full bg-violet-500/14 blur-3xl" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,rgba(249,115,22,0.22),rgba(124,58,237,0.22))] text-orange-300 ring-1 ring-orange-400/15 shadow-[0_0_35px_rgba(168,85,247,0.24)]">
                  <BrandCloudIcon />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300/90">
                    Dashboard
                  </p>
                  <p className="text-sm text-slate-400">{heroLabel}</p>
                </div>
              </div>

              <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Hail <span className="bg-[linear-gradient(135deg,#fb923c,#a855f7)] bg-clip-text text-transparent">Intelligence</span>
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
                {heroSubcopy} Use the map, pinned targets, evidence queue, and
                NOAA-forward reports as one focused hail reconnaissance workflow.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
              <HeroAction
                title="Storm Map"
                body="Jump straight into address search, swaths, MRMS, and canvassing."
                onClick={onOpenMap}
              />
              <HeroAction
                title="Reports"
                body="Generate PDFs and evidence packs without map clutter."
                onClick={onOpenReports}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Total Events"
            value={String(events.length)}
            tone="orange"
            icon={<TrendIcon />}
          />
          <MetricCard
            label="Hail Events"
            value={String(hailEvents.length)}
            tone="violet"
            icon={<HailIcon />}
          />
          <MetricCard
            label="Wind Events"
            value={String(windEvents.length)}
            tone="plum"
            icon={<WindIcon />}
          />
          <MetricCard
            label='Severe (1.75"+ / 60mph+)'
            value={String(severeEvents.length)}
            tone="rose"
            icon={<AlertIcon />}
          />
          <MetricCard
            label="Tracked Damage"
            value={formatCurrencyCompact(totalDamage)}
            tone="amber"
            icon={<DollarIcon />}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Recent Storm Events
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  Latest hail and wind activity
                </h3>
              </div>
              <button
                type="button"
                onClick={onOpenMap}
                className="rounded-2xl border border-violet-500/20 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-orange-200 transition-colors hover:border-violet-400/30 hover:bg-slate-800"
              >
                Open Map
              </button>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <RecentEventCard key={event.id} event={event} />
                ))
              ) : (
                <EmptyPanel
                  title="No storm events loaded yet"
                  body="Search an address in the Storm Map workspace to populate the dashboard with real hail and wind history."
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Quick Actions
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Work the next step fast
              </h3>
              <div className="mt-5 grid gap-3">
                <ActionTile
                  title="Interactive Storm Map"
                  body="Explore storm dates, swaths, MRMS overlays, and search-driven property history."
                  onClick={onOpenMap}
                  icon={<MapPinIcon />}
                />
                <ActionTile
                  title="Pinned Targets"
                  body="Return to saved properties and canvassing opportunities without another search."
                  onClick={onOpenPinned}
                  icon={<PinIcon />}
                />
                <ActionTile
                  title="Evidence Workspace"
                  body="Review uploads, public samples, and report-ready proof for the current property."
                  onClick={onOpenEvidence}
                  icon={<HailIcon />}
                />
                <ActionTile
                  title="Generate Reports"
                  body="Create PDFs and evidence packs from the exact storm date you want to document."
                  onClick={onOpenReports}
                  icon={<DollarIcon />}
                />
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Events by State
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Where the current search window hits hardest
              </h3>
              <div className="mt-5 grid gap-3">
                {stateCounts.length > 0 ? (
                  stateCounts.map(([state, count]) => (
                    <StateRow key={state} state={state} count={count} />
                  ))
                ) : (
                  <EmptyPanel
                    title="No state summary yet"
                    body="Once events load, the strongest states in the current search window will show here."
                  />
                )}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Latest Hits
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Most recent storm dates for this workspace
            </h3>
            <div className="mt-5 grid gap-3">
              {stormDates.slice(0, 4).map((stormDate) => (
                <div
                  key={stormDate.date}
                  className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold text-white">
                        {stormDate.label}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {stormDate.eventCount} report
                        {stormDate.eventCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-amber-300">
                        {stormDate.maxHailInches > 0
                          ? `${stormDate.maxHailInches.toFixed(2)}" hail`
                          : 'No hail'}
                      </p>
                      <p className="mt-1 text-sm text-violet-200">
                        {stormDate.maxWindMph > 0
                          ? `${stormDate.maxWindMph.toFixed(0)} mph wind`
                          : 'No wind'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {stormDates.length === 0 && (
                <EmptyPanel
                  title="No recent storm dates yet"
                  body="Search a property in the map view and this section will fill with the latest documented storm hits."
                />
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Saved Targets
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Pinned properties to revisit
            </h3>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {pinnedProperties.slice(0, 4).map((property) => (
                <div
                  key={property.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4"
                >
                  <p className="text-base font-semibold text-white">
                    {property.locationLabel}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {property.stormDateCount} storm date
                    {property.stormDateCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-3 text-sm text-violet-200">
                    {property.latestStormDate
                      ? `Latest hit ${formatShortDate(property.latestStormDate)}`
                      : 'No hit date saved yet'}
                  </p>
                </div>
              ))}

              {pinnedProperties.length === 0 && (
                <EmptyPanel
                  title="No pinned targets yet"
                  body="Pin searched addresses from the map workspace to build your canvassing and reporting queue."
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function HeroAction({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[24px] border border-slate-800 bg-slate-900/80 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
    >
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </button>
  );
}

function MetricCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'orange' | 'violet' | 'plum' | 'rose' | 'amber';
  icon: ReactNode;
}) {
  const toneClasses = {
    orange: 'border-orange-500/18 bg-orange-500/[0.07] text-orange-300',
    violet: 'border-violet-500/18 bg-violet-500/[0.07] text-violet-200',
    plum: 'border-fuchsia-500/18 bg-fuchsia-500/[0.07] text-fuchsia-200',
    rose: 'border-rose-500/18 bg-rose-500/[0.07] text-rose-300',
    amber: 'border-amber-500/18 bg-amber-500/[0.07] text-amber-300',
  };

  return (
    <div className={`rounded-[24px] border p-5 ${toneClasses[tone]}`}>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950/60">
        {icon}
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </div>
  );
}

function RecentEventCard({ event }: { event: StormEvent }) {
  const severityValue =
    event.eventType === 'Hail'
      ? event.magnitude
      : event.magnitude;
  const severityLabel =
    event.eventType === 'Hail'
      ? `${trimTrailingZeroes(event.magnitude)} in (${hailNickname(event.magnitude)})`
      : `${trimTrailingZeroes(event.magnitude)} mph`;

  return (
    <article className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-orange-300">
              {event.eventType === 'Hail' ? <HailIcon /> : <WindIcon />}
            </span>
            <p className="truncate text-lg font-semibold text-white">
              {event.eventType}
            </p>
          </div>
          <p className="mt-1 text-sm text-slate-400">{severityLabel}</p>
        </div>
        <div className="shrink-0">{renderSeverityStars(severityValue, event.eventType)}</div>
      </div>

      <div className="mt-5 space-y-2 text-sm text-slate-400">
        <DetailRow icon={<MapPinIcon />} text={formatEventLocation(event)} />
        <DetailRow icon={<CalendarIcon />} text={formatLongDate(event.beginDate)} />
        <DetailRow
          icon={<DollarIcon />}
          text={
            event.damageProperty > 0
              ? `Damage: ${formatCurrencyCompact(event.damageProperty)}`
              : `Source: ${event.source || 'NOAA'}`
          }
        />
      </div>
    </article>
  );
}

function ActionTile({
  title,
  body,
  icon,
  onClick,
}: {
  title: string;
  body: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[22px] border border-slate-800 bg-slate-900/65 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800/80 text-orange-300">
        {icon}
      </div>
      <p className="mt-4 text-lg font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </button>
  );
}

function StateRow({ state, count }: { state: string; count: number }) {
  return (
    <div className="flex items-center justify-between rounded-[22px] border border-slate-800 bg-slate-900/65 px-4 py-4">
      <div>
        <p className="text-lg font-semibold text-white">{stateName(state)}</p>
        <p className="text-sm text-slate-500">{state}</p>
      </div>
      <p className="text-5xl font-semibold tracking-tight text-orange-300">{count}</p>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-slate-800 bg-slate-900/35 p-5">
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
    </div>
  );
}

function DetailRow({
  icon,
  text,
}: {
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function formatEventLocation(event: StormEvent): string {
  const parts = [event.county, event.state].filter(Boolean);
  return parts.join(', ') || event.source || 'Unknown location';
}

function formatLongDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatShortDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function renderSeverityStars(value: number, eventType: StormEvent['eventType']) {
  const normalized =
    eventType === 'Hail'
      ? Math.max(1, Math.min(5, Math.ceil(value / 0.5)))
      : Math.max(1, Math.min(5, Math.ceil(value / 15)));

  return (
    <div className="flex items-center gap-1 text-amber-300">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < normalized ? 'opacity-100' : 'opacity-25'}>
          ★
        </span>
      ))}
    </div>
  );
}

function formatCurrencyCompact(value: number): string {
  if (!value) {
    return '$0';
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function trimTrailingZeroes(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function hailNickname(value: number): string {
  if (value >= 4.5) return 'Softball';
  if (value >= 2.5) return 'Tennis Ball';
  if (value >= 1.75) return 'Golf Ball';
  if (value >= 1.5) return 'Ping Pong Ball';
  if (value >= 1) return 'Quarter';
  return 'Small Hail';
}

function stateName(code: string): string {
  const names: Record<string, string> = {
    VA: 'Virginia',
    MD: 'Maryland',
    PA: 'Pennsylvania',
    DC: 'District of Columbia',
    WV: 'West Virginia',
  };

  return names[code] ?? code;
}

function BrandCloudIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.5 15a3.5 3.5 0 0 1 .25-7 5.2 5.2 0 0 1 10.05 1.6A3.05 3.05 0 0 1 16.9 15H6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 16.6 7.6 19M12 16.6 11.1 19.5M15.5 16.6 14.6 19.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l5-5 4 4 7-7M14 8h6v6" />
    </svg>
  );
}

function HailIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 15a4 4 0 118 0h1a3 3 0 100-6 5 5 0 00-9.7-1.5A4 4 0 007 15zm-1 4h.01M10 19h.01M14 19h.01" />
    </svg>
  );
}

function WindIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8h10a2 2 0 100-4M3 12h15a2 2 0 110 4M3 16h8" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86l-7.5 13A1 1 0 003.66 18h16.68a1 1 0 00.87-1.49l-7.5-13a1 1 0 00-1.74 0z" />
    </svg>
  );
}

function DollarIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m3-12.5a2.5 2.5 0 00-5 0c0 1.38 1.12 2.5 2.5 2.5S15 11.12 15 12.5 13.88 15 12.5 15 10 13.88 10 12.5" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 21s-6-5.33-6-11a6 6 0 1112 0c0 5.67-6 11-6 11zm0-8a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7l1 5-4 4m0 0l-3 3m3-3l-5-1 4-4-1-5 5-5 5 5-5 5z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-12 9h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v11a2 2 0 002 2z" />
    </svg>
  );
}
