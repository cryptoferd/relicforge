CREATE TABLE IF NOT EXISTS founder_support_audit (
  id BIGSERIAL PRIMARY KEY,
  founder_wallet TEXT NOT NULL,
  owner_wallet TEXT NOT NULL,
  project_id UUID NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS founder_support_audit_project_idx
  ON founder_support_audit(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS founder_support_audit_owner_idx
  ON founder_support_audit(owner_wallet, created_at DESC);
