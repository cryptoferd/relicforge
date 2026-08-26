# RelicForge Contracts V1 — RC2.1 Test Harness Fix

This patch changes **tests only**. It does not modify any production Solidity contract.

It fixes four issues exposed by the first full RC2 CI run:

1. `vm.prank` was consumed by `MAX_MINT_BATCH()` before the mint call.
2. `vm.prank` was consumed by `REVEAL_FORGE()` before the access-control call.
3. A test function began with `testFail...`, which Foundry 1.7 treats as the removed legacy convention.
4. `targetContract` was incorrectly declared/called as a VM cheatcode instead of exposing an invariant target hook.

From the repository root on `contracts-v1-production`:

```powershell
powershell -ExecutionPolicy Bypass -File .\apply-rc2.1.ps1
git diff -- test/v1
git add test/v1
git commit -m "Fix RC2 security test harness"
git push origin contracts-v1-production
```
