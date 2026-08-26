// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract GoodReceiverV1 is IERC721ReceiverRFV1 {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721ReceiverRFV1.onERC721Received.selector;
    }
}

contract BadReceiverV1 is IERC721ReceiverRFV1 {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return bytes4(0);
    }
}

contract ERC721SecurityTest is RelicForgeV1Fixture {
    function _mintOneToBob() internal {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));
    }

    function testUnauthorizedTransferRejected() public {
        _mintOneToBob();
        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(ALICE);
        collection.transferFrom(BOB, ALICE, 1);
        assertEq(collection.ownerOf(1), BOB, "owner unchanged");
    }

    function testApprovedTransferClearsApproval() public {
        _mintOneToBob();
        vm.prank(BOB);
        collection.approve(ALICE, 1);
        vm.prank(ALICE);
        collection.transferFrom(BOB, CAROL, 1);
        assertEq(collection.ownerOf(1), CAROL, "approved transfer");
        assertEq(collection.getApproved(1), address(0), "approval cleared");
    }

    function testOperatorTransfer() public {
        _mintOneToBob();
        vm.prank(BOB);
        collection.setApprovalForAll(ALICE, true);
        vm.prank(ALICE);
        collection.transferFrom(BOB, CAROL, 1);
        assertEq(collection.ownerOf(1), CAROL, "operator transfer");
    }

    function testSafeTransferAcceptsCorrectReceiver() public {
        _mintOneToBob();
        GoodReceiverV1 receiver = new GoodReceiverV1();
        vm.prank(BOB);
        collection.safeTransferFrom(BOB, address(receiver), 1);
        assertEq(collection.ownerOf(1), address(receiver), "safe recipient owns token");
    }

    function testSafeTransferRejectsBadReceiverAndRollsBack() public {
        _mintOneToBob();
        BadReceiverV1 receiver = new BadReceiverV1();
        vm.expectRevert(RF_UnsafeRecipient.selector);
        vm.prank(BOB);
        collection.safeTransferFrom(BOB, address(receiver), 1);
        assertEq(collection.ownerOf(1), BOB, "failed safe transfer rolled back");
    }

    function testZeroAddressTransferRejected() public {
        _mintOneToBob();
        vm.expectRevert(RF_ZeroAddress.selector);
        vm.prank(BOB);
        collection.transferFrom(BOB, address(0), 1);
    }
}
