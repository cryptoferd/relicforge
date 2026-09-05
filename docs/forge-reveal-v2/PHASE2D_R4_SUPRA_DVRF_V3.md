# Forge Reveal V2 — Phase 2D R4 Supra dVRF V3 Certification

Status: experimental local certification candidate only  
Relic Forge baseline: `forge-reveal-v2` at `357ee0cb63939fb877b8722bca5e426519a74de2`  
Provider documentation review: 2026-09-01  
Production enabled: **false**

## R4 objective

R4 evaluates Supra dVRF V3 for Forge Reveal V2 using the same persist-first thin-callback architecture proven in R1–R3. Supra offers strong callback-liveness and request-integrity features, but its third-party EVM product is a prepaid **client-wallet subscription**. R4 therefore focuses on two independent questions:

1. Can Supra deliver one verified word through the Relic Forge thin adapter while preserving exact-word replay/no-reroll and deferred NFT settlement?
2. Can the Phase 2C collection hopper / Forge Reserve model attribute and fund each collection's Supra cost without one collection draining shared subscription liquidity?

R4 deliberately keeps these questions separate. Passing the callback/security tests does not imply that the subscription accounting model is production safe.

## Official-source findings locked into R4

### 1. Current V3 EVM request ABI

Supra's current third-party EVM guide documents two `generateRequest` overloads. R4 uses the custom-seed form:

```solidity
function generateRequest(
    string memory functionSig,
    uint8 rngCount,
    uint256 numConfirmations,
    uint256 clientSeed,
    address clientWalletAddress
) external returns (uint256 nonce);
```

The documented callback shape is:

```solidity
function callback(uint256 nonce, uint256[] memory rngList) external;
```

R4 requests one random number, three confirmations, and binds a nonzero client seed to the adapter address, canonical collection, immutable collection context, and local request ID. The seed is used for request binding/auditability, not as a weak substitute for the dVRF proof.

Primary source:
- https://docs.supra.com/dvrf/build-third-party-evm-networks/request-random-numbers

### 2. Supra V3 uses a client-wallet prepaid subscription

Supra documents a two-contract EVM design:

- Router: request/callback delivery
- Deposit: client funds, contract whitelisting, and callback gas configuration

A client wallet owns/funds the subscription and whitelists requester contracts under it. Only whitelisted contracts can request.

The current utility interface documents:

```solidity
function depositFundClient() external payable;
function checkClientFund(address clientAddress) external view returns (uint128);
function checkMinBalanceClient(address clientAddress) external view returns (uint128);
function isMinimumBalanceReached(address clientAddress) external view returns (bool);
function getContractDetails(address contractAddress) external view returns (uint128, uint128);
```

The documented `depositFundClient()` call has **no target-client argument**. Combined with Supra's description of the client wallet as the subscription owner, R4 treats direct collection-to-subscription funding as unavailable through the published client API: the adapter cannot atomically call `depositFundClient()` to credit a different EOA client wallet's subscription.

That is an architectural inference from the published ABI/ownership model and remains a production gate that must be confirmed against the live V3 Deposit implementation before deployment.

Primary sources:
- https://docs.supra.com/dvrf/build-third-party-evm-networks/getting-started
- https://docs.supra.com/dvrf/build-third-party-evm-networks/deposit-and-withdraw-funds
- https://docs.supra.com/dvrf/build-third-party-evm-networks/other-functions

### 3. Callback gas settings are subscription/contract configuration, not request parameters

V3 exposes subscription-level `maxGasPrice` / `maxGasLimit` and optional per-contract `callbackGasPrice` / `callbackGasLimit`. A requester contract's callback settings must stay within the client's maximums.

R4 requires the adapter's live contract config to be exactly 300,000 callback gas and to remain at or below a Relic Forge gas-price ceiling. Configuration drift fails closed before a new request is accepted.

Primary source:
- https://docs.supra.com/dvrf/build-third-party-evm-networks/gas-configurations

### 4. Supra V3 adds request-parameter integrity checks

Supra's V3 migration documentation states that a hash of request parameters is stored and validated during callback processing, including nonce, caller, client seed and gas details. R4's router mock stores an equivalent request hash and rejects a callback attempt carrying a mismatched hash.

Primary source:
- https://docs.supra.com/dvrf/build-third-party-evm-networks/migration-to-dvrf-3.0

### 5. V3 has an automatic retry mechanism

Supra documents automatic retry of failed callback transactions caused by insufficient gas every six hours for up to 48 hours. R4 models a cached/committed random result and verifies that retry uses the same nonce and same committed word without a second randomness request.

Relic Forge does not depend on the provider retry for collection delivery failures: once the adapter itself receives the word, it stores the exact word before calling the collection and can replay locally without another Supra request.

Primary source:
- https://docs.supra.com/dvrf/build-third-party-evm-networks/migration-to-dvrf-3.0

### 6. Subscription balance and minimum-balance rules matter to liveness

Supra V3 dynamically enforces a minimum client balance based on gas limits/prices. The current migration guide gives:

```text
minBalanceLimit = minRequests * maxGasPrice * (maxGasLimit + verificationGasValue)
```

It also states that pending requests lock withdrawals and that a client at/below the minimum balance can no longer issue new VRF requests.

R4 therefore checks `isMinimumBalanceReached`, `checkClientFund`, and `checkMinBalanceClient` before quoting/dispatching a request.

### 7. Fee model is a floor or premium over network cost

Supra's current gas documentation states:

```text
effective fee = max(
    $0.01-equivalent baseline in native token,
    estimated network cost × (1 + chain premium)
)
```

