// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicProviderCostModelV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3DepositMockV2.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3RouterMockV2.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3ThinAdapterV2Harness.sol";

contract RelicSupraEconomicsRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who) external {
        canonical[who] = true;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract ForgeRevealV2Phase2DSupraEconomicsTest is TestBase {
    event GasMeasured(bytes32 indexed label, uint256 gasUsed);
    event CostMeasured(bytes32 indexed label, uint256 costWei);

    address internal constant CLIENT_WALLET = address(0xC11E17);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    uint128 internal constant MAX_GAS_PRICE = 5 gwei;
    uint128 internal constant MAX_GAS_LIMIT = 500_000;
    uint128 internal constant CALLBACK_GAS_PRICE = 2 gwei;
    uint128 internal constant CALLBACK_GAS_LIMIT = 300_000;
    uint128 internal constant MIN_BALANCE = 0.005 ether;
    uint128 internal constant INITIAL_FUND = 0.02 ether;
    uint256 internal constant RESERVATION = 0.001 ether;

    function _collectionFixture(uint256 hopperPerToken)
        internal
        returns (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        vm.deal(CLIENT_WALLET, 10 ether);
        deposit = new RelicSupraDVRFV3DepositMockV2();
        router = new RelicSupraDVRFV3RouterMockV2(address(deposit));
        deposit.setRouter(address(router));
        deposit.configureClient(CLIENT_WALLET, MIN_BALANCE, MAX_GAS_PRICE, MAX_GAS_LIMIT);
        vm.prank(CLIENT_WALLET);
        deposit.depositFundClient{value: INITIAL_FUND}();
        RelicSupraEconomicsRegistryMockV2 registry = new RelicSupraEconomicsRegistryMockV2();
        adapter = new RelicSupraDVRFV3ThinAdapterV2Harness(
            address(router), address(deposit), address(registry), CLIENT_WALLET, 3, RESERVATION, CALLBACK_GAS_PRICE, 4
        );
        deposit.configureContract(CLIENT_WALLET, address(adapter), CALLBACK_GAS_PRICE, CALLBACK_GAS_LIMIT, true);
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, hopperPerToken, hopperPerToken / 2, 0.01 ether
        );
        registry.setCanonical(address(collection));
        reserve.registerCollection(address(collection));
    }

    function _mintTwenty(RelicForgeBatchQueueV2Harness collection, uint256 price) internal {
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x9200 + i));
            vm.deal(buyer, price);
            vm.prank(buyer);
            collection.requestForgeMint{value: price}(buyer, 1);
        }
    }

    function testSupraCostModelUsesFloorOrThirtyPercentPremium() public {
        RelicProviderCostModelV2 model = new RelicProviderCostModelV2();
        uint256 floorDominates = model.supraSubscriptionCost(0.000005 ether, 0.00001 ether, 3_000);
        uint256 premiumDominates = model.supraSubscriptionCost(0.0005 ether, 0.00001 ether, 3_000);
        emit CostMeasured(bytes32("SUPRA_FLOOR"), floorDominates);
        emit CostMeasured(bytes32("SUPRA_PREM"), premiumDominates);
        assertEq(floorDominates, 0.00001 ether, "minimum fee dominates low execution cost");
        assertEq(premiumDominates, 0.00065 ether, "30 percent premium over network execution cost");
    }

    function testReservationCoverageAndDrainVectorsRemainSharedLiquidityProblem() public {
        RelicProviderCostModelV2 model = new RelicProviderCostModelV2();
        (uint256 protectedAfter, int256 protectedDelta) =
            model.subscriptionReservationOutcome(0.01 ether, RESERVATION, 0.0008 ether);
        (uint256 drainedAfter, int256 drainedDelta) =
            model.subscriptionReservationOutcome(0.01 ether, RESERVATION, 0.0012 ether);
        emit CostMeasured(bytes32("SUPRA_RES_OK"), protectedAfter);
        emit CostMeasured(bytes32("SUPRA_RES_LOW"), drainedAfter);
        assertEq(protectedAfter, 0.0102 ether, "sufficient reservation exceeds request charge");
        assertTrue(protectedDelta > 0, "sufficient reservation has positive delta");
        assertEq(drainedAfter, 0.0098 ether, "under reservation consumes prior shared liquidity");
        assertTrue(drainedDelta < 0, "under reservation has negative delta");
    }

    function testCollectionBooksReservationWhileSupraChargesSharedSubscriptionSeparately() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture(RESERVATION / 40);
        _mintTwenty(collection, RESERVATION / 40);
        assertEq(collection.hopperBalance(), RESERVATION / 2, "collection accumulated half reservation");
        collection.requestRandomnessForBatch(1);
        assertEq(collection.totalRandomnessSpend(), RESERVATION, "collection books conservative reservation");
        assertEq(collection.totalReserveSubsidy(), RESERVATION / 2, "reserve covers reservation shortfall");
        assertEq(address(adapter).balance, RESERVATION, "reservation remains adapter escrow");
        assertEq(deposit.checkClientFund(CLIENT_WALLET), INITIAL_FUND, "subscription not atomically replenished");

        router.setCharges(0.0006 ether, 0);
        router.attemptFulfill(1, 123);
        assertEq(
            deposit.checkClientFund(CLIENT_WALLET),
            INITIAL_FUND - 0.0006 ether,
            "actual provider charge hits shared subscription"
        );
        assertEq(adapter.reservationByLocalRequestId(1), RESERVATION, "adapter still knows reservation only");
    }

    function testGasSupraThinRequestWordAndSettlement20() public {
        (, RelicSupraDVRFV3RouterMockV2 router,,, RelicForgeBatchQueueV2Harness collection) = _collectionFixture(0);
        _mintTwenty(collection, 0);
        router.setCharges(0, 0);

        uint256 beforeRequest = gasleft();
        collection.requestRandomnessForBatch(1);
        uint256 requestGas = beforeRequest - gasleft();
        emit GasMeasured(bytes32("SUPRA_REQ_20"), requestGas);
        assertTrue(requestGas < 1_100_000, "Supra thin request dispatch budget");

        uint256 beforeWord = gasleft();
        bool callbackSucceeded = router.attemptFulfill(1, 0x1234);
        uint256 wordGas = beforeWord - gasleft();
        emit GasMeasured(bytes32("SUPRA_WORD_20"), wordGas);
        assertTrue(callbackSucceeded, "Supra callback succeeds");
        assertEq(collection.totalMinted(), 0, "provider callback performs no NFT settlement");
        assertTrue(wordGas < 1_000_000, "thin provider callback budget");

        uint256 beforeSettle = gasleft();
        uint32 settled = collection.settleReady(20);
        uint256 settleGas = beforeSettle - gasleft();
        emit GasMeasured(bytes32("SUPRA_SETTLE_20"), settleGas);
        assertEq(settled, 20, "ordinary transaction settles twenty NFTs");
        assertTrue(settleGas < 2_800_000, "ordinary settlement remains bounded");
    }
}
