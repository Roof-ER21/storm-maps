import type { PinnedProperty } from '../types/storm';

interface PinnedPropertiesPageProps {
  pinnedProperties: PinnedProperty[];
  routeCountsByPropertyId: Record<
    string,
    { active: number; booked: number; followUp: number }
  >;
  onOpenProperty: (property: PinnedProperty) => void;
  onRemoveProperty: (propertyId: string) => void;
  onOpenMap: () => void;
}

export default function PinnedPropertiesPage({
  pinnedProperties,
  routeCountsByPropertyId,
  onOpenProperty,
  onRemoveProperty,
  onOpenMap,
}: PinnedPropertiesPageProps) {
  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.14),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.15),_transparent_24%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
              Pinned Properties
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              Saved addresses reps can reopen instantly
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-400">
              Use this as the working queue for neighborhoods and addresses worth
              returning to. Each pin preserves the search context so the map can jump
              back into that property history without rebuilding it by hand.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenMap}
            className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-gray-700 hover:bg-gray-800"
          >
            Pin from Map
          </button>
        </div>

        {pinnedProperties.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-gray-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No pinned properties yet</p>
            <p className="mt-2 text-sm text-gray-500">
              Search an address on the Map page, then pin it so it becomes part of the
              rep workflow.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pinnedProperties.map((property) => (
              <article
                key={property.id}
                className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5 shadow-xl shadow-black/20"
              >
                {(() => {
                  const routeCounts = routeCountsByPropertyId[property.id] || {
                    active: 0,
                    booked: 0,
                    followUp: 0,
                  };

                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-white">
                      {property.locationLabel}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {property.lat.toFixed(4)}, {property.lng.toFixed(4)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveProperty(property.id)}
                    className="rounded-xl border border-gray-800 px-2.5 py-1.5 text-xs font-semibold text-gray-400 hover:border-orange-500/30 hover:text-orange-300"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <PinnedMetric
                    label="Storm Dates"
                    value={String(property.stormDateCount)}
                  />
                  <PinnedMetric
                    label="Largest Hail"
                    value={
                      property.latestMaxHailInches > 0
                        ? `${property.latestMaxHailInches.toFixed(2)}"`
                        : 'None'
                    }
                  />
                  <PinnedMetric
                    label="History"
                    value={
                      property.historyPreset === 'since'
                        ? `Since ${property.sinceDate || 'custom'}`
                        : property.historyPreset.toUpperCase()
                    }
                  />
                  <PinnedMetric
                    label="Latest Hit"
                    value={property.latestStormDate || 'None'}
                  />
                </div>

                {(routeCounts.active > 0 || routeCounts.booked > 0 || routeCounts.followUp > 0) && (
                  <div className="mt-4 rounded-2xl border border-violet-500/15 bg-violet-500/5 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-200">
                      Canvass Activity
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                      {routeCounts.active > 0 && <span>{routeCounts.active} active stops</span>}
                      {routeCounts.booked > 0 && <span>{routeCounts.booked} booked</span>}
                      {routeCounts.followUp > 0 && <span>{routeCounts.followUp} follow-up</span>}
                    </div>
                  </div>
                )}

                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenProperty(property)}
                    className="flex-1 rounded-2xl bg-white px-3 py-2.5 text-sm font-semibold text-gray-950 transition-colors hover:bg-gray-100"
                  >
                    Open on Map
                  </button>
                </div>
                    </>
                  );
                })()}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PinnedMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-black/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
