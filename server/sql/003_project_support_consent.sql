ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS founder_support_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS founder_support_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_founder_support_idx
  ON projects(founder_support_enabled, updated_at DESC)
  WHERE founder_support_enabled = TRUE;