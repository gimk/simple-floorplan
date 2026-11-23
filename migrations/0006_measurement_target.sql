-- 0006_measurement_target.sql — stored target of each on-site value.
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote
--
-- Target of one value (docs/walls-plan.md phase 5c): the wall face, centre line,
-- thickness or diagonal that the value measures, as JSON:
--   {"wallId":"W12","side":"L","roomId":"r-3","from":0,"to":412,"kind":"face"}
--
-- The value stays keyed by its label (label is the primary key with project_id),
-- so the table and the sync jobs do not change.
-- The column is nullable on purpose: rows written before this migration have no
-- target (NULL = no target), and an unreadable JSON value counts as no target.
-- Last-write-wins by updated_at does not change.

ALTER TABLE measurements ADD COLUMN target_json TEXT;
