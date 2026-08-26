// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract ReentrantPayoutV1 {
    RelicCollectionV1 public immutable collection;
    uint256 public receives;

    constructor(RelicCollectionV1 c) { collection = c; }

    receive() external payable {
        ++receives;
        try collection.withdraw() {} catch {}
    }
}

contract RejectingPayoutV1 {
    receive() external payable { revert("reject"); }
}

contract AccessControlSecurityTest is RelicForgeV1Fixture {
    function testNonControllerCannotChangeSaleControls() public {
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.createPhase(0, 0, 0, 0, 0, bytes32(0), 0, 0, true);

        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setPhaseEnabled(phase, false);

        uint8 forgeMode = collection.REVEAL_FORGE();
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        collection.setFutureRevealMode(forgeMode);
    }

    function testRelicForgeInfrastructureHasNoAdminAuthority() public {
        address[3] memory infra = [address(factory), address(renderer), address(randomness)];
        for (uint256 i; i < infra.length; ++i) {
            vm.expectRevert(RF_NotController.selector);
            vm.prank(infra[i]);
            collection.setMasterMintEnabled(true);
        }
    }

    function testOnlyCreatorCanConfigureUnsealedProjectData() public {
        (, RelicProjectDataV1 d) = _newUnsealed(1, 1);
        vm.expectRevert(RF_NotController.selector);
        vm.prank(BOB);
        d.addArtShard(hex"01");
    }

    function testRenderConfigLocksWhenContentSeals() public {
        vm.expectRevert(RF_ContentSealed.selector);
        collection.setRenderConfig("https://example.invalid/", true, 1);
    }

    function testRenderConfigCanBeChosenBeforeSealThenBecomesImmutable() public {
        (RelicCollectionV1 c, RelicProjectDataV1 d) = _newUnsealed(2, 1);
        c.setRenderConfig("https://cdn.example/", true, 0);
        _configureAndSealData(d, 2);
        assertEq(c.flattenedRenderBaseURI(), "https://cdn.example/", "base uri stored");

        vm.expectRevert(RF_ContentSealed.selector);
        c.setRenderConfig("https://evil.example/", true, 1);
    }

    function testRenounceBlockedWithDeferredTokens() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));

        vm.expectRevert(RF_RenounceUnsafe.selector);
        collection.renounceControl();
    }

    function testRenouncedCollectionCanContinuePreconfiguredForgeMint() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        collection.renounceControl();

        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        randomness.fulfill(1, 12345);
        collection.processReveal(10);
        assertTrue(collection.isRevealed(1), "renounced Forge sale must remain operational");
    }

    function testRenounceIsIrreversible() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        collection.renounceControl();

        vm.expectRevert(RF_Renounced.selector);
        collection.setPayoutReceiver(ALICE);
        vm.expectRevert(RF_Renounced.selector);
        collection.setRoyalty(ALICE, 100);
        vm.expectRevert(RF_Renounced.selector);
        collection.creatorMint(ALICE, 1);
    }

    function testAnyoneCanTriggerWithdrawButCannotRedirect() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));
        assertEq(address(collection).balance, 1 ether, "mint revenue held");

        uint256 beforeBalance = PAYOUT.balance;
        vm.prank(ALICE);
        collection.withdraw();
        assertEq(PAYOUT.balance, beforeBalance + 1 ether, "only payout receiver gets funds");
        assertEq(address(collection).balance, 0, "collection drained to payout");
    }

    function testWithdrawReentrancyCannotDoubleSpend() public {
        ReentrantPayoutV1 receiver = new ReentrantPayoutV1(collection);
        collection.setPayoutReceiver(address(receiver));
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));

        collection.withdraw();
        assertEq(address(receiver).balance, 1 ether, "receiver gets exactly one payout");
        assertEq(receiver.receives(), 1, "reentrant callback cannot cause second payout");
        assertEq(address(collection).balance, 0, "no residual balance");
    }

    function testRejectingPayoutCannotRedirectFunds() public {
        RejectingPayoutV1 receiver = new RejectingPayoutV1();
        collection.setPayoutReceiver(address(receiver));
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));

        vm.expectRevert(RF_WithdrawFailed.selector);
        collection.withdraw();
        assertEq(address(collection).balance, 1 ether, "failed payout leaves funds in collection");
    }
}
