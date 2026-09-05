// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicPricedRandomnessQueueMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";

contract ForgeRevealV2Phase2CHypeMintTest is TestBase {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    function _fixture(uint32 supply)
        internal
        returns (
            RelicPricedRandomnessQueueMockV2 provider,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        vm.deal(address(this), address(this).balance + 20 ether);
        provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        reserve = new RelicForgeReserveV2Harness{value: 10 ether}(
            address(this),
            payable(TREASURY),
            0.01 ether,
            0,
            10_000,
            1 ether,
            100 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR,
            address(provider),
            address(reserve),
            2,
            supply,
            3,
            0,
            0,
            0,
            0,
            0.001 ether
        );
        reserve.registerCollection(address(collection));
    }

    function testHypeMint10kLocks500BatchesWithoutRngBlockingMintPath() public {
        (
            RelicPricedRandomnessQueueMockV2 provider,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture(10_000);
        reserve;

        // Model 500 rapid quantity-20 collector transactions. No RNG/provider work occurs in any mint call.
        for (uint256 i; i < 500; ++i) {
            address buyer = address(uint160(0x1000 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 20);
        }

        assertEq(collection.totalCommitted(), 10_000, "10k sellout committed without oversell");
        assertEq(collection.totalMinted(), 0, "no placeholder erc721s born before rng");
        assertEq(collection.openBatchId(), 501, "500 immutable 20-nft batches locked");
        assertEq(collection.unrequestedLockedBatches(), 500, "500 rng jobs queued");
        assertEq(collection.lockedUnsettledBatches(), 500, "500 reveal batches pending");
        assertEq(provider.nextRequestId(), 1, "provider was never a mint-path bottleneck");
    }

    function testFiveHundredRngJobsCanBeRequestedAfter10kSellout() public {
        (
            RelicPricedRandomnessQueueMockV2 provider,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture(10_000);
        reserve;

        for (uint256 i; i < 500; ++i) {
            address buyer = address(uint160(0x2000 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 20);
        }

        // Permissionless executors can parallelize these transactions in production. The test serializes them.
        for (uint64 batchId = 1; batchId <= 500; ++batchId) {
            collection.requestRandomnessForBatch(batchId);
        }

        assertEq(provider.nextRequestId(), 501, "exactly 500 provider requests for 10k/20");
        assertEq(collection.unrequestedLockedBatches(), 0, "rng request queue fully dispatched");
        assertEq(collection.totalCommitted(), 10_000, "mint commitments unchanged by rng dispatch");
    }

    function testOutOfOrderReadyBacklogDoesNotCorruptSettlementCursor() public {
        (
            RelicPricedRandomnessQueueMockV2 provider,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture(100);
        reserve;

        for (uint256 i; i < 5; ++i) {
            address buyer = address(uint160(0x3000 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 20);
            collection.requestRandomnessForBatch(uint64(i + 1));
        }

        // Simulate a provider delivering 5,4,3,2 before 1.
        provider.fulfill(5, 5005);
        provider.fulfill(4, 4004);
        provider.fulfill(3, 3003);
        provider.fulfill(2, 2002);

        assertEq(collection.totalMinted(), 0, "head-of-line delay cannot reorder assignments");
        assertEq(collection.nextSettleBatchId(), 1, "cursor waits for oldest immutable batch");

        provider.fulfill(1, 1001);
        assertEq(collection.totalMinted(), 20, "oldest batch settles when word arrives");

        uint32 drained = collection.settleReady(80);
        assertEq(drained, 80, "ready backlog drains without new rng requests");
        assertEq(collection.totalMinted(), 100, "all queued reveals finish");
        assertTrue(collection.completed(), "sold-out collection completes cleanly");
    }

    function testOneThousandNftFullDrainHasNoDuplicateTokenIds() public {
        (
            RelicPricedRandomnessQueueMockV2 provider,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture(1_000);
        reserve;

        for (uint256 i; i < 50; ++i) {
            address buyer = address(uint160(0x4000 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 20);
            collection.requestRandomnessForBatch(uint64(i + 1));
            provider.recordWord(i + 1, uint256(keccak256(abi.encode(i, buyer))));
        }

        // Deliver in order to exercise the real sparse without-replacement deck for 1,000 NFTs.
        for (uint256 requestId = 1; requestId <= 50; ++requestId) {
            bool delivered = provider.deliver(requestId);
            assertTrue(delivered, "callback delivered");
        }

        assertEq(collection.totalMinted(), 1_000, "all 1,000 real deck draws settled");
        assertTrue(collection.completed(), "collection complete");

        // Every token ID in the fixed 1..1000 deck must exist exactly once.
        for (uint256 tokenId = 1; tokenId <= 1_000; ++tokenId) {
            assertTrue(collection.ownerOf(tokenId) != address(0), "no missing/duplicate recipe slot");
        }
    }
}
