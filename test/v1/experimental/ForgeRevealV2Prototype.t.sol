// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeMintV2Harness.sol";

contract ForgeRevealV2PrototypeTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    function _newForge(uint32 supply)
        internal
        returns (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge)
    {
        provider = new RelicRandomnessMockV2();
        forge = new RelicForgeMintV2Harness(address(provider), supply);
    }

    function testForgeRequestDoesNotMintPlaceholder() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(10_000);

        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint(ALICE, 1);

        assertEq(forge.totalCommitted(), 1, "supply reserved");
        assertEq(forge.totalMinted(), 0, "no placeholder minted");

        provider.fulfill(requestId, 0xA11CE);

        assertEq(forge.totalMinted(), 1, "mint happens after randomness");
        assertEq(forge.balanceOf(ALICE), 1, "collector owns revealed nft");
    }

    function testRandomTokenIdEqualsRecipePlusOne() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(100);

        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint(ALICE, 1);
        provider.fulfill(requestId, 123456789);

        uint256 found;
        for (uint256 tokenId = 1; tokenId <= 100; ++tokenId) {
            if (forge.ownerOf(tokenId) == ALICE) {
                found = tokenId;
                break;
            }
        }

        assertTrue(found != 0, "random token found");
        assertEq(forge.recipeForToken(found), found - 1, "token id directly selects recipe");
        assertTrue(forge.isRevealed(found), "forge nft is born revealed");
    }

    function testReservationsCannotOversellWhileWaitingForRandomness() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(3);
        provider; // silence unused warning

        vm.prank(ALICE);
        forge.requestForgeMint(ALICE, 2);

        vm.prank(BOB);
        vm.expectRevert(RF_SoldOut.selector);
        forge.requestForgeMint(BOB, 2);

        assertEq(forge.totalCommitted(), 2, "only valid reservation committed");
        assertEq(forge.totalMinted(), 0, "still no placeholder");
    }

    function testOutOfOrderRandomnessCannotChangeSettlementOrder() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(20);

        vm.prank(ALICE);
        (uint64 firstSequence, uint256 firstRequest) = forge.requestForgeMint(ALICE, 3);

        vm.prank(BOB);
        (uint64 secondSequence, uint256 secondRequest) = forge.requestForgeMint(BOB, 2);

        assertEq(firstSequence, 1, "first sequence");
        assertEq(secondSequence, 2, "second sequence");

        // Later request fulfills first. Its word is recorded but it MUST NOT draw first.
        provider.fulfill(secondRequest, 222);
        assertEq(forge.totalMinted(), 0, "later callback waits for earlier sequence");

        provider.fulfill(firstRequest, 111);

        assertEq(forge.totalMinted(), 5, "both settle once sequence gap closes");
        assertEq(forge.balanceOf(ALICE), 3, "alice quantity");
        assertEq(forge.balanceOf(BOB), 2, "bob quantity");
        assertEq(forge.nextSettleSequence(), 3, "strict sequence drained");
    }

    function testOneThousandForgeMintsNeverDuplicateTokenIds() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(1_000);

        uint256[] memory requestIds = new uint256[](20);

        for (uint256 batch; batch < 20; ++batch) {
            vm.prank(ALICE);
            (, requestIds[batch]) = forge.requestForgeMint(ALICE, 50);
        }

        // Fulfill in deliberately scrambled pairs. Strict settlement order must still hold.
        for (uint256 batch; batch < 20; batch += 2) {
            provider.fulfill(requestIds[batch + 1], 10_000 + batch + 1);
            provider.fulfill(requestIds[batch], 10_000 + batch);
        }

        // The final later request is intentionally ready behind the 50-token automatic callback
        // budget. Permissionless settlement drains it without a collector/creator signature.
        forge.settleReady(50);

        assertEq(forge.totalMinted(), 1_000, "all committed nfts minted");

        uint256 occupied;
        for (uint256 tokenId = 1; tokenId <= 1_000; ++tokenId) {
            if (forge.ownerOf(tokenId) != address(0)) ++occupied;
        }

        assertEq(occupied, 1_000, "every token id occupied exactly once");
        assertEq(forge.balanceOf(ALICE), 1_000, "collector balance");
    }

    function testFiftyTokenForgeCallbackStaysBelowCoarseBudget() public {
        (RelicRandomnessMockV2 provider, RelicForgeMintV2Harness forge) = _newForge(50);

        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint(ALICE, 50);

        uint256 gasBefore = gasleft();
        provider.fulfill(requestId, 0xF0F0F0);
        uint256 used = gasBefore - gasleft();

        // Phase 1 budget only. The exact result will be captured from Foundry output before
        // choosing production callback limits/provider settings.
        assertTrue(used < 5_000_000, "50-token forge callback unexpectedly expensive");
        assertEq(forge.totalMinted(), 50, "full callback batch minted");
    }
}
