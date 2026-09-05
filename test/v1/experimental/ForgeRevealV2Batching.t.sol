// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicReplayRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeBatchMintV2Harness.sol";

contract ForgeRevealV2BatchingTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA401);
    address payable internal constant PAYOUT = payable(address(0xCAFE));
    address payable internal constant TREASURY = payable(address(0xFEE));

    uint256 internal constant PRICE = 0.01 ether;
    uint256 internal constant FEE = 0.001 ether;

    function _newForge(uint32 supply, uint32 batchSize, uint64 window)
        internal
        returns (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge)
    {
        provider = new RelicReplayRandomnessMockV2();
        forge = new RelicForgeBatchMintV2Harness(
            address(provider),
            supply,
            batchSize,
            window,
            PRICE,
            FEE,
            PAYOUT,
            TREASURY
        );
    }

    function _reserveOne(RelicForgeBatchMintV2Harness forge, address payer) internal {
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        forge.requestForgeMint{value: PRICE + FEE}(payer, 1);
    }

    function testTwentySingleNftCollectorsShareOneRandomnessRequest() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(100, 20, 3);

        for (uint256 i; i < 20; ++i) {
            _reserveOne(forge, address(uint160(0x1000 + i)));
        }

        assertEq(provider.nextRequestId(), 2, "twenty reservations must share one provider request");

        (
            uint64 firstReservationId,
            uint64 lastReservationId,
            uint64 openedAt,
            uint32 reservationCount,
            uint32 totalQuantity,
            uint256 requestId,
            uint256 randomWord,
            bool closed,
            bool wordReady,
            bool settled,
            bool refunded
        ) = forge.batches(1);

        firstReservationId; lastReservationId; openedAt; randomWord; wordReady; settled; refunded;

        assertEq(reservationCount, 20, "twenty reservations locked");
        assertEq(totalQuantity, 20, "twenty nfts batched");
        assertEq(requestId, 1, "one request id");
        assertTrue(closed, "full batch auto closes");
    }

    function testLowVolumeBatchClosesPermissionlesslyAfterWindow() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(100, 20, 3);

        _reserveOne(forge, ALICE);

        assertEq(provider.nextRequestId(), 1, "no randomness request before close");
        assertFalse(forge.batchCanClose(), "window still open");

        vm.warp(block.timestamp + 3);
        assertTrue(forge.batchCanClose(), "window expired");

        vm.prank(BOB);
        (, uint256 requestId) = forge.closeOpenBatch();

        assertEq(requestId, 1, "first provider request");
        assertEq(provider.nextRequestId(), 2, "exactly one request created");
    }

    function testProviderCallbackStoresWordButDoesNotMint() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(100, 5, 3);

        for (uint256 i; i < 5; ++i) {
            _reserveOne(forge, address(uint160(0x2000 + i)));
        }

        provider.fulfill(1, 0xABCDEF);
        assertEq(forge.totalMinted(), 0, "provider callback does not perform nft work");

        (
            uint64 firstReservationId,
            uint64 lastReservationId,
            uint64 openedAt,
            uint32 reservationCount,
            uint32 totalQuantity,
            uint256 requestId,
            uint256 word,
            bool closed,
            bool wordReady,
            bool settled,
            bool refunded
        ) = forge.batches(1);

        firstReservationId; lastReservationId; openedAt; reservationCount; totalQuantity;
        requestId; closed; settled; refunded;

        assertEq(word, 0xABCDEF, "verified word stored");
        assertTrue(wordReady, "batch marked ready");

        uint32 settledCount = forge.settleReady(5);
        assertEq(settledCount, 5, "permissionless settlement mints batch");
        assertEq(forge.totalMinted(), 5, "revealed nfts now exist");
    }

    function testExisting150kDeliveryBudgetCanStoreFiftyNftBatchWord() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(100, 50, 3);

        vm.deal(ALICE, 2 ether);
        vm.prank(ALICE);
        forge.requestForgeMint{value: 50 * (PRICE + FEE)}(ALICE, 50);

        provider.recordWord(1, 123456);

        bool delivered = provider.deliver(1, 150_000);
        assertTrue(delivered, "150k callback budget should store a batch word");
        assertEq(forge.totalMinted(), 0, "settlement remains separate");
    }

    function testOutOfOrderBatchCallbacksCannotChangeDeckOrder() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(20, 2, 3);

        _reserveOne(forge, ALICE);
        _reserveOne(forge, BOB);

        _reserveOne(forge, CAROL);
        _reserveOne(forge, ALICE);

        provider.fulfill(2, 222);

        uint32 beforeGap = forge.settleReady(4);
        assertEq(beforeGap, 0, "later batch cannot consume deck first");

        provider.fulfill(1, 111);

        uint32 afterGap = forge.settleReady(4);
        assertEq(afterGap, 4, "both batches settle in immutable order");
        assertEq(forge.totalMinted(), 4, "all four minted");
        assertEq(forge.nextSettleBatchId(), 3, "settlement cursor advanced");
    }

    function testOneHundredSingleReservationsCreateFiveRandomnessRequestsAtBatch20() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(200, 20, 3);

        for (uint256 i; i < 100; ++i) {
            _reserveOne(forge, address(uint160(0x3000 + i)));
        }

        assertEq(provider.nextRequestId(), 6, "100 one-nft reservations should create five requests");
        assertEq(forge.openBatchId(), 6, "five batches closed");
        assertEq(forge.totalCommitted(), 100, "all supply reservations retained");
    }

    function testBatchEscrowBecomesEarnedOnlyAfterSettlement() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(20, 2, 3);

        _reserveOne(forge, ALICE);
        _reserveOne(forge, BOB);

        assertEq(forge.escrowedValue(), 2 * (PRICE + FEE), "batch payment escrowed");
        assertEq(forge.accruedCreatorProceeds(), 0, "creator has not earned pending batch");
        assertEq(forge.accruedPlatformFees(), 0, "platform has not earned pending batch");

        provider.fulfill(1, 111);
        assertEq(forge.escrowedValue(), 2 * (PRICE + FEE), "word alone does not release escrow");

        forge.settleReady(2);

        assertEq(forge.escrowedValue(), 0, "settlement releases escrow");
        assertEq(forge.accruedCreatorProceeds(), 2 * PRICE, "creator proceeds exact");
        assertEq(forge.accruedPlatformFees(), 2 * FEE, "platform fees exact");
    }

    function testTerminalBatchFailureRefundsEachOriginalPayerAndRestoresSupply() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(2, 2, 3);

        _reserveOne(forge, ALICE);
        _reserveOne(forge, BOB);

        assertEq(forge.availableSupply(), 0, "batch reserved whole supply");

        provider.markTerminalFailure(1);
        forge.refundFailedBatch(1);

        assertEq(forge.totalCommitted(), 0, "failed batch supply released");
        assertEq(forge.availableSupply(), 2, "supply restored");
        assertEq(forge.escrowedValue(), 0, "escrow removed");
        assertEq(forge.refundCredit(ALICE), PRICE + FEE, "alice credited");
        assertEq(forge.refundCredit(BOB), PRICE + FEE, "bob credited");
    }

    function testPauseBlocksNewReservationButCannotBlockExistingBatchCloseOrSettlement() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(20, 20, 3);

        _reserveOne(forge, ALICE);
        forge.setForgePaused(true);

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        vm.expectRevert(RF_PublicSalePaused.selector);
        forge.requestForgeMint{value: PRICE + FEE}(BOB, 1);

        vm.warp(block.timestamp + 3);
        forge.closeOpenBatch();

        provider.fulfill(1, 999);
        forge.settleReady(1);

        assertEq(forge.balanceOf(ALICE), 1, "already-paid reservation finishes");
    }

    function testBatchCompositionLocksBeforeRandomnessExists() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(20, 2, 3);

        _reserveOne(forge, ALICE);
        _reserveOne(forge, BOB);
        _reserveOne(forge, CAROL);

        (
            uint64 aFirst,
            uint64 aLast,
            uint64 aOpened,
            uint32 aReservations,
            uint32 aQuantity,
            uint256 aRequest,
            uint256 aWord,
            bool aClosed,
            bool aReady,
            bool aSettled,
            bool aRefunded
        ) = forge.batches(1);

        (
            uint64 bFirst,
            uint64 bLast,
            uint64 bOpened,
            uint32 bReservations,
            uint32 bQuantity,
            uint256 bRequest,
            uint256 bWord,
            bool bClosed,
            bool bReady,
            bool bSettled,
            bool bRefunded
        ) = forge.batches(2);

        provider;
        aFirst; aLast; aOpened; aRequest; aWord; aReady; aSettled; aRefunded;
        bFirst; bLast; bOpened; bRequest; bWord; bReady; bSettled; bRefunded;

        assertTrue(aClosed, "batch one immutable before random word");
        assertEq(aReservations, 2, "batch one membership fixed");
        assertEq(aQuantity, 2, "batch one quantity fixed");
        assertFalse(bClosed, "next reservation starts open batch two");
        assertEq(bReservations, 1, "carol belongs to batch two");
        assertEq(bQuantity, 1, "batch two quantity");
    }
}
