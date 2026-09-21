-- Relic Forge R1.10: public Reliquary visibility preferences.
-- Idempotent migration. Existing public behavior is preserved except testnet
-- activity remains hidden unless the profile owner explicitly enables it.

ALTER TABLE reliquary_profiles
  ADD COLUMN IF NOT EXISTS public_settings JSONB NOT NULL DEFAULT
  '{
    "showWallet": true,
    "showBio": true,
    "showPfp": true,
    "showStats": true,
    "showMintSpend": true,
    "showNfts": true,
    "showTestnet": false
  }'::jsonb;

UPDATE reliquary_profiles
SET public_settings =
  '{
    "showWallet": true,
    "showBio": true,
    "showPfp": true,
    "showStats": true,
    "showMintSpend": true,
    "showNfts": true,
    "showTestnet": false
  }'::jsonb
  || COALESCE(public_settings, '{}'::jsonb);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reliquary_public_settings_object'
  ) THEN
    ALTER TABLE reliquary_profiles
      ADD CONSTRAINT reliquary_public_settings_object
      CHECK (jsonb_typeof(public_settings) = 'object');
  END IF;
END $$;
