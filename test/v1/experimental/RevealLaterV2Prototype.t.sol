// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RFRevealPermutationV2.sol";
import "../../../contracts/production/experimental/RelicRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicRevealLaterV2Harness.sol";

contract RevealLaterV2PrototypeTest is TestBase {
    address internal constant ALICE = address(0xA11CE);

    function testTenThousandRecipePermutationIsBijective() public pure {
        uint256 supply = 10_000;
        (uint256 multiplier, uint256 offset) = RFRevealPermutationV2.derive(0xDEADBEEF, supply);

        bool[] memory seen = new bool[](supply);

        for (uint256 i; i < supply; ++i) {
            uint256 recipe = RFRevealPermutationV2.permute(i, supply, multiplier, offset);
            require(!seen[recipe], "duplicate recipe");
            seen[recipe] = true;
        }

        for (uint256 i; i < supply; ++i) {
            require(seen[i], "missing recipe");
        }
    }

    function testOneRandomWordRevealsExistingCollectionWithoutPerTokenWrites() public {
        RelicRandomnessMockV2 provider = new RelicRandomnessMockV2();
        RelicRevealLaterV2Harness reveal =
            new RelicRevealLaterV2Harness(address(provider), 10_000);

        reveal.mintHidden(ALICE, 50);

        for (uint256 tokenId = 1; tokenId <= 50; ++tokenId) {
            assertFalse(reveal.isRevealed(tokenId), "starts hidden");
        }

        uint256 requestId = reveal.requestReveal();
        provider.fulfill(requestId, 0x123456789ABCDEF);

        assertTrue(reveal.revealed(), "global reveal flag");
        assertEq(reveal.revealSeed(), 0x123456789ABCDEF, "one seed stored");

        bool[] memory seenRecipe = new bool[](10_000);
        for (uint256 tokenId = 1; tokenId <= 50; ++tokenId) {
            assertTrue(reveal.isRevealed(tokenId), "all existing tokens reveal together");
            uint256 recipe = reveal.recipeForToken(tokenId);
            assertFalse(seenRecipe[recipe], "no duplicate recipe");
            seenRecipe[recipe] = true;
        }
    }

    function testRevealRequestFreezesFutureMintingToPreventPostRevealSniping() public {
        RelicRandomnessMockV2 provider = new RelicRandomnessMockV2();
        RelicRevealLaterV2Harness reveal =
            new RelicRevealLaterV2Harness(address(provider), 100);

        reveal.mintHidden(ALICE, 10);
        reveal.requestReveal();

        vm.expectRevert(RF_EpochPending.selector);
        reveal.mintHidden(ALICE, 1);
    }

    function testTenThousandSupplyRevealCallbackIsConstantScale() public {
        RelicRandomnessMockV2 provider = new RelicRandomnessMockV2();
        RelicRevealLaterV2Harness reveal =
            new RelicRevealLaterV2Harness(address(provider), 10_000);

        reveal.mintHidden(ALICE, 1);
        uint256 requestId = reveal.requestReveal();

        uint256 gasBefore = gasleft();
        provider.fulfill(requestId, 0xBEEFCAFE);
        uint256 used = gasBefore - gasleft();

        // The callback stores a seed + two permutation parameters; it never loops over supply.
        assertTrue(used < 500_000, "one-shot reveal callback unexpectedly expensive");
        assertTrue(reveal.revealed(), "revealed");
    }

    function testDifferentSeedsProduceDifferentMappings() public pure {
        uint256 supply = 10_000;

        (uint256 a1, uint256 b1) = RFRevealPermutationV2.derive(111, supply);
        (uint256 a2, uint256 b2) = RFRevealPermutationV2.derive(222, supply);

        uint256 differences;
        for (uint256 token = 0; token < 20; ++token) {
            uint256 r1 = RFRevealPermutationV2.permute(token, supply, a1, b1);
            uint256 r2 = RFRevealPermutationV2.permute(token, supply, a2, b2);
            if (r1 != r2) ++differences;
        }

        assertGt(differences, 0, "different seeds should change mapping");
    }
}
