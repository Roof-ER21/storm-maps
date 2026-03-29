import type { ReactNode } from 'react';
import type {
  CanvassRouteStop,
  EvidenceItem,
  PinnedProperty,
  PropertySearchSummary,
  StormDate,
  StormEvent,
} from '../types/storm';
import type { StormAlert } from '../hooks/useStormAlerts';
import EvidenceThumbnailStrip from './EvidenceThumbnailStrip';

interface DashboardPageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  events: StormEvent[];
  evidenceItems: EvidenceItem[];
  routeStops: CanvassRouteStop[];
  pinnedProperties: PinnedProperty[];
  onOpenMap: () => void;
  onOpenStormDate: (stormDate: StormDate) => void;
  onOpenPinned: () => void;
  onOpenPinnedProperty: (property: PinnedProperty) => void;
  onOpenEvidence: () => void;
  onOpenReports: () => void;
  onOpenCanvass: () => void;
  onOpenLeads: () => void;
  stormAlerts: StormAlert[];
  onDismissStormAlert: (id: string) => void;
  onDismissAllStormAlerts: () => void;
  stormAlertsChecking: boolean;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  onSeedDemo: () => void;
  onImportHomeowners: () => void;
}

export default function DashboardPage({
  searchSummary,
  stormDates,
  events,
  evidenceItems,
  routeStops,
  pinnedProperties,
  onOpenMap,
  onOpenStormDate,
  onOpenPinned,
  onOpenPinnedProperty,
  onOpenEvidence,
  onOpenReports,
  onOpenCanvass,
  onOpenLeads,
  stormAlerts,
  onDismissStormAlert,
  onDismissAllStormAlerts,
  stormAlertsChecking,
  onExportBackup,
  onImportBackup,
  onSeedDemo,
  onImportHomeowners,
}: DashboardPageProps) {
  const hailEvents = events.filter((event) => event.eventType === 'Hail');
  const totalDamage = events.reduce(
    (sum, event) => sum + Math.max(0, event.damageProperty || 0),
    0,
  );
  const activeRouteStops = routeStops.filter((stop) => stop.status !== 'completed');
  const bookedStops = routeStops.filter((stop) => stop.outcome === 'inspection_booked');
  const followUpStops = routeStops.filter((stop) => stop.outcome === 'follow_up');
  const contactedStops = routeStops.filter((stop) => stop.leadStage === 'contacted');
  const inspectionSetStops = routeStops.filter((stop) => stop.leadStage === 'inspection_set');
  const wonStops = routeStops.filter((stop) => stop.leadStage === 'won');
  const lostStops = routeStops.filter((stop) => stop.leadStage === 'lost');

  // Your Day digest
  const today = new Date().toISOString().slice(0, 10);
  const activeLeads = routeStops.filter((s) =>
    s.outcome === 'interested' || s.outcome === 'follow_up' || s.outcome === 'inspection_booked',
  );
  const overdueLeads = activeLeads.filter((s) => s.reminderAt && s.reminderAt < today && s.leadStage !== 'won' && s.leadStage !== 'lost');
  const dueTodayLeads = activeLeads.filter((s) => s.reminderAt === today && s.leadStage !== 'won' && s.leadStage !== 'lost');

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

        {/* Storm Alerts Banner */}
        {stormAlerts.length > 0 && (
          <section className="rounded-[28px] border border-red-500/25 bg-red-500/[0.06] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/20 text-red-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-300">
                    New Storm Activity {stormAlertsChecking ? '(checking...)' : ''}
                  </p>
                  <p className="mt-1 text-sm text-white">
                    {stormAlerts.length} alert{stormAlerts.length === 1 ? '' : 's'} in your territory
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissAllStormAlerts}
                className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
              >
                Dismiss All
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {stormAlerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between rounded-2xl border border-red-500/15 bg-slate-950/60 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">{alert.message}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Detected {new Date(alert.detectedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onOpenMap}
                      className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/25"
                    >
                      View Map
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismissStormAlert(alert.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-slate-400"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Your Day digest strip */}
        {(overdueLeads.length > 0 || dueTodayLeads.length > 0) && (
          <section className="rounded-[28px] border border-amber-500/20 bg-amber-500/[0.04] p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
                  Your Day
                </p>
                <div className="flex gap-2 text-xs">
                  {overdueLeads.length > 0 && (
                    <span className="rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
                      {overdueLeads.length} overdue
                    </span>
                  )}
                  {dueTodayLeads.length > 0 && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      {dueTodayLeads.length} due today
                    </span>
                  )}
                </div>
              </div>
              <button type="button" onClick={onOpenLeads} className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20">
                Open Leads
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[...overdueLeads, ...dueTodayLeads].slice(0, 3).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={onOpenLeads}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left hover:border-slate-700"
                >
                  <p className="text-sm font-semibold text-white truncate">{lead.homeownerName || lead.locationLabel}</p>
                  <p className="mt-1 text-xs text-slate-400 truncate">
                    {lead.stormLabel}
                    {lead.reminderAt && lead.reminderAt < today && (
                      <span className="ml-1 text-red-300">overdue</span>
                    )}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Total Events"
            value={String(events.length)}
            tone="orange"
            icon={<TrendIcon />}
            onClick={onOpenMap}
          />
          <MetricCard
            label="Hail Events"
            value={String(hailEvents.length)}
            tone="violet"
            icon={<HailIcon />}
            onClick={onOpenMap}
          />
          <MetricCard
            label="Active Canvass Stops"
            value={String(activeRouteStops.length)}
            tone="plum"
            icon={<MapPinIcon />}
            onClick={onOpenCanvass}
          />
          <MetricCard
            label="Inspections Booked"
            value={String(bookedStops.length)}
            tone="rose"
            icon={<CalendarIcon />}
            onClick={onOpenLeads}
          />
          <MetricCard
            label="Follow Ups"
            value={String(followUpStops.length)}
            tone="amber"
            icon={<AlertIcon />}
            onClick={onOpenLeads}
          />
        </section>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr]">
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

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {recentEvents.length > 0 ? (
                recentEvents.map((event) => (
                  <RecentEventCard key={event.id} event={event} onClick={onOpenMap} />
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
                  title="Lead Pipeline"
                  body="Work booked inspections, follow-ups, and homeowner contacts without losing storm context."
                  onClick={onOpenLeads}
                  icon={<CalendarIcon />}
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
                Lead Pipeline
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">
                Stage movement across active route stops
              </h3>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label="Contacted"
                  value={String(contactedStops.length)}
                  tone="plum"
                  icon={<TrendIcon />}
                  onClick={onOpenLeads}
                  compact
                />
                <MetricCard
                  label="Inspection Set"
                  value={String(inspectionSetStops.length)}
                  tone="orange"
                  icon={<CalendarIcon />}
                  onClick={onOpenLeads}
                  compact
                />
                <MetricCard
                  label="Won"
                  value={String(wonStops.length)}
                  tone="violet"
                  icon={<PinIcon />}
                  onClick={onOpenLeads}
                  compact
                />
                <MetricCard
                  label="Lost"
                  value={String(lostStops.length)}
                  tone="plum"
                  icon={<AlertIcon />}
                  onClick={onOpenLeads}
                  compact
                />
                <MetricCard
                  label="Tracked Damage"
                  value={formatCurrencyCompact(totalDamage)}
                  tone="amber"
                  icon={<DollarIcon />}
                  onClick={onOpenReports}
                  compact
                />
              </div>
            </section>

            {wonStops.length > 0 && (
              <section className="rounded-[28px] border border-emerald-500/18 bg-emerald-500/[0.04] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Won Jobs
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  {wonStops.length} closed deal{wonStops.length === 1 ? '' : 's'}
                </h3>
                <div className="mt-4 grid gap-3">
                  {wonStops.slice(0, 4).map((stop) => (
                    <button
                      type="button"
                      key={stop.id}
                      onClick={onOpenLeads}
                      className="rounded-2xl border border-emerald-500/12 bg-slate-900/60 p-4 text-left transition-colors hover:border-emerald-400/25 hover:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {stop.homeownerName || stop.locationLabel}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {stop.stormLabel} · {stop.homeownerPhone || 'No phone'}
                          </p>
                        </div>
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          Won
                        </span>
                      </div>
                      {stop.assignedRep && (
                        <p className="mt-2 text-xs text-violet-200">Rep: {stop.assignedRep}</p>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

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
                    <StateRow key={state} state={state} count={count} onClick={onOpenMap} />
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

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Latest Hits
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Most recent storm dates for this workspace
            </h3>
            <div className="mt-5 grid gap-3">
              {stormDates.slice(0, 4).map((stormDate) => (
                <button
                  type="button"
                  key={stormDate.date}
                  onClick={() => onOpenStormDate(stormDate)}
                  className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
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
                  <div className="mt-4">
                    <EvidenceThumbnailStrip
                      items={evidenceItems.filter((item) => item.stormDate === stormDate.date)}
                      title="Evidence Preview"
                      subtitle="Attached proof for this storm date."
                      emptyLabel="No storm-date evidence attached yet."
                      compact
                      prioritizeIncluded
                    />
                  </div>
                </button>
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
                <button
                  type="button"
                  key={property.id}
                  onClick={() => onOpenPinnedProperty(property)}
                  className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
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
                </button>
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

        <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Data Management
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-white">
            Backup and restore all app data
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Import homeowner lists from any data provider (Cole Info, ListSource, ATTOM, PropertyRadar)
            to create leads matched to storm zones. Export and restore all app data as JSON backup.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onExportBackup}
              className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-3 sm:py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.18)] transition-opacity hover:opacity-95"
            >
              Export Backup
            </button>
            <label className="cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 sm:py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800">
              Import Backup
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportBackup(file);
                    e.target.value = '';
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={onImportHomeowners}
              className="rounded-2xl bg-emerald-500 px-4 py-3 sm:py-2.5 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              Import Homeowner CSV
            </button>
            <button
              type="button"
              onClick={onSeedDemo}
              className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 sm:py-2.5 text-sm font-semibold text-amber-300 hover:bg-amber-500/20"
            >
              Load Demo Data
            </button>
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
  onClick,
  compact = false,
}: {
  label: string;
  value: string;
  tone: 'orange' | 'violet' | 'plum' | 'rose' | 'amber';
  icon: ReactNode;
  onClick?: () => void;
  compact?: boolean;
}) {
  const toneClasses = {
    orange: 'border-orange-500/18 bg-orange-500/[0.07] text-orange-300',
    violet: 'border-violet-500/18 bg-violet-500/[0.07] text-violet-200',
    plum: 'border-fuchsia-500/18 bg-fuchsia-500/[0.07] text-fuchsia-200',
    rose: 'border-rose-500/18 bg-rose-500/[0.07] text-rose-300',
    amber: 'border-amber-500/18 bg-amber-500/[0.07] text-amber-300',
  };

  const className = `rounded-[24px] border ${compact ? 'p-4' : 'p-5'} ${toneClasses[tone]} ${
    onClick ? 'cursor-pointer transition-colors hover:bg-white/[0.06]' : ''
  }`;

  const content = (
    <>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950/60">
        {icon}
      </div>
      <p className="mt-4 text-4xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function RecentEventCard({
  event,
  onClick,
}: {
  event: StormEvent;
  onClick: () => void;
}) {
  const severityValue =
    event.eventType === 'Hail'
      ? event.magnitude
      : event.magnitude;
  const severityLabel =
    event.eventType === 'Hail'
      ? `${trimTrailingZeroes(event.magnitude)} in (${hailNickname(event.magnitude)})`
      : `${trimTrailingZeroes(event.magnitude)} mph`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[24px] border border-slate-800 bg-slate-900/70 p-5 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
    >
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
    </button>
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

function StateRow({
  state,
  count,
  onClick,
}: {
  state: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-[22px] border border-slate-800 bg-slate-900/65 px-4 py-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
    >
      <div>
        <p className="text-lg font-semibold text-white">{stateName(state)}</p>
        <p className="text-sm text-slate-500">{state}</p>
      </div>
      <p className="text-4xl sm:text-5xl font-semibold tracking-tight text-orange-300">{count}</p>
    </button>
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
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-12 9h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v11a2 2 0 002 2z" />
    </svg>
  );
}
