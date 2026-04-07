import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  real,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enums
export const roofTypeEnum = pgEnum("roof_type", [
  "three_tab_shingle",
  "architectural_shingle",
  "designer_shingle",
  "wood_shake",
  "synthetic_shake",
  "metal_standing_seam",
  "metal_ribbed",
  "tile_clay",
  "tile_concrete",
  "slate",
  "flat_membrane",
  "unknown",
]);

export const sidingTypeEnum = pgEnum("siding_type", [
  "aluminum",
  "vinyl",
  "wood",
  "fiber_cement",
  "brick",
  "stone",
  "stucco",
  "composite",
  "unknown",
]);

export const conditionEnum = pgEnum("condition_rating", [
  "excellent",
  "good",
  "fair",
  "poor",
  "critical",
  "unknown",
]);

export const analysisStatusEnum = pgEnum("analysis_status", [
  "pending",
  "geocoding",
  "fetching_images",
  "analyzing",
  "completed",
  "failed",
]);

export const batchStatusEnum = pgEnum("batch_status", [
  "uploading",
  "processing",
  "completed",
  "failed",
]);

// Tables
export const propertyAnalyses = pgTable(
  "property_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Input
    inputAddress: text("input_address").notNull(),
    normalizedAddress: text("normalized_address"),
    lat: real("lat"),
    lng: real("lng"),
    placeId: varchar("place_id", { length: 255 }),

    // Images
    streetViewUrl: text("street_view_url"),
    satelliteUrl: text("satellite_url"),
    streetViewAvailable: boolean("street_view_available").default(true),
    streetViewDate: varchar("street_view_date", { length: 10 }), // "YYYY-MM"

    // Roof classification
    roofType: roofTypeEnum("roof_type"),
    roofCondition: conditionEnum("roof_condition"),
    roofAgeEstimate: integer("roof_age_estimate"),
    roofConfidence: real("roof_confidence"),
    roofColor: varchar("roof_color", { length: 100 }),

    // Siding classification
    isAluminumSiding: boolean("is_aluminum_siding").default(false),
    sidingType: sidingTypeEnum("siding_type"),
    sidingCondition: conditionEnum("siding_condition"),
    sidingConfidence: real("siding_confidence"),

    // Classification reasoning
    roofFeatures: jsonb("roof_features").default([]),
    sidingFeatures: jsonb("siding_features").default([]),
    reasoning: text("reasoning"),

    // Damage & scoring
    damageIndicators: jsonb("damage_indicators").default([]),
    prospectScore: integer("prospect_score"),
    isHighPriority: boolean("is_high_priority").default(false),

    // AI response
    aiRawResponse: jsonb("ai_raw_response"),
    aiModelUsed: varchar("ai_model_used", { length: 100 }),

    // Lead management
    starred: boolean("starred").default(false),
    leadStatus: varchar("lead_status", { length: 30 }).default("new"), // new, knocked, not_home, callback, pitched, sold, skip
    repNotes: text("rep_notes"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),

    // Status
    status: analysisStatusEnum("status").default("pending"),
    errorMessage: text("error_message"),
    batchJobId: uuid("batch_job_id").references(() => batchJobs.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_analyses_status").on(table.status),
    index("idx_analyses_batch_job_id").on(table.batchJobId),
    index("idx_analyses_prospect_score").on(table.prospectScore),
    index("idx_analyses_is_high_priority").on(table.isHighPriority),
    index("idx_analyses_starred").on(table.starred),
    index("idx_analyses_lead_status").on(table.leadStatus),
    index("idx_analyses_created_at").on(table.createdAt),
    uniqueIndex("idx_analyses_place_id").on(table.placeId),
  ]
);

// Stored images — the actual image bytes, not just URLs
export const propertyImages = pgTable(
  "property_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => propertyAnalyses.id, { onDelete: "cascade" }),
    imageType: varchar("image_type", { length: 30 }).notNull(), // streetview_front, streetview_right, streetview_back, streetview_left, satellite, satellite_closeup
    imageData: text("image_data").notNull(), // base64 encoded
    mimeType: varchar("mime_type", { length: 20 }).default("image/jpeg"),
    captureDate: varchar("capture_date", { length: 10 }), // YYYY-MM from Google
    lat: real("lat"),
    lng: real("lng"),
    sizeBytes: integer("size_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_images_analysis_id").on(table.analysisId),
    index("idx_images_type").on(table.imageType),
  ]
);

// Activity log — every action taken in the app
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: varchar("action", { length: 50 }).notNull(), // search, zip_scan, batch_upload, star, status_change, correction, report_view
    analysisId: uuid("analysis_id"),
    details: jsonb("details"), // action-specific data
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_activity_action").on(table.action),
    index("idx_activity_created_at").on(table.createdAt),
  ]
);

// Enrichment data cache — avoid redundant API calls for Census/FEMA/Property data
export const dataCache = pgTable(
  "data_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cacheKey: varchar("cache_key", { length: 255 }).notNull().unique(), // e.g., "census:42-101-010200" or "fema_flood:39.95:-75.17" or "property:39.9531:-75.1654"
    dataType: varchar("data_type", { length: 30 }).notNull(), // "census", "fema_flood", "fema_disaster", "property"
    data: jsonb("data").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_data_cache_key").on(table.cacheKey),
    index("idx_data_cache_type").on(table.dataType),
    index("idx_data_cache_expires").on(table.expiresAt),
  ]
);

export const batchJobs = pgTable(
  "batch_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileName: varchar("file_name", { length: 255 }),
    totalAddresses: integer("total_addresses").default(0),
    processedCount: integer("processed_count").default(0),
    successCount: integer("success_count").default(0),
    failedCount: integer("failed_count").default(0),
    status: batchStatusEnum("status").default("uploading"),
    errorMessage: text("error_message"),
    summaryStats: jsonb("summary_stats"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_batch_jobs_status").on(table.status),
    index("idx_batch_jobs_created_at").on(table.createdAt),
  ]
);
