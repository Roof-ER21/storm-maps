import { useState } from 'react';
import type {
  CanvassOutcome,
  CanvassRouteArchive,
  CanvassRouteStop,
  CanvassStopStatus,
  LeadStage,
  LeadStageEntry,
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
  onUpdateLeadDealValue: (stopId: string, value: number | null) => void;
  onShareLeadReport: (stop: CanvassRouteStop) => void;
  onUpdateLeadChecklist: (stopId: string, key: string, done: boolean) => void;
  onLookupPropertyOwner: (stopId: string) => void;
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
  onUpdateLeadDealValue,
  onShareLeadReport,
  onUpdateLeadChecklist,
  onLookupPropertyOwner,
  onUpdateLeadHomeowner,
  onRestoreArchive,
}: LeadsPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState<LeadStage | 'all'>('all');
  const [filterUrgency, setFilterUrgency] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [filterRep, setFilterRep] = useState('all');
  const [filterOutcome, setFilterOutcome] = useState<CanvassOutcome | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allActiveLeads = routeStops
    .filter((stop) => LEAD_OUTCOMES.includes(stop.outcome))
    .slice()
    .sort(compareLeadPriority);

  // Derive available reps for the filter dropdown
  const availableReps = Array.from(
    new Set(allActiveLeads.map((l) => l.assignedRep?.trim()).filter(Boolean) as string[]),
  ).sort();

  // Apply filters
  const activeLeads = allActiveLeads.filter((lead) => {
    if (filterStage !== 'all' && lead.leadStage !== filterStage) return false;
    if (filterOutcome !== 'all' && lead.outcome !== filterOutcome) return false;
    if (filterRep !== 'all') {
      const rep = lead.assignedRep?.trim() || '';
      if (filterRep === '__unassigned__' ? rep !== '' : rep !== filterRep) return false;
    }
    if (filterUrgency !== 'all') {
      const u = getReminderUrgency(lead.reminderAt);
      if (filterUrgency !== u) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const haystack = [
        lead.homeownerName, lead.homeownerPhone, lead.homeownerEmail,
        lead.locationLabel, lead.stormLabel, lead.notes, lead.assignedRep,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

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
  const hasActiveFilters = filterStage !== 'all' || filterUrgency !== 'all' || filterRep !== 'all' || filterOutcome !== 'all' || searchQuery.trim() !== '';

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(activeLeads.map((l) => l.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkSetStage = (stage: LeadStage) => {
    for (const id of selectedIds) onUpdateLeadStage(id, stage);
    clearSelection();
  };

  const bulkSetReminder = (preset: 'today' | 'tomorrow' | 'next_week') => {
    const date = getQuickDate(preset);
    for (const id of selectedIds) onUpdateLeadReminder(id, date);
    clearSelection();
  };

  const bulkSetRep = (rep: string) => {
    for (const id of selectedIds) onUpdateLeadAssignedRep(id, rep);
    clearSelection();
  };

  const stageCounts = allActiveLeads.reduce((acc, lead) => {
    acc[lead.leadStage] = (acc[lead.leadStage] || 0) + 1;
    return acc;
  }, {} as Record<LeadStage, number>);

  // Conversion stats (always against full set)
  const allWon = allActiveLeads.filter((s) => s.leadStage === 'won').length;
  const allLost = allActiveLeads.filter((s) => s.leadStage === 'lost').length;
  const closedLeads = allWon + allLost;
  const winRate = closedLeads > 0 ? Math.round((allWon / closedLeads) * 100) : null;

  const avgDaysInPipeline = (() => {
    const leadsWithHistory = allActiveLeads.filter((l) => l.stageHistory && l.stageHistory.length >= 2);
    if (leadsWithHistory.length === 0) return null;
    const totalDays = leadsWithHistory.reduce((sum, l) => {
      const first = new Date(l.stageHistory![0].at).getTime();
      const last = new Date(l.stageHistory![l.stageHistory!.length - 1].at).getTime();
      return sum + (last - first) / (1000 * 60 * 60 * 24);
    }, 0);
    return Math.round(totalDays / leadsWithHistory.length);
  })();

  const repCounts = allActiveLeads.reduce((acc, lead) => {
    const rep = lead.assignedRep?.trim() || 'Unassigned';
    acc[rep] = (acc[rep] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topReps = Object.entries(repCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

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

        {/* Conversion insights */}
        {activeLeads.length > 0 && (() => {
          const pipelineValue = allActiveLeads.filter((l) => l.leadStage !== 'won' && l.leadStage !== 'lost').reduce((s, l) => s + (l.dealValue || 0), 0);
          const closedValue = allActiveLeads.filter((l) => l.leadStage === 'won').reduce((s, l) => s + (l.dealValue || 0), 0);
          return (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-emerald-300">
                {closedValue > 0 ? `$${(closedValue / 1000).toFixed(0)}k` : '--'}
              </p>
              <p className="mt-1 text-[10px] sm:text-xs text-slate-500">Closed Revenue</p>
            </div>
            <div className="rounded-[24px] border border-orange-500/20 bg-orange-500/[0.06] p-4">
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-orange-300">
                {pipelineValue > 0 ? `$${(pipelineValue / 1000).toFixed(0)}k` : '--'}
              </p>
              <p className="mt-1 text-[10px] sm:text-xs text-slate-500">Pipeline Value</p>
            </div>
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                {winRate !== null ? `${winRate}%` : '--'}
              </p>
              <p className="mt-1 text-[10px] sm:text-xs text-slate-500">Win Rate</p>
            </div>
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
              <p className="text-xl sm:text-2xl font-semibold tracking-tight text-white">
                {avgDaysInPipeline !== null ? `${avgDaysInPipeline}d` : '--'}
              </p>
              <p className="mt-1 text-[10px] sm:text-xs text-slate-500">Avg Days</p>
            </div>
            <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Leads by Rep</p>
              {topReps.map(([rep, count]) => (
                <div key={rep} className="flex items-center justify-between text-xs mt-1">
                  <span className="text-slate-300 truncate">{rep}</span>
                  <span className="text-white font-semibold">{count}</span>
                </div>
              ))}
              {topReps.length === 0 && (
                <p className="text-[11px] text-slate-600">No reps assigned yet</p>
              )}
            </div>
          </div>
          );
        })()}

        {/* Filter bar */}
        {allActiveLeads.length > 0 && (
          <div className="rounded-[24px] border border-slate-800 bg-slate-950/82 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search leads..."
                className="w-full sm:min-w-[180px] sm:flex-1 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-orange-400/40 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2 sm:contents">
              <select
                value={filterStage}
                onChange={(e) => setFilterStage(e.target.value as LeadStage | 'all')}
                className="rounded-xl border border-slate-800 bg-slate-900 px-2 sm:px-3 py-2 text-xs font-semibold text-slate-300 focus:border-orange-400/40 focus:outline-none"
              >
                <option value="all">All Stages</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="inspection_set">Inspection Set</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
              <select
                value={filterOutcome}
                onChange={(e) => setFilterOutcome(e.target.value as CanvassOutcome | 'all')}
                className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 focus:border-orange-400/40 focus:outline-none"
              >
                <option value="all">All Outcomes</option>
                <option value="inspection_booked">Booked</option>
                <option value="follow_up">Follow Up</option>
                <option value="interested">Interested</option>
              </select>
              <select
                value={filterUrgency}
                onChange={(e) => setFilterUrgency(e.target.value as 'all' | 'overdue' | 'today' | 'upcoming')}
                className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 focus:border-orange-400/40 focus:outline-none"
              >
                <option value="all">All Reminders</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due Today</option>
                <option value="upcoming">Upcoming</option>
              </select>
              <select
                value={filterRep}
                onChange={(e) => setFilterRep(e.target.value)}
                className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 focus:border-orange-400/40 focus:outline-none"
              >
                <option value="all">All Reps</option>
                <option value="__unassigned__">Unassigned</option>
                {availableReps.map((rep) => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </select>
              </div>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setFilterStage('all'); setFilterUrgency('all'); setFilterRep('all'); setFilterOutcome('all'); }}
                  className="w-full sm:w-auto rounded-xl border border-orange-400/30 bg-orange-500/10 px-3 py-2 text-xs font-semibold text-orange-300 hover:bg-orange-500/20"
                >
                  Clear Filters
                </button>
              )}
            </div>
            {hasActiveFilters && (
              <p className="mt-2 text-xs text-slate-500">
                Showing {activeLeads.length} of {allActiveLeads.length} leads
              </p>
            )}
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            totalVisible={activeLeads.length}
            availableReps={availableReps}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onBulkSetStage={bulkSetStage}
            onBulkSetReminder={bulkSetReminder}
            onBulkSetRep={bulkSetRep}
          />
        )}

        {activeLeads.length === 0 && archivedLeads.length === 0 && !hasActiveFilters ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No lead pipeline yet</p>
            <p className="mt-2 text-sm text-slate-500">
              Leads are created when reps mark a route stop as Interested, Follow Up, or Inspection Booked.
            </p>
          </div>
        ) : activeLeads.length === 0 && hasActiveFilters ? (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No leads match filters</p>
            <p className="mt-2 text-sm text-slate-500">
              Try adjusting your filters or clearing them to see all {allActiveLeads.length} leads.
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
                      isSelected={selectedIds.has(lead.id)}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadDealValue={onUpdateLeadDealValue}
                      onShareLeadReport={onShareLeadReport}
                      onUpdateLeadChecklist={onUpdateLeadChecklist}
                      onLookupPropertyOwner={onLookupPropertyOwner}
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
                      isSelected={selectedIds.has(lead.id)}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadDealValue={onUpdateLeadDealValue}
                      onShareLeadReport={onShareLeadReport}
                      onUpdateLeadChecklist={onUpdateLeadChecklist}
                      onLookupPropertyOwner={onLookupPropertyOwner}
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
                      isSelected={selectedIds.has(lead.id)}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onFocusLead={onFocusLead}
                      onUpdateLeadStatus={onUpdateLeadStatus}
                      onUpdateLeadOutcome={onUpdateLeadOutcome}
                      onUpdateLeadStage={onUpdateLeadStage}
                      onUpdateLeadNotes={onUpdateLeadNotes}
                      onUpdateLeadReminder={onUpdateLeadReminder}
                      onUpdateLeadAssignedRep={onUpdateLeadAssignedRep}
                      onUpdateLeadDealValue={onUpdateLeadDealValue}
                      onShareLeadReport={onShareLeadReport}
                      onUpdateLeadChecklist={onUpdateLeadChecklist}
                      onLookupPropertyOwner={onLookupPropertyOwner}
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
  isSelected,
  onToggleSelect,
  onFocusLead,
  onUpdateLeadStatus,
  onUpdateLeadOutcome,
  onUpdateLeadStage,
  onUpdateLeadNotes,
  onUpdateLeadReminder,
  onUpdateLeadAssignedRep,
  onUpdateLeadDealValue,
  onShareLeadReport,
  onUpdateLeadChecklist,
  onLookupPropertyOwner,
  onUpdateLeadHomeowner,
}: {
  lead: CanvassRouteStop;
  isSelected: boolean;
  onToggleSelect: () => void;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onUpdateLeadStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateLeadOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateLeadStage: (stopId: string, leadStage: LeadStage) => void;
  onUpdateLeadNotes: (stopId: string, notes: string) => void;
  onUpdateLeadReminder: (stopId: string, reminderAt: string) => void;
  onUpdateLeadAssignedRep: (stopId: string, rep: string) => void;
  onUpdateLeadDealValue: (stopId: string, value: number | null) => void;
  onShareLeadReport: (stop: CanvassRouteStop) => void;
  onUpdateLeadChecklist: (stopId: string, key: string, done: boolean) => void;
  onLookupPropertyOwner: (stopId: string) => void;
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
    <article className={`rounded-3xl border p-4 transition-colors ${isSelected ? 'border-orange-400/40 bg-orange-500/[0.06]' : 'border-slate-800 bg-slate-900/72'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onToggleSelect}
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${isSelected ? 'border-orange-400 bg-orange-500 text-white' : 'border-slate-700 bg-slate-950 text-transparent hover:border-slate-500'}`}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </button>
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
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onShareLeadReport(lead)}
            className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-2 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
          >
            Share
          </button>
          <button
            type="button"
            onClick={() => onFocusLead(lead)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-[10px] font-semibold text-white transition-colors hover:border-slate-700 hover:bg-slate-800"
          >
            Map
          </button>
        </div>
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
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {(['new', 'contacted', 'inspection_set', 'won', 'lost'] as LeadStage[]).map((stage) => {
            const cfg = STAGE_CONFIG[stage];
            const isActive = lead.leadStage === stage;
            const isPast = cfg.order < STAGE_CONFIG[lead.leadStage].order && lead.leadStage !== 'lost';
            return (
              <button
                key={stage}
                type="button"
                onClick={() => onUpdateLeadStage(lead.id, stage)}
                className={`rounded-lg border py-1.5 text-[9px] sm:text-[10px] font-bold transition-all ${
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

      {/* Stage history timeline */}
      {lead.stageHistory && lead.stageHistory.length > 1 && (
        <StageTimeline history={lead.stageHistory} />
      )}

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

      {/* Rep + Deal Value + Reminder row */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
            Deal Value ($)
          </label>
          <input
            type="number"
            value={lead.dealValue ?? ''}
            onChange={(event) => onUpdateLeadDealValue(lead.id, event.target.value ? parseFloat(event.target.value) : null)}
            placeholder="0"
            className="mt-1 w-full rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400/40 focus:outline-none"
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
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onLookupPropertyOwner(lead.id)}
          className="rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-[10px] font-semibold text-sky-300 hover:bg-sky-500/20"
        >
          Lookup Owner
        </button>
        {!lead.homeownerName && (
          <p className="text-[10px] text-slate-600">Auto-fill owner name from public records</p>
        )}
      </div>
      <div className="mt-2 grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
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

      {/* Quick-contact actions */}
      {(lead.homeownerPhone || lead.homeownerEmail) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.homeownerPhone && (
            <>
              <a
                href={`tel:${lead.homeownerPhone.replace(/[^\d+]/g, '')}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                <PhoneIcon /> Call
              </a>
              <a
                href={buildSmsLink(lead.homeownerPhone, lead.homeownerName || 'there', lead.locationLabel, lead.stormLabel)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/25 bg-sky-500/10 px-3 py-2.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
              >
                <MessageIcon /> Text
              </a>
            </>
          )}
          {lead.homeownerEmail && (
            <a
              href={buildEmailLink(lead.homeownerEmail, lead.homeownerName || 'Homeowner', lead.locationLabel, lead.stormLabel)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-400/25 bg-violet-500/10 px-3 py-2.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/20"
            >
              <EmailIcon /> Email
            </a>
          )}
        </div>
      )}

      {/* Win checklist */}
      {lead.leadStage === 'won' && lead.winChecklist && lead.winChecklist.length > 0 && (
        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300 mb-2">
            Closeout Checklist ({lead.winChecklist.filter((i) => i.done).length}/{lead.winChecklist.length})
          </p>
          <div className="space-y-1.5">
            {lead.winChecklist.map((item) => (
              <label key={item.key} className="flex items-center gap-2 cursor-pointer group">
                <button
                  type="button"
                  onClick={() => onUpdateLeadChecklist(lead.id, item.key, !item.done)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${item.done ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-slate-700 bg-slate-950 text-transparent group-hover:border-emerald-400/50'}`}
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </button>
                <span className={`text-xs ${item.done ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

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

function BulkActionBar({
  count,
  totalVisible,
  availableReps,
  onSelectAll,
  onClearSelection,
  onBulkSetStage,
  onBulkSetReminder,
  onBulkSetRep,
}: {
  count: number;
  totalVisible: number;
  availableReps: string[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkSetStage: (stage: LeadStage) => void;
  onBulkSetReminder: (preset: 'today' | 'tomorrow' | 'next_week') => void;
  onBulkSetRep: (rep: string) => void;
}) {
  const [bulkRep, setBulkRep] = useState('');

  return (
    <div className="sticky top-0 z-20 rounded-[24px] border border-orange-400/30 bg-slate-950/95 p-3 sm:p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-sm">
      <div className="space-y-2 sm:space-y-3">
        {/* Selection controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <p className="text-sm font-semibold text-orange-300">{count} selected</p>
          {count < totalVisible && (
            <button type="button" onClick={onSelectAll} className="text-xs text-slate-400 hover:text-white underline">Select all {totalVisible}</button>
          )}
          <button type="button" onClick={onClearSelection} className="text-xs text-slate-400 hover:text-white underline">Clear</button>
        </div>

        {/* Stage + Reminder row */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span className="text-[10px] font-semibold uppercase text-slate-600 shrink-0">Stage:</span>
          {(['contacted', 'inspection_set', 'won', 'lost'] as LeadStage[]).map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => onBulkSetStage(stage)}
              className={`flex-1 sm:flex-none rounded-lg border px-1.5 sm:px-2 py-1.5 text-[9px] sm:text-[10px] font-bold ${STAGE_CONFIG[stage].border} ${STAGE_CONFIG[stage].bg} ${STAGE_CONFIG[stage].color} hover:opacity-80`}
            >
              {STAGE_CONFIG[stage].label}
            </button>
          ))}
          <span className="hidden sm:block mx-1 h-5 border-l border-slate-700" />
          <span className="text-[10px] font-semibold uppercase text-slate-600 shrink-0">Remind:</span>
          <button type="button" onClick={() => onBulkSetReminder('today')} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-amber-300">Today</button>
          <button type="button" onClick={() => onBulkSetReminder('tomorrow')} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-amber-300">Tmrw</button>
          <button type="button" onClick={() => onBulkSetReminder('next_week')} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-amber-300">+7d</button>
        </div>

        {/* Rep assignment row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
          <span className="text-[10px] font-semibold uppercase text-slate-600 shrink-0">Rep:</span>
          <div className="flex items-center gap-1 flex-1">
            <input
              value={bulkRep}
              onChange={(e) => setBulkRep(e.target.value)}
              placeholder="Name"
              list="bulk-rep-options"
              className="flex-1 sm:w-24 sm:flex-none rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:border-violet-400/40 focus:outline-none"
            />
            <datalist id="bulk-rep-options">
              {availableReps.map((rep) => <option key={rep} value={rep} />)}
            </datalist>
            <button
              type="button"
              onClick={() => { if (bulkRep.trim()) { onBulkSetRep(bulkRep.trim()); setBulkRep(''); } }}
              className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-[10px] font-bold text-violet-300 hover:bg-violet-500/25"
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageTimeline({ history }: { history: LeadStageEntry[] }) {
  return (
    <div className="mt-3 rounded-2xl border border-slate-800/60 bg-slate-950/50 px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600 mb-1.5">Activity</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {history.map((entry, i) => {
          const cfg = STAGE_CONFIG[entry.stage];
          const d = new Date(entry.at);
          const dateStr = Number.isNaN(d.getTime())
            ? ''
            : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeStr = Number.isNaN(d.getTime())
            ? ''
            : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return (
            <div key={`${entry.stage}-${entry.at}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-700 text-[10px]">&rarr;</span>}
              <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
              <span className="text-[9px] text-slate-600">{dateStr} {timeStr}</span>
            </div>
          );
        })}
      </div>
    </div>
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

function buildSmsLink(phone: string, name: string, address: string, stormLabel: string): string {
  const cleanPhone = phone.replace(/[^\d+]/g, '');
  const body = `Hi ${name}, this is your local roofing specialist following up about the ${stormLabel} storm that affected ${address}. We offer free inspections to check for hail damage. Would you like to schedule one?`;
  return `sms:${cleanPhone}?body=${encodeURIComponent(body)}`;
}

function buildEmailLink(email: string, name: string, address: string, stormLabel: string): string {
  const subject = `Free Hail Damage Inspection — ${address}`;
  const body = `Hi ${name},\n\nI'm reaching out because the ${stormLabel} storm brought documented hail activity to your area around ${address}.\n\nWe offer free roof inspections to assess any potential damage, and we can help you navigate the insurance claim process if damage is found.\n\nWould you have time this week for a quick inspection?\n\nBest regards`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function PhoneIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
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
