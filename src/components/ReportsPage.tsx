import type { PropertySearchSummary, StormDate } from '../types/storm';

interface ReportsPageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  generatingReport: boolean;
  onGenerateReport: (dateOfLoss: string) => Promise<void>;
  onOpenMap: () => void;
  onOpenEvidence?: () => void;
}

export default function ReportsPage({
  searchSummary,
  stormDates,
  generatingReport,
  onGenerateReport,
  onOpenMap,
  onOpenEvidence,
}: ReportsPageProps) {
  return (
    <section className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-950 via-gray-950 to-black px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="rounded-3xl border border-gray-900 bg-gray-950/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Report Workspace
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Generate date-of-loss reports without map clutter
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-400">
            This page gives the standalone app its own report-oriented mode. Instead
            of hunting through the sidebar, reps can stay focused on one property and
            trigger the NOAA-forward PDF directly from the storm-date list.
          </p>
          {onOpenEvidence && (
            <button
              type="button"
              onClick={onOpenEvidence}
              className="mt-5 rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:border-gray-700 hover:bg-gray-800"
            >
              Open Evidence Workspace
            </button>
          )}
        </div>

        {searchSummary ? (
          <div className="rounded-3xl border border-gray-900 bg-black/35 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Active Property
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {searchSummary.locationLabel}
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              {stormDates.length} available storm date
              {stormDates.length === 1 ? '' : 's'} in the current property-history
              search window.
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-gray-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">
              No property is loaded yet
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Open the Map page, search an address, and come back here once the storm
              history is loaded.
            </p>
            <button
              type="button"
              onClick={onOpenMap}
              className="mt-5 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100"
            >
              Go to Map
            </button>
          </div>
        )}

        {searchSummary && (
          <div className="grid gap-3">
            {stormDates.map((stormDate) => (
              <div
                key={stormDate.date}
                className="flex flex-col gap-4 rounded-3xl border border-gray-900 bg-gray-950/80 p-5 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-white">{stormDate.label}</p>
                  <p className="mt-1 text-sm text-gray-400">
                    {stormDate.eventCount} report{stormDate.eventCount === 1 ? '' : 's'}
                    {' · '}
                    {stormDate.maxHailInches > 0
                      ? `${stormDate.maxHailInches.toFixed(2)}" hail`
                      : 'No hail'}
                    {' · '}
                    {stormDate.maxWindMph > 0
                      ? `${stormDate.maxWindMph.toFixed(0)} mph wind`
                      : 'No wind'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void onGenerateReport(stormDate.date);
                  }}
                  disabled={generatingReport}
                  className="rounded-2xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
                >
                  {generatingReport ? 'Generating...' : 'Generate PDF'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
