import { useEffect, useMemo } from 'react';
import type { EvidenceItem } from '../types/storm';

interface EvidenceThumbnailStripProps {
  items: EvidenceItem[];
  title?: string;
  subtitle?: string;
  emptyLabel?: string;
  onOpenEvidence?: () => void;
  compact?: boolean;
}

export default function EvidenceThumbnailStrip({
  items,
  title = 'Storm Evidence',
  subtitle,
  emptyLabel = 'No evidence attached to this storm date yet.',
  onOpenEvidence,
  compact = false,
}: EvidenceThumbnailStripProps) {
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

  const visibleItems = useMemo(() => items.slice(0, compact ? 3 : 5), [compact, items]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-black/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300">
            {title}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {subtitle || `${items.length} evidence item${items.length === 1 ? '' : 's'} tied to this storm.`}
          </p>
        </div>
        {onOpenEvidence && (
          <button
            type="button"
            onClick={onOpenEvidence}
            className="shrink-0 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Open Evidence
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">{emptyLabel}</p>
      ) : (
        <>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {visibleItems.map((item) => {
              const previewUrl = previewUrls[item.id] || item.thumbnailUrl || null;

              return (
                <article
                  key={item.id}
                  className={`shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75 ${
                    compact ? 'w-28' : 'w-36'
                  }`}
                >
                  <div className={`${compact ? 'h-20' : 'h-24'} bg-slate-950`}>
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
                    <p className="line-clamp-2 text-xs font-semibold text-white">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {formatMeta(item)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          {items.length > visibleItems.length && (
            <p className="mt-2 text-[11px] text-slate-500">
              +{items.length - visibleItems.length} more item
              {items.length - visibleItems.length === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
    </section>
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
