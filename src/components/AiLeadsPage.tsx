/**
 * AiLeadsPage — paginated lead management for AI-analyzed properties.
 *
 * Filter bar (All / Starred / High Priority / Status), sortable by prospect
 * score, inline status + notes editing, star toggle, and "View Details".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LeadStatus, PropertyAnalysis } from '../types/analysis';
import {
  type AiLeadsParams,
  getAiLeads,
  toggleStar,
  updateLeadNotes,
  updateLeadStatus,
} from '../services/aiApi';

// ── Types ────────────────────────────────────────────────────

interface AiLeadsPageProps {
  onViewAnalysis?: (address: string) => void;
}

type FilterTab = 'all' | 'starred' | 'high_priority';

const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'knocked',
  'not_home',
  'callback',
  'pitched',
  'sold',
  'skip',
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  knocked: 'Knocked',
  not_home: 'Not Home',
  callback: 'Callback',
  pitched: 'Pitched',
  sold: 'Sold',
  skip: 'Skip',
};

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'text-sky-300 bg-sky-500/15 border-sky-400/30',
  knocked: 'text-amber-300 bg-amber-500/15 border-amber-400/30',
  not_home: 'text-stone-500 bg-stone-100 border-stone-300',
  callback: 'text-violet-300 bg-violet-500/15 border-violet-400/30',
  pitched: 'text-orange-300 bg-orange-500/15 border-orange-400/30',
  sold: 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30',
  skip: 'text-stone-400 bg-stone-100 border-stone-300',
};

const PAGE_SIZE = 20;

// ── Score pill ───────────────────────────────────────────────

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-stone-400">--</span>;
  const color =
    score >= 80
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
      : score >= 60
        ? 'bg-orange-500/20 text-orange-300 border-orange-400/30'
        : score >= 40
          ? 'bg-amber-500/20 text-amber-300 border-amber-400/30'
          : 'bg-stone-100 text-stone-500 border-stone-300';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      {score}
    </span>
  );
}

// ── Lead card ────────────────────────────────────────────────

interface LeadCardProps {
  lead: PropertyAnalysis;
  onViewAnalysis?: (address: string) => void;
  onToggleStar: (id: string) => void;
  onStatusChange: (id: string, status: LeadStatus) => void;
  onNotesChange: (id: string, notes: string) => void;
}

function LeadCard({
  lead,
  onViewAnalysis,
  onToggleStar,
  onStatusChange,
  onNotesChange,
}: LeadCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [localNotes, setLocalNotes] = useState(lead.repNotes ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if the parent updates
  useEffect(() => {
    setLocalNotes(lead.repNotes ?? '');
  }, [lead.repNotes]);

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onNotesChange(lead.id, value);
    }, 600);
  };

  const displayAddress = lead.normalizedAddress ?? lead.inputAddress;

  return (
    <article className="bg-white border border-stone-200 rounded-2xl shadow-sm p-4 sm:p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-stone-900 text-sm leading-snug truncate" title={displayAddress}>
            {displayAddress}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <ScorePill score={lead.prospectScore} />
            {lead.isHighPriority && (
              <span className="inline-flex items-center rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">
                High Priority
              </span>
            )}
          </div>
        </div>

        {/* Star toggle */}
        <button
          onClick={() => onToggleStar(lead.id)}
          aria-label={lead.starred ? 'Unstar lead' : 'Star lead'}
          className={`shrink-0 rounded-lg p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors ${
            lead.starred
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-stone-400 hover:text-stone-600'
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill={lead.starred ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={lead.starred ? '0' : '1.5'}
            className="w-5 h-5"
            aria-hidden="true"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      </div>

      {/* Property details grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <dt className="text-stone-400 uppercase tracking-wide text-[10px]">Roof</dt>
          <dd className="text-stone-600 font-medium capitalize">
            {lead.roofType ? lead.roofType.replace(/_/g, ' ') : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-stone-400 uppercase tracking-wide text-[10px]">Roof Cond.</dt>
          <dd className="text-stone-600 font-medium capitalize">{lead.roofCondition ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-stone-400 uppercase tracking-wide text-[10px]">Siding</dt>
          <dd className="text-stone-600 font-medium capitalize">
            {lead.sidingType ? lead.sidingType.replace(/_/g, ' ') : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-stone-400 uppercase tracking-wide text-[10px]">Siding Cond.</dt>
          <dd className="text-stone-600 font-medium capitalize">{lead.sidingCondition ?? '—'}</dd>
        </div>
      </dl>

      {/* Status selector */}
      <div className="flex items-center gap-2">
        <label
          htmlFor={`status-${lead.id}`}
          className="text-[10px] uppercase tracking-wide text-stone-400 shrink-0"
        >
          Status
        </label>
        <select
          id={`status-${lead.id}`}
          value={lead.leadStatus}
          onChange={(e) => onStatusChange(lead.id, e.target.value as LeadStatus)}
          className={`flex-1 rounded-lg border px-2 py-1 text-xs font-medium bg-stone-50 min-h-[44px] focus:outline-none focus:ring-1 focus:ring-stone-400 ${STATUS_COLORS[lead.leadStatus]}`}
        >
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-stone-50 text-stone-700">
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Notes toggle */}
      <div>
        <button
          onClick={() => setNotesOpen((o) => !o)}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors"
          aria-expanded={notesOpen}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`w-3.5 h-3.5 transition-transform ${notesOpen ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L9.19 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
          {notesOpen ? 'Hide notes' : localNotes ? 'Show notes' : 'Add notes'}
        </button>

        {notesOpen && (
          <textarea
            value={localNotes}
            onChange={(e) => handleNotesChange(e.target.value)}
            rows={3}
            placeholder="Rep notes..."
            className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-xs text-stone-600 placeholder-stone-400 resize-none focus:outline-none focus:ring-1 focus:ring-stone-400"
            aria-label="Rep notes"
          />
        )}
      </div>

      {/* View Details */}
      <button
        onClick={() => onViewAnalysis?.(lead.normalizedAddress ?? lead.inputAddress)}
        className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-100 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 focus:outline-none focus:ring-1 focus:ring-stone-400"
      >
        View Details
      </button>
    </article>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function AiLeadsPage({ onViewAnalysis }: AiLeadsPageProps) {
  const [leads, setLeads] = useState<PropertyAnalysis[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | ''>('');

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: AiLeadsParams = {
        starred: activeTab === 'starred' ? true : undefined,
        highPriority: activeTab === 'high_priority' ? true : undefined,
        status: statusFilter || undefined,
        page,
        limit: PAGE_SIZE,
      };
      const result = await getAiLeads(params);
      setLeads(result.results);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
    } catch {
      setError('Failed to load leads. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, statusFilter, page]);

  useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [activeTab, statusFilter]);

  // Optimistic star toggle
  const handleToggleStar = useCallback(
    async (id: string) => {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, starred: !l.starred } : l)),
      );
      await toggleStar(id);
    },
    [],
  );

  // Optimistic status change
  const handleStatusChange = useCallback(
    async (id: string, status: LeadStatus) => {
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, leadStatus: status } : l)),
      );
      await updateLeadStatus(id, status);
    },
    [],
  );

  // Notes — debounced inside card, just call API here
  const handleNotesChange = useCallback(
    async (id: string, notes: string) => {
      await updateLeadNotes(id, notes);
    },
    [],
  );

  const TABS: Array<{ id: FilterTab; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'starred', label: 'Starred' },
    { id: 'high_priority', label: 'High Priority' },
  ];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 min-h-0">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-stone-900">AI Leads</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          {loading ? 'Loading...' : `${total} propert${total === 1 ? 'y' : 'ies'} analyzed`}
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Tab pills */}
        <div
          role="tablist"
          aria-label="Lead filters"
          className="flex items-center rounded-xl bg-stone-50 border border-stone-200 p-1 gap-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-stone-400 ${
                activeTab === tab.id
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Status dropdown */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LeadStatus | '')}
          aria-label="Filter by lead status"
          className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400"
        >
          <option value="">All Statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-stone-50">
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading leads">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-stone-200 rounded-2xl p-5 h-52 animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && leads.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-full bg-stone-100 p-5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.2}
              stroke="currentColor"
              className="w-10 h-10 text-stone-400"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25m19.5 0v-7.5A2.25 2.25 0 0 0 18 4.5h-5.25m0 11.25V4.5m0 11.25H9m6 0H9m6 0a2.25 2.25 0 0 1 2.25 2.25v.75M9 15.75V15A2.25 2.25 0 0 0 6.75 12.75H4.5"
              />
            </svg>
          </div>
          <p className="text-stone-600 font-medium">No AI analyses yet.</p>
          <p className="text-stone-400 text-sm mt-1">Run your first property scan.</p>
        </div>
      )}

      {/* Lead grid */}
      {!loading && !error && leads.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {leads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onViewAnalysis={onViewAnalysis}
              onToggleStar={handleToggleStar}
              onStatusChange={handleStatusChange}
              onNotesChange={handleNotesChange}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <nav
          aria-label="Lead pagination"
          className="flex items-center justify-center gap-3 pt-2"
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-stone-400 min-h-[44px] min-w-[44px]"
          >
            Previous
          </button>
          <span className="text-xs text-stone-500">
            Page <span className="font-semibold text-stone-900">{page}</span> of{' '}
            <span className="font-semibold text-stone-900">{totalPages}</span>
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-stone-400 min-h-[44px] min-w-[44px]"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
