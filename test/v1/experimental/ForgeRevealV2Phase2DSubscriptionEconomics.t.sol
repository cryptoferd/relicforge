// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicProviderCostModelV2.sol";

contract ForgeRevealV2Phase2DSubscriptionEconomicsTest is TestBase {
    event CostMeasured(bytes32 indexed label, uint256 costWei);

    function testReservationCoverageAndDrainVectors() public {
        RelicProviderCostModelV2 model = new RelicProviderCostModelV2();
        (uint256 protectedAfter, int256 protectedDelta) =
            model.subscriptionReservationOutcome(0.01 ether, 0.001 ether, 0.0008 ether);
        emit CostMeasured(bytes32("CL_SUB_RES_OK"), protectedAfter);
        assertEq(protectedAfter, 0.0102 ether, "sufficient reservation grows shared buffer");
        assertTrue(protectedDelta > 0, "request is self-funding at this vector");

        (uint256 drainedAfter, int256 drainedDelta) =
            model.subscriptionReservationOutcome(0.01 ether, 0.001 ether, 0.0012 ether);
        emit CostMeasured(bytes32("CL_SUB_RES_LOW"), drainedAfter);
        assertEq(drainedAfter, 0.0098 ether, "under reservation drains shared buffer");
        assertTrue(drainedDelta < 0, "request consumes prior shared liquidity");
    }
}
