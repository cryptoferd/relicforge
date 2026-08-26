// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract FuzzSecurityTest is RelicForgeV1Fixture {
    function testFuzz_PublicMintExactPrice(uint96 rawPrice, uint256 rawQuantity) public {
        uint96 price = uint96(_bound(rawPrice, 0, 10 ether));
        uint32 quantity = uint32(_bound(rawQuantity, 1, SUPPLY));
        uint32 phase = _createPublicPhase(price, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        uint256 cost = uint256(price) * quantity;
        vm.deal(BOB, cost + 1 ether);
        vm.prank(BOB);
        collection.mint{value: cost}(phase, quantity, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), quantity, "fuzz quantity minted");
        assertEq(address(collection).balance, cost, "exact price collected");
    }

    function testFuzz_RoyaltyMathFullUint256Domain(uint96 rawBps, uint256 salePrice) public {
        uint96 bps = uint96(_bound(rawBps, 0, 10_000));
        collection.setRoyalty(ROYALTY, bps);
        (, uint256 amount) = collection.royaltyInfo(1, salePrice);
        uint256 expected = (salePrice / 10_000) * bps + ((salePrice % 10_000) * bps) / 10_000;
        assertEq(amount, expected, "overflow-safe royalty math");
        assertTrue(amount <= salePrice, "royalty never exceeds sale price");
    }

    function testFuzz_ForgeRevealPoolUnique(uint256 seed) public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, SUPPLY, 0, new bytes32[](0));
        randomness.fulfill(1, seed);
        collection.processReveal(SUPPLY);

        bool[] memory seen = new bool[](SUPPLY);
        for (uint256 id = 1; id <= SUPPLY; ++id) {
            uint256 recipe = collection.recipeForToken(id);
            assertFalse(seen[recipe], "duplicate recipe under fuzz seed");
            seen[recipe] = true;
        }
    }

    function testFuzz_WalletLimit(uint256 rawLimit) public {
        uint32 limit = uint32(_bound(rawLimit, 1, SUPPLY - 1));
        uint32 phase = _createPublicPhaseWithLimits(0, 0, limit);
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, limit, 0, new bytes32[](0));

        vm.expectRevert(RF_WalletLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }
}
