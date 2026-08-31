// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicReplayRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeBatchMintV2Harness.sol";

contract ForgeRevealV2BatchGasMatrixTest is TestBase {
    address payable internal constant PAYOUT = payable(address(0xCAFE));
    address payable internal constant TREASURY = payable(address(0xFEE));

    event GasMeasured(bytes32 indexed label, uint256 gasUsed);

    function _newForge(uint32 batchSize)
        internal
        returns (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge)
    {
        provider = new RelicReplayRandomnessMockV2();
        forge = new RelicForgeBatchMintV2Harness(
            address(provider),
            10_000,
            batchSize,
            3,
            0,
            0,
            PAYOUT,
            TREASURY
        );
    }

    function _prepareSingleNftReservations(uint32 count)
        internal
        returns (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge)
    {
        (provider, forge) = _newForge(count);

        for (uint256 i; i < count; ++i) {
            address collector = address(uint160(0x5000 + i));
            vm.prank(collector);
            forge.requestForgeMint(collector, 1);
        }

        provider.recordWord(1, uint256(keccak256(abi.encode(count))));
        bool delivered = provider.replay(1);
        assertTrue(delivered, "word callback");
    }

    function _measureSettlement(uint32 count, bytes32 label) internal returns (uint256 used) {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _prepareSingleNftReservations(count);
        provider;

        uint256 beforeGas = gasleft();
        uint32 settled = forge.settleReady(count);
        used = beforeGas - gasleft();

        assertEq(settled, count, "batch quantity settled");
        assertEq(forge.totalMinted(), count, "all nfts minted");
        emit GasMeasured(label, used);
    }

    function testGasWordCallbackForFiftyNftBatch() public {
        (RelicReplayRandomnessMockV2 provider, RelicForgeBatchMintV2Harness forge) =
            _newForge(50);

        vm.prank(address(0x6000));
        forge.requestForgeMint(address(0x6000), 50);

        provider.recordWord(1, 123);

        uint256 beforeGas = gasleft();
        bool delivered = provider.replay(1);
        uint256 used = beforeGas - gasleft();

        assertTrue(delivered, "word callback");
        assertEq(forge.totalMinted(), 0, "callback does not mint");
        assertTrue(used < 250_000, "batch word callback unexpectedly expensive");
        emit GasMeasured(bytes32("WORD_50"), used);
    }

    function testGasSettle01x1() public {
        uint256 used = _measureSettlement(1, bytes32("SETTLE_01"));
        assertTrue(used < 750_000, "1 collector settlement budget");
    }

    function testGasSettle05x1() public {
        uint256 used = _measureSettlement(5, bytes32("SETTLE_05"));
        assertTrue(used < 1_500_000, "5 collector settlement budget");
    }

    function testGasSettle10x1() public {
        uint256 used = _measureSettlement(10, bytes32("SETTLE_10"));
        assertTrue(used < 2_500_000, "10 collector settlement budget");
    }

    function testGasSettle20x1() public {
        uint256 used = _measureSettlement(20, bytes32("SETTLE_20"));
        assertTrue(used < 4_000_000, "20 collector settlement budget");
    }

    function testGasSettle50x1() public {
        uint256 used = _measureSettlement(50, bytes32("SETTLE_50"));
        assertTrue(used < 8_000_000, "50 collector settlement budget");
    }
}
