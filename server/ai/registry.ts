/**
 * Phase 6 — AI assistant tool registry.
 *
 * Declarative catalog of the tools the assistant can call. Each read tool maps
 * 1:1 to an existing `/api/intel/*` endpoint; the invoker self-fetches that
 * endpoint server-side (no new data code). Act tools map to existing mutating
 * routes (plus a few new ones) and are gated propose-then-confirm.
 *
 * Role gating is enforced HERE (registry layer) before any endpoint is hit —
 * the AI inherits the calling user's role. `is_root_admin` ⇒ admin.
 */
import type { Role } from '../auth/services.js';

export type ToolKind = 'read' | 'act';
/** Act-tool danger class drives admin smart-bypass: 'safe' acts auto-confirm
 *  under smart-bypass; 'destructive' acts always confirm. */
export type ToolDanger = 'safe' | 'destructive';

export interface ToolDef {
  name: string;
  description: string;
  kind: ToolKind;
  /** Allowed roles, or 'any'. Root admin always allowed. */
  roles: readonly Role[] | 'any';
  danger?: ToolDanger;            // act tools only
  /** JSON Schema for the params object (function-calling). */
  params: Record<string, unknown>;
  /** HTTP method + path template on this same server. `:x` and `{x}` segments
   *  are filled from params; remaining params become query (GET) or body. */
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
}

const noParams = { type: 'object', properties: {}, additionalProperties: false } as const;
function obj(props: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties: props, required, additionalProperties: false };
}
const str = { type: 'string' };
const num = { type: 'number' };

