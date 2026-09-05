# Forge Reveal V2 — Phase 2A Economics + Security

Baseline: `ff6ebc052d255bc5cba78684eff2a988de400f47`

Phase 1 proved the state-machine concept. Phase 2A answers the next production questions without touching V1.

## Payment rule

A Forge request is not yet an ERC-721 mint, so collector funds cannot be treated as completed sale proceeds.

Phase 2A uses:

`request -> escrow -> verified random settlement -> earned proceeds`

While pending:
- the full collector payment remains `escrowedValue`;
- creator proceeds are zero for that reservation;
- platform fees are zero for that reservation;
- neither creator nor platform can withdraw pending funds.

After successful random mint:
- sale price moves to creator proceeds;
- platform component moves to platform fees;
- escrow decreases by the exact same amount.

This prevents a failed randomness request from becoming a debt owed by a creator who already withdrew the sale.

## Terminal provider failure

A timeout by itself is NOT a valid reason to refund a Forge request.

If a collector could cancel after learning (or potentially learning) the random outcome, selective abort becomes a rarity-sniping surface.

A refund therefore requires the configured randomness adapter to report an irreversible terminal failure:
- no random word was recorded;
- the request cannot later fulfill;
- the failure flag is permanent.

The prototype then:
1. removes the reservation from committed supply;
2. removes the payment from escrow;
3. credits the original payer for the full payment;
4. lets later ready reservations continue.

Production adapters must define provider-specific terminal-failure semantics. If a provider cannot prove terminal failure, RF should prefer replay/recovery over cancellation.

## Callback replay

The Phase 2 mock separates:
- recording the random word;
- attempting callback delivery.

Once recorded, a word cannot be replaced.

A low-gas or reverting callback leaves the exact word replayable. Permissionless replay can finish the Forge later without another collector or creator signature.

## Pause behavior

Pausing Forge:
- blocks NEW reservations;
- does NOT stop an already-paid pending reservation from receiving its NFT.

This avoids trapping collectors because a creator paused the public sale after their transaction confirmed.

## Settlement order

Random words may arrive out of order, but draws consume the remaining NFT deck strictly in immutable reservation order.

This reduces the ability of callback ordering to influence which known word receives access to an earlier deck state.

## Randomness cost

Phase 2A intentionally keeps randomness-provider funding separate from sale escrow.

The current V1 direct-funding model gives each collection a reveal/randomness credit balance. Provider benchmarking in Phase 2B will determine whether V2 keeps that model, includes a per-request randomness reserve in mint payment, or supports both.

## Production decisions still open

- exact maximum Forge batch size;
- callback gas limit per provider;
- provider request fee responsibility;
- expiry/recovery UX;
- safe ERC-721 receiver callbacks during async mint;
- creator-control renunciation with pending reservations;
- fee-policy integration;
- contract upgrade/versioning path.

These are deliberately not hidden by the prototype.
