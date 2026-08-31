// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicReplayRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeMintV2Harness.sol";

contract ForgeRevealV2GasMatrixTest is TestBase {
    address internal constant ALICE = address(0xA11CE);

    event GasMeasured(bytes32 indexed label, uint256 gasUsed);

    function _measure(uint32 quantity, bytes32 label) internal returns (uint256 used) {
        RelicReplayRandomnessMockV2 provider = new RelicReplayRandomnessMockV2();
        RelicForgeMintV2Harness forge = new RelicForgeMintV2Harness(address(provider), 10_000);

        vm.prank(ALICE);
        (, uint256 requestId) = forge.requestForgeMint(ALICE, quantity);

        provider.recordWord(requestId, uint256(keccak256(abi.encode(label, quantity))));

        uint256 beforeGas = gasleft();
        bool delivered = provider.replay(requestId);
        used = beforeGas - gasleft();

        assertTrue(delivered, "callback delivered");
        assertEq(forge.totalMinted(), quantity, "quantity minted");
        emit GasMeasured(label, used);
    }

    function testGasForge01() public {
        uint256 used = _measure(1, bytes32("FORGE_01"));
        assertTrue(used < 1_000_000, "1-token forge budget");
    }

    function testGasForge05() public {
        uint256 used = _measure(5, bytes32("FORGE_05"));
        assertTrue(used < 1_500_000, "5-token forge budget");
    }

    function testGasForge10() public {
        uint256 used = _measure(10, bytes32("FORGE_10"));
        assertTrue(used < 2_000_000, "10-token forge budget");
    }

    function testGasForge20() public {
        uint256 used = _measure(20, bytes32("FORGE_20"));
        assertTrue(used < 3_000_000, "20-token forge budget");
    }

    function testGasForge50() public {
        uint256 used = _measure(50, bytes32("FORGE_50"));
        assertTrue(used < 5_000_000, "50-token forge budget");
    }
}
