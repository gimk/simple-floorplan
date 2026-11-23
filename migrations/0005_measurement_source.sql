-- 0005_measurement_source.sql — how each on-site value was measured.
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote
--
-- Source of one measurement (docs/walls-plan.md phase 3a):
--   'tape' | 'laser' | 'plan' | 'other'
-- The solver uses it as the weight of the value: laser 0.3 cm, tape 1 cm,
-- plan 3 cm, other 2 cm (see src/model/measureSource.ts).
--
-- The column is nullable on purpose: rows written before this migration have no
-- source, and a NULL source means 'tape' (the default).
-- Last-write-wins by updated_at does not change.

ALTER TABLE measurements ADD COLUMN source TEXT;
