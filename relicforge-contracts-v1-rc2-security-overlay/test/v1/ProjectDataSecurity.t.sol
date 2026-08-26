// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract StringHarnessV1 {
    function escape(string calldata value) external pure returns (string memory) {
        return RFStringsV1.escapeJSON(value);
    }
}

contract ProjectDataSecurityTest is RelicForgeV1Fixture {
    function _addSingleTrait(RelicProjectDataV1 d) internal returns (address shard) {
        bytes memory art = bytes('<rect width="32" height="32"/>');
        shard = d.addArtShard(art);
        RelicProjectDataV1.TraitInput[] memory inputs = new RelicProjectDataV1.TraitInput[](1);
        inputs[0] = RelicProjectDataV1.TraitInput(0, 0, "Only", shard, 0, uint32(art.length), 0, false);
        d.addTraits(inputs);
        string[] memory names = new string[](1);
        names[0] = "Layer";
        d.setLayerNames(names);
        bool[] memory hidden = new bool[](1);
        d.setLayerMetadataVisibility(hidden);
        d.setPlaceholder(bytes('<rect width="32" height="32"/>'));
    }

    function testArtTraitBoundsAreEnforced() public {
        (, RelicProjectDataV1 d) = _newUnsealed(1, 1);
        address shard = d.addArtShard(hex"010203");
        RelicProjectDataV1.TraitInput[] memory inputs = new RelicProjectDataV1.TraitInput[](1);
        inputs[0] = RelicProjectDataV1.TraitInput(0, 0, "bad", shard, 2, 2, 0, false);
        vm.expectRevert(RF_DataBounds.selector);
        d.addTraits(inputs);
    }

    function testShortDnaCannotPassValidationViaExtcodecopyPadding() public {
        (, RelicProjectDataV1 d) = _newUnsealed(2, 1);
        _addSingleTrait(d);
        d.addDnaShard(hex"00"); // only one recipe byte, but config claims two
        d.setDNAConfig(2, 2);
        vm.expectRevert(RF_DataBounds.selector);
        d.validateNextRecipes(2);
    }

    function testMissingTraitBlocksValidation() public {
        (, RelicProjectDataV1 d) = _newUnsealed(2, 1);
        _addSingleTrait(d);
        d.addDnaShard(hex"0001"); // recipe #2 references nonexistent trait 1
        d.setDNAConfig(2, 2);
        vm.expectRevert(RF_MissingTrait.selector);
        d.validateNextRecipes(2);
    }

    function testDnaConfigCannotDescribeImpossibleFullShard() public {
        (, RelicProjectDataV1 d) = _newUnsealed(400, 64);
        vm.expectRevert(RF_BadConfig.selector);
        d.setDNAConfig(400, 360); // 360 * 64 = 23,040 > 23,000 shard payload ceiling
    }

    function testCannotSealBeforeAllRecipesValidated() public {
        (, RelicProjectDataV1 d) = _newUnsealed(2, 1);
        _addSingleTrait(d);
        d.addDnaShard(hex"0000");
        d.setDNAConfig(2, 2);
        d.validateNextRecipes(1);
        vm.expectRevert(RF_BadConfig.selector);
        d.sealContent(keccak256("not-yet"));
    }

    function testZeroProvenanceCannotSeal() public {
        (, RelicProjectDataV1 d) = _newUnsealed(1, 1);
        _addSingleTrait(d);
        d.addDnaShard(hex"00");
        d.setDNAConfig(1, 1);
        d.validateNextRecipes(1);
        vm.expectRevert(RF_BadConfig.selector);
        d.sealContent(bytes32(0));
    }

    function testSealedContentCannotMutate() public {
        vm.expectRevert(RF_ContentSealed.selector);
        data.addArtShard(hex"01");

        vm.expectRevert(RF_ContentSealed.selector);
        data.setPlaceholder(hex"01");

        vm.expectRevert(RF_ContentSealed.selector);
        data.setDNAConfig(SUPPLY, uint16(SUPPLY));
    }

    function testJsonEscapingQuotesBackslashesAndControlCharacters() public {
        StringHarnessV1 h = new StringHarnessV1();
        string memory escaped = h.escape("quote\" slash\\ newline\n tab\t");
        assertEq(escaped, "quote\\\" slash\\\\ newline\\n tab\\t", "json escaping");
    }

    function testRendererWorksForPlaceholderAndRevealedToken() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
        string memory pendingUri = collection.tokenURI(1);
        assertGt(bytes(pendingUri).length, 32, "placeholder tokenURI exists");

        collection.requestRevealEpoch();
        randomness.fulfill(1, 7);
        collection.processReveal(10);
        string memory revealedUri = collection.tokenURI(1);
        assertGt(bytes(revealedUri).length, bytes(pendingUri).length / 2, "revealed tokenURI exists");
        assertGt(bytes(collection.renderToken(1)).length, 32, "canonical SVG renders");
    }
}
