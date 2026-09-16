-- Relic Forge Founder Operations Console R1
CREATE TABLE IF NOT EXISTS founder_policy_profiles (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  networks JSONB NOT NULL DEFAULT '{}'::jsonb,
  bypass_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS founder_user_overrides (
  wallet TEXT PRIMARY KEY,
  profile_name TEXT REFERENCES founder_policy_profiles(name) ON DELETE SET NULL,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  networks JSONB NOT NULL DEFAULT '{}'::jsonb,
  bypass_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,
  reason TEXT,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS founder_user_overrides_expiry_idx ON founder_user_overrides(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS founder_feature_flags (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'off' CHECK (state IN ('off','founder','beta','everyone')),
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS founder_network_controls (
  chain_id BIGINT PRIMARY KEY REFERENCES rf26_networks(chain_id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'public' CHECK (mode IN ('disabled','founder','beta','public')),
  note TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS founder_platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS founder_announcements (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical','success')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS founder_announcements_active_idx ON founder_announcements(enabled,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS founder_admin_audit (
  id BIGSERIAL PRIMARY KEY,
  founder_wallet TEXT NOT NULL,
  action TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS founder_admin_audit_created_idx ON founder_admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS founder_admin_audit_subject_idx ON founder_admin_audit(subject_type,subject_id,created_at DESC);

INSERT INTO founder_policy_profiles(name,description,limits,features,networks,bypass_emergency) VALUES
('Standard','Default Relic Forge creator policy','{}','{}','{}',FALSE),
('Verified Creator','Higher cloud limits for verified creators','{"projectLimit":25,"projectAssetMaxBytes":52428800,"mintPageAssetMaxBytes":5242880,"whitelistMaxEntries":500000}','{}','{}',FALSE),
('Partner','Partner creator policy with expanded cloud limits','{"projectLimit":50,"projectAssetMaxBytes":104857600,"mintPageAssetMaxBytes":10485760,"whitelistMaxEntries":1000000}','{"betaAccess":true}','{}',FALSE),
('Beta Tester','Standard limits plus beta feature/network access','{}','{"betaAccess":true}','{}',FALSE),
('Unlimited Studio','Large support/partner exception profile','{"projectLimit":1000,"projectAssetMaxBytes":536870912,"mintPageAssetMaxBytes":52428800,"whitelistMaxEntries":2000000}','{"betaAccess":true}','{}',FALSE),
('Founder','Founder policy profile for explicit operational testing','{"projectLimit":1000,"projectAssetMaxBytes":536870912,"mintPageAssetMaxBytes":52428800,"whitelistMaxEntries":2000000}','{"betaAccess":true}','{}',TRUE)
ON CONFLICT(name) DO NOTHING;

INSERT INTO founder_feature_flags(key,label,description,state) VALUES
('beta_network_access','Beta network access','Allows Beta-profile creators to use networks in Beta deployment mode.','beta'),
('future_networks','Future network UI','Expose future network integrations to approved beta users.','off'),
('next_renderer','Next renderer preview','Expose an unreleased renderer/UI path to approved users.','founder'),
('next_reveal_architecture','Next reveal architecture','Expose unreleased reveal tooling to approved users.','founder'),
('advanced_metadata_beta','Advanced metadata beta','Expose experimental metadata tooling to approved users.','beta')
ON CONFLICT(key) DO NOTHING;

INSERT INTO founder_platform_settings(key,value,description) VALUES
('newDeploymentsPaused','false','Emergency stop for new creator deployment preflight/registration.'),
('projectWritesPaused','false','Emergency stop for creator cloud project saves/new project artwork preparation.'),
('mintPagePublishingPaused','false','Emergency stop for mint-page publishing changes.'),
('whitelistPublishingPaused','false','Emergency stop for whitelist/proof publication changes.'),
('publicDiscoveryPaused','false','Emergency stop for public discovery while direct mint URLs remain available.'),
('maintenanceMode','false','Shows a public maintenance notice without claiming decentralized contracts are paused.'),
('reserveWarningEth','"0.05"','Founder Console Reserve warning threshold in ETH.')
ON CONFLICT(key) DO NOTHING;

INSERT INTO founder_network_controls(chain_id,mode,note)
SELECT chain_id,CASE WHEN launch_enabled THEN 'public' ELSE 'disabled' END,'Seeded from rf26_networks launch_enabled'
FROM rf26_networks
ON CONFLICT(chain_id) DO NOTHING;
