# RelicForge Contracts V1 â€” RC4 Platform Fees

RC4 adds platform monetization while preserving the creator-control boundary established in RC1â€“RC3.

## Fee modes

### Sponsored

The creator pays the current sponsored rate multiplied by collection max supply at creation.
Initial default: **$0.25 per NFT of max supply**.

After successful sponsored creation, minters never owe a RelicForge mint fee for that collection.

### Minter Supported

The creator pays no upfront RelicForge platform fee.
Initial default: **$0.50 per NFT actually minted**.

The platform component is quoted in native currency from the collection's locked cents-per-NFT value.

## Locked collection terms

A collection permanently stores:

- its fee mode;
- its cents-per-NFT rate at creation;
- the fee-policy contract.

Changing platform defaults affects only collections created afterward.

The platform admin can globally pause/resume fee collection and can permanently waive a collection.
There is intentionally no function to unwaive a collection.

## Platform authority boundary

The fee-policy admin can:

- toggle platform fees globally;
- change Sponsored/Minter-Supported defaults for future collections;
- change the platform treasury;
- permanently waive a collection;
- transfer the fee-policy admin role.

The fee-policy admin **cannot** change:

- collection art or DNA;
- max supply;
- creator mint phases or creator mint price;
- payout receiver;
- royalties;
- reveal mode/state;
- collection controller;
- NFT ownership.

## Oracle safety

Native/USD conversion uses an immutable Chainlink-compatible feed and immutable maximum oracle age.

If the feed is stale, invalid, or reverts, the platform fee fails open to zero. A platform oracle outage must not halt a creator's mint.

When the oracle is healthy, underpayment reverts. Overpayment is never counted as extra platform revenue; it remains creator proceeds.

## Fund segregation

Minter-supported fees are reserved in the collection as `accruedPlatformFees`.

- `withdraw()` sends only `balance - accruedPlatformFees` to the creator's payout receiver.
- `withdrawPlatformFees()` forwards only reserved platform funds to the fee policy.
- `feePolicy.withdrawFees()` can be called by anyone but can only pay the configured platform treasury.

A failed platform-treasury transfer rolls back accounting and leaves platform funds recoverable.

## Audit status

RC4 remains unaudited. Internal unit, fuzz, invariant, gas/DoS, Slither, and live-chain testing reduce risk but do not replace an independent audit.