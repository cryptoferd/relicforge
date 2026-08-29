# RelicForge Contracts V1 â€” RC3.2 Slither Remediation

RC3.2 starts from the green RC3.1 baseline:

- 98/98 tests
- 20,000 fuzz cases
- 3 stateful invariants Ã— 64,000 calls
- gas/DoS suite green
- Slither 0.11.6 baseline: 28 findings

## Findings remediated in RC3.2

### Randomness delivery reentrancy

`RelicRandomnessAdapterBaseV1._deliver()` now pre-locks a delivery before invoking the collection callback. A reentrant call to `replayFulfillment()` therefore cannot recursively redeliver the same word. If the callback fails, the lock is restored to pending so the exact same stored word remains permissionlessly replayable.

A dedicated malicious reentrant consumer regression test enforces this behavior.

### Data-shard locked ETH

The shard creation constructor is no longer payable. More importantly, the one-byte runtime prefix changes from `STOP (0x00)` to `INVALID (0xfe)`. This preserves the existing data offset while causing ordinary calls/value transfers to revert instead of silently accepting and trapping ETH.

As with every EVM contract, forced ETH (for example via protocol-level mechanisms) cannot be fully prevented; no RelicForge accounting depends on a shard ETH balance.

### Reveal loop external call

Recipe assignment now uses the collection's stored `maxSupply`, which was validated against the project-data contract during initialization. This removes an external `maxSupply()` call from every recipe assignment inside bounded reveal processing.

### Renderer local initialization

The renderer's MIME local is now explicitly initialized, removing Slither's `uninitialized-local` finding without changing supported encodings.

### DNA configuration audit event

`setDNAConfig()` now emits `DNAConfigSet(recipeCount, recipesPerShard)`.

## Findings intentionally retained/documented

### `arbitrary-send-eth`

The direct-funded VRF adapter sends only the wrapper-quoted request price to the adapter's immutable Chainlink VRF wrapper. The wrapper address cannot be selected by a minter or collection, request price is capped by immutable `maxRequestPriceWei`, and each collection spends only its isolated credit.

### `encode-packed-collision`

The renderer uses `abi.encodePacked` for SVG/JSON/URI display concatenation. These values are not authentication hashes, signatures, Merkle leaves, authorization keys, or uniqueness commitments. Collision ambiguity is therefore not used as a security boundary.

### `divide-before-multiply`

The Base64 output-length expression is the standard ceiling calculation. ERC-2981 royalty math deliberately decomposes quotient/remainder so multiplication remains safe across the full `uint256` sale-price domain; this behavior is fuzz-tested.

### `timestamp`

Mint phase start/end logic intentionally uses `block.timestamp`. Validator timestamp tolerance is acceptable for sale scheduling; timestamps are not used as randomness, entropy, or a financial oracle.

### Renderer calls inside loops

Renderer loops are read-only and bounded by sealed collection configuration. V1 caps layers at 64 and one-of-one custom attributes at 64. These calls affect view/render cost, not state-changing liveness.

### Benign/event-order reentrancy reports

Factory initialization targets fixed RelicForge clone implementations. VRF credit withdrawal follows checks-effects-interactions and reverts atomically on failed transfer. Provider/wrapper addresses are immutable after the one-time deployment binding.

## Next gate

RC3.2 is not accepted until GitHub Actions:

1. Compiles with Solidity 0.8.30 / Foundry 1.7.1.
2. Passes all runtime-size gates.
3. Passes the expanded test suite.
4. Passes fuzz and invariant campaigns.
5. Produces a fresh `slither-rc3.2` artifact for detector-count comparison.