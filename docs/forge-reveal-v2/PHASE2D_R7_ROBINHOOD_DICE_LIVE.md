# Phase 2D R7 — Robinhood Chain Dice v10 Live Certification

Status: **live Robinhood Chain Testnet liveness certified; zero-default-gas production gate remains open for R8 hardening.**

Baseline: `forge-reveal-v2 @ e120fa7c20e02b7748290062ed4a10e08dfe68ea`

## Purpose

R6 proved the Robinhood/Dice architecture locally and, critically, proved that collector mint transactions do not call Dice. R7 moves the remaining provider behavior onto the real Robinhood Chain Testnet.

R7 does **not** alter production V1 and does **not** production-enable Dice.

## Pinned live-test target

Dice repository snapshot reviewed for R7:

`466b93ae2879e2e36ecb80cd33c0ee3a1ae6a799`

Pinned Robinhood testnet target:

- chain ID: `46630`
- RPC: `https://rpc.testnet.chain.robinhood.com`
- DiceEntropy: `0xE4F1cc334a3d5FFf8b588573921CA9e2FFE22E5c`
- provider: `0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6`
- exact observed protocol/request fee: `25000000000000` wei (`0.000025 ETH`)

## Live discrepancies discovered during R7

### 1. Refund-delay selector is absent on the pinned testnet deployment

`getProtocolFee()` and both tested `getFeeV2` paths return the expected exact fee, but `getRefundDelayBlocks()` reverts with empty data. The reviewed Dice source/docs advertise that view, so the live testnet deployment is not ABI-identical to that repository snapshot for this selector.

Relic Forge never uses Dice refunds to recover an accepted collector batch. Refund-delay introspection is therefore optional diagnostics only. No automatic `refundRequest()` or replacement randomness request is exposed.

### 2. The live provider currently reports `defaultGasLimit == 0`

The live `getProviderInfoV2()` call returned a registered, unexhausted provider with a nonzero current commitment, but `defaultGasLimit` is `0`.

In the reviewed Dice v10 source, zero provider default gas has special semantics: `requestHelper()` stores a zero callback gas marker regardless of the caller's requested gas, and `revealWithCallback()` then uses the remaining-gas callback branch. That branch clears provider request/retry state before attempting the callback.

This means a caller-supplied `300000` gas value is **not** a provider-enforced callback cap while the provider default is zero.

R7-v5 handles this conservatively:

- the one-shot live probe may exercise the zero-default remaining-gas mode solely to certify real request/keeper/callback liveness;
- the production-advancement Relic Dice adapter remains fail-closed when `defaultGasLimit == 0`;
- the local Dice mock now models the zero-default remaining-gas branch and the loss of provider retry state if that callback fails;
- production activation remains blocked until this callback-gas/retry mode is explicitly accepted after hardening/audit or the live provider is configured with a bounded nonzero default.

This does **not** weaken collector mint safety. Collector mint acceptance remains separate from provider dispatch, so a Dice request/callback failure can delay settlement but cannot revert an already successful collector mint reservation.

## Mint-safety invariant

1. collector transaction reserves payment/supply and succeeds independently of Dice;
2. a later executor transaction requests randomness;
3. a provider problem can fail/delay only that later executor/provider step;
4. an already accepted collector reservation remains pending;
5. the same Dice request/result is awaited;
6. no automatic provider refund or second randomness request is used to create a reroll.

## Live certification gates

The R7 live runner must prove/record:

- chain ID exactly `46630`;
- code at the pinned Dice testnet oracle;
- exact pinned default provider;
- provider registered, unexhausted, and committed;
- exact nonzero live `getFeeV2(provider,300000)` quote below the R7 safety cap;
- optional refund-delay selector behavior;
- observed provider `defaultGasLimit` and whether Dice is in bounded-gas or remaining-gas mode;
- one-shot probe deployment;
- one real `requestV2(provider,userRandomNumber,300000)` using a fresh OS-CSPRNG contribution and exact fee;
- real Dice keeper/provider callback;
- exact callback sender/provider/sequence authentication;
- exactly one final random word recorded;
- no refund/reroll action.

A successful live probe while `defaultGasLimit == 0` certifies **liveness only**. It does not production-enable the Relic Dice adapter.

## Secrets / wallet policy

Use a throwaway testnet wallet only. Never paste its private key into chat. Supply it only through the local `R7_PRIVATE_KEY` environment variable. The live runner generates a fresh 32-byte user contribution locally with the operating-system CSPRNG.

## Completion rule

Installing R7 and passing local Foundry tests does not complete R7. The live result must show a real testnet Dice callback and be reviewed before staging/commit/push.

Remaining production gates even after a successful R7 live callback include:

- resolution/acceptance of live callback-gas and provider retry semantics, including mainnet configuration verification;
- production-grade independent user-contribution source;
- mainnet deployment/source/configuration re-verification at activation;
- keeper/provider liveness monitoring and incident runbook;
- production-acceptable Dice security/audit gate;
- Relic Forge production adapter audit/hardening.
## Reviewed R7 live result â€” 2026-09-02

A real Robinhood Chain Testnet request was broadcast through the pinned Dice deployment and fulfilled by the real Dice keeper/provider.

- probe: `0xb549b9dfe1c4b1c5C2E2950f42302Fb559dbFAF2`
- deployment tx: `0x7280615146b649603310d56088011e50a80d8dded571cd9ee9c7260ee8bc79de`
- Dice request tx: `0x7586c9f15aac81de2b124bec1124f1d367367891f09b1be156eec21e417ef0d6`
- sequence: `839`
- exact request fee: `25000000000000` wei
- request/fulfillment block: `11619002`
- final random word: `0xb2ac9fa8b188aff5a66c8a033ffc20062b6b8d761d14945cb8889d5ef652c389`
- accepted callback count: `1`
- provider default gas observed: `0`
- refund/replacement/reroll: **none**

This closes the R7 live-liveness gate. It does not production-enable Dice. The zero-default remaining-gas behavior discovered live is the direct input to R8 storage-only callback hardening.

See `PHASE2D_R7_LIVE_EVIDENCE_20260902.txt` for the reviewed evidence record.
