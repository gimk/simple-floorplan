-- 0003_access.sql — scoped API tokens + append-only project event log.
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote

-- API tokens for agent access. The plaintext token (sfp_...) is shown exactly
-- once at creation; only its SHA-256 hex hash is stored here.
-- scopes is a comma-separated list: read,measure,edit,admin.
-- project_id NULL means the token can access every project.
CREATE TABLE IF NOT EXISTS api_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_project ON api_tokens(project_id);

-- Append-only audit log: one row per write route (and one per command inside a
-- commands batch). actor is the token name or 'web'.
CREATE TABLE IF NOT EXISTS project_events (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  summary      TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_events_project_ts
  ON project_events(project_id, ts);
