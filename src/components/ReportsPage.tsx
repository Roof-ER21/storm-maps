import type {
  CanvassRouteStop,
  PropertySearchSummary,
  EvidenceItem,
  StormDate,
} from '../types/storm';
import EvidenceThumbnailStrip from './EvidenceThumbnailStrip';

interface ReportsPageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  evidenceItems: EvidenceItem[];
  routeStops: CanvassRouteStop[];
  routeOutcomeCountsByDate: Record<
    string,
    { booked: number; followUp: number; interested: number }
  >;
  routeLeadStageCountsByDate: Record<
    string,
    { new: number; contacted: number; inspectionSet: number; won: number; lost: number }
  >;
  selectedEvidenceCount: number;
  selectedEvidenceCountsByDate: Record<string, number>;
  generatingReport: boolean;
  downloadingEvidencePack: boolean;
  onGenerateReport: (dateOfLoss: string) => Promise<void>;
  onDownloadEvidencePack: (dateOfLoss: string) => Promise<void>;
  onOpenMap: () => void;
  onOpenEvidence?: () => void;
}

export default function ReportsPage({
  searchSummary,
  stormDates,
  evidenceItems,
  routeStops,
  routeOutcomeCountsByDate,
  routeLeadStageCountsByDate,
  selectedEvidenceCount,
  selectedEvidenceCountsByDate,
  generatingReport,
  downloadingEvidencePack,
  onGenerateReport,
  onDownloadEvidencePack,
  onOpenMap,
  onOpenEvidence,
}: ReportsPageProps) {
  return (
    <section className="flex-1 overflow-y-auto bg-[#faf9f7] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-600">
            Report Workspace
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">
            Generate date-of-loss reports without map clutter
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
            This page gives the standalone app its own report-oriented mode. Instead
            of hunting through the sidebar, reps can stay focused on one property and
            trigger the NOAA-forward PDF directly from the storm-date list.
          </p>
          {onOpenEvidence && (
            <button
              type="button"
              onClick={onOpenEvidence}
              className="mt-5 rounded-2xl border border-stone-200 bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-stone-200"
            >
              Open Evidence Workspace
            </button>
          )}
        </div>

        {searchSummary ? (
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
              Active Property
            </p>
            <h3 className="mt-2 text-xl font-semibold text-stone-900">
              {searchSummary.locationLabel}
            </h3>
            <p className="mt-2 text-sm text-stone-600">
              {stormDates.length} available storm date
              {stormDates.length === 1 ? '' : 's'} in the current property-history
              search window.
            </p>
            <p className="mt-2 text-sm text-stone-600">
              {selectedEvidenceCount} approved evidence item
              {selectedEvidenceCount === 1 ? '' : 's'} currently selected for PDF
              attachment.
            </p>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-semibold text-stone-900">
              No property is loaded yet
            </p>
            <p className="mt-2 text-sm text-stone-500">
              Open the Map page, search an address, and come back here once the storm
              history is loaded.
            </p>
            <button
              type="button"
              onClick={onOpenMap}
              className="mt-5 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
            >
              Go to Map
            </button>
          </div>
        )}

        {searchSummary && (() => {
          const wonStops = routeStops.filter((s) => s.leadStage === 'won');
          return wonStops.length > 0 ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Won Jobs Ready for Reports
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {wonStops.length} closed deal{wonStops.length === 1 ? '' : 's'} — generate final documentation.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {wonStops.map((stop) => (
                  <div
                    key={stop.id}
                    className="rounded-2xl border border-emerald-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-900">
                          {stop.homeownerName || stop.locationLabel}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          {stop.stormLabel} · {stop.topHailInches > 0 ? `${stop.topHailInches}" hail` : 'Hail swath'}
                        </p>
                      </div>
                      <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        Won
                      </span>
                    </div>
                    <div className="mt-3 text-xs text-stone-500">
                      <p>{stop.homeownerPhone || 'No phone'} · {stop.homeownerEmail || 'No email'}</p>
                      {stop.assignedRep && <p className="mt-1 text-violet-700">Rep: {stop.assignedRep}</p>}
                      {stop.notes && <p className="mt-2 text-stone-600">{stop.notes}</p>}
                    </div>
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <button
                        type="button"
                        onClick={() => { void onGenerateReport(stop.stormDate); }}
                        disabled={generatingReport}
                        className="rounded-xl bg-[linear-gradient(135deg,#10b981,#059669)] px-3 py-2.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {generatingReport ? 'Generating...' : 'Generate PDF'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { void onDownloadEvidencePack(stop.stormDate); }}
                        disabled={downloadingEvidencePack}
                        className="rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                      >
                        Evidence Pack
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null;
        })()}

        {searchSummary && (
          <div className="grid gap-3">
            {stormDates.map((stormDate) => {
              const dateEvidence = evidenceItems.filter(
                (item) =>
                  item.stormDate === stormDate.date &&
                  item.status === 'approved' &&
                  item.includeInReport,
              );
              const dateStops = routeStops.filter((stop) => stop.stormDate === stormDate.date);
              const bookedContacts = dateStops.filter(
                (stop) => stop.outcome === 'inspection_booked',
              );
              const outcomeCounts = routeOutcomeCountsByDate[stormDate.date] || {
                booked: 0,
                followUp: 0,
                interested: 0,
              };
              const leadStageCounts = routeLeadStageCountsByDate[stormDate.date] || {
                new: 0,
                contacted: 0,
                inspectionSet: 0,
                won: 0,
                lost: 0,
              };

              return (
                <div
                  key={stormDate.date}
                  className="flex flex-col gap-4 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold text-stone-900">{stormDate.label}</p>
                    <p className="mt-1 text-sm text-stone-600">
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
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                      {selectedEvidenceCountsByDate[stormDate.date] ?? 0} evidence item
                      {(selectedEvidenceCountsByDate[stormDate.date] ?? 0) === 1 ? '' : 's'} will attach
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-violet-700">
                      {outcomeCounts.booked > 0 && (
                        <span>{outcomeCounts.booked} booked</span>
                      )}
                      {outcomeCounts.followUp > 0 && (
                        <span>{outcomeCounts.followUp} follow-up</span>
                      )}
                      {outcomeCounts.interested > 0 && (
                        <span>{outcomeCounts.interested} interested</span>
                      )}
                      {dateStops.length > 0 && (
                        <span>{dateStops.length} canvass stop{dateStops.length === 1 ? '' : 's'}</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-orange-700">
                      {leadStageCounts.new > 0 && <span>{leadStageCounts.new} new</span>}
                      {leadStageCounts.contacted > 0 && <span>{leadStageCounts.contacted} contacted</span>}
                      {leadStageCounts.inspectionSet > 0 && <span>{leadStageCounts.inspectionSet} inspection set</span>}
                      {leadStageCounts.won > 0 && <span>{leadStageCounts.won} won</span>}
                      {leadStageCounts.lost > 0 && <span>{leadStageCounts.lost} lost</span>}
                    </div>
                    {bookedContacts.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                          Booked Inspection Contacts
                        </p>
                        <div className="mt-2 space-y-2">
                          {bookedContacts.slice(0, 3).map((stop) => (
                            <div key={stop.id} className="text-xs text-stone-600">
                              <p className="font-semibold text-stone-900">
                                {stop.homeownerName || stop.locationLabel}
                              </p>
                              <p className="mt-1 text-stone-500">
                                {stop.homeownerPhone || 'No phone'} · {stop.homeownerEmail || 'No email'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-4">
                      <EvidenceThumbnailStrip
                        items={dateEvidence}
                        title="Report Attachments"
                        subtitle="Approved evidence that will be bundled with this storm-date report."
                        emptyLabel="No approved report evidence is selected for this date yet."
                        compact
                        prioritizeIncluded
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        void onDownloadEvidencePack(stormDate.date);
                      }}
                      disabled={downloadingEvidencePack}
                      className="rounded-2xl border border-stone-200 bg-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:bg-stone-200 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                    >
                      {downloadingEvidencePack ? 'Packing...' : 'Evidence Pack'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void onGenerateReport(stormDate.date);
                      }}
                      disabled={generatingReport}
                      className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.18)] transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
                    >
                      {generatingReport ? 'Generating...' : 'Generate PDF'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
