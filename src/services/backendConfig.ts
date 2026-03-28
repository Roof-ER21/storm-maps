function trimBaseUrl(value?: string): string {
  return (value || '').trim().replace(/\/+$/, '');
}

/**
 * Shared backend base for Hail Yes! features that still rely on server-side
 * processing: PDF reports, evidence candidate search, and MRMS proxy/image work.
 *
 * This keeps the frontend product-branded even while the backing service may
 * still be hosted elsewhere.
 */
const EXPLICIT_HAIL_YES_API_BASE = trimBaseUrl(
  import.meta.env.VITE_HAIL_YES_API_BASE as string | undefined,
);

export const HAIL_YES_API_BASE =
  EXPLICIT_HAIL_YES_API_BASE || 'https://sa21.up.railway.app/api';

export const HAIL_YES_HAIL_API_BASE = `${HAIL_YES_API_BASE}/hail`;
export const HAIL_YES_MRMS_API_BASE = `${HAIL_YES_API_BASE}/mrms`;

