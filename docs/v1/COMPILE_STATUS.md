# V1 RC Compile Status

This package is a development release candidate, not a mainnet artifact.

## Checks completed before packaging

- All production Solidity import targets are present in the package.
- Custom `RF_*` errors referenced by `revert` statements are declared.
- Production Solidity brace/parenthesis balance was checked.
- The legacy v11.1.6 Studio/testnet stack is retained unchanged except for documentation additions.
- A GitHub Actions Foundry build/test gate is included.

## Compiler execution

The package assembly environment did not have a local Solidity/Foundry binary and outbound compiler download was unavailable, so **this RC has not been claimed as successfully compiled locally**. The first branch gate after upload is `.github/workflows/contracts-v1.yml`, which runs `forge build --sizes` and `forge test -vvv` using the pinned Solidity 0.8.30 Foundry configuration.

Do not deploy V1 even to a public testnet until that build passes and any compiler findings are corrected. Do not deploy to mainnet until the complete security release gates in `SECURITY_MODEL.md` are satisfied.
