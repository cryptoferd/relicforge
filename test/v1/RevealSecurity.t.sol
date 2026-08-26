// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract DenyRandomnessAdapterV1 is RelicRandomnessAdapterBaseV1 {
    function _requireAuthorizedConsumer(address) internal view override { revert RF_NotAuthorized(); }
    function _requestUpstream(uint256, uint256) internal override {}
    function record(uint256 id, uint256 word) external { _recordWord(id, word); }
}

contract FlakyRandomnessConsumerV1 is IRelicRandomnessConsumerV1 {
    RelicRandomnessMockV1 public immutable provider;
    bool public accept;
    uint256 public callbacks;
    uint256 public receivedWord;

    constructor(RelicRandomnessMockV1 p) { provider = p; }

    function request() external returns (uint256) { return provider.requestRandomness(777); }
    function setAccept(bool value) external { accept = value; }

    function fulfillRandomness(uint256, uint256 word) external {
        require(msg.sender == address(provider), "provider only");
        require(accept, "not yet");
        ++callbacks;
        receivedWord = word;
    }
}

contract RevealSecurityTest is RelicForgeV1Fixture {
    function testRandomnessBaseInvokesConsumerAuthorizationHook() public {
        DenyRandomnessAdapterV1 denied = new DenyRandomnessAdapterV1();
        vm.expectRevert(RF_NotAuthorized.selector);
        denied.requestRandomness(1);
    }

    function testEpochRequiresDeferredTokens() public {
        vm.expectRevert(RF_NoDeferredTokens.selector);
        collection.requestRevealEpoch();
    }

    function testOnlyConfiguredProviderCanFulfillCollection() public {
        vm.expectRevert(RF_NotRandomnessProvider.selector);
        vm.prank(BOB);
        collection.fulfillRandomness(1, 123);
    }

    function testUnknownProviderRequestRejected() public {
        vm.expectRevert(RF_BadRequest.selector);
        vm.prank(address(randomness));
        collection.fulfillRandomness(9999, 123);
    }

    function testProcessRevealIsBoundedAndPermissionless() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 5, 0, new bytes32[](0));
        collection.requestRevealEpoch();
        randomness.fulfill(1, 111);

        vm.prank(ALICE);
        collection.processReveal(2);
        assertTrue(collection.isRevealed(1), "token 1 revealed");
        assertTrue(collection.isRevealed(2), "token 2 revealed");
        assertFalse(collection.isRevealed(3), "token 3 waits");
        assertEq(collection.deferredPendingCount(), 3, "three deferred remain");

        vm.prank(CAROL);
        collection.processReveal(3);
        assertEq(collection.deferredPendingCount(), 0, "all deferred processed");
        assertTrue(collection.isRevealed(5), "last token revealed");
    }

    function testZeroStepProcessingRejected() public {
        vm.expectRevert(RF_ZeroQuantity.selector);
        collection.processReveal(0);
    }

    function testForgeAssignmentsNeverDuplicateAcrossFullSupply() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, SUPPLY, 0, new bytes32[](0));
        randomness.fulfill(1, 0xBEEF);
        collection.processReveal(SUPPLY);

        bool[] memory seen = new bool[](SUPPLY);
        for (uint256 tokenId = 1; tokenId <= SUPPLY; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < SUPPLY, "recipe in range");
            assertFalse(seen[recipe], "recipe duplicated");
            seen[recipe] = true;
        }
        assertEq(collection.totalAssignedRecipes(), SUPPLY, "all recipes assigned once");
    }

    function testDeferredForgeDeferredInterleaveSharesOnePool() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0)); // deferred #1
        collection.requestRevealEpoch(); // req 1

        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0)); // forge #2 req 2

        collection.setFutureRevealMode(collection.REVEAL_DEFERRED());
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0)); // deferred #3
        collection.requestRevealEpoch(); // req 3 scans #2 and #3, only #3 is deferred

        randomness.fulfill(3, 333);
        randomness.fulfill(2, 222);
        randomness.fulfill(1, 111);
        collection.processReveal(20);

        uint256 r1 = collection.recipeForToken(1);
        uint256 r2 = collection.recipeForToken(2);
        uint256 r3 = collection.recipeForToken(3);
        assertNotEq(r1, r2, "1 != 2");
        assertNotEq(r1, r3, "1 != 3");
        assertNotEq(r2, r3, "2 != 3");
        assertEq(collection.deferredPendingCount(), 0, "no deferred left");
    }

    function testEpochRevealDoesNotAssignFutureTokenAndCanSwitchToForge() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        collection.requestRevealEpoch();
        randomness.fulfill(1, 101);
        collection.processReveal(10);

        assertTrue(collection.isRevealed(1), "minted token revealed");
        assertEq(collection.assignedRecipePlusOne(2), 0, "future token has no recipe mapping");

        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        vm.prank(ALICE);
        collection.mint(phase, 1, 0, new bytes32[](0));
        assertEq(collection.assignedRecipePlusOne(2), 0, "Forge token waits for its own randomness");
        randomness.fulfill(2, 202);
        collection.processReveal(10);
        assertTrue(collection.isRevealed(2), "future mint Forge-reveals later");
        assertNotEq(collection.recipeForToken(1), collection.recipeForToken(2), "shared pool remains unique");
    }

    function testRandomWordCannotBeRerolled() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        randomness.fulfill(1, 123);

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        randomness.fulfill(1, 999);
    }

    function testReplayAfterFailedDeliveryUsesSameWordAndIsIdempotent() public {
        FlakyRandomnessConsumerV1 consumer = new FlakyRandomnessConsumerV1(randomness);
        uint256 id = consumer.request();
        randomness.fulfill(id, 424242); // callback fails, word remains recorded

        (address recordedConsumer,, uint256 word, bool wordReady, bool delivered) = randomness.deliveries(id);
        assertEq(recordedConsumer, address(consumer), "consumer recorded");
        assertEq(word, 424242, "same word retained");
        assertTrue(wordReady, "word ready");
        assertFalse(delivered, "failed callback not delivered");

        consumer.setAccept(true);
        bool replayed = randomness.replayFulfillment(id);
        assertTrue(replayed, "replay succeeds");
        assertEq(consumer.receivedWord(), 424242, "replay uses original word");
        assertEq(consumer.callbacks(), 1, "one successful callback");

        bool replayAgain = randomness.replayFulfillment(id);
        assertTrue(replayAgain, "already-delivered replay reports success");
        assertEq(consumer.callbacks(), 1, "successful delivery is not called twice");
    }
}
