# Apply RelicForge Contracts V1 RC2 (Flat Overlay)

This archive is intentionally flat: extract it directly into the repository root while on `contracts-v1-production`.

```powershell
git checkout contracts-v1-production
git pull --ff-only origin contracts-v1-production

Expand-Archive .\relicforge-contracts-v1-rc2-security-overlay-FLAT.zip -DestinationPath . -Force
Remove-Item .\relicforge-contracts-v1-rc2-security-overlay-FLAT.zip

# Confirm the RC2 suites actually landed:
Get-ChildItem .\test\v1

git status
git add -A
git commit -m "Apply RelicForge Contracts V1 RC2 security hardening"
git push origin contracts-v1-production
```

Before committing, `test/v1` should include `AccessControlSecurity.t.sol`, `ERC721Security.t.sol`, `FactorySecurity.t.sol`, `FuzzSecurity.t.sol`, `InvariantSecurity.t.sol`, `PhaseSecurity.t.sol`, `ProjectDataSecurity.t.sol`, `RevealSecurity.t.sol`, `RelicForgeV1.t.sol`, `RelicForgeV1Fixture.sol`, and `TestBase.sol`.

Do not apply this overlay to `main`.
