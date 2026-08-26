// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract RelicForgeV1SmokeTest is RelicForgeV1Fixture {
    function testCollectionStartsPaused() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        vm.expectRevert(RF_PublicSalePaused.selector);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));
    }

    function testDynamicPhaseSchedule() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp + 1 days));
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_PhaseNotStarted.selector);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));

        collection.updatePhase(phase, 1 ether, uint64(block.timestamp), 0, 0, 0, bytes32(0), 0, 100);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 1, "dynamic start should permit mint");
    }

    function testHybridEpochThenForgeOutOfOrderFulfillment() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        collection.requestRevealEpoch();

        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));

        randomness.fulfill(2, 222);
        collection.processReveal(10);
        assertFalse(collection.isRevealed(2), "sequence 2 must wait for sequence 1");

        randomness.fulfill(1, 111);
        collection.processReveal(10);

        assertTrue(collection.isRevealed(1), "epoch token should reveal");
        assertTrue(collection.isRevealed(2), "forge token should reveal");
        assertNotEq(collection.recipeForToken(1), collection.recipeForToken(2), "recipes must be unique");
    }

    function testRenouncePreservesRoyaltyAndPayout() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        collection.renounceControl();
        assertEq(collection.controller(), address(0), "controller must be burned");
        assertEq(collection.payoutReceiver(), PAYOUT, "payout survives renounce");
        (address receiver, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        assertEq(receiver, ROYALTY, "royalty receiver survives renounce");
        assertEq(amount, 0.05 ether, "royalty bps survives renounce");

        vm.expectRevert(RF_Renounced.selector);
        collection.setMasterMintEnabled(true);
    }
}
