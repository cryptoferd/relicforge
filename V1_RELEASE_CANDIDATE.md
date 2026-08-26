# RelicForge Contracts V1 Release Candidate

This branch package adds the first production-oriented RelicForge V1 contract architecture under `contracts/production/` while intentionally preserving the existing v11.1.6 Sepolia Studio and `contracts/RelicForgeTest.sol`.

**This is development code. It has not completed compilation/audit release gates and must not be deployed to Ethereum mainnet yet.**

Start with:

- `contracts/production/README.md`
- `docs/v1/LOCKED_REQUIREMENTS.md`
- `docs/v1/SECURITY_MODEL.md`
- `docs/v1/COMPILE_STATUS.md`
- `docs/v1/STUDIO_INTEGRATION.md`
- `test/v1/RelicForgeV1.t.sol`

The next development step after this package is accepted on the branch is to wire the V1 phase/reveal controls into the staging Studio while keeping the existing Sepolia deployment path available.
