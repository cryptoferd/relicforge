// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Experimental O(1) reveal permutation for Relic Forge V2.
/// @dev This is intentionally simple and auditable for the Phase 1 prototype:
///      f(x) = (a*x + b) mod N, with gcd(a,N)=1.
///      That makes f a bijection over [0,N), so recipes cannot duplicate.
///      A stronger PRP can replace this library later without changing the reveal state machine.
library RFRevealPermutationV2 {
    bytes32 private constant MULTIPLIER_DOMAIN = keccak256("RELIC_FORGE_REVEAL_V2_MULTIPLIER");
    bytes32 private constant OFFSET_DOMAIN = keccak256("RELIC_FORGE_REVEAL_V2_OFFSET");

    function derive(uint256 seed, uint256 modulus)
        internal
        pure
        returns (uint256 multiplier, uint256 offset)
    {
        require(modulus != 0, "RFV2: zero modulus");
        if (modulus == 1) return (0, 0);

        multiplier = uint256(keccak256(abi.encode(seed, MULTIPLIER_DOMAIN))) % modulus;
        if (multiplier == 0) multiplier = 1;

        while (_gcd(multiplier, modulus) != 1) {
            unchecked { ++multiplier; }
            if (multiplier >= modulus) multiplier = 1;
        }

        offset = uint256(keccak256(abi.encode(seed, OFFSET_DOMAIN))) % modulus;
    }

    function permute(
        uint256 index,
        uint256 modulus,
        uint256 multiplier,
        uint256 offset
    ) internal pure returns (uint256) {
        require(modulus != 0, "RFV2: zero modulus");
        require(index < modulus, "RFV2: index out of range");
        if (modulus == 1) return 0;
        return addmod(mulmod(index, multiplier, modulus), offset, modulus);
    }

    function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) {
            uint256 t = b;
            b = a % b;
            a = t;
        }
        return a;
    }
}
