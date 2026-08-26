// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract GasDoSSecurityTest is RelicForgeV1Fixture {
    function testMintFromHighPhaseIdRemainsMappingBounded() public {
        for (uint256 i; i < 250; ++i) {
            collection.createPhase(
                0, uint64(block.timestamp), 0, 0, 0, bytes32(0), collection.ACCESS_PUBLIC(), 0, false
            );
        }

        uint32 phase = collection.createPhase(
            0, uint64(block.timestamp), 0, 0, 0, bytes32(0), collection.ACCESS_PUBLIC(), 100, true
        );
        collection.setMasterMintEnabled(true);

        vm.startPrank(BOB);
        uint256 gasBefore = gasleft();
        collection.mint(phase, 1, 0, new bytes32[](0));
        uint256 used = gasBefore - gasleft();
        vm.stopPrank();

        assertTrue(used < 500_000, "high phase id mint unexpectedly expensive");
        assertEq(collection.totalMinted(), 1, "mint succeeded");
    }

    function testMaxMintBatchGasStaysBelowCoarseBudget() public {
        (RelicCollectionV1 c, RelicProjectDataV1 d) = _newUnsealed(50, 1);
        _configureAndSealData(d, 50);

        uint32 phase = c.createPhase(
            0, uint64(block.timestamp), 0, 0, 0, bytes32(0), c.ACCESS_PUBLIC(), 1, true
        );
        c.setMasterMintEnabled(true);

        vm.startPrank(BOB);
        uint256 gasBefore = gasleft();
        c.mint(phase, 50, 0, new bytes32[](0));
        uint256 used = gasBefore - gasleft();
        vm.stopPrank();

        assertTrue(used < 8_000_000, "50-token mint unexpectedly expensive");
        assertEq(c.totalMinted(), 50, "full batch minted");
    }

    function testFiftyTokenEpochProcessingStaysBelowCoarseBudget() public {
        (RelicCollectionV1 c, RelicProjectDataV1 d) = _newUnsealed(50, 1);
        _configureAndSealData(d, 50);

        uint32 phase = c.createPhase(
            0, uint64(block.timestamp), 0, 0, 0, bytes32(0), c.ACCESS_PUBLIC(), 1, true
        );
        c.setMasterMintEnabled(true);
        vm.prank(BOB);
        c.mint(phase, 50, 0, new bytes32[](0));

        (, uint256 requestId) = c.requestRevealEpoch();
        randomness.fulfill(requestId, 0x123456);

        uint256 gasBefore = gasleft();
        c.processReveal(50);
        uint256 used = gasBefore - gasleft();

        assertTrue(used < 12_000_000, "50-token reveal unexpectedly expensive");
        assertEq(c.totalAssignedRecipes(), 50, "all recipes assigned");
        assertEq(c.deferredPendingCount(), 0, "no deferred remain");
    }

    function testRevealStepLimitActuallyBoundsWork() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 10, 0, new bytes32[](0));

        (, uint256 requestId) = collection.requestRevealEpoch();
        randomness.fulfill(requestId, 999);

        collection.processReveal(3);
        assertEq(collection.totalAssignedRecipes(), 3, "only three assignments");
        assertEq(collection.deferredPendingCount(), 7, "seven remain deferred");
        assertTrue(collection.isRevealed(1), "token 1");
        assertTrue(collection.isRevealed(3), "token 3");
        assertFalse(collection.isRevealed(4), "token 4 waits");
    }
}
