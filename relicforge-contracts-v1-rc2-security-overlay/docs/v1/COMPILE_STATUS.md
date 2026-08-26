# RelicForge Contracts V1 — Compile / CI Status

## RC1 verified baseline
GitHub Actions on `contracts-v1-production` successfully compiled the V1 stack with Solidity 0.8.30 using optimizer runs=1, viaIR=true, Cancun EVM.

Verified RC1 deployed-runtime sizes:
- RelicCollectionV1: 15,835 bytes
- RelicProjectDataV1: 9,767 bytes
- RelicRendererV1: 8,307 bytes
- RelicForgeFactoryV1: 2,032 bytes
- RelicRandomnessMockV1: 1,082 bytes

RC1 smoke tests: 4 passed, 0 failed.

## RC2 status
RC2 adds contract hardening plus expanded unit/fuzz/invariant suites. The RC2 overlay must be pushed to `contracts-v1-production` and pass the branch GitHub Actions workflow before these new bytecode sizes/tests are considered verified.

Do not deploy RC2 to mainnet merely because CI is green. External audit/formal/security gates remain required.
