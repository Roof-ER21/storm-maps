import JSZip from 'jszip';
import type { EvidenceItem } from '../types/storm';

interface GenerateEvidencePackParams {
  address: string;
  dateOfLoss: string;
  evidenceItems: EvidenceItem[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeFilename(value: string): string {
  const sanitized = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code < 32 || '<>:"/\\|?*'.includes(character)) {
        return '_';
      }
      return character;
    })
    .join('');

  return sanitized.trim() || 'file';
}

function getExtensionFromMimeType(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }

  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/svg+xml') return 'svg';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'video/mp4') return 'mp4';
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'text/plain') return 'txt';

  return mimeType.split('/')[1] ?? null;
}

function getExtensionFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname;
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1) {
      return null;
    }
    return pathname.slice(lastDot + 1).toLowerCase();
  } catch {
    return null;
  }
}

function isFetchableAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

async function fetchAssetBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(new URL(url, window.location.origin).toString(), {
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.blob();
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

function buildReferenceText(item: EvidenceItem): string {
  return [
    `Title: ${item.title}`,
    `Storm Date: ${item.stormDate ?? 'No specific date'}`,
    `Provider: ${item.provider}`,
    `Media Type: ${item.mediaType}`,
    `Status: ${item.status}`,
    `Included In Report: ${item.includeInReport ? 'yes' : 'no'}`,
    `Published At: ${item.publishedAt ?? 'Unknown'}`,
    `URL: ${item.externalUrl ?? item.thumbnailUrl ?? 'None'}`,
    `Notes: ${item.notes ?? 'None'}`,
  ].join('\n');
}

export async function generateEvidencePack({
  address,
  dateOfLoss,
  evidenceItems,
}: GenerateEvidencePackParams): Promise<void> {
  if (evidenceItems.length === 0) {
    throw new Error('No evidence is selected for this storm date.');
  }

  const zip = new JSZip();
  const evidenceFolder = zip.folder('evidence');
  const referencesFolder = zip.folder('references');

  if (!evidenceFolder || !referencesFolder) {
    throw new Error('Failed to create evidence pack folders.');
  }

  const manifest = [];

  for (const [index, item] of evidenceItems.entries()) {
    const prefix = `${String(index + 1).padStart(2, '0')}-${sanitizeFilename(slugify(item.title) || 'evidence')}`;
    let assetFilename: string | null = null;

    if (item.blob) {
      const extension =
        getExtensionFromMimeType(item.mimeType) ||
        getExtensionFromUrl(item.fileName || '') ||
        'bin';
      assetFilename = `${prefix}.${extension}`;
      evidenceFolder.file(assetFilename, item.blob);
    } else {
      const fetchableUrl =
        item.thumbnailUrl && isFetchableAssetUrl(item.thumbnailUrl)
          ? item.thumbnailUrl
          : item.externalUrl && isFetchableAssetUrl(item.externalUrl)
            ? item.externalUrl
            : null;

      if (fetchableUrl) {
        const assetBlob = await fetchAssetBlob(fetchableUrl);
        if (assetBlob) {
          const extension =
            getExtensionFromMimeType(assetBlob.type) ||
            getExtensionFromUrl(fetchableUrl) ||
            (item.mediaType === 'video' ? 'mp4' : 'bin');
          assetFilename = `${prefix}.${extension}`;
          evidenceFolder.file(assetFilename, assetBlob);
        }
      }
    }

    referencesFolder.file(`${prefix}.txt`, buildReferenceText(item));

    manifest.push({
      id: item.id,
      title: item.title,
      stormDate: item.stormDate,
      provider: item.provider,
      mediaType: item.mediaType,
      status: item.status,
      includeInReport: item.includeInReport,
      externalUrl: item.externalUrl ?? null,
      thumbnailUrl: item.thumbnailUrl ?? null,
      publishedAt: item.publishedAt ?? null,
      notes: item.notes ?? null,
      bundledAsset: assetFilename,
    });
  }

  zip.file(
    'README.txt',
    [
      `Storm Maps Evidence Pack`,
      `Property: ${address}`,
      `Date of Loss: ${dateOfLoss}`,
      `Evidence Count: ${evidenceItems.length}`,
      '',
      `The evidence folder contains bundled local/demo files when available.`,
      `The references folder contains a text reference for every selected item.`,
    ].join('\n'),
  );

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        address,
        dateOfLoss,
        exportedAt: new Date().toISOString(),
        evidenceItems: manifest,
      },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  const safeAddress = sanitizeFilename(address.replace(/[^a-zA-Z0-9]/g, '_'));
  downloadBlob(blob, `Evidence_Pack_${safeAddress}_${dateOfLoss}.zip`);
}
