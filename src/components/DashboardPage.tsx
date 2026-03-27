import type { PinnedProperty, PropertySearchSummary, StormDate } from '../types/storm';

interface DashboardPageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  pinnedProperties: PinnedProperty[];
  onOpenMap: () => void;
  onOpenPinned: () => void;
  onOpenEvidence: () => void;
  onOpenReports: () => void;
}

export default function DashboardPage({
  searchSummary,
  stormDates,
  pinnedProperties,
  onOpenMap,
  onOpenPinned,
  onOpenEvidence,
  onOpenReports,
}: DashboardPageProps) {
  const latestStorm = stormDates[0] ?? null;
  const topHail = stormDates.reduce((max, stormDate) => {
    return stormDate.maxHailInches > max ? stormDate.maxHailInches : max;
  }, 0);

  return (
    <section className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-950 via-gray-950 to-black px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-3xl border border-gray-900 bg-gray-950/80 p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-400">
            Property Intelligence
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Build the rep workflow around the map you already fixed
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-400">
            The storm engine is working. What was missing is the app shell around it:
            quick entry points, saved properties, and dedicated pages for reps to move
            between mapping, pinned targets, and report generation without losing
            context.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <QuickActionButton label="Open Map Workspace" onClick={onOpenMap} />
            <QuickActionButton label="Open Pinned Properties" onClick={onOpenPinned} />
            <QuickActionButton label="Open Evidence" onClick={onOpenEvidence} />
            <QuickActionButton label="Open Reports" onClick={onOpenReports} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Active Property"
            value={searchSummary?.locationLabel || 'DMV default workspace'}
            accent="red"
          />
          <StatCard
            label="Storm Dates Loaded"
            value={String(stormDates.length)}
            accent="cyan"
          />
          <StatCard
            label="Pinned Properties"
            value={String(pinnedProperties.length)}
            accent="amber"
          />
          <StatCard
            label="Largest Hail In View"
            value={topHail > 0 ? `${topHail.toFixed(2)}"` : 'None'}
            accent="emerald"
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-gray-900 bg-gray-950/70 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Latest Hits
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Most recent storm dates for the current property
                </h3>
              </div>
              <button
                type="button"
                onClick={onOpenMap}
                className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800"
              >
                View on Map
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {stormDates.slice(0, 4).map((stormDate) => (
                <div
                  key={stormDate.date}
                  className="rounded-2xl border border-gray-900 bg-black/40 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{stormDate.label}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {stormDate.eventCount} report{stormDate.eventCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-amber-300">
                        {stormDate.maxHailInches > 0
                          ? `${stormDate.maxHailInches.toFixed(2)}" hail`
                          : 'No hail'}
                      </p>
                      <p className="mt-1 text-xs text-cyan-300">
                        {stormDate.maxWindMph > 0
                          ? `${stormDate.maxWindMph.toFixed(0)} mph wind`
                          : 'No wind'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {stormDates.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-800 bg-black/30 p-5 text-sm text-gray-500">
                  Search a property on the Map page to populate its latest hits and
                  report history.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-900 bg-gray-950/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Pinned Queue
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              Saved targets for reps to revisit fast
            </h3>
            <div className="mt-4 space-y-3">
              {pinnedProperties.slice(0, 5).map((property) => (
                <div
                  key={property.id}
                  className="rounded-2xl border border-gray-900 bg-black/40 p-4"
                >
                  <p className="text-sm font-semibold text-white">
                    {property.locationLabel}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {property.stormDateCount} storm date
                    {property.stormDateCount === 1 ? '' : 's'} pinned
                  </p>
                  <p className="mt-2 text-xs text-amber-300">
                    {property.latestStormDate
                      ? `Latest hit ${property.latestStormDate}`
                      : 'No hit date saved yet'}
                  </p>
                </div>
              ))}

              {pinnedProperties.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-800 bg-black/30 p-5 text-sm text-gray-500">
                  Pin a searched address from the Map page to start building a saved
                  target list.
                </div>
              )}
            </div>
          </section>
        </div>

        {latestStorm && (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/8 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
              Report Push
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              The newest documented storm for this property is {latestStorm.label}
            </h3>
            <p className="mt-2 text-sm text-red-100/80">
              Move to the Reports page if you want the workflow focused entirely on
              date-of-loss selection and PDF output instead of map navigation.
            </p>
          </section>
        )}
      </div>
    </section>
  );
}

function QuickActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-gray-700 hover:bg-gray-800"
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'red' | 'cyan' | 'amber' | 'emerald';
}) {
  const accentClasses = {
    red: 'border-red-500/20 bg-red-500/8 text-red-300',
    cyan: 'border-cyan-500/20 bg-cyan-500/8 text-cyan-300',
    amber: 'border-amber-500/20 bg-amber-500/8 text-amber-300',
    emerald: 'border-emerald-500/20 bg-emerald-500/8 text-emerald-300',
  };

  return (
    <div className={`rounded-3xl border p-5 ${accentClasses[accent]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">
        {label}
      </p>
      <p className="mt-3 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
