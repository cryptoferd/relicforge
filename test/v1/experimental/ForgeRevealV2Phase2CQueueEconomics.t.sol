// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicPricedRandomnessQueueMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";

contract ForgeRevealV2Phase2CQueueEconomicsTest is TestBase {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant TREASURY = address(0x7EA5);

    uint256 internal constant MINT_PRICE = 0.01 ether;
    uint256 internal constant SPONSORED_FEE = 0.0001 ether;
    uint256 internal constant MINTER_FEE = 0.0002 ether;
    uint256 internal constant TEAM_FEE = 0.0001 ether;
    uint256 internal constant MAX_RNG_COST = 0.01 ether;

    function _newReserve(uint256 initialBalance)
        internal
        returns (RelicForgeReserveV2Harness reserve)
    {
        vm.deal(address(this), address(this).balance + initialBalance + 10 ether);
        reserve = new RelicForgeReserveV2Harness{value: initialBalance}(
            address(this),
            payable(TREASURY),
            0.05 ether,
            0.001 ether,
            20_000,
            0.05 ether,
            10 ether
        );
    }

    function _newCollection(
        RelicPricedRandomnessQueueMockV2 provider,
        RelicForgeReserveV2Harness reserve,
        uint8 feeMode,
        uint32 supply,
        uint64 batchWindow,
        uint256 mintPrice,
        uint256 maxRngCost
    )
        internal
        returns (RelicForgeBatchQueueV2Harness collection)
    {
        uint256 sponsoredValue = feeMode == 1 ? SPONSORED_FEE * supply : 0;
        vm.deal(address(this), address(this).balance + sponsoredValue + 1 ether);

        collection = new RelicForgeBatchQueueV2Harness{value: sponsoredValue}(
            CREATOR,
            address(provider),
            address(reserve),
            feeMode,
            supply,
            batchWindow,
            mintPrice,
            SPONSORED_FEE,
            MINTER_FEE,
            TEAM_FEE,
            maxRngCost
        );
        reserve.registerCollection(address(collection));
    }

    function _publicMint(
        RelicForgeBatchQueueV2Harness collection,
        address buyer,
        uint32 quantity,
        uint256 feePerToken
    ) internal {
        uint256 value = (collection.mintPriceWei() + feePerToken) * quantity;
        vm.deal(buyer, value + 1 ether);
        vm.prank(buyer);
        collection.requestForgeMint{value: value}(buyer, quantity);
    }

    function testFullTwentyLocksWithoutCallingRngProvider() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, MINTER_FEE);

        assertEq(collection.totalCommitted(), 20, "twenty supply committed");
        assertEq(collection.openBatchId(), 2, "full batch locked immediately");
        assertEq(collection.unrequestedLockedBatches(), 1, "one rng job queued");
        assertEq(provider.nextRequestId(), 1, "collector path never called provider");
    }

    function testOneMintClosesAfterShortWindowWithoutNineteenMoreBuyers() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 1, MINTER_FEE);
        assertEq(collection.openBatchId(), 1, "partial remains open during tiny window");

        vm.warp(block.timestamp + 3);
        collection.lockTimedOutBatch();

        assertEq(collection.openBatchId(), 2, "single mint batch closed on timeout");
        assertEq(collection.unrequestedLockedBatches(), 1, "rng job queued");
        assertEq(provider.nextRequestId(), 1, "locking still does not call provider");
    }

    function testRandomnessRequestIsPermissionlessAndSeparateFromMint() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, MINTER_FEE);

        vm.prank(BOB);
        uint256 requestId = collection.requestRandomnessForBatch(1);

        assertEq(requestId, 1, "executor created request");
        assertEq(provider.nextRequestId(), 2, "one provider request");
        assertEq(collection.unrequestedLockedBatches(), 0, "rng queue consumed");
    }

    function testDynamicCallbackSizingUsesLessGasForSmallBatch() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, 0, MAX_RNG_COST);

        uint256 one = collection.callbackGasForQuantity(1);
        uint256 twenty = collection.callbackGasForQuantity(20);

        assertTrue(one < twenty, "one nft callback is cheaper");
        assertTrue(twenty <= 2_500_000, "twenty fits configured callback ceiling");
    }

    function testMinterSupportedPublicFeesFeedHopper() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, MINT_PRICE, MAX_RNG_COST);

        _publicMint(collection, ALICE, 5, MINTER_FEE);

        assertEq(collection.hopperBalance(), 5 * MINTER_FEE, "normal RF fees stay in hopper");
        assertEq(collection.creatorEscrow(), 5 * MINT_PRICE, "creator sale proceeds isolated");
    }

    function testMinterSupportedTeamMintChargesQuarterEquivalentFeeAndSplitsBatches() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 500, 3, MINT_PRICE, MAX_RNG_COST);

        vm.deal(CREATOR, 1 ether);
        vm.prank(CREATOR);
        collection.creatorMint{value: 100 * TEAM_FEE}(address(0xBEEF), 100);

        assertEq(collection.totalCommitted(), 100, "team allocation consumes supply");
        assertEq(collection.hopperBalance(), 100 * TEAM_FEE, "team fee protects hopper");
        assertEq(collection.creatorEscrow(), 0, "team mint does not fabricate sale proceeds");
        assertEq(collection.openBatchId(), 6, "100 team nfts became five 20-nft batches");
        assertEq(collection.unrequestedLockedBatches(), 5, "five rng jobs queued");
        assertEq(provider.nextRequestId(), 1, "team mint also avoids provider calls");
    }

    function testSponsoredCollectionTeamMintHasNoAdditionalRfFee() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 1, 100, 3, MINT_PRICE, MAX_RNG_COST);

        uint256 startingHopper = collection.hopperBalance();
        assertEq(startingHopper, 100 * SPONSORED_FEE, "upfront sponsored fee loaded hopper");

        vm.prank(CREATOR);
        collection.creatorMint(address(0xBEEF), 40);

        assertEq(collection.hopperBalance(), startingHopper, "sponsored team mint adds no second fee");
        assertEq(collection.totalCommitted(), 40, "team allocation queued");
    }

    function testRandomnessConsumesHopperBeforeForgeReserve() public {
        // 20-NFT callback is 2.45M gas. At 1 gwei + 0.0001 base, quote = 0.00255 ETH.
        RelicPricedRandomnessQueueMockV2 provider =
            new RelicPricedRandomnessQueueMockV2(0.0001 ether, 1 gwei);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, 0, MAX_RNG_COST);

        // Hopper gets 20 * 0.0001 = 0.002 ETH via team-rate equivalent public test fee is 0.0002,
        // so use ten public mints then creator fills ten at team rate for a 0.003 ETH hopper.
        _publicMint(collection, ALICE, 10, MINTER_FEE);
        vm.deal(CREATOR, 1 ether);
        vm.prank(CREATOR);
        collection.creatorMint{value: 10 * TEAM_FEE}(address(0xBEEF), 10);

        uint256 hopperBefore = collection.hopperBalance();
        uint256 reserveBefore = address(reserve).balance;
        uint256 cost = provider.quoteRequestPrice(collection.callbackGasForQuantity(20));
        assertTrue(hopperBefore >= cost, "hopper covers this request");

        collection.requestRandomnessForBatch(1);

        assertEq(collection.totalReserveSubsidy(), 0, "reserve untouched when hopper covers rng");
        assertEq(address(reserve).balance, reserveBefore, "reserve native balance unchanged");
        assertEq(collection.hopperBalance(), hopperBefore - cost, "exact rng quote deducted from hopper");
        assertEq(collection.creatorEscrow(), 0, "no creator sale proceeds in this zero-price test");
    }

    function testForgeReserveCoversOnlyExactHopperShortfall() public {
        RelicPricedRandomnessQueueMockV2 provider =
            new RelicPricedRandomnessQueueMockV2(0.003 ether, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 100, 3, MINT_PRICE, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, MINTER_FEE); // hopper = 0.004 ETH
        // Make cost 0.003, so no shortfall yet. Pull safe excess cannot pull because queued obligation/runway protects it.
        uint256 cost = provider.quoteRequestPrice(collection.callbackGasForQuantity(20));
        assertEq(cost, 0.003 ether, "test provider quote");

        // Use a second collection with zero public fee to prove exact reserve shortfall cleanly.
        RelicForgeBatchQueueV2Harness zeroFee = new RelicForgeBatchQueueV2Harness(
            CREATOR,
            address(provider),
            address(reserve),
            2,
            20,
            3,
            MINT_PRICE,
            0,
            0,
            0,
            MAX_RNG_COST
        );
        reserve.registerCollection(address(zeroFee));

        vm.deal(BOB, 1 ether);
        vm.prank(BOB);
        zeroFee.requestForgeMint{value: 20 * MINT_PRICE}(BOB, 20);

        uint256 reserveBefore = address(reserve).balance;
        zeroFee.requestRandomnessForBatch(1);

        assertEq(zeroFee.totalReserveSubsidy(), cost, "reserve covers exact shortfall only");
        assertEq(address(reserve).balance, reserveBefore - cost, "reserve paid exact quote");
        assertEq(zeroFee.creatorEscrow(), 20 * MINT_PRICE, "creator proceeds remain fully escrowed");
    }

    function testRandomnessQuoteAboveCollectionCapFailsClosed() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0.02 ether, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 20, 3, 0, 0.01 ether);

        _publicMint(collection, ALICE, 20, MINTER_FEE);

        vm.expectRevert(RFV2_RandomnessQuoteTooHigh.selector);
        collection.requestRandomnessForBatch(1);

        assertEq(provider.nextRequestId(), 1, "no unsafe/expensive provider request created");
        assertEq(collection.unrequestedLockedBatches(), 1, "batch remains safely queued");
    }

    function testSponsoredHopperCanSweepExcessButKeepsTenBatchRunway() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        uint256 maxCost = 0.001 ether;
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 1, 1_000, 3, 0, maxCost);

        // Upfront hopper = 0.1 ETH. No activity, so ten future batches (0.01 ETH) remain protected.
        assertEq(collection.hopperBalance(), 0.1 ether, "sponsored hopper funded upfront");
        assertEq(collection.protectedHopperWei(), 0.01 ether, "ten-batch runway protected");
        assertEq(collection.sweepableHopperWei(), 0.09 ether, "rest is available to reserve");

        uint256 reserveBefore = address(reserve).balance;
        reserve.pullCollectionExcess(address(collection));

        assertEq(collection.hopperBalance(), 0.01 ether, "runway remains in collection hopper");
        assertEq(address(reserve).balance, reserveBefore + 0.09 ether, "excess moved to Forge Reserve");
        assertEq(
            reserve.totalRestrictedSponsoredLiabilityWei(),
            0.09 ether,
            "swept prepaid sponsored capacity remains restricted, not immediate revenue"
        );
    }

    function testSlowSponsoredCollectionCannotReleaseSweptPrepaidCapacityAsRevenue() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 1, 1_000, 3, 0, 0.001 ether);

        reserve.pullCollectionExcess(address(collection));
        uint256 restricted = reserve.totalRestrictedSponsoredLiabilityWei();
        assertEq(restricted, 0.09 ether, "future sponsored service obligation tracked globally");

        uint256 before = address(reserve).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 released = reserve.releaseRevenue();
        uint256 required = reserve.requiredReserveWei();

        assertEq(address(reserve).balance, required, "restricted sponsored capacity remains protected");
        assertEq(released, before - required, "only true surplus becomes platform revenue");
        assertEq(TREASURY.balance, treasuryBefore + released, "safe surplus reaches treasury");
    }

    function testReserveTracksDynamicActiveBatchesAndUncoveredExposure() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR,
            address(provider),
            address(reserve),
            2,
            100,
            3,
            0,
            0,
            0,
            0,
            0.01 ether
        );
        reserve.registerCollection(address(collection));

        _publicMint(collection, ALICE, 1, 0);
        reserve.syncCollection(address(collection));

        assertEq(reserve.activeCollectionCount(), 1, "one active collection");
        assertEq(reserve.totalActiveBatches(), 1, "open partial batch counted dynamically");
        assertEq(reserve.totalExposureWei(), 0.01 ether, "uncovered near-term rng exposure tracked");

        uint256 expectedDynamic = 0.02 ether + 0.001 ether;
        assertEq(reserve.requiredReserveWei(), 0.05 ether, "global floor dominates small dynamic exposure");
        expectedDynamic;
    }

    function testFounderRevenueReleaseCannotCrossDynamicReserveBoundary() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(2 ether);
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR,
            address(provider),
            address(reserve),
            2,
            100,
            3,
            0,
            0,
            0,
            0,
            0.1 ether
        );
        reserve.registerCollection(address(collection));

        _publicMint(collection, ALICE, 20, 0);
        reserve.syncCollection(address(collection));

        uint256 required = reserve.requiredReserveWei();
        uint256 treasuryBefore = TREASURY.balance;
        uint256 reserveBefore = address(reserve).balance;
        uint256 released = reserve.releaseRevenue();

        assertEq(released, reserveBefore - required, "only mathematically safe surplus released");
        assertEq(address(reserve).balance, required, "dynamic reserve remains protected");
        assertEq(TREASURY.balance, treasuryBefore + released, "revenue goes only to fixed treasury");
    }

    function testMintOutCompletionMakesRemainingHopperFullySweepable() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 1, 20, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, 0);
        collection.requestRandomnessForBatch(1);
        provider.fulfill(1, 123456);

        assertTrue(collection.completed(), "sellout plus final settlement marks complete");
        assertEq(collection.totalMinted(), 20, "all nfts forged");
        assertEq(collection.protectedHopperWei(), 0, "completed collection protects no runway");

        uint256 remaining = collection.hopperBalance();
        uint256 reserveBefore = address(reserve).balance;
        reserve.pullCollectionExcess(address(collection));

        assertEq(collection.hopperBalance(), 0, "completed hopper fully swept");
        assertEq(address(reserve).balance, reserveBefore + remaining, "remainder joins Forge Reserve");
    }

    function testOutOfOrderRandomnessCannotReorderDeckSettlement() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 40, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, MINTER_FEE);
        _publicMint(collection, BOB, 20, MINTER_FEE);
        collection.requestRandomnessForBatch(1);
        collection.requestRandomnessForBatch(2);

        bool second = provider.fulfill(2, 222);
        assertTrue(second, "batch two word delivered");
        assertEq(collection.totalMinted(), 0, "batch two cannot consume deck before batch one");

        bool first = provider.fulfill(1, 111);
        assertTrue(first, "batch one delivered");
        assertEq(collection.totalMinted(), 20, "batch one settles first");

        uint32 drained = collection.settleReady(20);
        assertEq(drained, 20, "queued ready batch drains permissionlessly");
        assertEq(collection.totalMinted(), 40, "both batches complete in immutable order");
    }

    function testRecordedWordSurvivesLowGasDeliveryAndReplaysExactly() public {
        RelicPricedRandomnessQueueMockV2 provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        RelicForgeReserveV2Harness reserve = _newReserve(1 ether);
        RelicForgeBatchQueueV2Harness collection =
            _newCollection(provider, reserve, 2, 20, 3, 0, MAX_RNG_COST);

        _publicMint(collection, ALICE, 20, MINTER_FEE);
        collection.requestRandomnessForBatch(1);
        provider.recordWord(1, 987654321);

        bool lowGasDelivered = provider.deliverWithGas(1, 150_000);
        assertTrue(lowGasDelivered, "low gas still stores verified word and returns");
        assertEq(collection.totalMinted(), 0, "low gas skips settlement");

        uint32 drained = collection.settleReady(20);
        assertEq(drained, 20, "same stored word recovered permissionlessly");
        assertEq(collection.totalMinted(), 20, "all nfts forged after recovery");

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        provider.recordWord(1, 123);
    }
}
