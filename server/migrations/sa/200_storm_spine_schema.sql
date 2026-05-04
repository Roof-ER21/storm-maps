-- Phase 2: Storm-archive data spine — schema migration into Hail Yes
--
-- This file recreates the storm-archive schema for tables that don't
-- exist in Hail Yes. Data import is a separate step (per-table SQL
-- dumps from sa-migration-dumps/).
--
-- Skipped tables (already in HY or Phase 1):
--   - users (extended in 100_auth_extension.sql)
--   - sessions, activity_log (created in 100)
--   - push_subscriptions (HY has its own; SA columns added separately below)
--   - properties (HY has its own SaaS-shape properties table)
--
-- Migration order respects FK dependencies: standalone lookups first,
-- then events (root), then children, then property/canvass.

-- ─────────────────────────────────────────
-- 001_init.sql — events, swaths, ground_reports, surface_obs, regions
-- ─────────────────────────────────────────
-- storm-archive · 001_init.sql
-- Foundational schema. No PostGIS dependency: geometry is GeoJSON in JSONB,
-- point-in-polygon runs in JS (matches Hail Yes pattern, proven at production scale).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- regions: territory definitions for backfill scoping
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE regions (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,        -- DMV, PA, RICHMOND, DE, NJ
  name        TEXT NOT NULL,
  states      TEXT[] NOT NULL,             -- ['VA','MD','DC']
  bbox_n      REAL NOT NULL,
  bbox_s      REAL NOT NULL,
  bbox_e      REAL NOT NULL,
  bbox_w      REAL NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO regions (code, name, states, bbox_n, bbox_s, bbox_e, bbox_w) VALUES
  ('DMV',      'DC / Maryland / Northern Virginia', ARRAY['VA','MD','DC'], 39.8, 38.0, -76.5, -78.5),
  ('PA',       'Pennsylvania',                       ARRAY['PA'],          42.3, 39.7, -74.7, -80.5),
  ('RICHMOND', 'Richmond / Tidewater VA',            ARRAY['VA'],          37.9, 36.5, -76.2, -78.0),
  ('DE',       'Delaware',                           ARRAY['DE'],          39.85,38.45,-75.05,-75.80),
  ('NJ',       'New Jersey',                         ARRAY['NJ'],          41.4, 38.9, -73.9, -75.6);

-- ─────────────────────────────────────────────────────────────────────────
-- events: canonical storm-day catalog (one row per state-date)
-- Seeded by parsing storm-evidence sheets (2,006 of them).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id                  SERIAL PRIMARY KEY,
  state               TEXT NOT NULL,        -- VA, MD, PA, DC, DE, NJ
  event_date          DATE NOT NULL,
  tier                SMALLINT NOT NULL,    -- 0=<1", 1=1-2", 2=2-3", 3=>=3"
  peak_hail_inches    REAL,                 -- e.g. 4.75
  peak_wind_mph       REAL,                 -- e.g. 81

  source_ncei         BOOLEAN NOT NULL DEFAULT false,
  source_swdi         BOOLEAN NOT NULL DEFAULT false,
  source_iem          BOOLEAN NOT NULL DEFAULT false,
  source_hailtrace    BOOLEAN NOT NULL DEFAULT false,
  source_ihm          BOOLEAN NOT NULL DEFAULT false,

  evidence_sheet_path TEXT,                 -- e.g. 'evidence-seed/VA-2023-08-07.html'
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (state, event_date)
);

