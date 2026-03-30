/**
 * API client for Hail Yes! backend.
 *
 * All mutations write to both localStorage (offline-first)
 * and the server (cloud sync). Reads prioritize localStorage
 * then hydrate from server in background.
 */

const API_BASE = '/api';

async function apiPost(path: string, body: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } catch {
    console.warn(`[api] POST ${path} failed, data saved locally only`);
    return null;
  }
}

async function apiPut(path: string, body: unknown): Promise<unknown> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } catch {
    console.warn(`[api] PUT ${path} failed, data saved locally only`);
    return null;
  }
}

async function apiDelete(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } catch {
    console.warn(`[api] DELETE ${path} failed`);
    return null;
  }
}

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json();
  } catch {
    console.warn(`[api] GET ${path} failed`);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────

export async function syncLeadsToServer(leads: unknown[]): Promise<void> {
  await apiPost('/sync/leads', leads);
}

export async function saveLead(id: string, data: unknown): Promise<void> {
  await apiPut(`/leads/${id}`, data);
}

export async function deleteLead(id: string): Promise<void> {
  await apiDelete(`/leads/${id}`);
}

export async function saveProperty(id: string, data: unknown): Promise<void> {
  await apiPut(`/properties/${id}`, data);
}

export async function saveEvidence(id: string, data: unknown): Promise<void> {
  await apiPut(`/evidence/${id}`, data);
}

export async function deleteEvidence(id: string): Promise<void> {
  await apiDelete(`/evidence/${id}`);
}

export async function saveRep(id: string, data: unknown): Promise<void> {
  await apiPut(`/reps/${id}`, data);
}

export async function createShareableReport(data: {
  address: string;
  lat: number;
  lng: number;
  stormDate: string;
  stormLabel: string;
  maxHailInches?: number;
  maxWindMph?: number;
  eventCount?: number;
  repName?: string;
  repPhone?: string;
  companyName?: string;
  homeownerName?: string;
}): Promise<{ slug: string; url: string } | null> {
  const result = await apiPost('/reports/share', data);
  return result as { slug: string; url: string } | null;
}

export async function getShareableReport(slug: string): Promise<Record<string, unknown> | null> {
  return apiGet(`/reports/${slug}`);
}

export async function seedDemoData(): Promise<boolean> {
  const result = await apiPost('/demo/seed', {});
  return result !== null;
}

// ── Billing ─────────────────────────────────────────────

function getAuthToken(): string {
  return localStorage.getItem('hail-yes:auth-token') || '';
}

export async function createCheckout(plan: 'pro' | 'company'): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  } catch {
    return null;
  }
}

export async function openBillingPortal(): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  } catch {
    return null;
  }
}

export async function getBillingStatus(): Promise<{ plan: string; hasSubscription: boolean } | null> {
  try {
    const res = await fetch(`${API_BASE}/billing/status`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function checkHealth(): Promise<boolean> {
  const result = await apiGet<{ ok: boolean }>('/health');
  return result?.ok === true;
}

// ── Hydration (server → client) ─────────────────────────

export async function fetchLeadsFromServer(): Promise<Record<string, unknown>[] | null> {
  return apiGet('/leads');
}

export async function fetchPropertiesFromServer(): Promise<Record<string, unknown>[] | null> {
  return apiGet('/properties');
}

// ── Evidence blob upload ────────────────────────────────

export async function uploadEvidenceBlob(evidenceId: string, blob: Blob, fileName: string): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append('file', blob, fileName);
    const res = await fetch(`${API_BASE}/evidence/${evidenceId}/blob`, {
      method: 'POST',
      body: formData,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getEvidenceBlobUrl(evidenceId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/evidence/${evidenceId}/blob`, { method: 'HEAD' });
    if (res.ok) return `${API_BASE}/evidence/${evidenceId}/blob`;
    return null;
  } catch {
    return null;
  }
}
