// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

error RFV2_ZeroPermutationModulus();
error RFV2_PermutationIndexOutOfRange();

/// @notice O(1)-state bijection used by RelicCollectionV2 delayed reveal.
/// @dev f(x) = (a*x + b) mod N, where gcd(a,N)=1.
///      One verified seed fixes a complete token-index -> recipe permutation without per-token writes.
library RFRevealPermutationV2 {
    bytes32 private constant MULTIPLIER_DOMAIN = keccak256("RELIC_FORGE_REVEAL_V2_MULTIPLIER");
    bytes32 private constant OFFSET_DOMAIN = keccak256("RELIC_FORGE_REVEAL_V2_OFFSET");

    function derive(uint256 seed, uint256 modulus) internal pure returns (uint256 multiplier, uint256 offset) {
        if (modulus == 0) revert RFV2_ZeroPermutationModulus();
        if (modulus == 1) return (0, 0);

        multiplier = uint256(keccak256(abi.encode(seed, MULTIPLIER_DOMAIN))) % modulus;
        if (multiplier == 0) multiplier = 1;

        while (_gcd(multiplier, modulus) != 1) {
            unchecked {
                ++multiplier;
            }
            if (multiplier >= modulus) multiplier = 1;
        }

        offset = uint256(keccak256(abi.encode(seed, OFFSET_DOMAIN))) % modulus;
    }

    function permute(uint256 index, uint256 modulus, uint256 multiplier, uint256 offset)
        internal
        pure
        returns (uint256)
    {
        if (modulus == 0) revert RFV2_ZeroPermutationModulus();
        if (index >= modulus) revert RFV2_PermutationIndexOutOfRange();
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