// ─── Read tools (no confirmation) ──────────────────────────────────────────
export const READ_TOOLS: ToolDef[] = [
  { name: 'search_quick', description: 'Typeahead across customers, reps, carriers, adjusters.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/quick-search', params: obj({ q: str }, ['q']) },
  { name: 'get_dashboard_kpis', description: 'Top-line revenue, close rate, jobs, pipeline.', kind: 'read', roles: ['exec', 'analytics', 'admin'], method: 'GET', path: '/api/intel/dashboard-kpis', params: noParams },
  { name: 'get_exec_summary', description: 'Board-level snapshot (top reps/zips/carriers, YoY).', kind: 'read', roles: ['exec', 'admin'], method: 'GET', path: '/api/intel/exec-summary', params: noParams },
  { name: 'get_weekly_recap', description: 'Last 7 days closures + pipeline movement.', kind: 'read', roles: ['exec', 'admin'], method: 'GET', path: '/api/intel/weekly-recap', params: noParams },
  { name: 'query_projects', description: 'Filtered job list (carrier, zip, rep, stage, type, source).', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/projects-query', params: obj({ carrier: str, zip: str, rep: str, stage: str, type: str, source: str, state: str, limit: num }) },
  { name: 'aggregate_projects', description: "Job counts + total value grouped by a dimension. NOTE: the carrier dimension is 'insurance'.", kind: 'read', roles: ['analytics', 'admin', 'exec'], method: 'GET', path: '/api/intel/projects-aggregate', params: obj({ group_by: { type: 'string', enum: ['insurance', 'zip', 'state', 'city', 'stage', 'sales_rep', 'lead_source', 'job_type'], description: "Dimension to group by — 'insurance' is the carrier." } }, ['group_by']) },
  { name: 'get_zip_stats', description: 'ZIP signed/completed/dead, revenue, recent storms.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/zip-stats', params: obj({ window: num, state: str, min_jobs: num }) },
  { name: 'get_zip_deep', description: 'One-ZIP detail with knock script.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/zip-deep', params: obj({ zip: str }, ['zip']) },
  { name: 'get_carriers_summary', description: 'Carrier list + approval rates.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/carriers-summary', params: noParams },
  { name: 'get_carrier_deep', description: 'One-carrier deep dive.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/carrier-deep', params: obj({ name: { type: 'string', description: 'Carrier name, e.g. "State Farm".' } }, ['name']) },
  { name: 'get_carrier_complaints', description: 'NAIC complaint index per carrier.', kind: 'read', roles: ['analytics', 'exec', 'admin'], method: 'GET', path: '/api/intel/carrier-complaints', params: obj({ carrier: str }) },
  { name: 'get_carrier_trade_matrix', description: 'Carrier × trade heatmap.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/carrier-trade-matrix', params: noParams },
  { name: 'get_adjusters_summary', description: 'Adjuster directory + approval rates.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/adjusters-summary', params: noParams },
  { name: 'get_adjuster_deep', description: 'Adjuster detail (carriers, reps, history).', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/adjuster-deep', params: obj({ name: { type: 'string', description: 'Adjuster full name.' } }, ['name']) },
  { name: 'get_reps_summary', description: 'Sales rep list with signed/completed/revenue.', kind: 'read', roles: ['analytics', 'exec', 'admin'], method: 'GET', path: '/api/intel/reps-summary', params: noParams },
  { name: 'get_rep_deep', description: 'Rep detail. Employees: self only.', kind: 'read', roles: ['analytics', 'exec', 'admin', 'employee'], method: 'GET', path: '/api/intel/rep-deep', params: obj({ name: { type: 'string', description: 'Sales rep full name.' } }, ['name']) },
  { name: 'get_rep_response', description: 'Rep storm-to-signed response time.', kind: 'read', roles: ['analytics', 'exec', 'admin'], method: 'GET', path: '/api/intel/rep-response', params: obj({ rep: str }) },
  { name: 'get_customers_list', description: 'All customers with summary.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/customers-list', params: noParams },
  { name: 'get_customer_deep', description: 'Single customer + full job history. Needs the customer key from search_quick or get_customers_list.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/customer-deep', params: obj({ key: { type: 'string', description: 'Customer key from search_quick / get_customers_list.' } }, ['key']) },
  { name: 'get_customer_leads', description: 'Leads tied to a customer.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/customer-leads', params: obj({ customer: str }, ['customer']) },
  { name: 'get_leads_summary', description: 'Lead funnel KPIs.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/leads-summary', params: noParams },
  { name: 'query_leads', description: 'Filtered lead list. Employees: own only.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/leads-query', params: obj({ rep: str, stage: str, source: str, limit: num }) },
  { name: 'get_lead_deep', description: 'Single lead + nearby projects.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/lead-deep', params: obj({ id: str }, ['id']) },
  { name: 'get_lead_pipeline', description: 'Rep funnel. Employees: self.', kind: 'read', roles: ['analytics', 'exec', 'admin', 'employee'], method: 'GET', path: '/api/intel/lead-pipeline', params: obj({ rep: str }, ['rep']) },
  { name: 'get_lifetime_touch_queue', description: 'Re-engagement queue per rep. Employees: own.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/lifetime-touch-query', params: obj({ rep: str }, ['rep']) },
  { name: 'get_solar_candidates', description: 'Roofs ready for solar upsell.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/solar-candidates', params: noParams },
  { name: 'get_carrier_orphans', description: 'Insurance jobs missing a carrier.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/carrier-orphans', params: noParams },
  { name: 'get_notes', description: 'Full-text search of job notes.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/notes', params: obj({ q: str }) },
  { name: 'get_active_work', description: 'Open supplements, cross-sell, install readiness.', kind: 'read', roles: ['exec', 'analytics', 'admin', 'employee'], method: 'GET', path: '/api/intel/active-work', params: noParams },
  { name: 'get_adjustments_open', description: 'Pending adjustments.', kind: 'read', roles: ['exec', 'analytics', 'admin', 'employee'], method: 'GET', path: '/api/intel/adjustments-open', params: noParams },
  { name: 'get_receivables', description: 'Open AR + downpayments.', kind: 'read', roles: ['exec', 'analytics', 'admin', 'employee'], method: 'GET', path: '/api/intel/receivables', params: noParams },
  { name: 'get_scheduling', description: 'Install scheduling intel.', kind: 'read', roles: ['exec', 'analytics', 'admin', 'employee'], method: 'GET', path: '/api/intel/scheduling', params: noParams },
  { name: 'get_pricing_margins', description: 'Underwater line items.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/pricing-margins', params: noParams },
  { name: 'get_pricing_library', description: 'Material/trade catalog.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/pricing-library', params: noParams },
  { name: 'get_pricing_templates', description: 'Quote templates.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/pricing-templates', params: noParams },
  { name: 'get_storms_light', description: 'IEM hail/wind events 2018-2026.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/storms-light', params: obj({ date: str, location: str }) },
  { name: 'get_storm_exposure', description: 'Customer storm history.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/storm-exposure', params: obj({ customer: str }) },
  { name: 'get_storm_playbook', description: 'Trade-by-trade upsell plays for a storm.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/storm-playbook', params: obj({ trade: str }) },
  { name: 'get_resurrection', description: 'Dead jobs hit by new storms.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/resurrection', params: noParams },
  { name: 'get_jobs_nearby', description: 'Geo radius job query.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/jobs-nearby', params: obj({ lat: num, lng: num, radius: num }, ['lat', 'lng']) },
  { name: 'get_map_pins', description: 'Slim location layer for maps.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/map-pins', params: obj({ state: str }) },
  { name: 'get_predictor_score', description: 'Lead score 0-100 + approval probability.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/predictor/score', params: obj({ carrier: str, zip: str, hail: num, adjuster: str }) },
  { name: 'get_pipeline_intel', description: 'Bottlenecks + pipeline DNA + automation triggers.', kind: 'read', roles: ['exec', 'analytics', 'admin'], method: 'GET', path: '/api/intel/pipeline-intel', params: noParams },
  { name: 'get_live_market_intel', description: 'Market hardening, carrier exits, rate changes.', kind: 'read', roles: ['exec', 'analytics', 'admin'], method: 'GET', path: '/api/intel/live-market-intel', params: noParams },
  { name: 'get_insurer_rankings', description: 'Composite carrier scores.', kind: 'read', roles: ['analytics', 'exec', 'admin'], method: 'GET', path: '/api/intel/insurer-rankings', params: noParams },
  { name: 'get_naic_complaint_index', description: 'NAIC complaint ratios, state-level.', kind: 'read', roles: ['analytics', 'exec', 'admin'], method: 'GET', path: '/api/intel/naic-complaint-index', params: noParams },
  { name: 'get_carrier_patents', description: 'Carrier AI patent + tactic library.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/carrier-patents', params: obj({ carrier: str }) },
  { name: 'get_carrier_boilerplate', description: 'Per-carrier denial phrase library.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/carrier-boilerplate', params: obj({ carrier: str }) },
  { name: 'get_denial_stats', description: 'Aggregated denial outcomes.', kind: 'read', roles: ['analytics', 'admin'], method: 'GET', path: '/api/intel/denial-intake/stats', params: noParams },
  { name: 'list_denials', description: 'Browse the denial archive.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/denial-intake/list', params: obj({ carrier: str, outcome: str, since: str }) },
  { name: 'get_adjuster_twin_list', description: 'Adjusters with cheat-sheet data.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/adjuster-twin/list', params: noParams },
  { name: 'get_data_freshness', description: 'Intel blob mtimes + cache status.', kind: 'read', roles: 'any', method: 'GET', path: '/api/intel/health', params: noParams },
  { name: 'get_refresh_status', description: 'Current intel refresh job state.', kind: 'read', roles: ['admin'], method: 'GET', path: '/api/intel/refresh/status', params: noParams },
];

// ─── Act tools (propose-then-confirm) ──────────────────────────────────────
export const ACT_TOOLS: ToolDef[] = [
  { name: 'create_share_link', description: 'Mint a public share slug for a list snapshot.', kind: 'act', danger: 'destructive', roles: 'any', method: 'POST', path: '/api/intel/share', params: obj({ list_type: str, snapshot_data: { type: 'object' }, title: str, description: str, expires_days: num }, ['list_type', 'snapshot_data', 'title']) },
  { name: 'revoke_share_link', description: 'Revoke a share link by slug.', kind: 'act', danger: 'destructive', roles: 'any', method: 'DELETE', path: '/api/intel/share/:slug', params: obj({ slug: str }, ['slug']) },
  { name: 'trigger_refresh', description: 'Kick off the nightly intel rebuild now (idempotent).', kind: 'act', danger: 'safe', roles: ['admin'], method: 'POST', path: '/api/intel/refresh', params: noParams },
  { name: 'analyze_denial', description: 'Gemini analysis of a denial letter → counter-letter (records intake).', kind: 'act', danger: 'safe', roles: 'any', method: 'POST', path: '/api/intel/analyze-denial', params: obj({ text: str, carrier: str, stance: str }, ['text']) },
  { name: 'transcribe_denial', description: 'OCR a PDF/image denial letter.', kind: 'act', danger: 'safe', roles: 'any', method: 'POST', path: '/api/intel/transcribe-denial', params: obj({ base64: str, format: str, mimeType: str }, ['base64', 'mimeType']) },
  { name: 'predict_adjuster', description: 'Run the Adjuster Twin prediction.', kind: 'act', danger: 'safe', roles: 'any', method: 'POST', path: '/api/intel/adjuster-twin/predict', params: obj({ adjuster: str, scope: str }, ['adjuster']) },
  { name: 'mark_denial_outcome', description: 'Log a denial appeal outcome.', kind: 'act', danger: 'destructive', roles: 'any', method: 'POST', path: '/api/intel/denial-intake/:id/outcome', params: obj({ id: str, outcome: str, outcome_date: str, counter_sent: { type: 'boolean' }, notes: str }, ['id', 'outcome']) },
  // NOTE: append_note (POST /api/intel/notes/append) deferred — needs a notes-write store (notes are read-only intel blobs today).
  { name: 'set_user_role', description: "Change a user's role.", kind: 'act', danger: 'destructive', roles: ['admin'], method: 'PATCH', path: '/api/admin/users/:id/role', params: obj({ id: str, role: str }, ['id', 'role']) },
  { name: 'webhook_score_lead', description: 'CC21 lead-scoring integration call.', kind: 'act', danger: 'safe', roles: ['admin'], method: 'POST', path: '/api/intel/predictor/webhook', params: obj({ features: { type: 'object' } }, ['features']) },
];

export const ALL_TOOLS: ToolDef[] = [...READ_TOOLS, ...ACT_TOOLS];
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

/** Can a user with `role` (and root-admin flag) call this tool? */
export function canUseTool(tool: ToolDef, role: Role, isRootAdmin: boolean): boolean {
  if (isRootAdmin) return true;
  if (tool.roles === 'any') return true;
  return tool.roles.includes(role);
}

/** Tools visible to a given role — what we expose to the model per request. */
export function toolsForRole(role: Role, isRootAdmin: boolean): ToolDef[] {
  return ALL_TOOLS.filter((t) => canUseTool(t, role, isRootAdmin));
}
