# Apply RelicForge Contracts V1 RC3.3

RC3.3 is a flat overlay built for the `contracts-v1-production` branch after green RC3.2.

It changes no production Solidity. It adds Ethereum Sepolia deployment scripts, real Chainlink VRF v2.5 smoke/finalize/verify scripts, a local PowerShell live runner, `.gitignore` protection for local secrets/artifacts, `.env.example`, and RC3.3 documentation.

## Apply

From the repository root:

```powershell
git checkout contracts-v1-production
git pull --ff-only origin contracts-v1-production
git status
```

The working tree should be clean.

Extract the overlay directly into the repo root, then:

```powershell
git status
git diff --stat
git add -A
git commit -m "Add RelicForge Contracts V1 RC3.3 Sepolia live integration"
git push origin contracts-v1-production
```

Wait for GitHub Actions to compile the new scripts and keep the existing 100-test suite green before running the live Sepolia test.
