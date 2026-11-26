CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
