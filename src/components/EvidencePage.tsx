import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceItem, EvidenceStatus, PropertySearchSummary, StormDate } from '../types/storm';
import EvidenceThumbnailStrip from './EvidenceThumbnailStrip';

interface EvidencePageProps {
  searchSummary: PropertySearchSummary | null;
  stormDates: StormDate[];
  evidenceItems: EvidenceItem[];
  onUploadFiles: (files: FileList, stormDate: string | null) => Promise<void>;
  onFetchProviderCandidates: () => Promise<void>;
  onSeedDemoEvidence: () => Promise<void>;
  onSeedRegionalEvidence: () => Promise<void>;
  onRemoveEvidenceItem: (itemId: string) => Promise<void>;
  onToggleEvidenceStatus: (itemId: string) => Promise<void>;
  onToggleEvidenceInReport: (itemId: string) => Promise<void>;
  onSaveAnnotatedEvidence?: (itemId: string, blob: Blob) => void;
  onOpenReports: () => void;
  onOpenMap: () => void;
  providerStatus: {
    youtube: 'live' | 'fallback';
    flickr: 'live' | 'fallback';
  };
}

type FilterStatus = 'all' | 'pending' | 'approved';
type FilterMedia = 'all' | 'image' | 'video' | 'link';
type FilterProvider = 'all' | 'upload' | 'youtube' | 'flickr';

