/**
 * Hail Yes! - AI Engine API Client
 *
 * Typed fetch wrapper for all /api/ai/* endpoints.
 * Unlike the offline-first api.ts client, every function here throws
 * on non-ok responses so callers can surface errors to the user.
 *
 * Auth: JWT stored in localStorage under key `hailyes_token`.
 */

import type {
  AnalysisMode,
  AiDashboardStats,
  BatchJob,
  LeadStatus,
  PropertyAnalysis,
  PropertyImage,
} from '../types/analysis';

// ============================================================
// Internal helpers
// ============================================================

const API_BASE = '/api/ai';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('hailyes_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // ignore parse failure — use the status-based message above
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ============================================================
// Single-property analysis
// ============================================================

/**
 * POST /api/ai/analyze
 * Submit a single address for AI analysis.
 *
 * @param address  Full street address to analyze.
 * @param mode     Audience context — affects scoring weights.
 * @param force    Re-analyze even if a recent result already exists.
 */
export async function analyzeProperty(
  address: string,
  mode: AnalysisMode = 'retail',
  force = false,
): Promise<PropertyAnalysis> {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ address, mode, force }),
  });
  return handleResponse<PropertyAnalysis>(res);
}

/**
 * GET /api/ai/analyze/:id
 * Retrieve a completed (or in-progress) analysis with its stored images.
 */
export async function getAnalysis(
  id: string,
): Promise<{ analysis: PropertyAnalysis; images: PropertyImage[] }> {
  const res = await fetch(`${API_BASE}/analyze/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  return handleResponse<{ analysis: PropertyAnalysis; images: PropertyImage[] }>(res);
}

// ============================================================
// History
// ============================================================

export interface AnalysisHistoryResponse {
  results: PropertyAnalysis[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * GET /api/ai/history
 * Paginated list of all past analyses for this account.
 */
export async function getAnalysisHistory(
  page = 1,
  limit = 20,
): Promise<AnalysisHistoryResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  const res = await fetch(`${API_BASE}/history?${params.toString()}`, {
    headers: authHeaders(),
  });
  return handleResponse<AnalysisHistoryResponse>(res);
}

// ============================================================
// Zip-code scanner
// ============================================================

/**
 * POST /api/ai/zip-scan
 * Start a neighborhood-level sweep for a given zip code.
 *
 * @returns id of the created BatchJob and the number of addresses queued.
 */
export async function startZipScan(
  zipCode: string,
  mode: AnalysisMode = 'retail',
  limit = 50,
): Promise<{ id: string; addressesFound: number }> {
  const res = await fetch(`${API_BASE}/zip-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ zipCode, mode, limit }),
  });
  return handleResponse<{ id: string; addressesFound: number }>(res);
}

/**
 * GET /api/ai/zip-scan/:id
 * Poll a running zip scan for status and partial results.
 */
export async function getZipScanResults(
  id: string,
): Promise<{ job: BatchJob; results: PropertyAnalysis[]; summary: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/zip-scan/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  return handleResponse<{
    job: BatchJob;
    results: PropertyAnalysis[];
    summary: Record<string, unknown>;
  }>(res);
}

// ============================================================
// CSV batch upload
// ============================================================

/**
 * POST /api/ai/batch  (multipart/form-data)
 * Upload a CSV file of addresses for bulk analysis.
 *
 * @returns id of the created BatchJob.
 */
export async function uploadBatch(
  file: File,
  mode: AnalysisMode = 'retail',
): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('mode', mode);

  const res = await fetch(`${API_BASE}/batch`, {
    method: 'POST',
    // Do NOT set Content-Type here — the browser must set it with the correct boundary.
    headers: authHeaders(),
    body: form,
  });
  return handleResponse<{ id: string }>(res);
}

/**
 * GET /api/ai/batch/:id
 * Poll a CSV batch job for status and results.
 */
export async function getBatchResults(
  id: string,
): Promise<{ job: BatchJob; results: PropertyAnalysis[] }> {
  const res = await fetch(`${API_BASE}/batch/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  });
  return handleResponse<{ job: BatchJob; results: PropertyAnalysis[] }>(res);
}

// ============================================================
// Lead CRM actions
// ============================================================

/**
 * PATCH /api/ai/property-leads/:id/star
 * Toggle the starred flag on a lead.
 */
export async function toggleStar(id: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/property-leads/${encodeURIComponent(id)}/star`,
    {
      method: 'PATCH',
      headers: authHeaders(),
    },
  );
  await handleResponse<unknown>(res);
}

/**
 * PATCH /api/ai/property-leads/:id/status
 * Set the canvassing / sales status for a lead.
 */
export async function updateLeadStatus(id: string, status: LeadStatus): Promise<void> {
  const res = await fetch(
    `${API_BASE}/property-leads/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status }),
    },
  );
  await handleResponse<unknown>(res);
}

/**
 * PATCH /api/ai/property-leads/:id/notes
 * Persist free-text rep notes against a lead.
 */
export async function updateLeadNotes(id: string, notes: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/property-leads/${encodeURIComponent(id)}/notes`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ notes }),
    },
  );
  await handleResponse<unknown>(res);
}

// ============================================================
// Leads list
// ============================================================

export interface AiLeadsParams {
  starred?: boolean;
  status?: string;
  highPriority?: boolean;
  page?: number;
  limit?: number;
}

export interface AiLeadsResponse {
  results: PropertyAnalysis[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * GET /api/ai/property-leads
 * Filtered, paginated list of AI-analyzed leads.
 */
export async function getAiLeads(params: AiLeadsParams = {}): Promise<AiLeadsResponse> {
  const query = new URLSearchParams();
  if (params.starred !== undefined) query.set('starred', String(params.starred));
  if (params.status !== undefined) query.set('status', params.status);
  if (params.highPriority !== undefined) query.set('highPriority', String(params.highPriority));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.limit !== undefined) query.set('limit', String(params.limit));

  const qs = query.toString();
  const res = await fetch(`${API_BASE}/property-leads${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  });
  return handleResponse<AiLeadsResponse>(res);
}

// ============================================================
// Dashboard
// ============================================================

/**
 * GET /api/ai/dashboard
 * Aggregate stats, top leads, and recent activity for the AI dashboard.
 */
export async function getAiDashboard(): Promise<AiDashboardStats> {
  const res = await fetch(`${API_BASE}/dashboard`, {
    headers: authHeaders(),
  });
  return handleResponse<AiDashboardStats>(res);
}

// ============================================================
// Stored images
// ============================================================

/**
 * GET /api/ai/images/stored/:analysisId
 * Retrieve all images saved against a completed analysis.
 */
export async function getStoredImages(analysisId: string): Promise<PropertyImage[]> {
  const res = await fetch(
    `${API_BASE}/images/stored/${encodeURIComponent(analysisId)}`,
    { headers: authHeaders() },
  );
  return handleResponse<PropertyImage[]>(res);
}
