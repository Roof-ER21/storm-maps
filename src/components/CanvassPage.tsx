import type {
  CanvassOutcome,
  CanvassRouteArchive,
  CanvassRouteStop,
  CanvassStopStatus,
  PropertySearchSummary,
} from '../types/storm';

interface CanvassPageProps {
  searchSummary: PropertySearchSummary | null;
  routeStops: CanvassRouteStop[];
  routeArchives: CanvassRouteArchive[];
  onOpenMap: () => void;
  onFocusStop: (stop: CanvassRouteStop) => void;
  onBuildKnockRoute: () => void;
  onOpenNavigation: () => void;
  onExportSummary: () => void;
  onExportCsv: () => void;
  onClearRoute: () => void;
  onUpdateStopStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateStopOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateStopNotes: (stopId: string, notes: string) => void;
  onUpdateStopHomeowner: (
    stopId: string,
    field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail',
    value: string,
  ) => void;
  onRemoveStop: (stopId: string) => void;
  onRestoreArchive: (archiveId: string) => void;
  onRemoveArchive: (archiveId: string) => void;
}

export default function CanvassPage({
  searchSummary,
  routeStops,
  routeArchives,
  onOpenMap,
  onFocusStop,
  onBuildKnockRoute,
  onOpenNavigation,
  onExportSummary,
  onExportCsv,
  onClearRoute,
  onUpdateStopStatus,
  onUpdateStopOutcome,
  onUpdateStopNotes,
  onUpdateStopHomeowner,
  onRemoveStop,
  onRestoreArchive,
  onRemoveArchive,
}: CanvassPageProps) {
  const pendingStops = routeStops.filter((stop) => stop.status !== 'completed');
  const visitedStops = routeStops.filter((stop) => stop.status === 'visited');
  const completedStops = routeStops.filter((stop) => stop.status === 'completed');
  const bookedStops = routeStops.filter((stop) => stop.outcome === 'inspection_booked');
  const followUps = routeStops.filter((stop) => stop.outcome === 'follow_up');

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.14),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_22%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="rounded-[28px] border border-slate-800 bg-slate-950/88 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
            Canvass Workspace
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Route, knock, log, and export the day
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            {searchSummary
              ? `Working route for ${searchSummary.locationLabel}.`
              : 'Build a route from the Storm Map and use this page as the rep field log.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBuildKnockRoute}
              className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.18)] transition-opacity hover:opacity-95"
            >
              Build Knock-Now Route
            </button>
            <button
              type="button"
              onClick={onOpenNavigation}
              disabled={pendingStops.length === 0}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open Turn-by-Turn
            </button>
            <button
              type="button"
              onClick={onExportSummary}
              disabled={routeStops.length === 0}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export Summary
            </button>
            <button
              type="button"
              onClick={onExportCsv}
              disabled={routeStops.length === 0}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={onOpenMap}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
            >
              Back to Map
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <CanvassMetric label="Pending Stops" value={String(pendingStops.length)} />
          <CanvassMetric label="Visited" value={String(visitedStops.length)} />
          <CanvassMetric label="Completed" value={String(completedStops.length)} />
          <CanvassMetric label="Booked" value={String(bookedStops.length)} />
          <CanvassMetric label="Follow Ups" value={String(followUps.length)} />
        </div>

        {routeStops.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No canvass route yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Build a route from knock-now storm dates, then use this page to track outcomes and notes.
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {routeStops.map((stop, index) => (
              <article
                key={stop.id}
                className={`rounded-3xl border p-5 ${
                  stop.status === 'completed'
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : stop.status === 'visited'
                      ? 'border-sky-500/20 bg-sky-500/5'
                      : 'border-slate-800 bg-slate-950/82'
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-orange-100">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-lg font-semibold text-white">{stop.stormLabel}</p>
                        <p className="text-sm text-slate-400">
                          {stop.locationLabel} · {stop.sourceLabel}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                      <span>{stop.reportCount} reports</span>
                      <span>{stop.topHailInches > 0 ? `${stop.topHailInches}" hail` : 'hail swath'}</span>
                      <span>{stop.evidenceCount} proof</span>
                      <span className="text-orange-200">{stop.priority}</span>
                      <span>{formatOutcomeLabel(stop.outcome)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onFocusStop(stop)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
                    >
                      Open on Map
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveStop(stop.id)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[0.52fr_0.48fr]">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Stop Status
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ['queued', 'Queued'],
                          ['visited', 'Visited'],
                          ['completed', 'Done'],
                        ] as Array<[CanvassStopStatus, string]>
                      ).map(([status, label]) => (
                        <button
                          key={`${stop.id}-${status}`}
                          type="button"
                          onClick={() => onUpdateStopStatus(stop.id, status)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            stop.status === status
                              ? 'border-orange-400/40 bg-orange-500/20 text-orange-100'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Outcome
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ['none', 'Not Set'],
                          ['no_answer', 'No Answer'],
                          ['interested', 'Interested'],
                          ['follow_up', 'Follow Up'],
                          ['inspection_booked', 'Booked'],
                        ] as Array<[CanvassOutcome, string]>
                      ).map(([outcome, label]) => (
                        <button
                          key={`${stop.id}-${outcome}`}
                          type="button"
                          onClick={() => onUpdateStopOutcome(stop.id, outcome)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            stop.outcome === outcome
                              ? 'border-violet-400/40 bg-violet-500/20 text-violet-100'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Rep Notes
                    </label>
                    <textarea
                      value={stop.notes}
                      onChange={(event) => onUpdateStopNotes(stop.id, event.target.value)}
                      placeholder="Gate code, homeowner name, roof age, follow-up timing..."
                      className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
                    />
                    {(stop.outcome === 'inspection_booked' || stop.homeownerName || stop.homeownerPhone || stop.homeownerEmail) && (
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <input
                          value={stop.homeownerName || ''}
                          onChange={(event) =>
                            onUpdateStopHomeowner(stop.id, 'homeownerName', event.target.value)
                          }
                          placeholder="Homeowner name"
                          className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
                        />
                        <input
                          value={stop.homeownerPhone || ''}
                          onChange={(event) =>
                            onUpdateStopHomeowner(stop.id, 'homeownerPhone', event.target.value)
                          }
                          placeholder="Phone number"
                          className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
                        />
                        <input
                          value={stop.homeownerEmail || ''}
                          onChange={(event) =>
                            onUpdateStopHomeowner(stop.id, 'homeownerEmail', event.target.value)
                          }
                          placeholder="Email address"
                          className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {routeArchives.length > 0 && (
          <div className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Route Archive
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Reopen completed canvass days
            </h3>
            <div className="mt-4 grid gap-3">
              {routeArchives.slice(0, 6).map((archive) => (
                <div
                  key={archive.id}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{archive.summaryLabel}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {archive.stops.length} stop{archive.stops.length === 1 ? '' : 's'} · archived{' '}
                      {new Date(archive.archivedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onRestoreArchive(archive.id)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveArchive(archive.id)}
                      className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {routeStops.length > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClearRoute}
              className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:border-slate-700 hover:bg-slate-800"
            >
              Clear Route
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function CanvassMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-5">
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </div>
  );
}

function formatOutcomeLabel(outcome: CanvassOutcome): string {
  switch (outcome) {
    case 'no_answer':
      return 'No Answer';
    case 'interested':
      return 'Interested';
    case 'follow_up':
      return 'Follow Up';
    case 'inspection_booked':
      return 'Inspection Booked';
    default:
      return 'Not Set';
  }
}
