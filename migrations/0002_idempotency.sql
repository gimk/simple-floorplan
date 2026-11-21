-- 0002_idempotency.sql — Idempotency-Key response cache for POST /api/projects/:id/commands.
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote

CREATE TABLE IF NOT EXISTS idempotency_keys (
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  status_code   INTEGER NOT NULL DEFAULT 200,
  response_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created
  ON idempotency_keys(created_at);
