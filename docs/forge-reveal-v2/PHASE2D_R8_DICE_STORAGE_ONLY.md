# Phase 2D R8 — Robinhood Dice v10 Storage-Only Callback Hardening

Status: **live Robinhood Chain Testnet storage-only callback and permissionless exact-word replay certified; production remains disabled pending the remaining security, contribution-source, mainnet re-verification, and operational gates.**

R8 builds on the successful R7 live result from 2026-09-02:

- Robinhood Chain Testnet chain ID `46630`;
- Dice testnet oracle `0xE4F1cc334a3d5FFf8b588573921CA9e2FFE22E5c`;
- provider `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6`;
- exact fee `25000000000000` wei;
- real sequence `839`;
- real callback observed exactly once;
- final R7 word `0xb2ac9fa8b188aff5a66c8a033ffc20062b6b8d761d14945cb8889d5ef652c389`;
- live provider `defaultGasLimit == 0`;
- no refund, replacement request, or reroll.

## Why R8 exists

R7 proved Dice request/keeper/callback liveness but also proved that the live provider currently uses Dice's zero-default **remaining-gas** branch. In the reviewed Dice v10 source, that branch clears provider request/retry state before attempting the consumer callback. If the callback fails before Relic records the random word, provider-side retry is unavailable.

R8 reduces that failure surface by removing all downstream collection work from the Dice callback.

## R8 upstream callback invariant

The R8 adapter callback may only:

1. authenticate `msg.sender == pinned Dice`;
2. authenticate the pinned Dice provider;
3. resolve `sequenceNumber -> localRequestId`;
4. reject unknown or already fulfilled requests;
5. store the exact verified Dice word;
6. mark the word ready;
7. emit the word-record events;
8. return.

It must **not**:

- call the collection;
- settle NFTs;
- loop over collectors/tokens;
- transfer ETH;
- call Forge Reserve;
- request replacement randomness;
- call Dice refund functions.

## Three-transaction recovery pipeline

For Robinhood/Dice the hardened path is deliberately split:

1. **collector transaction** — reserve payment/supply; never call Dice;
2. **Dice callback transaction** — storage-only exact word persistence;
3. **permissionless delivery/settlement transactions** — replay the stored word to the collection and settle NFTs later.

A collection delivery failure therefore cannot cause the upstream Dice callback to fail after the word has reached Relic Forge. `replayFulfillment(localRequestId)` reuses only the exact stored word and can be called again permissionlessly.

## Zero-default provider mode

Unlike the older R6/R7 thin adapter, the R8 storage-only adapter may report provider-ready while Dice `defaultGasLimit == 0`, provided all other provider checks pass. This is **not** equivalent to claiming Dice offers provider-side retry in zero-default mode. R8 explicitly reports that provider-side callback retry is not expected in that configuration.

The justification for allowing zero-default mode is narrow: the upstream callback has been reduced to authenticated local persistence only and must pass both local gas-envelope testing and a real R8 live callback before the R8 candidate can be advanced.

## Live R8 certification target

The live R8 runner must prove on Robinhood Chain Testnet:

- exact pinned Dice/provider/fee configuration;
- deployment of the storage-only adapter path;
- a fresh OS-CSPRNG contribution;
- one real Dice request;
- one real Dice keeper callback into the storage-only adapter;
- `wordReady == true` and `delivered == false` immediately after the upstream callback;
- an intentionally failing downstream `replayFulfillment()` leaves the exact stored word unchanged;
- a later permissionless replay delivers the same word successfully;
- exactly one final downstream delivery;
- no provider refund;
- no replacement randomness request;
- no reroll.

## Collector mint UX invariant

R8 does not move Dice into the collector transaction. An already successful collector reservation cannot be reverted by a later provider outage, fee spike, delayed callback, or downstream delivery failure.

The remaining extreme failure mode is provider/keeper failure before the storage-only callback performs its durable word write. R8 minimizes that callback surface and certifies it live; production monitoring and incident response remain required because the live zero-default Dice mode itself does not provide an upstream retry state after a failed callback attempt.

## Production status

`productionEnabled` remains `false` in R8.

Remaining gates include:

- residual zero-default risk: if the storage-only callback itself fails before persistence, Dice provider-side retry is unavailable in the observed live mode;
- production-grade independent user-contribution source;
- Robinhood mainnet Dice address/bytecode/provider configuration re-verification;
- production security/audit gate for Dice and Relic adapter;
- keeper/provider liveness monitoring and incident runbook;
- explicit operational decision on the residual zero-default keeper under-gassing/censorship risk;
- final governed deployment/rotation controls.

## Reviewed R8 live result â€” 2026-09-02

The R8 storage-only design was exercised against the real Robinhood Chain Testnet Dice deployment:

- adapter: 0x7aEfe2e217DC22b46B8ddECe6d5bD8d561DD3850;
- downstream consumer: 0x96A6513cF07f370da3cfaF8d4592adcea36EeF66;
- adapter deployment tx: 0xa93bc1017ec6c310bf895515d96081226aab3382750a8a50276a44a55c27f45b;
- consumer deployment tx: 0xe488950a44f1ec2a17c19838eef40c437ee55eed0befac7891c3585d8f325147;
- Dice request tx: 0x05771a9eb206fc98988463b680b2ba1dcc3d5171f61abfc7cd83988ab284ff2e;
- Dice sequence: 840;
- exact request fee: 25000000000000 wei;
- live provider mode: defaultGasLimit == 0 / remaining-gas callback mode;
- exact stored word: 0x96eb0d68e93e9539108a961f1e85bff08774ee7e8107d6aaf78dc47b72e3de14 (68262228898813349305827763738903909819587598674475084628255051467992357658132 decimal);
- immediately after the real upstream callback: wordReady == true, delivered == false, downstream deliveryCount == 0;
- an intentionally rejected permissionless replay left the stored word unchanged;
- the v7 recovery broadcast then exposed a Robinhood gas-estimation issue: tx 0x9930fc6df2d7e53fc07746e689683a4e74cf6e454274167e0b119b35f389961d sent the consumer enable call with gas limit 30044, consumed exactly 30044, and failed out-of-gas before changing consumer state;
- recovery was resumed without a new Dice request using explicit transaction gas limits (200000 for the consumer toggle and 500000 for exact-word replay);
- final independently re-read state: wordReady == true, delivered == true, consumer revertDelivery == false, deliveryCount == 1, and lastWord == storedWord;
- no Dice refund, replacement request, cross-provider fallback, or reroll was performed.

The gas-estimation failure was outside the randomness callback and did not alter or replace the persisted Dice word. R8-v8 live tooling therefore uses explicit conservative gas limits for the downstream recovery transactions on Robinhood testnet.