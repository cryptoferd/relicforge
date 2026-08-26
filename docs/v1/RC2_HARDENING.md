# RelicForge Contracts V1 RC2 Hardening Notes

RC2 is a security-focused update to RC1. It does not wire the Studio to production contracts yet.

## Contract hardening changes

1. **DNA reads are bounds checked at read time.** `extcodecopy` zero-pads out-of-range reads, so validation now rejects a recipe whose bytes are not actually present in its DNA shard.
2. **Seal-time work is bounded.** Full recipe validation remains sequential/batched; `sealContent` no longer loops over every required DNA shard after those recipes have already been bounds-validated.
3. **DNA shard configuration sanity.** A configured full shard cannot require more than the 23,000-byte immutable shard payload ceiling.
4. **Reveal cursors widened to uint64.** Internal reveal range/cursor/sentinel values can safely advance one past the maximum uint32 token ID without overflow.
5. **Mint boundary arithmetic widened before comparisons.** Supply, phase-supply, wallet-limit, and allowlist-limit additions are evaluated in uint256 before comparison.
6. **Royalty math is overflow-safe for the full uint256 sale-price domain.** The ERC-2981 calculation no longer multiplies `salePrice * bps` before division.
7. **Render configuration locks with content.** Canonical/offchain render policy can be chosen before content seal but cannot be changed by the creator after the collection content becomes immutable.
8. **Randomness adapter consumer authorization is fail-closed by design.** The base adapter now requires every production adapter to implement an authorization hook. The test mock explicitly remains open and is never a production provider.
9. **Randomness replay is idempotent after successful delivery.** Failed callbacks may replay the same stored word; successful callbacks are not delivered a second time.

## CI expectations
The package should be pushed only to `contracts-v1-production`. GitHub Actions must compile with Solidity 0.8.30, enforce EIP-170 runtime limits on production deployables, and pass every unit/fuzz/invariant test before RC2 is accepted.