The current network table lists a 30% service premium for Ethereum and Base. R4 uses the pre-existing `RelicProviderCostModelV2.supraSubscriptionCost()` comparison model and does **not** invent an undocumented exact-fee ABI.

The provider's actual charge is still paid from the shared client subscription, not from the collection's request transaction.

### 8. R4 intentionally models collection payment as reservation escrow, not exact cost

The adapter accepts a conservative per-request reservation because the existing Phase 2C collection interface requires a request price before dispatch. The reservation remains in the adapter harness and is tracked by collection/request.

This is deliberately **not** called an exact provider charge. R4 tests both sides of the economic problem:

- if reservation >= actual subscription charge, the request's economic responsibility is conservatively covered;
- if reservation < actual charge, the difference consumes previously shared subscription liquidity;
- the adapter cannot atomically replenish the EOA-owned Supra subscription through the documented `depositFundClient()` API;
- the adapter does not have a certified exact per-request reconciliation/refund path.

This remains a production certification gate.

## Thin Supra lifecycle under test

```text
canonical Forge collection
    -> conservative R4 reservation quote
    -> hopper first / Forge Reserve reservation shortfall
    -> reservation held as adapter escrow
    -> Supra generateRequest(..., rngCount=1, confirmations=3, clientSeed, clientWallet)
    -> Supra request integrity / dVRF processing
    -> Router calls adapter supraCallback(nonce,[word])
    -> adapter stores exact final word FIRST
    -> adapter attempts 150k collection word delivery
    -> provider callback returns
    -> permissionless settleReady(20)
```

The EOA/client Supra subscription is separately prepaid and charged by Supra. R4 does not claim that the reservation escrow is automatically reconciled to that charge.

## Current network snapshot

Supra's current official V3 table lists:

### Ethereum Mainnet
- chain ID: `1`
- Router: `0x23726e27Ec79d421cf58C815D37748AfCaFeC9e4`
- Deposit: `0xb63b8391e666d21958b8b3459840594A12055D2d`
- service fee snapshot: `30%`

### Base Mainnet
- chain ID: `8453`
- Router: `0x73970504Df8290E9A508676a0fbd1B7f4Bcb7f5a`
- Deposit: `0x52Ad5Ba5c041D6cF952c476c595844c647a692Eb`
- service fee snapshot: `30%`

Robinhood Chain is not present in the current official Supra dVRF network table. Robinhood remains fail closed.

Every address, version, premium and live contract configuration must be reverified immediately before deployment.

Primary source:
- https://docs.supra.com/dvrf/learn-supra-dvrf/networks

## Audit-status snapshot

Supra publishes a security-audit index, but the current dVRF rows shown there identify Pull VRF 1.0, 2.0 and 2.1 scopes; the page does not identify a dVRF V3-specific Solidity audit. R4 therefore cannot mark the production-audit gate satisfied from the current public evidence.

Primary source:
- https://docs.supra.com/audit-reports

## R4 local test plan

### Adapter/security tests

- exact documented `generateRequest` request shape;
- one word / three confirmations / immutable client wallet;
- request-bound nonzero client seed;
- 300k contract callback gas configuration;
- callback gas-price ceiling;
- canonical collections only;
- minimum subscription balance fails closed;
- removed/unwhitelisted requester fails closed;
- per-consumer pending-request throttle;
- router-only callback authentication;
- request parameter hash tampering rejected in V3 mock;
- exact word persisted before collection delivery;
- failed collection delivery remains locally replayable;
- duplicate callback cannot reroll;
- provider callback performs no NFT settlement;
- later permissionless `settleReady(20)` completes the batch;
- retry uses same nonce and same committed word without a second request;
- collection reservation remains distinct from the actual shared subscription charge.

### Economics/gas tests

- `$0.01`-equivalent floor vs 30% premium comparison vectors;
- sufficient-reservation shared-liquidity vector;
- under-reservation shared-liquidity drain vector;
- collection hopper pays reservation first;
- Forge Reserve covers reservation shortfall;
- actual Supra mock charge hits the separate client subscription;
- adapter still knows reservation rather than exact charge;
- gas labels: `SUPRA_REQ_20`, `SUPRA_WORD_20`, `SUPRA_SETTLE_20`;
- cost labels: `SUPRA_FLOOR`, `SUPRA_PREM`, `SUPRA_RES_OK`, `SUPRA_RES_LOW`.

## Production gates intentionally left open

1. Confirm the live V3 Deposit implementation/ABI and whether any production-supported path can fund another client wallet's subscription atomically.
2. Exact per-request actual-cost attribution to the responsible collection under shared subscription liquidity.
3. Safe reservation reconciliation/refund logic if conservative reservations exceed actual charges.
4. Automated subscription replenishment without creating an unsafe hot-wallet trust boundary.
5. Live fork/test request on Ethereum and Base.
6. Reverify callback gas price/limit, minimum-balance parameters, Router and Deposit addresses at activation.
7. Verify a production-acceptable audit specifically covering the V3 contracts in use.
8. Govern the subscription wallet, contract whitelist and configuration rotation.
9. Audit the production Relic Forge adapter/reconciliation layer.
10. Keep Robinhood Chain disabled until a provider passes the same gates there.

Until these gates are closed, `productionEnabled` remains `false`.

## Current R4 conclusion target

If the local package passes, the intended status is:

```text
Ethereum / Supra dVRF V3
Base / Supra dVRF V3
status: phase2d_r4_local_harness_candidate
productionEnabled: false
```

That status means the documented request ABI, thin callback, replay/no-reroll protections, V3 request-integrity model, retry shape and subscription/reservation economics have been locally characterized. It does **not** mean Supra is approved for production Forge Reveal.