CREATE INDEX events_event_date_desc_idx ON events (event_date DESC);
CREATE INDEX events_tier_idx             ON events (tier);
CREATE INDEX events_state_date_idx       ON events (state, event_date DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- event_sources: per-source records (NCEI, SWDI, IEM, Hailtrace meteo/algo, IHM)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE event_sources (
  id                SERIAL PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,          -- ncei | swdi | iem | hailtrace_meteo | hailtrace_algo | ihm
  peak_hail_inches  REAL,
  peak_wind_mph     REAL,
  record_count      INTEGER,
  description       TEXT,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (event_id, source)
);

CREATE INDEX event_sources_event_id_idx ON event_sources (event_id);

-- ─────────────────────────────────────────────────────────────────────────
-- ground_reports: federal point-grade ground reports
-- (NCEI SWDI radar locations, Hailtrace records, IEM LSR points, mPING)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE ground_reports (
  id                SERIAL PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source            TEXT NOT NULL,          -- ncei_swdi | hailtrace_meteo | hailtrace_algo | iem_lsr | mping
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  hail_size_inches  REAL,
  wind_mph          REAL,
  reported_at       TIMESTAMPTZ,
  city              TEXT,
  raw_data          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ground_reports_event_id_idx ON ground_reports (event_id);
CREATE INDEX ground_reports_lat_lng_idx  ON ground_reports (lat, lng);
CREATE INDEX ground_reports_source_idx   ON ground_reports (source);

-- ─────────────────────────────────────────────────────────────────────────
-- swaths: MRMS hail polygons + wind swaths
-- GeoJSON FeatureCollection in JSONB. Bbox columns enable fast spatial prefilter
-- before full point-in-polygon scan (which runs in JS).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE swaths (
  id                SERIAL PRIMARY KEY,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,          -- mrms_hail | wind | l2_hail
  source            TEXT NOT NULL,          -- mrms_iem | spc_lsr | iem_lsr_wind | l2_nexrad
  threshold_inches  REAL,                   -- 0.25 .. 2.5+ for hail
  threshold_mph     REAL,                   -- 50, 58, 65, 75, 90 for wind

  bbox_n            REAL NOT NULL,
  bbox_s            REAL NOT NULL,
  bbox_e            REAL NOT NULL,
  bbox_w            REAL NOT NULL,

  geojson           JSONB NOT NULL,         -- FeatureCollection
  feature_count     INTEGER NOT NULL,
  metadata          JSONB,                  -- {refTime, anchorTimestamp, decoder, ...}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (event_id, kind, source, threshold_inches, threshold_mph)
);

CREATE INDEX swaths_event_id_idx ON swaths (event_id);
CREATE INDEX swaths_kind_idx     ON swaths (kind);
CREATE INDEX swaths_bbox_idx     ON swaths (bbox_n, bbox_s, bbox_e, bbox_w);

-- ─────────────────────────────────────────────────────────────────────────
-- surface_obs: Synoptic surface-station snapshots per event
-- One row per station per event (Phase 5 backfill).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE surface_obs (
  id                    SERIAL PRIMARY KEY,
  event_id              INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  station_id            TEXT NOT NULL,
  network               TEXT,
  lat                   DOUBLE PRECISION NOT NULL,
  lng                   DOUBLE PRECISION NOT NULL,
  peak_wind_gust_mph    REAL,
  peak_1h_precip_in     REAL,
  peak_15m_precip_in    REAL,
  hail_signal           BOOLEAN NOT NULL DEFAULT false,
  hail_signal_reason    TEXT,
  raw_data              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (event_id, station_id)
);

CREATE INDEX surface_obs_event_id_idx ON surface_obs (event_id);
CREATE INDEX surface_obs_lat_lng_idx  ON surface_obs (lat, lng);

-- ─────────────────────────────────────────────────────────────────────────
-- impact_lookups: cache for /api/impact?address= queries
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE impact_lookups (
  id                    SERIAL PRIMARY KEY,
  address_normalized    TEXT NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL,
  lng                   DOUBLE PRECISION NOT NULL,
  result                JSONB NOT NULL,
  hit_count             INTEGER NOT NULL DEFAULT 1,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (address_normalized)
);

CREATE INDEX impact_lookups_lat_lng_idx ON impact_lookups (lat, lng);
CREATE INDEX impact_lookups_expires_idx ON impact_lookups (expires_at);

-- ─────────────────────────────────────────────────────────────────────────
-- updated_at trigger for events
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_set_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ─────────────────────────────────────────
-- 002_swath_unique_constraint
-- ─────────────────────────────────────────
-- storm-archive · 002_swath_unique_constraint.sql
-- Fix: NULL-in-unique-constraint behavior. Postgres treats NULL as distinct,
-- so the original constraint `(event_id, kind, source, threshold_inches, threshold_mph)`
-- doesn't dedupe MRMS hail rows where thresholds are aggregated (NULL).
-- Identity is (event_id, kind, source). Thresholds are descriptive metadata.

BEGIN;

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name FROM pg_constraint
  WHERE conrelid = 'swaths'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%threshold_inches%'
  LIMIT 1;
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE swaths DROP CONSTRAINT %I', con_name);
  END IF;
END$$;

ALTER TABLE swaths
  ADD CONSTRAINT swaths_event_kind_source_key UNIQUE (event_id, kind, source);

COMMIT;

-- ─────────────────────────────────────────
-- 003_customer_properties (FK → users)
-- ─────────────────────────────────────────
-- storm-archive · 003_customer_properties.sql
-- Per-browser saved properties. No auth required: client_id is a UUIDv4
-- generated in the browser and stored in localStorage. Each browser has
-- its own private property list. (Future: optional rep account login can
-- migrate properties via a server-side merge.)

BEGIN;

CREATE TABLE customer_properties (
  id              SERIAL PRIMARY KEY,
  client_id       TEXT NOT NULL,            -- browser-side UUIDv4
  label           TEXT NOT NULL,            -- rep-given nickname
  address         TEXT NOT NULL,            -- normalized geocoder result
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  notes           TEXT,
  monitor         BOOLEAN NOT NULL DEFAULT false,  -- include in push notifications
  hail_threshold  REAL NOT NULL DEFAULT 0.5,        -- alert when hail >= this size (in)
  alert_radius_mi REAL NOT NULL DEFAULT 2.0,        -- alert when swath edge within mi
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (client_id, label)
);

CREATE INDEX customer_properties_client_id_idx ON customer_properties (client_id) WHERE archived_at IS NULL;
CREATE INDEX customer_properties_lat_lng_idx   ON customer_properties (lat, lng) WHERE archived_at IS NULL;
CREATE INDEX customer_properties_monitor_idx   ON customer_properties (monitor) WHERE monitor AND archived_at IS NULL;

CREATE TRIGGER customer_properties_set_updated_at
  BEFORE UPDATE ON customer_properties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- ─────────────────────────────────────────
-- 004_canvas (canvass_sessions, canvass_points)
-- ─────────────────────────────────────────
-- storm-archive · 004_canvas.sql
-- GPS canvass tracker: per-session breadcrumb trails. Reps tap "start
-- canvass," walk/drive routes door-to-door, the browser records GPS
-- points and posts them in batches. Useful for: route-replay, coverage
-- maps, time-on-property analytics.

BEGIN;

CREATE TABLE canvass_sessions (
  id           SERIAL PRIMARY KEY,
  client_id    TEXT NOT NULL,
  label        TEXT,                             -- rep-given name; optional
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  archived_at  TIMESTAMPTZ,
  notes        TEXT,
  metadata     JSONB                             -- e.g. associated event_id, lead source
);

CREATE INDEX canvass_sessions_client_idx ON canvass_sessions (client_id) WHERE archived_at IS NULL;
CREATE INDEX canvass_sessions_started_idx ON canvass_sessions (started_at DESC);

CREATE TABLE canvass_points (
  id            BIGSERIAL PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES canvass_sessions(id) ON DELETE CASCADE,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  accuracy_m    REAL,
  altitude_m    REAL,
  heading_deg   REAL,
  speed_mps     REAL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX canvass_points_session_idx ON canvass_points (session_id, recorded_at);
CREATE INDEX canvass_points_recorded_idx ON canvass_points (recorded_at DESC);

COMMIT;

-- ─────────────────────────────────────────
-- 007_canvass_v2 (canvass_crossings, canvass_city_bundle)
-- ─────────────────────────────────────────
-- Canvass v2 — driving narrator. See docs/SPEC-canvass-redesign.md.
--
-- Adds:
--   - canvass_sessions.event_id  : target storm chosen at "Start Drive"
--   - canvass_sessions.started_lat/lng + ended_at : trip envelope
--   - canvass_crossings : append-only log of city/band crossings during a drive
--   - canvass_city_bundle : single-row holder for the VA/MD/PA/DC city polygon
--                           bundle (US Census TIGER/Line) shipped to the
--                           client for offline reverse-geocoding.

ALTER TABLE canvass_sessions
  ADD COLUMN IF NOT EXISTS event_id    INTEGER REFERENCES events(id),
  ADD COLUMN IF NOT EXISTS started_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS started_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ended_at    TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS canvass_sessions_event_id_idx
  ON canvass_sessions(event_id);

CREATE TABLE IF NOT EXISTS canvass_crossings (
  id            BIGSERIAL PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES canvass_sessions(id) ON DELETE CASCADE,
  crossed_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  city          TEXT,
  band_label    TEXT,
  band_size_in  DOUBLE PRECISION,
  event_id      INTEGER NOT NULL REFERENCES events(id),
  payload       JSONB,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS canvass_crossings_session_idx
  ON canvass_crossings(session_id);
CREATE INDEX IF NOT EXISTS canvass_crossings_event_idx
  ON canvass_crossings(event_id);
-- Dedupe within a session: re-entering the same (city, band, event) doesn't
-- get re-logged. Caller checks before insert; this index makes the lookup fast.
CREATE INDEX IF NOT EXISTS canvass_crossings_dedupe_idx
  ON canvass_crossings(session_id, event_id, city, band_label);

CREATE TABLE IF NOT EXISTS canvass_city_bundle (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  geojson       JSONB NOT NULL,
  source        TEXT NOT NULL,
  feature_count INTEGER NOT NULL,
  built_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- 009_pdf_reports
-- ─────────────────────────────────────────
-- Persisted PDF report metadata so the verification block on the cover
-- page is real: an adjuster gets a Report# + Verification Code printed
-- on the PDF and can paste them into /verify on the public site to
-- confirm we issued that exact report for that exact property + date.
--
-- Each row is created server-side at the moment buildAdjusterPdf is
-- called; the report_id and verification_code returned to the client
-- match the PDF's printed copy.

CREATE TABLE IF NOT EXISTS pdf_reports (
  report_id          TEXT PRIMARY KEY,
  verification_code  TEXT NOT NULL,
  event_id           INTEGER NOT NULL REFERENCES events(id),
  event_date         DATE NOT NULL,
  state              TEXT NOT NULL,
  lat                DOUBLE PRECISION NOT NULL,
  lng                DOUBLE PRECISION NOT NULL,
  address            TEXT,
  generated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  generated_by_user  INTEGER REFERENCES users(id),
  client_id          TEXT,
  payload            JSONB
);

CREATE INDEX IF NOT EXISTS pdf_reports_event_idx     ON pdf_reports(event_id);
CREATE INDEX IF NOT EXISTS pdf_reports_user_idx      ON pdf_reports(generated_by_user, generated_at DESC);
CREATE INDEX IF NOT EXISTS pdf_reports_generated_idx ON pdf_reports(generated_at DESC);

-- ─────────────────────────────────────────
-- 010_ihm_cities
-- ─────────────────────────────────────────
-- IHM city geocode cache. The evidence sheets list IHM "city-page hits" as
-- slugs (e.g. 'sterling', 'great-falls', 'washington') with no lat/lng.
-- We resolve each slug+state pair to its city centroid once via the
-- existing geocode service, then re-use that lookup forever.
--
-- 136 unique slug+state pairs across DC/MD/PA/VA in the 2,006-sheet
-- corpus. Mapbox-friendly batch.

CREATE TABLE IF NOT EXISTS ihm_cities (
  slug          TEXT NOT NULL,
  state         TEXT NOT NULL,
  display_name  TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  geocoded_at   TIMESTAMPTZ,
  geocode_failed BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (slug, state)
);

-- ─────────────────────────────────────────
-- 011_hailtrace_cache
-- ─────────────────────────────────────────
-- HailTrace bulk-extracted data, frozen for permanent local use.
--
-- Roof Docs has paid HailTrace access through ~end-of-month 2026; we
-- snapshot the per-date geoJSON + weather reports + per-property report
-- archive while we have access, then run forever on the frozen cache.
--
-- One row per event_date — HailTrace's GetWeatherEventByDate returns
-- one event aggregate per day (with geoJSON containing all polygons +
-- meteorologist-flagged points across all affected states).

CREATE TABLE IF NOT EXISTS hailtrace_event_cache (
  event_date                DATE PRIMARY KEY,
  hailtrace_event_id        TEXT,
  max_algorithm_hail_size   REAL,
  max_meteorologist_hail_size REAL,
  max_meteorologist_wind_mph REAL,
  geojson                   JSONB,           -- full FeatureCollection
  weather_reports           JSONB,           -- per-point report list
  feature_count             INTEGER,
  meteorologist_point_count INTEGER,
  algorithm_polygon_count   INTEGER,
  fetched_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetch_status              TEXT NOT NULL DEFAULT 'ok'  -- ok | empty | error
);

CREATE INDEX IF NOT EXISTS hailtrace_event_cache_fetched_at_idx
  ON hailtrace_event_cache (fetched_at DESC);

-- ─────────────────────────────────────────
-- 012_hailtrace_photos (FK → ground_reports)
-- ─────────────────────────────────────────
-- Local mirror of HailTrace meteorologist hail-damage photos.
--
-- HailTrace's CDN (ht-met-app-content-prd.hailtrace.com /
-- ht-met-app-content-legacy.hailstalker.dev) may go away after the
-- Roof Docs subscription lapses end of May 2026; this table holds a
-- copy of every JPG we reference from ground_reports.raw_data so
-- the Evidence Package + PDF keep working forever.
--
-- ~95 photos in our service territory (VA/MD/PA/DC), ~200 KB avg →
-- ~20 MB total. Backed up nightly via the existing pg_dump pipeline.

CREATE TABLE IF NOT EXISTS hailtrace_photos (
  id              SERIAL PRIMARY KEY,
  source_url      TEXT NOT NULL UNIQUE,
  content_type    TEXT NOT NULL DEFAULT 'image/jpeg',
  bytes           BYTEA NOT NULL,
  byte_length     INTEGER NOT NULL,
  ground_report_id INTEGER REFERENCES ground_reports(id) ON DELETE SET NULL,
  event_date      DATE,
  info_text       TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hailtrace_photos_source_url_idx ON hailtrace_photos(source_url);
CREATE INDEX IF NOT EXISTS hailtrace_photos_event_date_idx ON hailtrace_photos(event_date DESC);

-- ─────────────────────────────────────────
-- 013_federal_citations (pcs_catastrophes, fema_declarations)
-- ─────────────────────────────────────────
-- Federal citation sources — adjuster-grade authoritative records that
-- Verisk's claim systems and federal courts both recognize verbatim.
--
-- fema_declarations: one row per (disaster, designated county). FEMA
-- OpenFEMA API exposes these as JSON; we filter to severe-storm /
-- tornado incidents in our service territory.
--
-- pcs_catastrophes: Property Claim Services serial numbers — every
-- carrier's internal claims system uses these to tag insured-loss
-- events. Citing "PCS Cat #2424" alongside our analysis means the
-- adjuster's system can match on the same key. Manually curated
-- (Verisk publishes via press release, not API).

CREATE TABLE IF NOT EXISTS fema_declarations (
  disaster_number       INTEGER NOT NULL,
  state                 TEXT NOT NULL,
  designated_area       TEXT NOT NULL,            -- "Loudoun (County)"
  county_name           TEXT,                     -- "Loudoun" (parsed)
  declaration_date      DATE NOT NULL,
  incident_begin_date   DATE NOT NULL,
  incident_end_date     DATE,
  incident_type         TEXT NOT NULL,            -- "Severe Storm", "Tornado"
  declaration_title     TEXT NOT NULL,
  PRIMARY KEY (disaster_number, state, designated_area)
);

CREATE INDEX IF NOT EXISTS fema_declarations_dates_idx
  ON fema_declarations (state, incident_begin_date, incident_end_date);
CREATE INDEX IF NOT EXISTS fema_declarations_county_idx
  ON fema_declarations (state, county_name);

CREATE TABLE IF NOT EXISTS pcs_catastrophes (
  cat_number            TEXT PRIMARY KEY,         -- "2424", "2426"
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  affected_states       TEXT[] NOT NULL,
  description           TEXT,                     -- "April 2024 NoVA Hail Storm"
  source_url            TEXT,                     -- press release / Verisk page
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pcs_catastrophes_dates_idx
  ON pcs_catastrophes (start_date, end_date);

-- ─────────────────────────────────────────
-- 014_county_lookups
-- ─────────────────────────────────────────
-- Persistent cache of property→county reverse-geocode results.
-- The FCC Census Block API is fast (~150ms) and free, but at burst rep
-- traffic, repeating it for the same neighborhood is wasteful and risks
-- rate-limiting. Cache by lat/lng quantized to 0.01° (~0.7mi) so all
-- properties in the same census-block-ish area share a row.

CREATE TABLE IF NOT EXISTS county_lookups (
  lat_q           NUMERIC(6,2) NOT NULL,
  lng_q           NUMERIC(6,2) NOT NULL,
  state_code      TEXT,
  county_fips     TEXT,
  county_name     TEXT,
  block_fips      TEXT,
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (lat_q, lng_q)
);

CREATE INDEX IF NOT EXISTS county_lookups_county_idx ON county_lookups(state_code, county_name);
