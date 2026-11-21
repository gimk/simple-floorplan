-- 0001_init.sql — initial schema for Simple Floorplan (D1 / SQLite).
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote

-- One row per project (apartment).
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  title      TEXT,
  updated_at TEXT NOT NULL
);

-- Full floorplan snapshots, versioned. data_json holds the PlanDoc minus
-- measurements/roomNotes (rooms, elements, background, tapes, title...).
CREATE TABLE IF NOT EXISTS floorplan_snapshots (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_json  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_floorplan_snapshots_project
  ON floorplan_snapshots(project_id, version);
CREATE INDEX IF NOT EXISTS idx_floorplan_snapshots_updated
  ON floorplan_snapshots(project_id, created_at);

-- On-site measurements, one row per survey label ("SE-2", "SE-D", "SE-H").
-- Last-write-wins by updated_at.
CREATE TABLE IF NOT EXISTS measurements (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  actual_cm  REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, label)
);
CREATE INDEX IF NOT EXISTS idx_measurements_updated
  ON measurements(project_id, updated_at);

-- Survey items (doors, windows, cupboards...) recorded on site.
-- Soft deletes: deleted=1 rows stay so other devices can sync the removal.
CREATE TABLE IF NOT EXISTS survey_items (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_json  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_survey_items_updated
  ON survey_items(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_survey_items_deleted
  ON survey_items(project_id, deleted, updated_at);

-- Free-text note per room, keyed by room code ("SE", "C1"...).
CREATE TABLE IF NOT EXISTS room_notes (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_code  TEXT NOT NULL,
  text       TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, room_code)
);
CREATE INDEX IF NOT EXISTS idx_room_notes_updated
  ON room_notes(project_id, updated_at);

-- Registry of uploaded images stored in R2.
CREATE TABLE IF NOT EXISTS images (
  key          TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_project
  ON images(project_id, created_at);
