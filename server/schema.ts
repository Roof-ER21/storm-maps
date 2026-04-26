import { pgTable, text, timestamp, real, boolean, jsonb, serial, integer } from 'drizzle-orm/pg-core';

export const reps = pgTable('reps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  teamCode: text('team_code').default(''),
  role: text('role').default('rep'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const properties = pgTable('properties', {
  id: text('id').primaryKey(),
  locationLabel: text('location_label').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  resultType: text('result_type').default('address'),
  radiusMiles: real('radius_miles').default(20),
  historyPreset: text('history_preset').default('1y'),
  sinceDate: text('since_date'),
  stormDateCount: real('storm_date_count').default(0),
  latestStormDate: text('latest_storm_date'),
  latestMaxHailInches: real('latest_max_hail_inches').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  propertyLabel: text('property_label').notNull(),
  stormDate: text('storm_date').notNull(),
  stormLabel: text('storm_label').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  locationLabel: text('location_label').notNull(),
  sourceEventId: text('source_event_id'),
  sourceLabel: text('source_label').default(''),
  topHailInches: real('top_hail_inches').default(0),
  reportCount: real('report_count').default(0),
  evidenceCount: real('evidence_count').default(0),
  priority: text('priority').default('Monitor'),
  status: text('status').default('queued'),
  outcome: text('outcome').default('none'),
  leadStage: text('lead_stage').default('new'),
  notes: text('notes').default(''),
  reminderAt: text('reminder_at'),
  assignedRep: text('assigned_rep').default(''),
  dealValue: real('deal_value'),
  stageHistory: jsonb('stage_history').default([]),
  homeownerName: text('homeowner_name').default(''),
  homeownerPhone: text('homeowner_phone').default(''),
  homeownerEmail: text('homeowner_email').default(''),
  aiAnalysisId: text('ai_analysis_id'), // links to property_analyses.id
  aiProspectScore: real('ai_prospect_score'), // cached from property_analyses for sorting
  aiRoofType: text('ai_roof_type'), // cached for display without join
  aiRoofCondition: text('ai_roof_condition'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  visitedAt: timestamp('visited_at'),
  completedAt: timestamp('completed_at'),
});

export const evidence = pgTable('evidence', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  provider: text('provider').notNull(),
  mediaType: text('media_type').notNull(),
  propertyLabel: text('property_label').notNull(),
  stormDate: text('storm_date'),
  title: text('title').notNull(),
  notes: text('notes'),
  externalUrl: text('external_url'),
  thumbnailUrl: text('thumbnail_url'),
  publishedAt: text('published_at'),
  fileName: text('file_name'),
  mimeType: text('mime_type'),
  sizeBytes: real('size_bytes'),
  status: text('status').default('pending'),
  includeInReport: boolean('include_in_report').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const archives = pgTable('archives', {
  id: text('id').primaryKey(),
  propertyLabel: text('property_label').notNull(),
  summaryLabel: text('summary_label').notNull(),
  stops: jsonb('stops').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  archivedAt: timestamp('archived_at').defaultNow(),
});

/**
 * Storm/wind swath polygon cache.
 *
 * Keyed on (source, date, bbox_hash). Holds the GeoJSON FeatureCollection so
 * the next rep to look up the same storm + neighborhood gets it instantly.
 *
 * `source` is one of:
 *   - 'wind-archive' / 'wind-live' — wind swath collections built in-repo
 *   - 'mrms-hail' — hail vector polygons (when proxied/cached locally)
 *   - 'mrms-now' — live now-cast hail polygons
 *
 * `expires_at` is set per-source by the cache wrapper:
 *   - "today" entries: 5 minutes (live)
 *   - "yesterday" entries: 1 hour
 *   - older archive entries: 30 days
 *
 * The (source, date, bbox_hash) tuple is unique. Cleanup of expired rows is
 * lazy — we just check expires_at on read.
 */
export const swathCache = pgTable('swath_cache', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(),
  date: text('date').notNull(),
  bboxHash: text('bbox_hash').notNull(),
  bboxNorth: real('bbox_north').notNull(),
  bboxSouth: real('bbox_south').notNull(),
  bboxEast: real('bbox_east').notNull(),
  bboxWest: real('bbox_west').notNull(),
  /** Free-form metadata (storm peak, source mix, sub-source URL list). */
  metadata: jsonb('metadata').default({}),
  /** GeoJSON FeatureCollection (or any source-shaped payload). */
  payload: jsonb('payload').notNull(),
  featureCount: integer('feature_count').default(0),
  /** Peak observed value (max hail inches or max wind mph). */
  maxValue: real('max_value').default(0),
  generatedAt: timestamp('generated_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

/**
 * Storm-event cache for property-search results. Keyed on
 * (lat_q, lng_q, radius_miles, months, since_date) where lat_q/lng_q are
 * quantized to ~½ mile so two reps querying the same neighborhood share
 * cache entries.
 */
export const eventCache = pgTable('event_cache', {
  id: serial('id').primaryKey(),
  cacheKey: text('cache_key').notNull().unique(),
  latQ: real('lat_q').notNull(),
  lngQ: real('lng_q').notNull(),
  radiusMiles: real('radius_miles').notNull(),
  months: integer('months').notNull(),
  sinceDate: text('since_date'),
  payload: jsonb('payload').notNull(),
  eventCount: integer('event_count').default(0),
  generatedAt: timestamp('generated_at').defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

/**
 * Web push notification subscriptions.
 *
 * One row per browser/device that has hit "Enable storm alerts". The
 * (endpoint) is unique per browser per VAPID key — we upsert on it so a
 * single device can move between rep accounts without leaving stale rows.
 *
 * `territory_states` is the rep's focus list (e.g. `['VA','MD','PA']`); the
 * fan-out worker filters NWS warnings by intersection with this column.
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  repId: text('rep_id'),
  territoryStates: jsonb('territory_states').default([]),
  /** Last UA + label so the rep can identify devices in their settings. */
  userAgent: text('user_agent'),
  label: text('label'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  /** Cleared after a 410 from the push service so we stop re-pushing. */
  invalidatedAt: timestamp('invalidated_at'),
  /** Bookkeeping for the fan-out worker so it doesn't double-push the same alert. */
  lastPushedAt: timestamp('last_pushed_at'),
  lastAlertId: text('last_alert_id'),
});

export const shareableReports = pgTable('shareable_reports', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  stormDate: text('storm_date').notNull(),
  stormLabel: text('storm_label').notNull(),
  maxHailInches: real('max_hail_inches').default(0),
  maxWindMph: real('max_wind_mph').default(0),
  eventCount: real('event_count').default(0),
  repName: text('rep_name'),
  repPhone: text('rep_phone'),
  companyName: text('company_name'),
  homeownerName: text('homeowner_name'),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
});
