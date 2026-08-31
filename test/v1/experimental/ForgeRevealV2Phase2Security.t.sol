// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicReplayRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeMintV2EconomicsHarness.sol";

contract ForgeRevealV2Phase2SecurityTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address payable internal constant PAYOUT = payable(address(0xCAFE));
    address payable internal constant TREASURY = payable(address(0xFEE));

    uint256 internal constant PRICE = 0.01 ether;
    uint256 internal constant FEE = 0.001 ether;

    function _newForge(uint32 supply)
        internal
        returns (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge)
    {
        provider = new RelicReplayRandomnessMockV2();
        forge = new RelicForgeMintV2EconomicsHarness(
            address(provider),
            supply,
            PRICE,
            FEE,
            PAYOUT,
            TREASURY
        );
    }

    function testFundsStayEscrowedUntilRandomMintSucceeds() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(100);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        assertEq(forge.escrowedValue(), PRICE + FEE, "full payment escrowed");
        assertEq(forge.accruedCreatorProceeds(), 0, "creator cannot withdraw pending sale");
        assertEq(forge.accruedPlatformFees(), 0, "platform fee not earned before mint");
        assertEq(forge.totalMinted(), 0, "no placeholder nft");

        provider.fulfill(requestId, 12345);

        assertEq(forge.escrowedValue(), 0, "escrow released at settlement");
        assertEq(forge.accruedCreatorProceeds(), PRICE, "creator proceeds earned");
        assertEq(forge.accruedPlatformFees(), FEE, "platform fee earned");
        assertEq(forge.totalMinted(), 1, "revealed nft minted");
    }

    function testPauseBlocksNewRequestsButDoesNotTrapPendingMint() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(100);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        forge.setForgePaused(true);

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        vm.expectRevert(RF_PublicSalePaused.selector);
        forge.requestForgeMint{value: PRICE + FEE}(BOB, 1);

        // Pause affects new reservations only. An already-paid collector still receives the NFT.
        provider.fulfill(requestId, 777);

        assertEq(forge.totalMinted(), 1, "pending mint settles while paused");
        assertEq(forge.balanceOf(ALICE), 1, "alice receives nft");
    }

    function testTerminalProviderFailureRefundsAndRestoresSupply() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(1);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (uint64 sequence, uint256 requestId) =
            forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        assertEq(forge.availableSupply(), 0, "reservation consumes final supply");

        provider.markTerminalFailure(requestId);
        forge.refundFailedReservation(sequence);

        assertEq(forge.totalCommitted(), 0, "failed reservation released");
        assertEq(forge.availableSupply(), 1, "supply restored");
        assertEq(forge.escrowedValue(), 0, "escrow removed");
        assertEq(forge.refundCredit(ALICE), PRICE + FEE, "payer credited full payment");

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        forge.requestForgeMint{value: PRICE + FEE}(BOB, 1);

        assertEq(forge.totalCommitted(), 1, "restored supply can be reserved again");
    }

    function testRecordedRandomWordCannotBeConvertedIntoRefund() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(10);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (uint64 sequence, uint256 requestId) =
            forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        provider.recordWord(requestId, 123);

        vm.expectRevert(RF_BadRequest.selector);
        provider.markTerminalFailure(requestId);

        vm.expectRevert(RF_BadRequest.selector);
        forge.refundFailedReservation(sequence);

        assertEq(forge.refundCredit(ALICE), 0, "known draw cannot be selectively aborted");
    }

    function testLowGasDeliveryFailureCanOnlyReplaySameRecordedWord() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(100);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        provider.recordWord(requestId, 0xABCDEF);

        bool first = provider.deliver(requestId, 5_000);
        assertFalse(first, "intentionally underfunded callback must fail");
        assertEq(forge.totalMinted(), 0, "failed callback does not half-mint");

        bool replayed = provider.replay(requestId);
        assertTrue(replayed, "same recorded word replays");
        assertEq(forge.totalMinted(), 1, "replay finishes mint");
    }

    function testRandomnessCannotBeRerolled() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(100);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);
        forge;

        provider.recordWord(requestId, 111);

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        provider.recordWord(requestId, 222);
    }

    function testOutOfOrderCallbacksPreserveReservationOrderAndAccounting() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(20);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 request1) = forge.requestForgeMint{value: 2 * (PRICE + FEE)}(ALICE, 2);

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        (, uint256 request2) = forge.requestForgeMint{value: PRICE + FEE}(BOB, 1);

        provider.fulfill(request2, 222);
        assertEq(forge.totalMinted(), 0, "later callback waits");
        assertEq(forge.escrowedValue(), 3 * (PRICE + FEE), "all funds still escrowed");

        provider.fulfill(request1, 111);

        assertEq(forge.totalMinted(), 3, "gap close drains ready reservations");
        assertEq(forge.balanceOf(ALICE), 2, "alice quantity");
        assertEq(forge.balanceOf(BOB), 1, "bob quantity");
        assertEq(forge.escrowedValue(), 0, "all settled escrow released");
        assertEq(forge.accruedCreatorProceeds(), 3 * PRICE, "creator accounting exact");
        assertEq(forge.accruedPlatformFees(), 3 * FEE, "platform accounting exact");
    }

    function testWrongCallerCannotInjectRandomness() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(10);
        provider;

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        vm.prank(BOB);
        vm.expectRevert(RF_NotRandomnessProvider.selector);
        forge.fulfillRandomness(requestId, 999);
    }

    function testWithdrawalsCannotTouchPendingEscrow() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(10);

        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint{value: PRICE + FEE}(ALICE, 1);

        uint256 payoutBefore = PAYOUT.balance;
        uint256 treasuryBefore = TREASURY.balance;

        forge.withdrawCreatorProceeds();
        forge.withdrawPlatformFees();

        assertEq(PAYOUT.balance, payoutBefore, "pending creator funds cannot leave escrow");
        assertEq(TREASURY.balance, treasuryBefore, "pending platform funds cannot leave escrow");

        provider.fulfill(requestId, 123);

        forge.withdrawCreatorProceeds();
        forge.withdrawPlatformFees();

        assertEq(PAYOUT.balance, payoutBefore + PRICE, "only settled creator proceeds paid");
        assertEq(TREASURY.balance, treasuryBefore + FEE, "only settled platform fees paid");
    }

    function testRefundClaimReturnsFullEscrowToOriginalPayer() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeMintV2EconomicsHarness forge) = _newForge(10);

        vm.deal(ALICE, 1 ether);
        uint256 before = ALICE.balance;

        vm.prank(ALICE);
        (uint64 sequence, uint256 requestId) =
            forge.requestForgeMint{value: PRICE + FEE}(BOB, 1);

        provider.markTerminalFailure(requestId);
        forge.refundFailedReservation(sequence);

        vm.prank(ALICE);
        forge.claimRefund();

        assertEq(ALICE.balance, before, "payer receives full refund");
        assertEq(forge.refundCredit(ALICE), 0, "refund credit consumed");
        assertEq(forge.balanceOf(BOB), 0, "recipient never received failed nft");
    }
}
