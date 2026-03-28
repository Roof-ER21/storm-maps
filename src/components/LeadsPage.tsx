import { useState } from 'react';
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
  onUpdateLeadAssignedRep: (stopId: string, rep: string) => void;
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

const STAGE_CONFIG: Record<LeadStage, { label: string; color: string; bg: string; border: string; ring: string; order: number }> = {
  new: { label: 'New', color: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-400/30', ring: 'ring-sky-400/20', order: 0 },
  contacted: { label: 'Contacted', color: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-400/30', ring: 'ring-amber-400/20', order: 1 },
  inspection_set: { label: 'Inspection Set', color: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-400/30', ring: 'ring-violet-400/20', order: 2 },
  won: { label: 'Won', color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/30', ring: 'ring-emerald-400/20', order: 3 },
  lost: { label: 'Lost', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-600/30', ring: 'ring-slate-500/15', order: 4 },
};

function getQuickDate(preset: 'today' | 'tomorrow' | 'next_week'): string {
  const d = new Date();
  if (preset === 'tomorrow') d.setDate(d.getDate() + 1);
  if (preset === 'next_week') d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function getReminderUrgency(reminderAt: string | null | undefined): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!reminderAt) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (reminderAt < today) return 'overdue';
  if (reminderAt === today) return 'today';
  return 'upcoming';
}

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
  onUpdateLeadAssignedRep,
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

  const wonLeads = activeLeads.filter((s) => s.leadStage === 'won');
  const lostLeads = activeLeads.filter((s) => s.leadStage === 'lost');
  const pipelineLeads = activeLeads.filter((s) => s.leadStage !== 'won' && s.leadStage !== 'lost');

  const stageCounts = activeLeads.reduce((acc, lead) => {
    acc[lead.leadStage] = (acc[lead.leadStage] || 0) + 1;
    return acc;
  }, {} as Record<LeadStage, number>);

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

        {/* Stage funnel metrics */}
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StageMetric stage="new" count={stageCounts.new || 0} />
          <StageMetric stage="contacted" count={stageCounts.contacted || 0} />
          <StageMetric stage="inspection_set" count={stageCounts.inspection_set || 0} />
          <StageMetric stage="won" count={stageCounts.won || 0} />
          <StageMetric stage="lost" count={stageCounts.lost || 0} />
          <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
            <p className="text-3xl font-semibold tracking-tight text-white">{archivedLeads.length}</p>
            <p className="mt-1 text-xs text-slate-500">Archived</p>
          </div>
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
            {/* Active pipeline leads (not won/lost) */}
            {pipelineLeads.length > 0 && (
              <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
                  Active Pipeline
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {pipelineLeads.length} lead{pipelineLeads.length === 1 ? '' : 's'} in progress
                </p>
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  {pipelineLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadHomeowner={onUpdateLeadHomeowner}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Won leads */}
            {wonLeads.length > 0 && (
              <section className="rounded-[28px] border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
                  Won Jobs
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  {wonLeads.length} closed deal{wonLeads.length === 1 ? '' : 's'} ready for follow-up
                </p>
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  {wonLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadHomeowner={onUpdateLeadHomeowner}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Lost leads (collapsed) */}
            {lostLeads.length > 0 && (
              <CollapsibleSection
                title={`Lost (${lostLeads.length})`}
                accent="slate"
              >
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  {lostLeads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadHomeowner={onUpdateLeadHomeowner}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {archivedLeads.length > 0 && (
              <CollapsibleSection
                title={`Archived Leads (${archivedLeads.length})`}
                accent="slate"
              >
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {archivedLeads.map((entry) => (
                    <ArchivedLeadCard
                      key={`${entry.archiveId}-${entry.stop.id}`}
                      lead={entry}
                      onFocusLead={onFocusLead}
                      onRestoreArchive={onRestoreArchive}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function StageMetric({ stage, count }: { stage: LeadStage; count: number }) {
  const cfg = STAGE_CONFIG[stage];
  return (
    <div className={`rounded-[24px] border ${cfg.border} ${cfg.bg} p-4`}>
      <p className="text-3xl font-semibold tracking-tight text-white">{count}</p>
      <p className={`mt-1 text-xs font-semibold ${cfg.color}`}>{cfg.label}</p>
    </div>
  );
}

function CollapsibleSection({
  title,
  accent,
  children,
}: {
  title: string;
  accent: 'slate' | 'emerald';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const borderClass = accent === 'emerald' ? 'border-emerald-500/15' : 'border-slate-800';
  const textClass = accent === 'emerald' ? 'text-emerald-300' : 'text-slate-500';

  return (
    <section className={`rounded-[28px] border ${borderClass} bg-slate-950/82 p-5`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${textClass}`}>
          {title}
        </p>
        <span className="text-slate-500 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && children}
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
  onUpdateLeadAssignedRep,
  onUpdateLeadHomeowner,
}: {
  lead: CanvassRouteStop;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onUpdateLeadStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateLeadOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadNotes: (stopId: string, notes: string) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadAssignedRep: (stopId: string, rep: string) => void;
  onUpdateLeadHomeowner: (
    stopId: string,
    field: 'homeownerName' | 'homeownerPhone' | 'homeownerEmail',
    value: string,
  ) => void;
}) {
  const stageCfg = STAGE_CONFIG[lead.leadStage];
  const urgency = getReminderUrgency(lead.reminderAt);

  const urgencyBadge = urgency === 'overdue'
    ? 'border-red-400/40 bg-red-500/15 text-red-300'
    : urgency === 'today'
      ? 'border-amber-400/40 bg-amber-500/15 text-amber-300'
      : urgency === 'upcoming'
        ? 'border-sky-400/30 bg-sky-500/10 text-sky-300'
        : '';

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/72 p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${stageCfg.border} ${stageCfg.bg} ${stageCfg.color}`}>
              {stageCfg.label}
            </span>
            {urgency !== 'none' && lead.reminderAt && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${urgencyBadge}`}>
                {urgency === 'overdue' ? 'Overdue' : urgency === 'today' ? 'Due Today' : formatShortDate(lead.reminderAt)}
              </span>
            )}
          </div>
          <p className="mt-2 text-base font-semibold text-white">{lead.stormLabel}</p>
          <p className="mt-1 text-sm text-slate-400">{lead.locationLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => onFocusLead(lead)}
          className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
        >
          Map
        </button>
      </div>

      {/* Storm context badges */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
        <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-slate-300">
          {lead.reportCount} reports
        </span>
        <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-slate-300">
          {lead.topHailInches > 0 ? `${lead.topHailInches}" hail` : 'hail swath'}
        </span>
        <span className="rounded-full border border-slate-800 bg-slate-950/80 px-2 py-0.5 text-slate-300">
          {lead.evidenceCount} proof
        </span>
        <span className="rounded-full border border-orange-400/25 bg-orange-500/10 px-2 py-0.5 text-orange-200">
          {lead.priority}
        </span>
        {lead.assignedRep && (
          <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-violet-200">
            {lead.assignedRep}
          </span>
        )}
      </div>

      {/* Stage pipeline - visual progression */}
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600 mb-2">Stage</p>
        <div className="flex gap-1">
          {(['new', 'contacted', 'inspection_set', 'won', 'lost'] as LeadStage[]).map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const isActive = lead.leadStage === stage;
            const isPast = cfg.order < STAGE_CONFIG[lead.leadStage].order && lead.leadStage !== 'lost';
            return (
              <button
                key={stage}
                type="button"
                onClick={() => onUpdateLeadStage(lead.id, stage)}
                className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold transition-all ${
                  isActive
                    ? `${cfg.border} ${cfg.bg} ${cfg.color} ring-1 ${cfg.ring}`
                    : isPast
                      ? 'border-slate-700 bg-slate-800/50 text-slate-400'
                      : 'border-slate-800 bg-slate-950 text-slate-600 hover:border-slate-700 hover:text-slate-400'
                }`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick actions row */}
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
        <span className="mx-1 border-l border-slate-800" />
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

      {/* Rep assignment + Reminder row */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Assigned Rep
          </label>
          <input
            value={lead.assignedRep || ''}
            onChange={(event) => onUpdateLeadAssignedRep(lead.id, event.target.value)}
            placeholder="Rep name"
            className="mt-1 w-full rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-400/40 focus:outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
            Reminder
          </label>
          <div className="mt-1 flex gap-1.5">
            <input
              type="date"
              value={lead.reminderAt || ''}
              onChange={(event) => onUpdateLeadReminder(lead.id, event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-orange-400/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onUpdateLeadReminder(lead.id, getQuickDate('today'))}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-[10px] font-semibold text-slate-400 hover:border-amber-400/30 hover:text-amber-300"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => onUpdateLeadReminder(lead.id, getQuickDate('tomorrow'))}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-[10px] font-semibold text-slate-400 hover:border-amber-400/30 hover:text-amber-300"
            >
              Tmrw
            </button>
            <button
              type="button"
              onClick={() => onUpdateLeadReminder(lead.id, getQuickDate('next_week'))}
              className="rounded-xl border border-slate-800 bg-slate-950 px-2 py-1.5 text-[10px] font-semibold text-slate-400 hover:border-amber-400/30 hover:text-amber-300"
            >
              +7d
            </button>
          </div>
        </div>
      </div>

      {/* Homeowner fields */}
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

      <textarea
        value={lead.notes}
        onChange={(event) => onUpdateLeadNotes(lead.id, event.target.value)}
        placeholder="Lead notes, scheduling details, next touch..."
        className="mt-4 h-20 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/40 focus:outline-none"
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
  const stageCfg = STAGE_CONFIG[lead.stop.leadStage];

  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/72 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${stageCfg.border} ${stageCfg.bg} ${stageCfg.color}`}>
              {stageCfg.label}
            </span>
            <span className="rounded-full border border-slate-800 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
              Archived
            </span>
          </div>
          <p className="mt-2 text-base font-semibold text-white">{lead.stop.stormLabel}</p>
          <p className="mt-1 text-sm text-slate-400">{lead.stop.locationLabel}</p>
        </div>
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

function formatShortDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
