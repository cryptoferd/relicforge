# RelicForge Contracts V1 — RC3 Hardening

RC3 builds on the green RC2.1 baseline (71/71 tests passing) and begins the production-provider and audit-readiness phase.

## Security changes

### Replay-safe provider delivery

`RelicRandomnessAdapterBaseV1` now caps the gas forwarded to a collection callback and retains a reserve in the adapter callback. The verified random word is committed to storage before the consumer is called. A reverting or gas-burning consumer therefore cannot erase the verified word or force a reroll; anyone can later replay the same stored word.

### Chainlink VRF v2.5 direct native funding

RC3 adds `RelicChainlinkVRFV25DirectFundingAdapterV1`, using the current Chainlink VRF v2.5 wrapper native-payment ABI:

- `calculateRequestPriceNative(callbackGasLimit, numWords)`
- `requestRandomWordsInNative{value: requestPrice}(callbackGasLimit, requestConfirmations, numWords, extraArgs)`
- `rawFulfillRandomWords(requestId, randomWords)` callback from the wrapper only
- `VRF ExtraArgsV1` with `nativePayment: true`

The production adapter deliberately does **not** use one RelicForge-wide creator subscription balance. Every canonical collection has its own `nativeCredit` bucket. A collection can spend only its own balance.

This avoids a shared-fund economic DoS where a malicious creator could otherwise deploy legitimate collections and intentionally exhaust a platform-funded subscription.

The adapter also has an immutable `maxRequestPriceWei` ceiling. Because the wrapper quote depends on the request transaction gas price, this prevents a minter from deliberately using an extreme priority fee to make a single Forge request burn an unbounded amount of the collection's credit. Quotes above the ceiling revert atomically.

### Atomic insufficient-credit behavior

A Forge mint requests randomness inside the same transaction. If the collection does not have enough native randomness credit, the adapter reverts. EVM transaction atomicity restores:

- the collection mint,
- phase counters,
- wallet counters,
- reveal request state,
- adapter request counters,
- randomness credit.

No token should be left minted without its corresponding Forge randomness request.

Deferred epoch requests have the same atomic rollback property: a failed upstream request cannot advance the epoch cursor.

### One-time factory binding

The direct-funded adapter is deployed before the immutable factory, creating a circular trust reference. RC3 resolves this with a one-time deployment handshake:

1. Deploy adapter. `bootstrapAuthority = deployer`.
2. Deploy `RelicForgeFactoryV1` with `randomnessProvider = adapter`.
3. Call `adapter.bindFactory(factory)`.
4. Adapter verifies `factory.randomnessProvider() == address(adapter)`.
5. `bootstrapAuthority` is permanently set to `address(0)`.

There is no post-binding factory setter, wrapper setter, callback-gas setter, confirmation setter, or RelicForge platform admin control.

### Credit funding and recovery

Anyone may sponsor a canonical collection by calling `fundConsumer(collection)` with native currency. Sponsorship is credited to the collection budget, not to the individual funder.

Unused credit may only be withdrawn by the collection's current `payoutReceiver`, and the adapter always sends the withdrawal to that same address. This remains possible after ownership/control renunciation because `payoutReceiver` persists.

The Studio/mint UI must clearly explain that third-party randomness sponsorship is non-refundable to the sponsor and becomes collection-controlled budget.

## New adversarial coverage

RC3 adds tests for:

- gas-burning/reverting randomness consumer callbacks,
- stored-word survival after failed delivery,
- permissionless same-word replay,
- duplicate replay idempotence,
- arbitrary addresses attempting billable VRF requests,
- non-collection credit deposits,
- per-collection credit isolation,
- Forge mint rollback on insufficient VRF credit,
- epoch cursor rollback on insufficient VRF credit,
- wrapper-only fulfillment,
- malformed random word arrays,
- duplicate fulfillment/reroll attempts,
- exact wrapper request parameters and native-payment extra args,
- payout-only credit recovery,
- credit recovery after collection renunciation,
- unattributed direct native transfers,
- minimum callback-gas configuration,
- immutable maximum request-price enforcement against gas-price-driven credit drain,
- minting from a high phase ID after hundreds of configured phases,
- 50-token mint gas regression,
- 50-token epoch-processing gas regression,
- reveal `maxSteps` work bounding.

## Static analysis

RC3 adds Slither to GitHub Actions as an **advisory** baseline. The Slither step is intentionally non-blocking for the first RC3 run so findings can be reviewed individually. After false positives and accepted design warnings are documented, unresolved high/medium issues should be fixed and the static-analysis gate should become blocking before audit freeze.

## Expected intentional warnings

`block.timestamp` is intentionally authoritative for mint phase start/end windows. Validators can influence timestamps slightly, so Studio countdowns must be treated as UX estimates while the contract remains authoritative. This warning should be documented, not "fixed" by replacing timestamps with block numbers.

Test-only narrowing casts may still emit lint warnings where the test input is already explicitly bounded. Production narrowing casts should remain reviewed separately.

## RC3 is not mainnet-ready

RC3 still requires:

1. GitHub Actions compile and size pass.
2. Full unit/fuzz/invariant/VRF/gas suite pass.
3. Slither baseline review and remediation.
4. Official chain-specific wrapper address verification.
5. Real Sepolia direct-funded request and fulfillment.
6. Callback gas measurement under the real wrapper.
7. Deployment bytecode/hash freeze.
8. Independent professional audit and remediation.
