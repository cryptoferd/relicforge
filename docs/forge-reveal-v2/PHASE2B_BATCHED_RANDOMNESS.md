# Forge Reveal V2 — Phase 2B Batched Randomness

Baseline: `b5c221f944ddad9a7cf9c7e70d1a1da81b1227eb`

## Problem being solved

Phase 2A showed that random mint settlement is economically reasonable, but one secure randomness request per
collector reservation would still be wasteful at collection scale.

Phase 2B changes the unit of randomness from "reservation" to "Forge batch."

## Collector experience

A collector still performs one action:

`Mint -> wallet confirmation -> Forging -> revealed NFT appears`

Internally:

1. Collector payment and supply are reserved immediately.
2. Reservation joins the currently open Forge batch.
3. A hot batch closes automatically when the configured NFT target is reached.
4. A low-volume batch can be closed permissionlessly after a short time window.
5. Batch composition is locked BEFORE randomness is requested.
6. ONE verified random word is requested for the whole batch.
7. The provider callback stores only that word.
8. Permissionless RF settlement consumes batches strictly in immutable order.
9. Each reservation receives random unused token IDs derived from the batch word.
10. NFTs are created already revealed.

No collector or creator second signature is required.

## Why callback and settlement are separate

Phase 2A measured direct mint callback gas at approximately:

- 1 NFT: 121,243 gas
- 5 NFTs: 319,225 gas
- 10 NFTs: 566,706 gas
- 20 NFTs: 1,061,678 gas
- 50 NFTs: 2,524,813 gas

The provider callback should instead be tiny and predictable:

`verified word -> store batch word -> emit ready event`

The more expensive NFT/deck work is then performed by a permissionless settlement transaction that RF
infrastructure can automate.

This prevents provider callback gas limits from determining collection batch size.

## Batch close policy

Prototype policy:

- close immediately when `maxBatchNfts` is reached;
- otherwise allow permissionless close after `batchWindowSeconds`.

Production UX can use a keeper/automation so low-volume collectors do not need to close batches themselves.

Likely starting ranges:
- high-cost L1: 10–20 NFT target;
- inexpensive L2: 20–50 NFT target;
- short low-volume window where chain/provider latency makes that meaningful.

These are not final constants. Phase 2B measures worst-case one-NFT-per-reservation settlement gas.

## Fairness properties

### Composition locks before randomness

No reservation can be added to a batch after its randomness request exists.

Therefore a collector/keeper can decide when an eligible batch closes, but cannot know the secure random result
when making that decision.

### Strict batch settlement order

All batches consume one shared without-replacement token deck in immutable batch order.

If Batch 2 randomness arrives before Batch 1, Batch 2 records its word but cannot consume the deck until Batch 1
is ready or terminally refunded.

This removes callback arrival order as a recipe-allocation choice.

### Position inside a batch

Each token draw is derived from:
- the verified batch word;
- collection address;
- immutable batch ID;
- immutable reservation ID;
- token ordinal inside the reservation;
- recipient.

The result is unknown when transaction ordering determines reservation position.

## Economics

Payments remain escrowed at reservation time.

The batch random word does NOT release money.

Only successful NFT settlement moves:
- mint price -> creator proceeds;
- platform component -> platform fees.

A provider-proven terminal failure before any word exists can refund the whole failed batch and restore its
reserved supply.

Once a word exists, the batch cannot be selectively aborted.

## Request-count effect

With target batch size 20:
- 100 one-NFT reservations -> 5 randomness requests
- 1,000 one-NFT reservations -> ~50 requests
- 10,000 one-NFT reservations -> ~500 requests

With target batch size 50:
- 100 one-NFT reservations -> 2 requests
- 1,000 one-NFT reservations -> ~20 requests
- 10,000 one-NFT reservations -> ~200 requests

Low-volume timeout batches may increase request count. Provider economics will determine the best per-chain target.

## Still experimental

Phase 2B does not select the production randomness vendor. It proves that provider cost can be amortized across
many collectors while preserving a one-signature mint experience and secure, unpredictable assignment.
