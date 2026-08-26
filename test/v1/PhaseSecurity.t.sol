// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract PhaseSecurityTest is RelicForgeV1Fixture {
    function testDisabledPhaseCannotMint() public {
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, bytes32(0), 0, 1, false);
        collection.setMasterMintEnabled(true);
        vm.expectRevert(RF_PhaseDisabled.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testExpiredPhaseCannotMint() public {
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), uint64(block.timestamp + 100), 0, 0, bytes32(0), 0, 1, true);
        collection.setMasterMintEnabled(true);
        vm.warp(block.timestamp + 100);
        vm.expectRevert(RF_PhaseClosed.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testCreatorCanPushStartLaterAndMoveItSooner() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        collection.updatePhase(phase, 0, uint64(block.timestamp + 7 days), 0, 0, 0, bytes32(0), 0, 1);
        assertFalse(collection.phaseIsOpen(phase), "pushed phase should close");

        collection.updatePhase(phase, 0, uint64(block.timestamp), 0, 0, 0, bytes32(0), 0, 1);
        assertTrue(collection.phaseIsOpen(phase), "moved-sooner phase should open");
    }

    function testCreatorCanPauseAndResumeAllMinting() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));

        collection.setMasterMintEnabled(false);
        vm.expectRevert(RF_PublicSalePaused.selector);
        vm.prank(ALICE);
        collection.mint(phase, 1, 0, new bytes32[](0));

        collection.setMasterMintEnabled(true);
        vm.prank(ALICE);
        collection.mint(phase, 1, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 2, "resume restores minting");
    }

    function testCreatorCanPauseAndResumeIndividualPhase() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        collection.setPhaseEnabled(phase, false);
        vm.expectRevert(RF_PhaseDisabled.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));

        collection.setPhaseEnabled(phase, true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 1, "phase resumes");
    }

    function testPhaseSupplyCannotBeExceeded() public {
        uint32 phase = _createPublicPhaseWithLimits(0, 2, 0);
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 2, 0, new bytes32[](0));
        vm.expectRevert(RF_PhaseSoldOut.selector);
        vm.prank(ALICE);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testWalletLimitCannotBeExceeded() public {
        uint32 phase = _createPublicPhaseWithLimits(0, 0, 2);
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 2, 0, new bytes32[](0));
        vm.expectRevert(RF_WalletLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testWrongPriceCannotMint() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.expectRevert(RF_WrongPrice.selector);
        vm.prank(BOB);
        collection.mint{value: 0.99 ether}(phase, 1, 0, new bytes32[](0));
    }

    function testOverlappingPhasesRemainIndependent() public {
        uint32 phaseA = _createPublicPhaseWithLimits(0, 0, 1);
        uint32 phaseB = _createPublicPhaseWithLimits(0, 0, 2);
        collection.setMasterMintEnabled(true);

        vm.prank(BOB);
        collection.mint(phaseA, 1, 0, new bytes32[](0));
        vm.prank(BOB);
        collection.mint(phaseB, 2, 0, new bytes32[](0));

        assertEq(collection.phaseWalletMinted(phaseA, BOB), 1, "phase A count");
        assertEq(collection.phaseWalletMinted(phaseB, BOB), 2, "phase B count");
    }

    function testSingleLeafWhitelistAndAllowance() public {
        uint32 phaseId = collection.phaseCount() + 1;
        bytes32 root = _leaf(address(collection), phaseId, BOB, 2);
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, collection.ACCESS_MERKLE(), 200, true);
        collection.setMasterMintEnabled(true);

        vm.prank(BOB);
        collection.mint(phase, 2, 2, new bytes32[](0));
        vm.expectRevert(RF_InsufficientAllowance.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 2, new bytes32[](0));
    }

    function testTwoLeafWhitelistProof() public {
        uint32 phaseId = collection.phaseCount() + 1;
        bytes32 bobLeaf = _leaf(address(collection), phaseId, BOB, 2);
        bytes32 aliceLeaf = _leaf(address(collection), phaseId, ALICE, 1);
        bytes32 root = _hashPair(bobLeaf, aliceLeaf);
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, 1, 10, true);
        collection.setMasterMintEnabled(true);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = aliceLeaf;
        vm.prank(BOB);
        collection.mint(phase, 1, 2, proof);
        assertEq(collection.ownerOf(1), BOB, "proof mint owner");
    }

    function testWhitelistProofIsWalletBound() public {
        uint32 phaseId = collection.phaseCount() + 1;
        bytes32 root = _leaf(address(collection), phaseId, BOB, 1);
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, 1, 1, true);
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_BadProof.selector);
        vm.prank(ALICE);
        collection.mint(phase, 1, 1, new bytes32[](0));
    }

    function testWhitelistProofCannotMoveBetweenPhases() public {
        uint32 phase1Id = collection.phaseCount() + 1;
        bytes32 phase1Root = _leaf(address(collection), phase1Id, BOB, 2);
        collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, phase1Root, 1, 1, true);

        uint32 phase2Id = collection.phaseCount() + 1;
        uint32 phase2 = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, phase1Root, 1, 1, true);
        assertEq(phase2, phase2Id, "phase id assumption");
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_BadProof.selector);
        vm.prank(BOB);
        collection.mint(phase2, 1, 2, new bytes32[](0));
    }

    function testWhitelistProofCannotMoveBetweenCollections() public {
        uint32 phaseId = collection.phaseCount() + 1;
        bytes32 root = _leaf(address(collection), phaseId, BOB, 1);
        collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, 1, 1, true);

        (RelicCollectionV1 other, RelicProjectDataV1 otherData) = _newUnsealed(2, 1);
        _configureAndSealData(otherData, 2);
        uint32 otherPhase = other.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, 1, 1, true);
        other.setMasterMintEnabled(true);

        vm.expectRevert(RF_BadProof.selector);
        vm.prank(BOB);
        other.mint(otherPhase, 1, 1, new bytes32[](0));
    }

    function testWhitelistProofIsChainBound() public {
        uint256 originalChain = block.chainid;
        uint32 phaseId = collection.phaseCount() + 1;
        bytes32 root = _leaf(address(collection), phaseId, BOB, 1);
        uint32 phase = collection.createPhase(0, uint64(block.timestamp), 0, 0, 0, root, 1, 1, true);
        collection.setMasterMintEnabled(true);
        vm.chainId(originalChain + 1);

        vm.expectRevert(RF_BadProof.selector);
        vm.prank(BOB);
        collection.mint(phase, 1, 1, new bytes32[](0));
    }

    function testGlobalSupplyCannotBeExceededAcrossWallets() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 10, 0, new bytes32[](0));
        vm.prank(ALICE);
        collection.mint(phase, 6, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), SUPPLY, "sold out exactly");

        vm.expectRevert(RF_SoldOut.selector);
        vm.prank(CAROL);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testPhaseSupplyCannotBeReducedBelowAlreadyMinted() public {
        uint32 phase = _createPublicPhaseWithLimits(0, 5, 0);
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 3, 0, new bytes32[](0));

        vm.expectRevert(RF_PhaseSoldOut.selector);
        collection.updatePhase(phase, 0, uint64(block.timestamp), 0, 2, 0, bytes32(0), 0, 1);
    }

    function testBatchLimitEnforced() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        uint32 overLimit = collection.MAX_MINT_BATCH() + 1;
        vm.expectRevert(RF_BatchLimit.selector);
        vm.prank(BOB);
        collection.mint(phase, overLimit, 0, new bytes32[](0));
    }
}
