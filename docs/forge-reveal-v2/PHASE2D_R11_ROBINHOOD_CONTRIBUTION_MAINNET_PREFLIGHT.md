# Forge Reveal V2 — Phase 2D R11 Robinhood Contribution Source + Mainnet Read-Only Preflight

Baseline branch: `forge-reveal-v2`  
Baseline commit: `d31f7b1f3a1c26dd43fd4e578a86126f1c2220ad`  
Baseline tree: `4d31968cbcccf2775e1bf7c8f1392bf7b7c09849`  
R11 status: **local certified; Robinhood mainnet read-only fork preflight passed**  
Production enabled: **NO**

## Purpose

R10 froze the Robinhood Factory-V2-facing randomness seam. R11 addresses the next two production prerequisites without changing that seam:

1. a collector/team-derived Dice user-contribution source that cannot be selected by the permissionless RNG executor; and
2. a read-only Robinhood mainnet fork preflight against the documented Dice v10 deployment.

R11 does not activate production, does not make a mainnet randomness request, and does not introduce a refund/reroll or provider fallback.

## Collector contribution model

The R11 queue candidate requires a fresh nonzero `bytes32` supplied with every collector or creator/team mint call. The web client is expected to generate this value off-chain using a cryptographically secure source such as `crypto.getRandomValues()`.

The queue hashes accepted entropy into a batch accumulator together with chain, collection, batch, reservation, payer, recipient, and quantity domains. The contribution is only exposed once the batch is locked. No `block.prevrandao`, `block.timestamp`, `blockhash`, sequencer-local entropy, RNG executor address, or RNG executor chosen nonce is used.

The R11 contribution source then domain-separates that frozen batch value and only releases it when:

- the collection is canonical;
- the caller is the randomness adapter already bound to that collection; and
- the batch contribution is locked and nonzero.

The permissionless RNG executor therefore decides **when** a locked batch is dispatched, but not **which contribution** Dice receives.

## Security boundary

The contribution source is one side of Dice's two-party contribution model. Its local R11 certification does not eliminate Dice's remaining single-provider censorship/selective-liveness trust assumption. Relic Forge still preserves the original Dice request indefinitely after creation and does not automatically refund, reroll, or switch providers.

R11 also does not claim that collector software can never be compromised. Production UI work must generate entropy locally in the browser/wallet client and must never replace it with a server-selected value.

## Mainnet read-only snapshot expected by R11-v1

Current Dice/Robinhood documentation reviewed on 2026-09-02 reports:

- Robinhood Chain ID: `4663`
- DiceEntropy v10: `0xd8a0680e7699526b57140ed4eafdcc7219dc0a0c`
- provider/keeper: `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6`
- exact fee: `25000000000000` wei (`0.000025 ETH`)
- provider default gas limit: `200000`
- refund delay: `6` L1 blocks

The installer runs `RobinhoodMainnetForkPreflightR11.t.sol` with a Robinhood mainnet fork. It sends no transaction and needs no private key. The fork asserts live runtime code exists, provider commitment/range are live, fee/refund/default-gas snapshots match, and the R10 frozen adapter reports `providerReady()` against the live contract.

## R11-v1 focused local matrix

The contribution-source suite checks:

- entropy-less legacy mint entrypoints fail closed;
- zero entropy cannot reserve supply;
- full 20-NFT batch freezes contribution before provider request;
- timed-out partial batch freezes contribution without provider call;
- mint-out partial batch freezes immediately;
- different collector entropy changes the frozen contribution;
- permissionless executor cannot select/change the contribution;
- only the collection-bound adapter may consume a canonical contribution;
- collector contribution survives the R8/R9 storage-only callback → exact-word replay → settlement pipeline;
- creator/team entropy can span and freeze multiple batches.

## Minimal Phase 2C harness change

R11 adds only the Solidity `virtual` keyword to the existing two Phase 2C mint entrypoints so the entropy-enforcing experimental queue can override and disable those legacy signatures. The original Phase 2C behavior and tests remain unchanged.

Because the R10 baseline already contains unrelated formatter drift in `RelicForgeBatchQueueV2Harness.sol`, R11 must not run global `forge fmt` on that existing file. The installer validates the exact two-line `virtual` patch, formats/checks only the new R11 Solidity files, then runs full regression.

## R11 validation result

Reviewed local validation on 2026-09-02 passed:

- `forge build`
- focused contribution-source suite: **10 passed / 0 failed**
- Robinhood mainnet read-only fork preflight: **5 passed / 0 failed**
- all Phase 2D tests: **119 passed / 0 failed**
- all experimental tests: **194 passed / 0 failed**
- full repository regression: **318 passed / 0 failed**
- `git diff --check`
- no mainnet transaction sent
- no private key used
- `productionEnabled` remains `false` and mainnet activation remains blocked

## Gates that remain after R11

Even if R11 passes locally and on the read-only mainnet fork, Robinhood production remains blocked by:

1. reviewed live R11 output and final certification metadata;
2. source/bytecode equivalence review of the mainnet Dice deployment immediately before activation;
3. a live mainnet storage-only request/callback certification or an explicitly accepted equivalent gate;
4. single-provider keeper/fee/commitment/chain-exhaustion monitoring and incident runbook;
5. production adapter + contribution-source security review/audit;
6. explicit production activation decision.

`productionEnabled` remains `false` throughout R11.
