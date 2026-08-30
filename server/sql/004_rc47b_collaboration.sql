ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS actor_wallet TEXT;
ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS action TEXT;
ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS change_sections JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE project_versions pv
SET actor_wallet = COALESCE(pv.actor_wallet, p.owner_wallet),
    action = COALESCE(pv.action, 'owner_save')
FROM projects p
WHERE p.id = pv.project_id
  AND (pv.actor_wallet IS NULL OR pv.action IS NULL);

CREATE TABLE IF NOT EXISTS project_collaborators (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, wallet)
);

CREATE INDEX IF NOT EXISTS project_collaborators_wallet_idx
  ON project_collaborators(wallet, updated_at DESC);
CREATE INDEX IF NOT EXISTS project_versions_history_idx
  ON project_versions(project_id, version DESC);

-- Records which collaborator permission authorized a newly prepared asset. The
-- normal owner asset routes continue to use purpose='project'; this column only
-- prevents a collaborator with one edit permission from completing an upload
-- prepared for another section.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS collab_section TEXT;

-- RC4.7B supports one published whitelist phase per collection, but records the
-- canonical V1 phase id so proofs cannot be accidentally served for a different phase.
ALTER TABLE whitelists ADD COLUMN IF NOT EXISTS phase_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS phase_id INTEGER NOT NULL DEFAULT 0;