export default function EvidencePage({
  searchSummary,
  stormDates,
  evidenceItems,
  onUploadFiles,
  onFetchProviderCandidates,
  onSeedDemoEvidence,
  onSeedRegionalEvidence,
  onRemoveEvidenceItem,
  onToggleEvidenceStatus,
  onToggleEvidenceInReport,
  onSaveAnnotatedEvidence,
  onOpenReports,
  onOpenMap,
  providerStatus,
}: EvidencePageProps) {
  const [selectedStormDate, setSelectedStormDate] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [seedingRegional, setSeedingRegional] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterMedia, setFilterMedia] = useState<FilterMedia>('all');
  const [filterProvider, setFilterProvider] = useState<FilterProvider>('all');
  const [filterDate, setFilterDate] = useState<string>('all');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Camera
  const [showCamera, setShowCamera] = useState(false);

  // Annotation
  const [annotatingItem, setAnnotatingItem] = useState<EvidenceItem | null>(null);

  useEffect(() => {
    setSelectedStormDate((current) => current || stormDates[0]?.date || '');
  }, [stormDates]);

  useEffect(() => {
    const entries = evidenceItems
      .filter((item) => Boolean(item.blob))
      .map((item) => [item.id, URL.createObjectURL(item.blob as Blob)] as const);
    const nextUrls = Object.fromEntries(entries);
    setPreviewUrls(nextUrls);
    return () => { for (const [, url] of entries) URL.revokeObjectURL(url); };
  }, [evidenceItems]);

  const propertyEvidence = useMemo(() => {
    if (!searchSummary) return evidenceItems;
    return evidenceItems.filter((item) => item.propertyLabel === searchSummary.locationLabel);
  }, [evidenceItems, searchSummary]);

  // Apply filters
  const filteredEvidence = useMemo(() => {
    return propertyEvidence.filter((item) => {
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (filterMedia !== 'all' && item.mediaType !== filterMedia) return false;
      if (filterProvider !== 'all' && item.provider !== filterProvider) return false;
      if (filterDate !== 'all') {
        if (filterDate === '__none__' && item.stormDate) return false;
        if (filterDate !== '__none__' && item.stormDate !== filterDate) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = [item.title, item.notes, item.provider, item.stormDate, item.fileName].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [propertyEvidence, filterStatus, filterMedia, filterProvider, filterDate, searchQuery]);

  const approvedForReportItems = propertyEvidence.filter(
    (item) => item.status === 'approved' && item.includeInReport,
  );
  const selectedForReportCount = approvedForReportItems.length;

  const hasActiveFilters = filterStatus !== 'all' || filterMedia !== 'all' || filterProvider !== 'all' || filterDate !== 'all' || searchQuery.trim() !== '';

  // Bulk helpers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelectedIds(new Set(filteredEvidence.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkApprove = async () => {
    for (const id of selectedIds) {
      const item = propertyEvidence.find((i) => i.id === id);
      if (item && item.status !== 'approved') await onToggleEvidenceStatus(id);
    }
    clearSelection();
  };

  const bulkInclude = async () => {
    for (const id of selectedIds) {
      const item = propertyEvidence.find((i) => i.id === id);
      if (item && item.status === 'approved' && !item.includeInReport) await onToggleEvidenceInReport(id);
    }
    clearSelection();
  };

  const bulkRemove = async () => {
    for (const id of selectedIds) await onRemoveEvidenceItem(id);
    clearSelection();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) return;
    setUploading(true);
    try {
      await onUploadFiles(event.target.files, selectedStormDate || null);
      event.target.value = '';
    } finally {
      setUploading(false);
    }
  };

  const handleFetchCandidates = async () => {
    setSeeding(true);
    try { await onFetchProviderCandidates(); } finally { setSeeding(false); }
  };

  const handleSeedDemoPack = async () => {
    setSeedingDemo(true);
    try { await onSeedDemoEvidence(); } finally { setSeedingDemo(false); }
  };

  const handleSeedRegionalPack = async () => {
    setSeedingRegional(true);
    try { await onSeedRegionalEvidence(); } finally { setSeedingRegional(false); }
  };

  const handleCameraCapture = useCallback(async (blob: Blob) => {
    setShowCamera(false);
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    await onUploadFiles(dt.files, selectedStormDate || null);
  }, [onUploadFiles, selectedStormDate]);

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.12),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_22%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="rounded-3xl border border-gray-900 bg-gray-950/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
            Evidence Workspace
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Capture, organize, and stage proof for reports
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-400">
            Upload photos, snap from camera, annotate damage, and pull public media.
            Approved evidence flows directly into PDF reports and evidence packs.
          </p>
        </div>

        {!searchSummary ? (
          <div className="rounded-3xl border border-dashed border-gray-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">No property is loaded yet</p>
            <p className="mt-2 text-sm text-gray-500">
              Open the Map page, search an address, then come back here to attach evidence.
            </p>
            <button type="button" onClick={onOpenMap} className="mt-5 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100">
              Go to Map
            </button>
          </div>
        ) : (
          <>
            {/* Upload + seeding controls */}
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Current Property</p>
                <h3 className="mt-2 text-xl font-semibold text-white">{searchSummary.locationLabel}</h3>

                <div className="mt-5 rounded-2xl border border-gray-900 bg-black/35 p-4">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Attach to Storm Date</label>
                  <select value={selectedStormDate} onChange={(e) => setSelectedStormDate(e.target.value)} className="mt-2 w-full rounded-2xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400">
                    <option value="">No specific date</option>
                    {stormDates.map((sd) => <option key={sd.date} value={sd.date}>{sd.label}</option>)}
                  </select>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-900/70 px-4 py-5 text-center hover:border-amber-400/60">
                      <span className="text-sm font-semibold text-white">{uploading ? 'Saving...' : 'Upload Files'}</span>
                      <span className="mt-1 text-[10px] text-gray-500">JPEG, PNG, HEIC, MP4, MOV</span>
                      <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={handleFileChange} />
                    </label>
                    <button type="button" onClick={() => setShowCamera(true)} className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-900/70 px-4 py-5 text-center hover:border-orange-400/60">
                      <CameraIcon />
                      <span className="mt-2 text-sm font-semibold text-white">Take Photo</span>
                      <span className="mt-1 text-[10px] text-gray-500">Use device camera</span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 grid-cols-1 sm:grid-cols-3">
                  <button type="button" onClick={handleSeedDemoPack} disabled={seedingDemo} className="rounded-2xl bg-amber-400 px-3 py-2.5 text-xs font-semibold text-gray-950 hover:bg-amber-300 disabled:bg-gray-800 disabled:text-gray-500">
                    {seedingDemo ? 'Seeding...' : 'Demo Pack'}
                  </button>
                  <button type="button" onClick={handleSeedRegionalPack} disabled={seedingRegional} className="rounded-2xl bg-violet-400 px-3 py-2.5 text-xs font-semibold text-gray-950 hover:bg-violet-300 disabled:bg-gray-800 disabled:text-gray-500">
                    {seedingRegional ? 'Seeding...' : 'Regional Samples'}
                  </button>
                  <button type="button" onClick={handleFetchCandidates} disabled={seeding} className="rounded-2xl bg-gray-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-800 disabled:text-gray-500">
                    {seeding ? 'Fetching...' : 'Fetch Candidates'}
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-gray-600">YouTube: {providerStatus.youtube} · Flickr: {providerStatus.flickr}</p>
              </section>

              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Ready for Reports</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">Approved evidence queue</h3>
                  </div>
                  <button type="button" onClick={onOpenReports} className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100">Open Reports</button>
                </div>
                <div className="mt-4 grid gap-2 grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Uploads" value={String(propertyEvidence.filter((i) => i.kind === 'upload').length)} />
                  <SummaryCard label="Candidates" value={String(propertyEvidence.filter((i) => i.kind === 'provider-query').length)} />
                  <SummaryCard label="Approved" value={String(propertyEvidence.filter((i) => i.status === 'approved').length)} />
                  <SummaryCard label="For PDF" value={String(selectedForReportCount)} />
                </div>
                <div className="mt-4">
                  <EvidenceThumbnailStrip items={approvedForReportItems} title="Best Report Evidence" subtitle="Top proof currently selected for the next PDF or evidence pack." emptyLabel="Approve items and mark them for report inclusion." onOpenEvidence={undefined} prioritizeIncluded />
                </div>
              </section>
            </div>

            {/* Filter bar */}
            <div className="rounded-[24px] border border-gray-900 bg-gray-950/80 p-3 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search evidence..." className="w-full sm:min-w-[160px] sm:flex-1 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-amber-400/40 focus:outline-none" />
                <div className="grid grid-cols-2 gap-2 sm:contents">
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FilterStatus)} className="rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 focus:outline-none">
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                </select>
                <select value={filterMedia} onChange={(e) => setFilterMedia(e.target.value as FilterMedia)} className="rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 focus:outline-none">
                  <option value="all">All Media</option>
                  <option value="image">Images</option>
                  <option value="video">Videos</option>
                  <option value="link">Links</option>
                </select>
                <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value as FilterProvider)} className="rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 focus:outline-none">
                  <option value="all">All Sources</option>
                  <option value="upload">Uploads</option>
                  <option value="youtube">YouTube</option>
                  <option value="flickr">Flickr</option>
                </select>
                <select value={filterDate} onChange={(e) => setFilterDate(e.target.value)} className="rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 focus:outline-none">
                  <option value="all">All Dates</option>
                  <option value="__none__">No Date</option>
                  {stormDates.map((sd) => <option key={sd.date} value={sd.date}>{sd.label}</option>)}
                </select>
                </div>
                {hasActiveFilters && (
                  <button type="button" onClick={() => { setSearchQuery(''); setFilterStatus('all'); setFilterMedia('all'); setFilterProvider('all'); setFilterDate('all'); }} className="w-full sm:w-auto rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20">Clear</button>
                )}
              </div>
              {hasActiveFilters && <p className="mt-2 text-xs text-gray-500">Showing {filteredEvidence.length} of {propertyEvidence.length} items</p>}
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="sticky top-0 z-20 rounded-[24px] border border-amber-400/30 bg-gray-950/95 p-4 shadow-lg backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-semibold text-amber-300">{selectedIds.size} selected</p>
                  {selectedIds.size < filteredEvidence.length && (
                    <button type="button" onClick={selectAllVisible} className="text-xs text-gray-400 underline hover:text-white">Select all {filteredEvidence.length}</button>
                  )}
                  <button type="button" onClick={clearSelection} className="text-xs text-gray-400 underline hover:text-white">Clear</button>
                  <span className="mx-1 h-5 border-l border-gray-700" />
                  <button type="button" onClick={() => void bulkApprove()} className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-bold text-violet-300 hover:bg-violet-500/25">Approve All</button>
                  <button type="button" onClick={() => void bulkInclude()} className="rounded-lg border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25">Include in Report</button>
                  <button type="button" onClick={() => void bulkRemove()} className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/20">Remove</button>
                </div>
              </div>
            )}

            {/* Evidence grid - unified view */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredEvidence.map((item) => (
                <EvidenceCard
                  key={item.id}
                  item={item}
                  previewUrl={previewUrls[item.id]}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onToggleStatus={() => void onToggleEvidenceStatus(item.id)}
                  onToggleInReport={() => void onToggleEvidenceInReport(item.id)}
                  onRemove={() => void onRemoveEvidenceItem(item.id)}
                  onAnnotate={item.kind === 'upload' && item.mediaType === 'image' ? () => setAnnotatingItem(item) : undefined}
                />
              ))}
            </div>

            {filteredEvidence.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-800 bg-black/30 p-8 text-center text-sm text-gray-500">
                {hasActiveFilters ? `No evidence matches your filters. ${propertyEvidence.length} items total.` : 'No evidence yet. Upload photos, take a snapshot, or fetch public candidates above.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Camera modal */}
      {showCamera && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Annotation modal */}
      {annotatingItem && previewUrls[annotatingItem.id] && (
        <AnnotationCanvas
          imageUrl={previewUrls[annotatingItem.id]}
          onSave={(blob) => {
            onSaveAnnotatedEvidence?.(annotatingItem.id, blob);
            setAnnotatingItem(null);
          }}
          onClose={() => setAnnotatingItem(null)}
        />
      )}
    </section>
  );
}

