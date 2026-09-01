// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicProviderCostModelV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

contract RelicGasRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address collection) external {
        canonical[collection] = true;
    }

    function isCanonicalCollection(address collection) external view returns (bool) {
        return canonical[collection];
    }
}

contract ForgeRevealV2Phase2DCostMatrixTest is TestBase {
    event GasMeasured(bytes32 indexed label, uint256 gasUsed);
    event CostMeasured(bytes32 indexed label, uint256 costWei);

    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    function _gasFixture()
        internal
        returns (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);
        wrapper = new RelicChainlinkVRFV25WrapperMockV2(0, 0);
        RelicGasRegistryMockV2 registry = new RelicGasRegistryMockV2();
        adapter = new RelicChainlinkVRFV25DirectThinAdapterV2Harness(address(wrapper), address(registry), 3);
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.01 ether, 0, 10_000, 1 ether, 100 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, 0, 0, 0.001 ether
        );
        registry.setCanonical(address(collection));
        reserve.registerCollection(address(collection));

        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x3100 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 1);
        }
    }

    function testGasChainlinkThinRequestWordAndSettlement20() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeBatchQueueV2Harness collection
        ) = _gasFixture();
        adapter;

        uint256 beforeRequest = gasleft();
        collection.requestRandomnessForBatch(1);
        uint256 requestGas = beforeRequest - gasleft();
        emit GasMeasured(bytes32("CL_REQ_20"), requestGas);
        assertTrue(requestGas < 600_000, "thin request dispatch budget");

        uint256 beforeWord = gasleft();
        bool callbackSucceeded = wrapper.fulfill(1, 0xBEEF);
        uint256 wordGas = beforeWord - gasleft();
        emit GasMeasured(bytes32("CL_WORD_20"), wordGas);
        assertTrue(callbackSucceeded, "thin callback succeeded");
        assertEq(collection.totalMinted(), 0, "thin callback performed no nft settlement");
        assertTrue(wordGas < 600_000, "thin provider callback budget");

        uint256 beforeSettle = gasleft();
        uint32 settled = collection.settleReady(20);
        uint256 settleGas = beforeSettle - gasleft();
        emit GasMeasured(bytes32("CL_SETTLE_20"), settleGas);
        assertEq(settled, 20, "ordinary transaction settled twenty nfts");
        assertTrue(settleGas < 2_500_000, "ordinary settlement budget");
    }

    function testProviderEconomicMatrixAtOneGwei() public {
        RelicProviderCostModelV2 model = new RelicProviderCostModelV2();

        uint256 ethThin = model.chainlinkDirectNativeCost(1 gwei, 300_000, 90_000, 13_400, 435, 1, 2_400);
        uint256 ethFat = model.chainlinkDirectNativeCost(1 gwei, 2_450_000, 90_000, 13_400, 435, 1, 2_400);
        uint256 ethLifecycle = model.chainlinkThinLifecycleCost(1 gwei, 300_000, 1_825_108, 90_000, 13_400, 435, 2_400);

        emit CostMeasured(bytes32("CL_ETH_THIN"), ethThin);
        emit CostMeasured(bytes32("CL_ETH_FAT"), ethFat);
        emit CostMeasured(bytes32("CL_ETH_LIFE"), ethLifecycle);
        assertEq(ethThin, 0.0005007554 ether, "ethereum thin direct cost");
        assertEq(ethFat, 0.0031667554 ether, "ethereum fat direct cost");
        assertEq(ethLifecycle, 0.0023258634 ether, "ethereum thin lifecycle cost");
        assertTrue(ethLifecycle < ethFat, "thin callback plus ordinary settlement beats fat direct callback");

        uint256 baseThin = model.chainlinkDirectNativeCost(1 gwei, 300_000, 128_500, 13_400, 435, 1, 6_000);
        uint256 baseFat = model.chainlinkDirectNativeCost(1 gwei, 2_450_000, 128_500, 13_400, 435, 1, 6_000);
        uint256 baseLifecycle =
            model.chainlinkThinLifecycleCost(1 gwei, 300_000, 1_825_108, 128_500, 13_400, 435, 6_000);

        emit CostMeasured(bytes32("CL_BASE_THIN"), baseThin);
        emit CostMeasured(bytes32("CL_BASE_FAT"), baseFat);
        emit CostMeasured(bytes32("CL_BASE_LIFE"), baseLifecycle);
        assertEq(baseThin, 0.000707736 ether, "base thin direct cost");
        assertEq(baseFat, 0.004147736 ether, "base fat direct cost");
        assertEq(baseLifecycle, 0.002532844 ether, "base thin lifecycle cost");
        assertTrue(baseLifecycle < baseFat, "base thin lifecycle beats fat direct callback");

        uint256 subscriptionActual = model.chainlinkSubscriptionActualCost(1 gwei, 115_000, 95_000, 2_400);
        emit CostMeasured(bytes32("CL_SUB_ACTUAL"), subscriptionActual);
        assertEq(subscriptionActual, 0.0002604 ether, "subscription model charges actual gas plus premium");

        uint256 supraFloor = model.supraSubscriptionCost(0.005 ether, 0.01 ether, 3_000);
        uint256 supraPremium = model.supraSubscriptionCost(0.02 ether, 0.01 ether, 3_000);
        emit CostMeasured(bytes32("SUPRA_FLOOR"), supraFloor);
        emit CostMeasured(bytes32("SUPRA_PREM"), supraPremium);
        assertEq(supraFloor, 0.01 ether, "supra minimum dominates small network cost");
        assertEq(supraPremium, 0.026 ether, "supra premium dominates larger network cost");
    }
}
