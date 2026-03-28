import { useEffect, useMemo, useState } from 'react';
import type { EvidenceItem, PropertySearchSummary, StormDate } from '../types/storm';
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
  onOpenReports: () => void;
  onOpenMap: () => void;
  providerStatus: {
    youtube: 'live' | 'fallback';
    flickr: 'live' | 'fallback';
  };
}

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

  useEffect(() => {
    setSelectedStormDate((current) => {
      if (current) {
        return current;
      }
      return stormDates[0]?.date ?? '';
    });
  }, [stormDates]);

  useEffect(() => {
    const entries = evidenceItems
      .filter((item) => Boolean(item.blob))
      .map((item) => [item.id, URL.createObjectURL(item.blob as Blob)] as const);

    const nextUrls = Object.fromEntries(entries);
    setPreviewUrls(nextUrls);

    return () => {
      for (const [, url] of entries) {
        URL.revokeObjectURL(url);
      }
    };
  }, [evidenceItems]);

  const propertyEvidence = useMemo(() => {
    if (!searchSummary) {
      return evidenceItems;
    }

    return evidenceItems.filter(
      (item) => item.propertyLabel === searchSummary.locationLabel,
    );
  }, [evidenceItems, searchSummary]);

  const uploadItems = propertyEvidence.filter((item) => item.kind === 'upload');
  const providerItems = propertyEvidence.filter(
    (item) => item.kind === 'provider-query',
  );
  const approvedForReportItems = propertyEvidence.filter(
    (item) => item.status === 'approved' && item.includeInReport,
  );
  const selectedForReportCount = propertyEvidence.filter(
    (item) => item.status === 'approved' && item.includeInReport,
  ).length;

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

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
    try {
      await onFetchProviderCandidates();
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedDemoPack = async () => {
    setSeedingDemo(true);
    try {
      await onSeedDemoEvidence();
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleSeedRegionalPack = async () => {
    setSeedingRegional(true);
    try {
      await onSeedRegionalEvidence();
    } finally {
      setSeedingRegional(false);
    }
  };

  return (
    <section className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.12),_transparent_20%),radial-gradient(circle_at_80%_0%,_rgba(124,58,237,0.16),_transparent_22%),linear-gradient(180deg,_#12071d_0%,_#090412_40%,_#04020a_100%)] px-4 py-5 lg:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="rounded-3xl border border-gray-900 bg-gray-950/80 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
            Evidence Workspace
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
            Store uploads now and stage public-media backfill on the same property
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-400">
            This first version gives you a real place to collect photo and video
            evidence by address and storm date. Reps can upload media immediately, and
            the app can stage source packs for YouTube and Flickr so backend ingestion
            can later flow into the exact same review screen.
          </p>
        </div>

        {!searchSummary ? (
          <div className="rounded-3xl border border-dashed border-gray-800 bg-black/30 p-8 text-center">
            <p className="text-lg font-semibold text-white">
              No property is loaded yet
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Open the Map page, search an address, then come back here to attach or
              stage evidence for that property.
            </p>
            <button
              type="button"
              onClick={onOpenMap}
              className="mt-5 rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100"
            >
              Go to Map
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Current Property
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  {searchSummary.locationLabel}
                </h3>
                <p className="mt-2 text-sm text-gray-400">
                  Attach first-party evidence now, then add approved media to a report
                  package later.
                </p>

                <div className="mt-5 rounded-2xl border border-gray-900 bg-black/35 p-4">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    Attach to Storm Date
                  </label>
                  <select
                    value={selectedStormDate}
                    onChange={(event) => setSelectedStormDate(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
                  >
                    <option value="">No specific date</option>
                    {stormDates.map((stormDate) => (
                      <option key={stormDate.date} value={stormDate.date}>
                        {stormDate.label}
                      </option>
                    ))}
                  </select>

                  <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 bg-gray-900/70 px-4 py-6 text-center hover:border-amber-400/60">
                    <span className="text-sm font-semibold text-white">
                      {uploading ? 'Saving files...' : 'Upload photos or videos'}
                    </span>
                    <span className="mt-1 text-xs text-gray-400">
                      JPEG, PNG, HEIC, MP4, MOV. Saved locally in the browser for this
                      first version.
                    </span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-900 bg-black/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Standalone Demo Pack
                      </p>
                      <p className="mt-2 text-sm text-gray-400">
                        Seed realistic placeholder images and one video reference for
                        this property so reps can test approval, PDF inclusion, and
                        report generation immediately.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSeedDemoPack}
                      disabled={seedingDemo}
                      className="rounded-2xl bg-amber-400 px-3 py-2 text-xs font-semibold text-gray-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
                    >
                      {seedingDemo ? 'Seeding...' : 'Seed Demo Pack'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-900 bg-black/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Real Regional Samples
                      </p>
                      <p className="mt-2 text-sm text-gray-400">
                        Seed verified public storm-related articles and viewer media
                        from actual DMV, PA, or Richmond-area hail dates when the
                        current property falls inside those regions.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSeedRegionalPack}
                      disabled={seedingRegional}
                      className="rounded-2xl bg-violet-400 px-3 py-2 text-xs font-semibold text-gray-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
                    >
                      {seedingRegional ? 'Seeding...' : 'Seed Real Samples'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-900 bg-black/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                        Public Media Candidates
                      </p>
                      <p className="mt-2 text-sm text-gray-400">
                        Pull live candidates from the backend when provider keys exist,
                        or source-pack fallbacks when they do not.
                      </p>
                      <p className="mt-2 text-xs text-gray-500">
                        YouTube: {providerStatus.youtube} · Flickr: {providerStatus.flickr}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleFetchCandidates}
                      disabled={seeding}
                      className="rounded-2xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
                    >
                      {seeding ? 'Fetching...' : 'Fetch Candidates'}
                    </button>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Ready for Reports
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-white">
                      Approved evidence queue
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenReports}
                    className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-950 hover:bg-gray-100"
                  >
                    Open Reports
                  </button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <SummaryCard label="Uploads" value={String(uploadItems.length)} />
                  <SummaryCard label="Public Candidates" value={String(providerItems.length)} />
                  <SummaryCard
                    label="Approved"
                    value={String(
                      propertyEvidence.filter((item) => item.status === 'approved').length,
                    )}
                  />
                  <SummaryCard
                    label="Selected For PDF"
                    value={String(selectedForReportCount)}
                  />
                </div>

                <div className="mt-4">
                  <EvidenceThumbnailStrip
                    items={approvedForReportItems}
                    title="Best Report Evidence"
                    subtitle="Top proof currently selected for the next PDF or evidence pack."
                    emptyLabel="Approve items and mark them for report inclusion to see the best proof here."
                    onOpenEvidence={undefined}
                    prioritizeIncluded
                  />
                </div>
              </section>
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Saved Media
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-white">
                      Uploaded evidence by property
                    </h3>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {uploadItems.map((item) => (
                    <article
                      key={item.id}
                      className="overflow-hidden rounded-3xl border border-gray-900 bg-black/35"
                    >
                      <div className="aspect-[4/3] bg-gray-900">
                        {item.mediaType === 'image' && previewUrls[item.id] && (
                          <img
                            src={previewUrls[item.id]}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        )}
                        {item.mediaType === 'video' && previewUrls[item.id] && (
                          <video
                            src={previewUrls[item.id]}
                            controls
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {item.title}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {item.stormDate || 'No storm date'} ·{' '}
                              {formatBytes(item.sizeBytes || 0)}
                            </p>
                          </div>
                          <StatusPill status={item.status} />
                        </div>
                        <div className="mt-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void onToggleEvidenceStatus(item.id)}
                            className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800"
                          >
                            {item.status === 'approved' ? 'Mark Pending' : 'Approve'}
                          </button>
                          {item.status === 'approved' && (
                            <button
                              type="button"
                              onClick={() => void onToggleEvidenceInReport(item.id)}
                              className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                                item.includeInReport
                                  ? 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25'
                                  : 'border border-gray-800 text-gray-300 hover:border-violet-500/30 hover:text-violet-300'
                              }`}
                            >
                              {item.includeInReport
                                ? 'Remove From Report'
                                : 'Include In Report'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void onRemoveEvidenceItem(item.id)}
                            className="rounded-xl border border-gray-800 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-orange-500/30 hover:text-orange-300"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {uploadItems.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-gray-800 bg-black/30 p-6 text-sm text-gray-500">
                    No uploaded evidence yet. Start by adding homeowner or rep photos
                    and videos for this property.
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-gray-900 bg-gray-950/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  Source Packs
                </p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  Public-media search starters
                </h3>
                <div className="mt-4 space-y-3">
                  {providerItems.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-gray-900 bg-black/35 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {item.provider.toUpperCase()} · {item.stormDate || 'No storm date'}
                          </p>
                          {item.status === 'approved' && (
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                              {item.includeInReport ? 'Selected for PDF' : 'Approved only'}
                            </p>
                          )}
                        </div>
                        <StatusPill status={item.status} />
                      </div>
                      {item.thumbnailUrl && (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.title}
                          className="mt-3 h-36 w-full rounded-2xl object-cover"
                        />
                      )}
                      {item.notes && (
                        <p className="mt-3 text-sm text-gray-400">{item.notes}</p>
                      )}
                      {item.publishedAt && (
                        <p className="mt-2 text-xs text-gray-500">
                          Posted {formatPublishedAt(item.publishedAt)}
                        </p>
                      )}
                      <div className="mt-4 flex gap-2">
                        {item.externalUrl && (
                          <a
                            href={item.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-gray-950 hover:bg-gray-100"
                          >
                            Open Source
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void onToggleEvidenceStatus(item.id)}
                          className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800"
                        >
                          {item.status === 'approved' ? 'Mark Pending' : 'Approve'}
                        </button>
                        {item.status === 'approved' && (
                          <button
                            type="button"
                            onClick={() => void onToggleEvidenceInReport(item.id)}
                            className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                              item.includeInReport
                                ? 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25'
                                : 'border border-gray-800 text-gray-300 hover:border-violet-500/30 hover:text-violet-300'
                            }`}
                          >
                            {item.includeInReport
                              ? 'Remove From Report'
                              : 'Include In Report'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onRemoveEvidenceItem(item.id)}
                          className="rounded-xl border border-gray-800 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-orange-500/30 hover:text-orange-300"
                        >
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                {providerItems.length === 0 && (
                  <div className="mt-4 rounded-2xl border border-dashed border-gray-800 bg-black/30 p-6 text-sm text-gray-500">
                    No public candidates yet. Fetch live candidates to pull YouTube and
                    Flickr results for the current property and latest storm dates.
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function formatPublishedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-900 bg-black/35 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: EvidenceItem['status'] }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        status === 'approved'
          ? 'bg-violet-500/15 text-violet-300'
          : 'bg-amber-500/15 text-amber-300'
      }`}
    >
      {status}
    </span>
  );
}

function formatBytes(sizeBytes: number): string {
  if (!sizeBytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = sizeBytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
