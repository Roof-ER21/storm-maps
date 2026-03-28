import type {
  CanvassOutcome,
  CanvassRouteArchive,
  CanvassRouteStop,
  CanvassStopStatus,
  LeadStage,
  PropertySearchSummary,
} from '../types/storm';

interface LeadsPageProps {
  searchSummary: PropertySearchSummary | null;
  routeStops: CanvassRouteStop[];
  routeArchives: CanvassRouteArchive[];
  onOpenMap: () => void;
  onOpenCanvass: () => void;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onUpdateLeadStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateLeadOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadNotes: (stopId: string, notes: string) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadHomeowner: (
    stopId: string,
    field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail',
    value: string,
  ) => void;
  onRestoreArchive: (archiveId: string) => void;
}

interface ArchivedLead {
  stop: CanvassRouteStop;
  archiveId: string;
  archivedAt: string;
  summaryLabel: string;
}

const LEAD_OUTCOMES: CanvassOutcome[] = [
  'inspection_booked',
  'follow_up',
  'interested',
];

export default function LeadsPage({
  searchSummary,
  routeStops,
  routeArchives,
  onOpenMap,
  onOpenCanvass,
  onFocusLead,
  onUpdateLeadStatus,
  onUpdateLeadOutcome,
  onUpdateLeadStage,
  onUpdateLeadNotes,
  onUpdateLeadReminder,
  onUpdateLeadHomeowner,
  onRestoreArchive,
}: LeadsPageProps) {
  const activeLeads = routeStops
    .filter((stop) => LEAD_OUTCOMES.includes(stop.outcome))
    .slice()
    .sort(compareLeadPriority);

  const archivedLeads = routeArchives
    .flatMap((archive) =>
      archive.stops
        .filter((stop) => LEAD_OUTCOMES.includes(stop.outcome))
        .map((stop) => ({
          stop,
          archiveId: archive.id,
          archivedAt: archive.archivedAt,
          summaryLabel: archive.summaryLabel,
        })),
    )
    .sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));

  const bookedActive = activeLeads.filter((stop) => stop.outcome === 'inspection_booked');
  const followUpActive = activeLeads.filter((stop) => stop.outcome === 'follow_up');
  const interestedActive = activeLeads.filter((stop) => stop.outcome === 'interested');

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.14),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_24%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <div className="rounded-[28px] border border-slate-800 bg-slate-950/88 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
            Lead Pipeline
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Work booked inspections and follow-ups without losing storm context
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            {searchSummary
              ? `Lead view for ${searchSummary.locationLabel}.`
              : 'Track canvass outcomes, homeowner contact info, and archived route opportunities in one place.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenCanvass}
              className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.18)] transition-opacity hover:opacity-95"
            >
              Open Canvass Workspace
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
          <LeadMetric label="Active Leads" value={String(activeLeads.length)} />
          <LeadMetric label="Booked" value={String(bookedActive.length)} />
          <LeadMetric label="Follow Ups" value={String(followUpActive.length)} />
          <LeadMetric label="Interested" value={String(interestedActive.length)} />
          <LeadMetric label="Archived Leads" value={String(archivedLeads.length)} />
        </div>

        {activeLeads.length === 0 && archivedLeads.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No lead pipeline yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Leads are created when reps mark a route stop as Interested, Follow Up, or Inspection Booked.
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-3">
              <LeadColumn
                title="Booked Inspections"
                subtitle="Strongest opportunities with homeowner details."
                leads={bookedActive}
                emptyLabel="No booked inspections yet."
                accent="rose"
                onFocusLead={onFocusLead}
                onUpdateLeadStatus={onUpdateLeadStatus}
                onUpdateLeadOutcome={onUpdateLeadOutcome}
                onUpdateLeadStage={onUpdateLeadStage}
                onUpdateLeadNotes={onUpdateLeadNotes}
                onUpdateLeadReminder={onUpdateLeadReminder}
                onUpdateLeadHomeowner={onUpdateLeadHomeowner}
              />
              <LeadColumn
                title="Follow Ups"
                subtitle="Doors that need another touch or scheduled revisit."
                leads={followUpActive}
                emptyLabel="No follow-up leads yet."
                accent="violet"
                onFocusLead={onFocusLead}
                onUpdateLeadStatus={onUpdateLeadStatus}
                onUpdateLeadOutcome={onUpdateLeadOutcome}
                onUpdateLeadStage={onUpdateLeadStage}
                onUpdateLeadNotes={onUpdateLeadNotes}
                onUpdateLeadReminder={onUpdateLeadReminder}
                onUpdateLeadHomeowner={onUpdateLeadHomeowner}
              />
              <LeadColumn
                title="Interested"
                subtitle="Early momentum that still needs conversion."
                leads={interestedActive}
                emptyLabel="No interested leads yet."
                accent="amber"
                onFocusLead={onFocusLead}
                onUpdateLeadStatus={onUpdateLeadStatus}
                onUpdateLeadOutcome={onUpdateLeadOutcome}
                onUpdateLeadStage={onUpdateLeadStage}
                onUpdateLeadNotes={onUpdateLeadNotes}
                onUpdateLeadReminder={onUpdateLeadReminder}
                onUpdateLeadHomeowner={onUpdateLeadHomeowner}
              />
            </div>

            {archivedLeads.length > 0 && (
              <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Archived Leads
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">
                  Leads saved from completed canvass days
                </h3>
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {archivedLeads.map((entry) => (
                    <ArchivedLeadCard
                      key={`${entry.archiveId}-${entry.stop.id}`}
                      lead={entry}
                      onFocusLead={onFocusLead}
                      onRestoreArchive={onRestoreArchive}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function LeadMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-5">
      <p className="text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-400">{label}</p>
    </div>
  );
}

function LeadColumn({
  title,
  subtitle,
  leads,
  emptyLabel,
  accent,
  onFocusLead,
  onUpdateLeadStatus,
  onUpdateLeadOutcome,
  onUpdateLeadStage,
  onUpdateLeadNotes,
  onUpdateLeadReminder,
  onUpdateLeadHomeowner,
}: {
  title: string;
  subtitle: string;
  leads: CanvassRouteStop[];
  emptyLabel: string;
  accent: 'rose' | 'violet' | 'amber';
  onFocusLead: (stop: CanvassRouteStop) => void;
  onUpdateLeadStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateLeadOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadNotes: (stopId: string, notes: string) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadHomeowner: (
    stopId: string,
    field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail',
    value: string,
  ) => void;
}) {
  const accentClass =
    accent === 'rose'
      ? 'text-rose-300'
      : accent === 'violet'
        ? 'text-violet-300'
        : 'text-amber-300';

  return (
    <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
      <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${accentClass}`}>
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{subtitle}</p>

      <div className="mt-5 grid gap-4">
        {leads.length > 0 ? (
          leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onFocusLead={onFocusLead}
              onUpdateLeadStatus={onUpdateLeadStatus}
              onUpdateLeadOutcome={onUpdateLeadOutcome}
              onUpdateLeadStage={onUpdateLeadStage}
              onUpdateLeadNotes={onUpdateLeadNotes}
              onUpdateLeadReminder={onUpdateLeadReminder}
              onUpdateLeadHomeowner={onUpdateLeadHomeowner}
            />
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-black/20 p-4 text-sm text-slate-500">
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

function LeadCard({
  lead,
  onFocusLead,
  onUpdateLeadStatus,
  onUpdateLeadOutcome,
  onUpdateLeadStage,
  onUpdateLeadNotes,
  onUpdateLeadReminder,
  onUpdateLeadHomeowner,
}: {
  lead: CanvassRouteStop;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onUpdateLeadStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateLeadOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadNotes: (stopId: string, notes: string) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadHomeowner: (
    stopId: string,
    field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail',
    value: string,
  ) => void;
}) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/72 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-white">{lead.stormLabel}</p>
          <p className="mt-1 text-sm text-slate-400">{lead.locationLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => onFocusLead(lead)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
        >
          Open on Map
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        <span>{lead.reportCount} reports</span>
        <span>{lead.topHailInches > 0 ? `${lead.topHailInches}" hail` : 'hail swath'}</span>
        <span>{lead.evidenceCount} proof</span>
        <span className="text-orange-200">{lead.priority}</span>
        <span className="text-violet-200">{formatLeadStageLabel(lead.leadStage)}</span>
        {lead.reminderAt && <span className="text-amber-200">Due {lead.reminderAt}</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['visited', 'Visited'],
            ['completed', 'Done'],
          ] as Array<[CanvassStopStatus, string]>
        ).map(([status, label]) => (
          <button
            key={`${lead.id}-${status}`}
            type="button"
            onClick={() => onUpdateLeadStatus(lead.id, status)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              lead.status === status
                ? 'border-orange-400/40 bg-orange-500/20 text-orange-100'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['interested', 'Interested'],
            ['follow_up', 'Follow Up'],
            ['inspection_booked', 'Booked'],
          ] as Array<[CanvassOutcome, string]>
        ).map(([outcome, label]) => (
          <button
            key={`${lead.id}-${outcome}`}
            type="button"
            onClick={() => onUpdateLeadOutcome(lead.id, outcome)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              lead.outcome === outcome
                ? 'border-violet-400/40 bg-violet-500/20 text-violet-100'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['new', 'New'],
            ['contacted', 'Contacted'],
            ['inspection_set', 'Inspection Set'],
            ['won', 'Won'],
            ['lost', 'Lost'],
          ] as Array<[LeadStage, string]>
        ).map(([leadStage, label]) => (
          <button
            key={`${lead.id}-${leadStage}`}
            type="button"
            onClick={() => onUpdateLeadStage(lead.id, leadStage)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              lead.leadStage === leadStage
                ? 'border-fuchsia-400/40 bg-fuchsia-500/20 text-fuchsia-100'
                : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <input
          value={lead.homeownerName || ''}
          onChange={(event) =>
            onUpdateLeadHomeowner(lead.id, 'homeownerName', event.target.value)
          }
          placeholder="Homeowner name"
          className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
        />
        <input
          value={lead.homeownerPhone || ''}
          onChange={(event) =>
            onUpdateLeadHomeowner(lead.id, 'homeownerPhone', event.target.value)
          }
          placeholder="Phone number"
          className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
        />
        <input
          value={lead.homeownerEmail || ''}
          onChange={(event) =>
            onUpdateLeadHomeowner(lead.id, 'homeownerEmail', event.target.value)
          }
          placeholder="Email address"
          className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
        />
      </div>

      <div className="mt-4">
        <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Reminder Date
        </label>
        <input
          type="date"
          value={lead.reminderAt || ''}
          onChange={(event) => onUpdateLeadReminder(lead.id, event.target.value)}
          className="mt-2 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-orange-400/40 focus:outline-none"
        />
      </div>

      <textarea
        value={lead.notes}
        onChange={(event) => onUpdateLeadNotes(lead.id, event.target.value)}
        placeholder="Lead notes, scheduling details, next touch..."
        className="mt-4 h-24 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
      />
    </article>
  );
}

function ArchivedLeadCard({
  lead,
  onFocusLead,
  onRestoreArchive,
}: {
  lead: ArchivedLead;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onRestoreArchive: (archiveId: string) => void;
}) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/72 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold text-white">{lead.stop.stormLabel}</p>
          <p className="mt-1 text-sm text-slate-400">{lead.stop.locationLabel}</p>
        </div>
        <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-[11px] font-semibold text-slate-300">
          Archived
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
        <span>{formatOutcomeLabel(lead.stop.outcome)}</span>
        <span>{lead.summaryLabel}</span>
        <span>{formatArchiveDate(lead.archivedAt)}</span>
      </div>

      {(lead.stop.homeownerName || lead.stop.homeownerPhone || lead.stop.homeownerEmail) && (
        <div className="mt-4 rounded-2xl border border-violet-500/15 bg-violet-500/5 p-3 text-sm text-slate-300">
          <p className="font-semibold text-white">
            {lead.stop.homeownerName || 'Homeowner'}
          </p>
          <p className="mt-1 text-slate-400">
            {lead.stop.homeownerPhone || 'No phone'} · {lead.stop.homeownerEmail || 'No email'}
          </p>
        </div>
      )}

      {lead.stop.notes && (
        <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-300">
          {lead.stop.notes}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onFocusLead(lead.stop)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
        >
          Open on Map
        </button>
        <button
          type="button"
          onClick={() => onRestoreArchive(lead.archiveId)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
        >
          Restore Route Day
        </button>
      </div>
    </article>
  );
}

function formatOutcomeLabel(outcome: CanvassOutcome): string {
  switch (outcome) {
    case 'interested':
      return 'Interested';
    case 'follow_up':
      return 'Follow Up';
    case 'inspection_booked':
      return 'Inspection Booked';
    case 'no_answer':
      return 'No Answer';
    default:
      return 'Not Set';
  }
}

function formatLeadStageLabel(stage: LeadStage): string {
  switch (stage) {
    case 'contacted':
      return 'Contacted';
    case 'inspection_set':
      return 'Inspection Set';
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    default:
      return 'New';
  }
}

function compareLeadPriority(left: CanvassRouteStop, right: CanvassRouteStop): number {
  const leftDue = left.reminderAt ? new Date(`${left.reminderAt}T12:00:00Z`).getTime() : Infinity;
  const rightDue = right.reminderAt ? new Date(`${right.reminderAt}T12:00:00Z`).getTime() : Infinity;

  if (leftDue !== rightDue) {
    return leftDue - rightDue;
  }

  const stageRank: Record<LeadStage, number> = {
    new: 0,
    contacted: 1,
    inspection_set: 2,
    won: 3,
    lost: 4,
  };

  if (stageRank[left.leadStage] !== stageRank[right.leadStage]) {
    return stageRank[left.leadStage] - stageRank[right.leadStage];
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function formatArchiveDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return `Archived ${parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}
