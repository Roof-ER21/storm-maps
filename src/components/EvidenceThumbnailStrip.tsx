import { useEffect, useMemo, useState } from 'react';
import type { EvidenceItem } from '../types/storm';

interface EvidenceThumbnailStripProps {
  items: EvidenceItem[];
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
  onOpenEvidence?: () => void;
  compact?: boolean;
  prioritizeIncluded?: boolean;
}

export default function EvidenceThumbnailStrip({
  items,
  title = 'Storm Evidence',
  subtitle,
  emptyLabel = 'No evidence attached to this storm date yet.',
  onOpenEvidence,
  compact = false,
  prioritizeIncluded = false,
}: EvidenceThumbnailStripProps) {
  const [lightboxItem, setLightboxItem] = useState<EvidenceItem | null>(null);
  const previewEntries = useMemo(
    () =>
      items
        .filter((item) => Boolean(item.blob))
        .map((item) => [item.id, URL.createObjectURL(item.blob as Blob)] as const),
    [items],
  );

  useEffect(() => {
    return () => {
      for (const [, url] of previewEntries) {
        URL.revokeObjectURL(url);
      }
    };
  }, [previewEntries]);

  const previewUrls = useMemo(
    () => Object.fromEntries(previewEntries),
    [previewEntries],
  );

  const rankedItems = useMemo(
    () => [...items].sort((left, right) => rankEvidence(right, prioritizeIncluded) - rankEvidence(left, prioritizeIncluded)),
    [items, prioritizeIncluded],
  );

  const visibleItems = useMemo(
    () => rankedItems.slice(0, compact ? 3 : 5),
    [compact, rankedItems],
  );

  return (
    <>
      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300">
              {title}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {subtitle || `${items.length} evidence item${items.length === 1 ? '' : 's'} tied to this storm.`}
            </p>
          </div>
          {onOpenEvidence && (
            <button
              type="button"
              onClick={onOpenEvidence}
              className="shrink-0 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-semibold text-stone-900 transition-colors hover:bg-stone-100"
            >
              Open Evidence
            </button>
          )}
        </div>

        {items.length === 0 ? (
          onOpenEvidence ? (
            <button
              type="button"
              onClick={onOpenEvidence}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white px-3 py-3 text-xs font-semibold text-stone-600 transition-colors hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700"
            >
              <span aria-hidden="true">+</span>
              Add evidence for this storm
            </button>
          ) : (
            emptyLabel ? (
              <p className="mt-3 text-xs text-stone-400">{emptyLabel}</p>
            ) : null
          )
        ) : (
          <>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {visibleItems.map((item) => {
                const previewUrl = previewUrls[item.id] || item.thumbnailUrl || null;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLightboxItem(item)}
                    className={`shrink-0 overflow-hidden rounded-2xl border border-stone-200 bg-stone-50/75 text-left transition-colors hover:border-orange-400/50 ${
                      compact ? 'w-28' : 'w-36'
                    }`}
                  >
                    <div className={`${compact ? 'h-20' : 'h-24'} bg-stone-100`}>
                      {previewUrl ? (
                        item.mediaType === 'video' && item.blob ? (
                          <video
                            src={previewUrl}
                            className="h-full w-full object-cover"
                            muted
                            playsInline
                          />
                        ) : (
                          <img
                            src={previewUrl}
                            alt={item.title}
                            className="h-full w-full object-cover"
                          />
                        )
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,rgba(249,115,22,0.15),rgba(124,58,237,0.16))] px-3 text-center text-[11px] font-semibold text-orange-100">
                          {formatFallbackLabel(item)}
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="line-clamp-2 text-xs font-semibold text-stone-900">
                        {item.title}
                      </p>
                      <p className="mt-1 text-[11px] text-stone-500">
                        {formatMeta(item)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            {items.length > visibleItems.length && (
              <p className="mt-2 text-[11px] text-stone-400">
                +{items.length - visibleItems.length} more item
                {items.length - visibleItems.length === 1 ? '' : 's'}
              </p>
            )}
          </>
        )}
      </section>

      {lightboxItem && (
        <EvidenceLightbox
          item={lightboxItem}
          previewUrl={previewUrls[lightboxItem.id] || lightboxItem.thumbnailUrl || null}
          onClose={() => setLightboxItem(null)}
        />
      )}
    </>
  );
}

function formatMeta(item: EvidenceItem): string {
  if (item.mediaType === 'image') return `${item.provider} image`;
  if (item.mediaType === 'video') return `${item.provider} video`;
  return `${item.provider} link`;
}

function formatFallbackLabel(item: EvidenceItem): string {
  if (item.mediaType === 'video') return 'Video proof';
  if (item.mediaType === 'link') return 'Source link';
  return 'Photo proof';
}

function rankEvidence(item: EvidenceItem, prioritizeIncluded: boolean): number {
  let score = 0;

  if (prioritizeIncluded && item.includeInReport) score += 40;
  if (item.status === 'approved') score += 30;
  if (item.mediaType === 'image') score += 20;
  if (item.mediaType === 'video') score += 16;
  if (item.thumbnailUrl || item.blob) score += 12;
  if (item.provider === 'upload') score += 8;
  if (item.provider === 'youtube' || item.provider === 'flickr') score += 4;

  return score;
}

function EvidenceLightbox({
  item,
  previewUrl,
  onClose,
}: {
  item: EvidenceItem;
  previewUrl: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-[28px] border border-stone-200 bg-stone-100 p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
              Evidence Preview
            </p>
            <h3 className="mt-2 text-xl font-semibold text-stone-900">{item.title}</h3>
            <p className="mt-1 text-sm text-stone-500">
              {formatMeta(item)}{item.stormDate ? ` · ${item.stormDate}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-3xl border border-stone-200 bg-stone-50">
          {previewUrl ? (
            item.mediaType === 'video' && item.blob ? (
              <video
                src={previewUrl}
                controls
                className="max-h-[70vh] w-full object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt={item.title}
                className="max-h-[70vh] w-full object-contain"
              />
            )
          ) : (
            <div className="flex min-h-72 items-center justify-center bg-[linear-gradient(135deg,rgba(249,115,22,0.15),rgba(124,58,237,0.16))] px-6 text-center text-sm font-semibold text-orange-100">
              No image preview is available for this evidence item.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-stone-600">
          <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5">
            {item.status}
          </span>
          {item.includeInReport && (
            <span className="rounded-full border border-violet-500/30 bg-violet-500/12 px-3 py-1.5 text-violet-200">
              Included in report
            </span>
          )}
          {item.externalUrl && (
            <a
              href={item.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-orange-200"
            >
              Open Source
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
