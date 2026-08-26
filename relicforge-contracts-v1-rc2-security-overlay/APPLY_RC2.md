# Apply RelicForge Contracts V1 RC2

This is an overlay for the `contracts-v1-production` branch only. It intentionally does not contain Studio/site files.

From a local clone of `cryptoferd/relicforge`:

```powershell
git checkout contracts-v1-production
git pull origin contracts-v1-production

# Put relicforge-contracts-v1-rc2-security-overlay.zip in the repo root, then:
Expand-Archive .\relicforge-contracts-v1-rc2-security-overlay.zip -DestinationPath . -Force

git status
git add .github contracts/production docs/v1 test/v1 foundry.toml V1_RELEASE_CANDIDATE.md APPLY_RC2.md RC2_OVERLAY_MANIFEST.txt
git commit -m "Harden RelicForge Contracts V1 RC2 security suite"
git push origin contracts-v1-production
```

GitHub Actions should then run the Solidity 0.8.30 compile, EIP-170 size gates, unit tests, 5,000-run fuzz tests, and 1,000-run stateful invariants.

Do not apply this overlay to `main`.
