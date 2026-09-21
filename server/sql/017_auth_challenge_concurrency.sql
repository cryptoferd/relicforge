-- Relic Forge R1.10.1.2
-- Concurrent wallet sign-in challenges.

CREATE TABLE IF NOT EXISTS auth_challenges_v2 (
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(wallet, nonce)
);

CREATE INDEX IF NOT EXISTS auth_challenges_v2_wallet_created_idx
  ON auth_challenges_v2(wallet, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_challenges_v2_expires_idx
  ON auth_challenges_v2(expires_at);
