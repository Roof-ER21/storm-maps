import type { CanvassRouteStop, LeadStage, PropertySearchSummary } from '../types/storm';
import type { StormAlert } from '../hooks/useStormAlerts';
import { getTodayEasternKey } from '../services/dateUtils';

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
  new: { color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
  contacted: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  inspection_set: { color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  won: { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  lost: { color: 'text-stone-500', bg: 'bg-stone-50', border: 'border-stone-200' },
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
  const today = getTodayEasternKey();
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
    <section className="flex-1 overflow-y-auto bg-[#faf9f7] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {/* Hero */}
        <div className="rounded-[28px] border border-stone-200 bg-white shadow-sm px-4 py-5 sm:p-6 ">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-600">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">
            {greeting}
          </h2>
          <p className="mt-3 text-sm text-stone-500">
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
              Storm Alerts
            </p>
            <div className="mt-3 grid gap-2">
              {activeAlerts.slice(0, 3).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between rounded-2xl border border-red-500/15 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-stone-900">{alert.message}</p>
                  </div>
                  <div className="ml-3 flex gap-2">
                    <button type="button" onClick={onOpenMap} className="rounded-lg bg-red-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-red-600 hover:bg-red-500/25">Map</button>
                    <button type="button" onClick={() => onDismissAlert(alert.id)} aria-label="Dismiss alert" className="flex h-8 w-8 items-center justify-center text-stone-400 hover:text-stone-500">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Overdue leads */}
        {overdueLeads.length > 0 && (
          <section className="rounded-[28px] border border-red-500/20 bg-red-500/[0.04] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
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
          <section className="rounded-[28px] border border-stone-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
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
          <div className="rounded-3xl border border-dashed border-stone-200 bg-stone-50 p-8 text-center">
            <p className="text-lg font-semibold text-stone-900">Clear schedule</p>
            <p className="mt-2 text-sm text-stone-400">
              No reminders due and no storm alerts. Set reminders on leads or start canvassing to populate your daily briefing.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={onOpenCanvass} className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white">
                Start Canvassing
              </button>
              <button type="button" onClick={onOpenLeads} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-900 hover:bg-stone-100">
                View Leads
              </button>
            </div>
          </div>
        )}

        {/* Quick nav */}
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
          <button type="button" onClick={onOpenMap} className="rounded-2xl border border-stone-200 bg-white p-4 text-left hover:bg-stone-100">
            <p className="text-sm font-semibold text-stone-900">Storm Map</p>
            <p className="mt-1 text-xs text-stone-400">Check current conditions</p>
          </button>
          <button type="button" onClick={onOpenCanvass} className="rounded-2xl border border-stone-200 bg-white p-4 text-left hover:bg-stone-100">
            <p className="text-sm font-semibold text-stone-900">Canvass</p>
            <p className="mt-1 text-xs text-stone-400">{pendingCanvassStops} stops queued</p>
          </button>
          <button type="button" onClick={onOpenLeads} className="rounded-2xl border border-stone-200 bg-white p-4 text-left hover:bg-stone-100">
            <p className="text-sm font-semibold text-stone-900">Lead Pipeline</p>
            <p className="mt-1 text-xs text-stone-400">{activeLeads.length} active leads</p>
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
    <div className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-stone-50/60 px-4 py-3">
      {/* Stage badge */}
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${stageCfg.border} ${stageCfg.bg} ${stageCfg.color}`}>
        {STAGE_LABELS[lead.leadStage]}
      </span>

      {/* Lead info */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-stone-900 truncate">
          {lead.homeownerName || lead.locationLabel}
        </p>
        <p className="mt-0.5 text-xs text-stone-500 truncate">
          {lead.stormLabel}
          {urgency === 'overdue' && daysOverdue > 0 && (
            <span className="ml-2 text-red-600">{daysOverdue}d overdue</span>
          )}
          {urgency === 'upcoming' && lead.reminderAt && (
            <span className="ml-2 text-sky-700">{formatShortDate(lead.reminderAt)}</span>
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
          className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-900"
          title="View on map"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6-5.33-6-11a6 6 0 1112 0c0 5.67-6 11-6 11z" /></svg>
        </button>
        <button
          type="button"
          onClick={onOpenLeads}
          className="flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-500 hover:text-stone-900"
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
    red: value > 0 ? 'text-red-600' : 'text-stone-900',
    amber: value > 0 ? 'text-amber-600' : 'text-stone-900',
    violet: 'text-stone-900',
    emerald: 'text-stone-900',
  };

  return (
    <div className={`rounded-2xl border p-3 ${toneClasses[tone]}`}>
      <p className={`text-2xl font-semibold ${valueColor[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold text-stone-400">{label}</p>
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
