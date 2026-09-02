# Forge Reveal V2 — Phase 2D R6 Robinhood Chain / Dice Protocol v10 Certification

Status: experimental local certification candidate only  
Relic Forge baseline: `forge-reveal-v2` at `890cb7c78e9df91cdfc5f40c3826eea7c9694bea`  
Dice source snapshot: `diceprotocol/dice-entropy` commit `466b93ae2879e2e36ecb80cd33c0ee3a1ae6a799`  
Production enabled: **false**

## R6 objective

R6 introduces a Robinhood-native randomness path using Dice Protocol v10 while preserving the most important collector UX rule: **a collector mint transaction never calls Dice**. Mint acceptance/reservation happens first; randomness dispatch is a separate permissionless executor transaction. Therefore a Dice outage, fee spike, exhausted commitment, or temporary configuration failure cannot retroactively revert a collector transaction that already succeeded.

## Mint-safety lifecycle

```text
collector requestForgeMint()
    -> validate sale/payment/supply
    -> escrow creator value + randomness contribution
    -> reserve immutable supply
    -> append reservation to batch
    -> full/final batch locks
    -> collector transaction RETURNS SUCCESS

SEPARATE TRANSACTION:
permissionless requestRandomnessForBatch(batchId)
    -> live Dice provider-ready check
    -> exact getFeeV2() quote
    -> collection hopper first
    -> Forge Reserve exact shortfall
    -> Dice requestV2(provider,userRandom,300k)

SEPARATE CALLBACK:
Dice -> adapter _entropyCallback(sequence,provider,word)
    -> adapter stores exact word FIRST
    -> best-effort 150k collection delivery
    -> callback returns

SEPARATE ORDINARY TX:
settleReady(20)
    -> mint final NFTs
```

This means users can see a successful transaction immediately even if randomness later queues. The UI should label the state as **Mint accepted — awaiting reveal**, not failed.

## Dice v10 findings locked into R6

- Robinhood mainnet chain ID: `4663`.
- DiceEntropy v10 snapshot: `0xd8a0680e7699526b57140ed4eafdcc7219dc0a0c`.
- Provider snapshot: `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6`.
- Testnet chain ID: `46630`; DiceEntropy snapshot: `0xE4F1cc334a3d5FFf8b588573921CA9e2FFE22E5c`.
- Current documented fee snapshot: exact `0.000025 ETH` (`25,000,000,000,000 wei`) through `getFeeV2()`.
- Required request path: `requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit)`. Legacy auto-random overloads are disabled in the reviewed v10 source.
- Reviewed v10 source stores `useBlockhash = false` for the explicit full-custom V2 path.
- Failed first callbacks retain `CALLBACK_FAILED` and can be retried with the same contribution/revelation pair.
- Dice refunds are optional and requester-only after the configured delay. A refund clears the request.

Primary reviewed sources:
- Dice Protocol security/developer documentation
- `diceprotocol/dice-entropy` source at commit `466b93ae2879e2e36ecb80cd33c0ee3a1ae6a799`

## Why R6 does NOT automatically call refundRequest

The adapter itself is the Dice requester. Dice permits the requester to refund an unrevealed request after the delay, but the reviewed v10 source clears the request when refunded. For Forge Reveal that creates a dangerous choice: either terminate accepted collector reservations or make a second randomness request, which would create a reroll/censorship surface.

R6 therefore exposes **no Dice refund forwarding function** and no automatic refund. If the keeper is delayed, the batch stays pending against the same Dice sequence. A late reveal of that same sequence can still settle the accepted collector mints.

This intentionally prefers delayed settlement over failed collector mints or rerolls. It does not claim that a permanently unavailable single provider can guarantee liveness forever; that remains an operational/production gate.

## Collector failure policy

- Dice provider unavailable before request: executor tx fails; collector reservation remains.
- Dice live fee above collection cap: executor tx fails; collector reservation remains.
- Dice request exists but keeper is late: batch remains pending; no automatic collector refund, no new request.
- Dice callback reaches adapter but collection delivery fails: exact word is already stored and can be replayed locally.
- Dice first callback itself fails: same sequence/contributions are retried; no second request.
- After verified word exists: reroll is impossible.

## Independent contribution requirement

Dice's single-provider commit/reveal security requires a fresh user contribution. R6 uses an external contribution-source interface and rejects zero or reused contributions. The production source must be independently generated and governed; test mocks do not satisfy this production gate.

R6 explicitly does **not** use `block.timestamp`, `block.prevrandao`, `blockhash`, sequencer-local entropy, or any block-local fallback as the user contribution or as an emergency reroll path.

## R6 local tests

Adapter/security and mint-safety tests cover:

1. collector reservations succeed while Dice is offline;
2. failed executor request leaves collector reservation/supply/accounting intact;
3. collector reservations succeed during a Dice fee spike above the collection cap;
4. executor retries after provider/fee recovery;
5. exact flat native fee + full custom contribution + 300k thin callback;
6. canonical collections only;
7. provider commitment/default-gas/refund-delay drift fails closed;
8. fresh nonzero contribution requirement;
9. exact word persisted before collection delivery;
10. failed collection delivery replays only the stored word;
11. Dice/provider callback authentication;
12. failed Dice callback retries the same sequence/result;
13. a stalled request remains pending beyond the refund delay and a late same-sequence reveal completes the mints;
14. second request for the same batch is rejected;
15. no automatic Dice refund forwarding surface.

Economics/gas tests cover exact flat fee behavior, hopper-first / exact Forge Reserve shortfall, and `DICE_REQ_20`, `DICE_WORD_20`, `DICE_SETTLE_20` gas labels.

## Production gates intentionally left open

1. Perform a real Robinhood Chain testnet request through the published Dice testnet contract and keeper.
2. Reverify mainnet bytecode/source/address/provider/fee/commitment immediately before activation.
3. Implement and audit a production-grade independent contribution source.
4. Define monitoring and incident handling for the single-provider/keeper liveness and censorship assumption.
5. Close the production security-audit gate; reviewed Dice sources explicitly do not claim a published independent third-party v10 audit.
6. Audit the production Relic Forge Dice adapter and collection integration.
7. Keep all block-local fallback randomness prohibited.

Until these gates are closed, Robinhood/Dice remains `productionEnabled: false`.
