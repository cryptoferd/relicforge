# Forge Reveal V2 — Phase 2C Queue, Hopper & Reserve Architecture

Baseline branch: `forge-reveal-v2`
Baseline commit: `326fbb952821cd85797ded311a75ccc360228310`

Phase 2C remains **experimental only**. It adds new harnesses/tests/docs and does not modify production V1.

## Locked product decisions

### 1. Forge RNG batch maximum is 20 NFTs

Twenty is the maximum number of NFTs sharing one Forge Reveal RNG request in this phase.
It is a maximum, not a minimum.

- A full batch locks immediately at 20.
- A partial batch locks after the short batch window (tests use 3 seconds).
- Mint-out locks the final partial batch immediately.
- A one-NFT mint therefore does **not** wait for nineteen more buyers.

### 2. Collector minting is decoupled from the randomness provider

The collector transaction only:

1. validates payment/supply;
2. reserves the recipient and quantity;
3. escrows creator proceeds;
4. credits the RF fee to the collection hopper;
5. appends the reservation to the current batch; and
6. locks the batch if full.

It does **not** call Chainlink/Pyth/Supra or settle ERC-721s.

A permissionless executor later calls `requestRandomnessForBatch(batchId)`.
This means a provider slowdown can create a reveal queue without turning the provider into the public mint bottleneck.

### 3. Multiple RNG jobs may be outstanding

Locked batches are independent RNG jobs. Different RF executor wallets can submit different batch requests.
Batch composition is immutable before any request is made.

Settlement remains strictly ordered by batch ID so callback arrival order cannot change recipe allocation.
Out-of-order words are stored and wait safely behind the oldest unsettled batch.

### 4. Dynamic callback sizing

The max remains 20, but a one-NFT timeout batch should not pay for a 20-NFT callback ceiling.
The prototype computes callback gas from actual batch quantity and caps it at 2.5M.

The provider callback:

1. stores the verified word first;
2. attempts settlement only if this is the next batch and gas is sufficient;
3. runs settlement inside an isolated self-call; and
4. leaves the exact word available to `settleReady()` if settlement is skipped/fails.

### 5. Collection Forge Hopper

Both RF fee models feed the collection-specific hopper.

#### Creator-sponsored

`$0.25 × max supply` is paid up front in production fee-policy terms.
That fee allocation enters the hopper.
Public mints and creator/team mints incur no additional RF per-mint fee.

#### Minter-supported

- Public collector mint: `$0.50/NFT` RF fee enters the hopper.
- Creator/team/treasury mint: `$0.25/NFT` RF fee enters the hopper.

The creator-team fee prevents large treasury allocations from consuming RNG/Forge resources while bypassing hopper funding.
Creator mint quantity may span many internal 20-NFT batches in one creator transaction.

The Solidity harness uses native-wei equivalents supplied to the constructor. Production continues to use the existing USD-denominated fee policy/oracle machinery.

### 6. Hopper pays RNG before the global Forge Reserve

For every RNG request:

1. quote the configured provider for the quantity-sized callback;
2. reject if quote exceeds the collection's chain-profile maximum;
3. consume collection hopper funds first;
4. request only the exact remaining shortfall from the chain-local Forge Reserve; and
5. atomically pay the provider.

Creator sale proceeds remain a separate accounting bucket and are never considered available RNG funds.

### 7. Slow sponsored collections do not strand all upfront fees

The collection calculates a protected hopper target containing:

- all locked-but-unrequested RNG batches;
- the current open partial batch; and
- up to 10 future 20-NFT batches of runway.

Excess above that target is sweepable to the Forge Reserve.
The founder/automation can trigger `ForgeReserve.pullCollectionExcess(collection)`, but cannot choose the amount or destination.
The collection contract computes the safe amount.

For **incomplete creator-sponsored collections**, moving prepaid funds out of the local hopper does **not** instantly turn those funds into platform revenue. The collection reports a `restrictedSponsoredLiabilityWei()` for the prepaid fee allocation tied to still-uncommitted supply. The global Forge Reserve must continue protecting that liability. As sponsored supply commits, the restricted liability falls and true surplus may become releasable.

This allows slow sponsored collections to consolidate idle liquidity into the Forge Reserve (where it can backstop other canonical collections) without accidentally spending away the prepaid capacity required if that sponsored collection becomes active later.

After a sold-out collection has fully settled, protected runway and future sponsored liability become zero and the entire remaining hopper is sweepable.
The final RNG callback only marks completion; a permissionless/founder automation sweep moves the balance afterward so an external treasury transfer can never break the final NFT settlement.

### 8. Chain-local Forge Reserve

Phase 2C models a native-asset reserve per chain.
It does **not** automatically bridge, swap, or convert funds.

The reserve tracks/synchronizes:

- active Forge collections;
- active/open/settling Forge batches;
- uncovered active RNG exposure after hopper funds;
- restricted prepaid sponsored liability for uncommitted supply;
- per-request and per-collection subsidy caps; and
- a configurable global reserve floor.

Dynamic reserve target:

`max(global minimum, restricted sponsored liability + uncovered exposure × safety multiplier + active batches × batch buffer)`

The reserve exists to fund legitimate canonical RNG shortfalls. Collection hopper is always consumed first.

### 9. Platform revenue boundary

Forge Reserve funds are operational capital, not immediately withdrawable platform revenue.

Founder can call `releaseRevenue()`. The contract:

1. refreshes collection exposure in the experimental registry;
2. calculates the dynamic protected reserve;
3. transfers only the surplus above that requirement; and
4. transfers only to the configured Revenue Treasury.

The founder cannot specify an arbitrary withdrawal amount or alternate destination through this path.

There is intentionally **no automatic asset conversion** in Phase 2C. Revenue remains in the chain's native asset until a later explicit treasury-management decision.

> Production scaling note: the experimental reserve synchronizes all registered collections during a revenue release. Before production this must become a paginated/snapshot or active-set design so revenue accounting never requires an unbounded O(N) loop.

### 10. Hype-mint behavior

A 10,000 NFT sellout at the 20-NFT maximum creates 500 immutable RNG jobs.

Phase 2C tests that:

- 500 quantity-20 reservation transactions can commit all 10,000 supply;
- those mint transactions create **zero RNG provider calls**;
- exactly 500 later executor calls can dispatch the RNG jobs;
- out-of-order RNG words cannot reorder deck settlement; and
- a real 1,000-NFT / 50-batch sparse-deck drain has no missing token IDs.

A reveal backlog is allowed during extreme demand. A provider backlog must not retroactively invalidate successful mint reservations.

## Remaining production questions after Phase 2C

Phase 2C intentionally does not select the production RNG provider. The next provider/economics phase must benchmark:

- Chainlink VRF v2.5 direct vs controlled subscription funding;
- Pyth Entropy variants and security assumptions;
- Supra dVRF;
- supported networks including Robinhood Chain alternatives;
- live request cost and callback limits;
- exact-word replay/recovery behavior;
- terminal failure semantics;
- executor/automation cost; and
- chain-specific maximum request-price and reserve policy profiles.

Production also needs the full ERC-721 safe-receiver/reentrancy treatment, existing phase/wallet-limit integration, factory registration, fee-policy wiring, renunciation behavior with pending Forge jobs, and audit review.
