import type { CanvassRouteStop, LeadStage, PropertySearchSummary } from '../types/storm';
import type { StormAlert } from '../hooks/useStormAlerts';

interface TodayPageProps {
  searchSummary: PropertySearchSummary | null;
  routeStops: CanvassRouteStop[];
  stormAlerts: StormAlert[];
  onOpenMap: () => void;
  onOpenLeads: () => void;
  onOpenCanvass: () => void;
  onFocusLead: (stop: CanvassRouteStop) => void;
  onDismissAlert: (id: string) => void;
}

const STAGE_COLORS: Record<LeadStage, { color: string; bg: string; border: string }> = {
  new: { color: 'text-sky-300', bg: 'bg-sky-500/15', border: 'border-sky-400/30' },
  contacted: { color: 'text-amber-300', bg: 'bg-amber-500/15', border: 'border-amber-400/30' },
  inspection_set: { color: 'text-violet-300', bg: 'bg-violet-500/15', border: 'border-violet-400/30' },
  won: { color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/30' },
  lost: { color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-600/30' },
};

const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New', contacted: 'Contacted', inspection_set: 'Inspection Set', won: 'Won', lost: 'Lost',
};

function formatPhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export default function TodayPage({
  searchSummary,
  routeStops,
  stormAlerts,
  onOpenMap,
  onOpenLeads,
  onOpenCanvass,
  onFocusLead,
  onDismissAlert,
}: TodayPageProps) {
  const today = new Date().toISOString().slice(0, 10);
  const activeLeads = routeStops.filter((s) =>
    s.outcome === 'interested' || s.outcome === 'follow_up' || s.outcome === 'inspection_booked',
  );

  const overdueLeads = activeLeads
    .filter((s) => s.reminderAt && s.reminderAt < today && s.leadStage !== 'won' && s.leadStage !== 'lost')
    .sort((a, b) => (a.reminderAt || '').localeCompare(b.reminderAt || ''));

  const dueTodayLeads = activeLeads
    .filter((s) => s.reminderAt === today && s.leadStage !== 'won' && s.leadStage !== 'lost');

  const upcomingLeads = activeLeads
    .filter((s) => s.reminderAt && s.reminderAt > today && s.leadStage !== 'won' && s.leadStage !== 'lost')
    .sort((a, b) => (a.reminderAt || '').localeCompare(b.reminderAt || ''))
    .slice(0, 5);

  const pendingCanvassStops = routeStops.filter((s) => s.status === 'queued').length;
  const visitedToday = routeStops.filter((s) => s.visitedAt?.startsWith(today)).length;

  const activeAlerts = stormAlerts.filter((a) => !a.dismissed);

  const greeting = getGreeting();

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.14),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_24%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {/* Hero */}
        <div className="rounded-[28px] border border-slate-800 bg-slate-950/88 px-4 py-5 sm:p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-white">
            {greeting}
          </h2>
          <p className="mt-3 text-sm text-slate-400">
            {searchSummary
              ? `Territory: ${searchSummary.locationLabel}`
              : 'Search a property on the Map to set your territory.'}
          </p>

          {/* Quick stats row */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <QuickStat label="Overdue" value={overdueLeads.length} tone="red" />
            <QuickStat label="Due Today" value={dueTodayLeads.length} tone="amber" />
            <QuickStat label="Queued Stops" value={pendingCanvassStops} tone="violet" />
            <QuickStat label="Visited Today" value={visitedToday} tone="emerald" />
          </div>
        </div>

        {/* Storm alerts */}
        {activeAlerts.length > 0 && (
          <section className="rounded-[28px] border border-red-500/25 bg-red-500/[0.06] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
              Storm Alerts
            </p>
            <div className="mt-3 grid gap-2">
              {activeAlerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between rounded-2xl border border-red-500/15 bg-slate-950/60 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">{alert.message}</p>
                  </div>
                  <div className="ml-3 flex gap-2">
                    <button type="button" onClick={onOpenMap} className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-red-300 hover:bg-red-500/25">Map</button>
                    <button type="button" onClick={() => onDismissAlert(alert.id)} className="text-slate-600 hover:text-slate-400 text-sm">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Overdue leads */}
        {overdueLeads.length > 0 && (
          <section className="rounded-[28px] border border-red-500/20 bg-red-500/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-300">
              Overdue — Needs Attention Now
            </p>
            <div className="mt-4 grid gap-3">
              {overdueLeads.map((lead) => (
                <DigestLeadCard key={lead.id} lead={lead} urgency="overdue" onFocusLead={onFocusLead} onOpenLeads={onOpenLeads} />
              ))}
            </div>
          </section>
        )}

        {/* Due today */}
        {dueTodayLeads.length > 0 && (
          <section className="rounded-[28px] border border-amber-500/20 bg-amber-500/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              Due Today
            </p>
            <div className="mt-4 grid gap-3">
              {dueTodayLeads.map((lead) => (
                <DigestLeadCard key={lead.id} lead={lead} urgency="today" onFocusLead={onFocusLead} onOpenLeads={onOpenLeads} />
              ))}
            </div>
          </section>
        )}

        {/* Coming up */}
        {upcomingLeads.length > 0 && (
          <section className="rounded-[28px] border border-slate-800 bg-slate-950/82 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              Coming Up
            </p>
            <div className="mt-4 grid gap-3">
              {upcomingLeads.map((lead) => (
                <DigestLeadCard key={lead.id} lead={lead} urgency="upcoming" onFocusLead={onFocusLead} onOpenLeads={onOpenLeads} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {overdueLeads.length === 0 && dueTodayLeads.length === 0 && upcomingLeads.length === 0 && activeAlerts.length === 0 && (
          <div className="rounded-3xl border border-dashed border-slate-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">Clear schedule</p>
            <p className="mt-2 text-sm text-slate-500">
              No reminders due and no storm alerts. Set reminders on leads or start canvassing to populate your daily briefing.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={onOpenCanvass} className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white">
                Start Canvassing
              </button>
              <button type="button" onClick={onOpenLeads} className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                View Leads
              </button>
            </div>
          </div>
        )}

        {/* Quick nav */}
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
          <button type="button" onClick={onOpenMap} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-slate-700 hover:bg-slate-900">
            <p className="text-sm font-semibold text-white">Storm Map</p>
            <p className="mt-1 text-xs text-slate-500">Check current conditions</p>
          </button>
          <button type="button" onClick={onOpenCanvass} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-slate-700 hover:bg-slate-900">
            <p className="text-sm font-semibold text-white">Canvass</p>
            <p className="mt-1 text-xs text-slate-500">{pendingCanvassStops} stops queued</p>
          </button>
          <button type="button" onClick={onOpenLeads} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-slate-700 hover:bg-slate-900">
            <p className="text-sm font-semibold text-white">Lead Pipeline</p>
            <p className="mt-1 text-xs text-slate-500">{activeLeads.length} active leads</p>
          </button>
        </div>
      </div>
    </section>
  );
}

function DigestLeadCard({
  lead,
  urgency,
  onFocusLead,
  onOpenLeads,
}: {
  lead: CanvassRouteStop;
  urgency: 'overdue' | 'today' | 'upcoming';
  onFocusLead: (stop: CanvassRouteStop) => void;
  onOpenLeads: () => void;
}) {
  const stageCfg = STAGE_COLORS[lead.leadStage];
  const daysOverdue = computeDaysOverdue(urgency, lead.reminderAt);

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      {/* Stage badge */}
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${stageCfg.border} ${stageCfg.bg} ${stageCfg.color}`}>
        {STAGE_LABELS[lead.leadStage]}
      </span>

      {/* Lead info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white truncate">
          {lead.homeownerName || lead.locationLabel}
        </p>
        <p className="mt-0.5 text-xs text-slate-400 truncate">
          {lead.stormLabel}
          {urgency === 'overdue' && daysOverdue > 0 && (
            <span className="ml-2 text-red-300">{daysOverdue}d overdue</span>
          )}
          {urgency === 'upcoming' && lead.reminderAt && (
            <span className="ml-2 text-sky-300">{formatShortDate(lead.reminderAt)}</span>
          )}
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex shrink-0 gap-1.5">
        {lead.homeownerPhone && (
          <a
            href={`tel:${formatPhone(lead.homeownerPhone)}`}
            className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
            title="Call"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          </a>
        )}
        <button
          type="button"
          onClick={() => onFocusLead(lead)}
          className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
          title="View on map"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6-5.33-6-11a6 6 0 1112 0c0 5.67-6 11-6 11z" /></svg>
        </button>
        <button
          type="button"
          onClick={onOpenLeads}
          className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
          title="Open in leads"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

function QuickStat({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'violet' | 'emerald' }) {
  const toneClasses = {
    red: 'border-red-500/20 bg-red-500/[0.06]',
    amber: 'border-amber-500/20 bg-amber-500/[0.06]',
    violet: 'border-violet-500/20 bg-violet-500/[0.06]',
    emerald: 'border-emerald-500/20 bg-emerald-500/[0.06]',
  };
  const valueColor = {
    red: value > 0 ? 'text-red-300' : 'text-white',
    amber: value > 0 ? 'text-amber-300' : 'text-white',
    violet: 'text-white',
    emerald: 'text-white',
  };

  return (
    <div className={`rounded-2xl border p-3 ${toneClasses[tone]}`}>
      <p className={`text-2xl font-semibold ${valueColor[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function computeDaysOverdue(urgency: string, reminderAt: string | null | undefined): number {
  if (urgency !== 'overdue' || !reminderAt) return 0;
  const now = new Date();
  const due = new Date(`${reminderAt}T12:00:00Z`);
  return Math.floor((now.getTime() - due.getTime()) / 86400000);
}

function formatShortDate(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
