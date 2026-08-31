// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicReplayRandomnessMockV2.sol";
import "../../../contracts/production/experimental/RelicRevealLaterV2Harness.sol";

contract RevealLaterV2GasMatrixTest is TestBase {
    address internal constant ALICE = address(0xA11CE);

    event GasMeasured(bytes32 indexed label, uint256 gasUsed);

    function _measure(uint32 maxSupply, bytes32 label) internal returns (uint256 used) {
        RelicReplayRandomnessMockV2 provider = new RelicReplayRandomnessMockV2();
        RelicRevealLaterV2Harness reveal =
            new RelicRevealLaterV2Harness(address(provider), maxSupply);

        reveal.mintHidden(ALICE, 1);
        uint256 requestId = reveal.requestReveal();
        provider.recordWord(requestId, 0xBEEFCAFE12345678);

        uint256 beforeGas = gasleft();
        bool delivered = provider.replay(requestId);
        used = beforeGas - gasleft();

        assertTrue(delivered, "callback delivered");
        assertTrue(reveal.revealed(), "collection revealed");
        emit GasMeasured(label, used);
    }

    function testGasRevealSupply100() public {
        uint256 used = _measure(100, bytes32("REVEAL_100"));
        assertTrue(used < 500_000, "100-supply reveal budget");
    }

    function testGasRevealSupply10000() public {
        uint256 used = _measure(10_000, bytes32("REVEAL_10K"));
        assertTrue(used < 500_000, "10k-supply reveal budget");
    }
}
