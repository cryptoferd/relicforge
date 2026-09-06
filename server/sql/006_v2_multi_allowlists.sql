-- R12-v2 Collector Mint R2
-- Allow multiple independently published Merkle proof tables per collection.
ALTER TABLE whitelists ADD COLUMN IF NOT EXISTS phase_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE whitelist_entries ADD COLUMN IF NOT EXISTS phase_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE whitelists ALTER COLUMN phase_id TYPE BIGINT USING phase_id::bigint;
ALTER TABLE whitelist_entries ALTER COLUMN phase_id TYPE BIGINT USING phase_id::bigint;

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY u.ord)
    INTO cols
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum,ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum
  WHERE c.conrelid='whitelists'::regclass AND c.contype='p'
  GROUP BY c.oid;
  IF cols IS DISTINCT FROM 'chain_id,contract_address,phase_id' THEN
    ALTER TABLE whitelists DROP CONSTRAINT IF EXISTS whitelists_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='whitelists'::regclass AND contype='p') THEN
    ALTER TABLE whitelists ADD CONSTRAINT whitelists_pkey PRIMARY KEY(chain_id,contract_address,phase_id);
  END IF;
END $$;

DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY u.ord)
    INTO cols
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum,ord) ON true
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum
  WHERE c.conrelid='whitelist_entries'::regclass AND c.contype='p'
  GROUP BY c.oid;
  IF cols IS DISTINCT FROM 'chain_id,contract_address,phase_id,wallet' THEN
    ALTER TABLE whitelist_entries DROP CONSTRAINT IF EXISTS whitelist_entries_pkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='whitelist_entries'::regclass AND contype='p') THEN
    ALTER TABLE whitelist_entries ADD CONSTRAINT whitelist_entries_pkey PRIMARY KEY(chain_id,contract_address,phase_id,wallet);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whitelist_phase_wallet_idx
  ON whitelist_entries(chain_id,contract_address,phase_id,wallet);
