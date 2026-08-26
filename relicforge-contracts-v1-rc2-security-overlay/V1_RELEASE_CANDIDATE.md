# RelicForge Contracts V1 Release Candidate

The `contracts-v1-production` branch contains the parallel production-oriented RelicForge V1 architecture under `contracts/production/` while intentionally preserving the existing v11.1.6 Sepolia Studio and `contracts/RelicForgeTest.sol`.

**Status: RC2 SECURITY HARDENING — NOT AUDITED — NOT FOR MAINNET.**

Start with:
- `contracts/production/README.md`
- `docs/v1/LOCKED_REQUIREMENTS.md`
- `docs/v1/SECURITY_MODEL.md`
- `docs/v1/RC2_HARDENING.md`
- `docs/v1/SECURITY_TEST_MATRIX.md`
- `docs/v1/COMPILE_STATUS.md`
- `docs/v1/STUDIO_INTEGRATION.md`
- `test/v1/`

RC1 has a verified green Solidity 0.8.30 compile/size/test baseline. RC2 expands the adversarial surface and must pass the branch CI gate before Studio production wiring begins.
