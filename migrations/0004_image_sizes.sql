-- 0004_image_sizes.sql — byte size per uploaded image, for the R2 cost caps.
-- Apply locally:  npm run db:migrate:local
-- Apply remote:   wrangler d1 migrations apply simple-floorplan --remote
--
-- The upload route (POST /api/projects/:id/images) stores the size of every file
-- in size_bytes. The caps in wrangler.toml [vars] compare SUM(size_bytes) with
-- MAX_R2_TOTAL_MB and count rows with created_at >= now - 24 h for
-- MAX_UPLOADS_PER_DAY. See "Cost safety" in functions/README.md.
--
-- Rows written before this migration stay at 0: their real size is unknown, so the
-- total is an underestimate. Uploads are refused before R2 is written, so the
-- bucket itself never grows past the cap.

ALTER TABLE images ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;

-- Daily upload count (uploads in the last 24 h) and the SUM scan.
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);
