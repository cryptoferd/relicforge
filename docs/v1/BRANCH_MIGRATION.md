# Putting this package on `contracts-v1-production`

This ZIP contains the full current v11.1.6 site plus the new V1 RC files. The existing Sepolia Studio remains intact.

## Recommended Git workflow

1. Check out `contracts-v1-production` locally or in GitHub Desktop.
2. Copy the contents of this package folder over the repository root.
3. Delete the stale root-level `RelicForgeTest.sol` if it still exists in the GitHub branch. The authoritative Sepolia test source is `contracts/RelicForgeTest.sol`.
4. Delete the temporary `test.txt` branch-trigger file if desired.
5. Commit with a message such as `Add RelicForge Contracts V1 release candidate`.
6. Push `contracts-v1-production`.
7. Vercel will update the branch preview. The web UI will initially look the same because the existing Studio remains intentionally wired to the Sepolia V2 test stack.
8. GitHub Actions should run `forge build --sizes` and `forge test -vvv` from `.github/workflows/contracts-v1.yml`.

Do not merge to `main` and do not deploy V1 to mainnet until the V1 release gates are complete.
