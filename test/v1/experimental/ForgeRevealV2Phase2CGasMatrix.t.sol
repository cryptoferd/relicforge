// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicPricedRandomnessQueueMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";

contract ForgeRevealV2Phase2CGasMatrixTest is TestBase {
    event GasMeasured(bytes32 indexed label, uint256 gasUsed);

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
        vm.deal(address(this), address(this).balance + 10 ether);
        provider = new RelicPricedRandomnessQueueMockV2(0, 0);
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
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

    function testGasReserve01() public {
        (RelicPricedRandomnessQueueMockV2 provider, RelicForgeReserveV2Harness reserve, RelicForgeBatchQueueV2Harness collection) = _fixture(100);
        provider; reserve;
        address buyer = address(0x1001);

        uint256 beforeGas = gasleft();
        vm.prank(buyer);
        collection.requestForgeMint(buyer, 1);
        uint256 used = beforeGas - gasleft();

        emit GasMeasured(bytes32("RESERVE_01"), used);
        assertTrue(used < 350_000, "single reservation should stay lean");
    }

    function testGasReserve20AndLock() public {
        (RelicPricedRandomnessQueueMockV2 provider, RelicForgeReserveV2Harness reserve, RelicForgeBatchQueueV2Harness collection) = _fixture(100);
        reserve;
        address buyer = address(0x1002);

        uint256 beforeGas = gasleft();
        vm.prank(buyer);
        collection.requestForgeMint(buyer, 20);
        uint256 used = beforeGas - gasleft();

        assertEq(provider.nextRequestId(), 1, "full lock still performs zero provider calls");
        emit GasMeasured(bytes32("RESERVE_20"), used);
        assertTrue(used < 450_000, "quantity-20 reservation/lock budget");
    }

    function testGasRngRequest20() public {
        (RelicPricedRandomnessQueueMockV2 provider, RelicForgeReserveV2Harness reserve, RelicForgeBatchQueueV2Harness collection) = _fixture(100);
        reserve;
        address buyer = address(0x1003);
        vm.prank(buyer);
        collection.requestForgeMint(buyer, 20);

        uint256 beforeGas = gasleft();
        collection.requestRandomnessForBatch(1);
        uint256 used = beforeGas - gasleft();

        assertEq(provider.nextRequestId(), 2, "one rng request created");
        emit GasMeasured(bytes32("RNG_REQ_20"), used);
        assertTrue(used < 600_000, "rng dispatch is off collector path");
    }

    function testGasCallback20() public {
        (RelicPricedRandomnessQueueMockV2 provider, RelicForgeReserveV2Harness reserve, RelicForgeBatchQueueV2Harness collection) = _fixture(100);
        reserve;

        // Worst-case Phase 2B shape: twenty distinct one-NFT reservations/recipients in one batch.
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x1100 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 1);
        }
        collection.requestRandomnessForBatch(1);
        provider.recordWord(1, 0xBEEF);

        uint256 beforeGas = gasleft();
        bool delivered = provider.deliver(1);
        uint256 used = beforeGas - gasleft();

        assertTrue(delivered, "callback delivered");
        assertEq(collection.totalMinted(), 20, "20 auto-settled");
        emit GasMeasured(bytes32("CALLBACK_20"), used);
        // Outer measurement includes provider bookkeeping around the consumer's <=2.5M callback.
        assertTrue(used < 2_800_000, "20-nft provider+consumer callback budget");
    }

    function testGasRecovery20AfterLowGasWordStore() public {
        (RelicPricedRandomnessQueueMockV2 provider, RelicForgeReserveV2Harness reserve, RelicForgeBatchQueueV2Harness collection) = _fixture(100);
        reserve;

        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x1200 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 1);
        }
        collection.requestRandomnessForBatch(1);
        provider.recordWord(1, 0xCAFE);
        bool delivered = provider.deliverWithGas(1, 150_000);
        assertTrue(delivered, "word-only low-gas callback delivered");
        assertEq(collection.totalMinted(), 0, "settlement deferred");

        uint256 beforeGas = gasleft();
        uint32 settled = collection.settleReady(20);
        uint256 used = beforeGas - gasleft();

        assertEq(settled, 20, "recovery settled one batch");
        emit GasMeasured(bytes32("RECOVER_20"), used);
        assertTrue(used < 2_500_000, "permissionless recovery budget");
    }
}
