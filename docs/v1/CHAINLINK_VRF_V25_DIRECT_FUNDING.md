# RelicForge V1 — Chainlink VRF v2.5 Direct Funding

## Current integration target

RelicForge RC3 uses the VRF v2.5 wrapper's native direct-funding path rather than a creator-shared Chainlink subscription.

The wrapper address is chain-specific and must be taken from current official Chainlink deployment information immediately before deployment. Do not hardcode an address copied from an old guide.

## Production deployment environment

`DeployChainlinkDirectFundingV1.s.sol` expects:

- `DEPLOYER_PRIVATE_KEY`
- `RF_VRF_V25_WRAPPER`
- `RF_VRF_CALLBACK_GAS_LIMIT`
- `RF_VRF_REQUEST_CONFIRMATIONS`
- `RF_VRF_MAX_REQUEST_PRICE_WEI`

The adapter requires callback gas of at least 300,000 in RC3. The final configured value must be measured on testnet and remain within the selected wrapper/coordinator's supported maximum. `RF_VRF_MAX_REQUEST_PRICE_WEI` is an immutable economic safety ceiling: if the wrapper's live native quote exceeds it, the request reverts instead of allowing a deliberately high gas-price transaction to consume an unexpectedly large amount of collection credit.

## Deployment ceremony

1. Verify the official wrapper address for the target chain.
2. Verify wrapper bytecode/source on the chain explorer.
3. Deploy collection implementation.
4. Deploy project-data implementation.
5. Deploy shared renderer.
6. Deploy direct-funding adapter with wrapper/callback/confirmation immutables.
7. Deploy immutable V1 factory pointing to those exact addresses.
8. Call `adapter.bindFactory(factory)` exactly once.
9. Verify `adapter.factory() == factory`.
10. Verify `adapter.bootstrapAuthority() == address(0)`.
11. Verify `factory.randomnessProvider() == adapter`.
12. Verify all runtime bytecode/hash values against the release manifest.
13. Fund a test collection's randomness credit and perform a real end-to-end testnet Forge reveal.

## Request flow

For a Forge mint:

1. Collection calls `adapter.requestRandomness(sequence)`.
2. Adapter verifies the caller is a collection registered by the bound factory.
3. Adapter asks the wrapper for the current native request price.
4. Adapter verifies the quote is not above the immutable `maxRequestPriceWei` ceiling.
5. Adapter verifies that collection's isolated credit covers the price.
6. Adapter debits only that collection's credit.
7. Adapter makes the native-funded wrapper request.
8. Adapter maps Chainlink upstream request ID to the local RelicForge request ID.
9. If any upstream step reverts, the entire collection mint transaction reverts atomically.
10. Wrapper later calls `rawFulfillRandomWords` on the adapter.
11. Adapter stores the verified word before attempting collection delivery.
12. Adapter calls the collection with capped gas.
13. If collection delivery fails, anyone can call `replayFulfillment(localRequestId)` later; the word cannot change.

## Pricing behavior

`calculateRequestPriceNative` depends on current request conditions, including transaction gas pricing. Randomness credit therefore needs a safety buffer; funding exactly one previously quoted request price can become insufficient by the time a later mint executes.

The Studio should display:

- current adapter credit,
- current quote,
- approximate requests remaining,
- a recommended safety buffer,
- a clear warning when Forge mode is armed with insufficient credit.

The contract remains authoritative: if actual current credit is insufficient, the request/mint reverts rather than silently minting an unrevealable Forge token.