// ── Evidence Card ──────────────────────────────────────────

function EvidenceCard({
  item,
  previewUrl,
  isSelected,
  onToggleSelect,
  onToggleStatus,
  onToggleInReport,
  onRemove,
  onAnnotate,
}: {
  item: EvidenceItem;
  previewUrl?: string;
  isSelected: boolean;
  onToggleSelect: () => void;
  onToggleStatus: () => void;
  onToggleInReport: () => void;
  onRemove: () => void;
  onAnnotate?: () => void;
}) {
  const hasPreview = (item.mediaType === 'image' || item.mediaType === 'video') && (previewUrl || item.thumbnailUrl);

  return (
    <article className={`overflow-hidden rounded-3xl border transition-colors ${isSelected ? 'border-amber-400/40 bg-amber-500/[0.04]' : 'border-gray-900 bg-black/35'}`}>
      {/* Selection checkbox */}
      <div className="relative">
        <button
          type="button"
          onClick={onToggleSelect}
          className={`absolute left-3 top-3 z-10 flex h-5 w-5 items-center justify-center rounded border transition-colors ${isSelected ? 'border-amber-400 bg-amber-500 text-white' : 'border-gray-600 bg-gray-900/80 text-transparent hover:border-gray-400'}`}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        </button>

        {/* Preview */}
        <div className="aspect-[4/3] bg-gray-900">
          {item.mediaType === 'image' && (previewUrl || item.thumbnailUrl) && (
            <img src={previewUrl || item.thumbnailUrl || ''} alt={item.title} className="h-full w-full object-cover" />
          )}
          {item.mediaType === 'video' && previewUrl && (
            <video src={previewUrl} controls className="h-full w-full object-cover" />
          )}
          {item.mediaType === 'video' && !previewUrl && item.thumbnailUrl && (
            <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" />
          )}
          {!hasPreview && (
            <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-gray-950 text-gray-600">
              <span className="text-3xl">{item.mediaType === 'link' ? '🔗' : '📄'}</span>
              <span className="mt-2 text-xs">{item.provider.toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* Status badge overlay */}
        <div className="absolute right-3 top-3">
          <StatusPill status={item.status} />
        </div>
        {item.includeInReport && (
          <div className="absolute bottom-3 right-3 rounded-full bg-violet-500/80 px-2 py-0.5 text-[9px] font-bold text-white">
            IN REPORT
          </div>
        )}
      </div>

      <div className="p-4">
        <p className="truncate text-sm font-semibold text-white">{item.title}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full border border-gray-800 bg-gray-950 px-2 py-0.5 text-gray-400">{item.provider.toUpperCase()}</span>
          <span className="rounded-full border border-gray-800 bg-gray-950 px-2 py-0.5 text-gray-400">{item.mediaType}</span>
          <span className="rounded-full border border-gray-800 bg-gray-950 px-2 py-0.5 text-gray-400">{item.stormDate || 'No date'}</span>
          {item.sizeBytes ? <span className="rounded-full border border-gray-800 bg-gray-950 px-2 py-0.5 text-gray-400">{formatBytes(item.sizeBytes)}</span> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" onClick={onToggleStatus} className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-gray-800">
            {item.status === 'approved' ? 'Pending' : 'Approve'}
          </button>
          {item.status === 'approved' && (
            <button type="button" onClick={onToggleInReport} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${item.includeInReport ? 'bg-violet-500/15 text-violet-300' : 'border border-gray-800 text-gray-400 hover:text-violet-300'}`}>
              {item.includeInReport ? '- Report' : '+ Report'}
            </button>
          )}
          {onAnnotate && (
            <button type="button" onClick={onAnnotate} className="rounded-lg border border-gray-800 px-2.5 py-1.5 text-[10px] font-semibold text-gray-400 hover:border-amber-400/30 hover:text-amber-300">
              Annotate
            </button>
          )}
          {item.externalUrl && (
            <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-semibold text-gray-950 hover:bg-gray-100">
              Source
            </a>
          )}
          <button type="button" onClick={onRemove} className="rounded-lg border border-gray-800 px-2.5 py-1.5 text-[10px] font-semibold text-gray-400 hover:border-red-400/30 hover:text-red-300">
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Camera Capture ─────────────────────────────────────────

function CameraCapture({ onCapture, onClose }: { onCapture: (blob: Blob) => Promise<void>; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
      })
      .catch(() => setError('Camera access denied or unavailable.'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleSnap = async () => {
    if (!videoRef.current) return;
    setCapturing(true);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      if (blob) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        await onCapture(blob);
      }
      setCapturing(false);
    }, 'image/jpeg', 0.9);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-3xl border border-gray-800 bg-gray-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-white">Camera Capture</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>
        {error ? (
          <p className="text-sm text-red-400 p-8 text-center">{error}</p>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-2xl bg-black aspect-video object-cover" />
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => void handleSnap()}
                disabled={capturing}
                className="h-16 w-16 rounded-full border-4 border-white bg-red-500 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Annotation Canvas ──────────────────────────────────────

function AnnotationCanvas({ imageUrl, onSave, onClose }: { imageUrl: string; onSave: (blob: Blob) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'arrow' | 'circle' | 'text' | 'freehand'>('freehand');
  const [color, setColor] = useState('#ff4444');
  const [isDrawing, setIsDrawing] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPos, setTextPos] = useState<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const pathRef = useRef<{ x: number; y: number }[]>([]);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getPos(e);
    if (tool === 'text') {
      setTextPos(pos);
      return;
    }
    setIsDrawing(true);
    startRef.current = pos;
    pathRef.current = [pos];
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const pos = getPos(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    if (tool === 'freehand') {
      pathRef.current.push(pos);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, canvasRef.current!.width / 200);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const prev = pathRef.current[pathRef.current.length - 2];
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !startRef.current) return;
    const end = getPos(e);
    const start = startRef.current;
    const lw = Math.max(3, canvasRef.current!.width / 200);

    if (tool === 'arrow') {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Arrowhead
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = lw * 6;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (tool === 'circle') {
      const rx = Math.abs(end.x - start.x) / 2;
      const ry = Math.abs(end.y - start.y) / 2;
      const cx = (start.x + end.x) / 2;
      const cy = (start.y + end.y) / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Bake into image for undo-less flow
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = dataUrl;
  };

  const handleTextSubmit = () => {
    if (!textPos || !textInput.trim()) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const fontSize = Math.max(20, canvasRef.current!.width / 30);
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeText(textInput, textPos.x, textPos.y);
    ctx.fillText(textInput, textPos.x, textPos.y);
    // Bake
    const dataUrl = canvasRef.current!.toDataURL('image/png');
    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = dataUrl;
    setTextInput('');
    setTextPos(null);
  };

  const handleSave = () => {
    canvasRef.current?.toBlob((blob) => { if (blob) onSave(blob); }, 'image/jpeg', 0.92);
  };

  const handleReset = () => {
    const orig = new Image();
    orig.onload = () => {
      imgRef.current = orig;
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) ctx.drawImage(orig, 0, 0);
    };
    orig.src = imageUrl;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex max-h-[95vh] w-full max-w-4xl flex-col rounded-3xl border border-gray-800 bg-gray-950 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">Annotate Evidence</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white text-xl">&times;</button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-2 sm:mb-3">
          {(['freehand', 'arrow', 'circle', 'text'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTool(t)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tool === t ? 'bg-amber-500 text-gray-950' : 'bg-gray-900 text-gray-300 hover:bg-gray-800'}`}>
              {t === 'freehand' ? 'Draw' : t === 'arrow' ? 'Arrow' : t === 'circle' ? 'Circle' : 'Text'}
            </button>
          ))}
          <span className="mx-1 h-5 border-l border-gray-700" />
          {['#ff4444', '#ffaa00', '#44ff44', '#4488ff', '#ffffff'].map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-white' : 'border-gray-700'}`} style={{ backgroundColor: c }} />
          ))}
          <span className="mx-1 h-5 border-l border-gray-700" />
          <button type="button" onClick={handleReset} className="rounded-lg border border-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:text-white">Reset</button>
          <button type="button" onClick={handleSave} className="rounded-lg bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-1.5 text-xs font-semibold text-white">Save</button>
        </div>

        {/* Text input */}
        {textPos && (
          <div className="flex items-center gap-2 mb-3">
            <input value={textInput} onChange={(e) => setTextInput(e.target.value)} placeholder="Type annotation text..." autoFocus className="flex-1 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none" onKeyDown={(e) => { if (e.key === 'Enter') handleTextSubmit(); }} />
            <button type="button" onClick={handleTextSubmit} className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-gray-950">Place</button>
            <button type="button" onClick={() => setTextPos(null)} className="rounded-xl border border-gray-800 px-3 py-2 text-xs font-semibold text-gray-400">Cancel</button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <canvas
            ref={canvasRef}
            className="w-full cursor-crosshair rounded-2xl"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; handleMouseDown({ clientX: t.clientX, clientY: t.clientY, stopPropagation: () => {}, preventDefault: () => {} } as unknown as React.MouseEvent<HTMLCanvasElement>); }}
            onTouchMove={(e) => { e.preventDefault(); const t = e.touches[0]; handleMouseMove({ clientX: t.clientX, clientY: t.clientY } as unknown as React.MouseEvent<HTMLCanvasElement>); }}
            onTouchEnd={(e) => { e.preventDefault(); const t = e.changedTouches[0]; handleMouseUp({ clientX: t.clientX, clientY: t.clientY } as unknown as React.MouseEvent<HTMLCanvasElement>); }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg className="h-6 w-6 text-orange-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-black/35 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: EvidenceStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${status === 'approved' ? 'bg-violet-500/80 text-white' : 'bg-amber-500/80 text-white'}`}>
      {status}
    </span>
  );
}

function formatBytes(sizeBytes: number): string {
  if (!sizeBytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
