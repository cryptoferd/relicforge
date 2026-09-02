// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25SubscriptionCoordinatorMockV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness.sol";

contract RelicSubscriptionRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicSubscriptionConsumerMockV2 is IRelicRandomnessConsumerV1 {
    IRelicPricedRandomnessProviderV2 public immutable provider;
    bool public revertDelivery;
    uint256 public lastRequestId;
    uint256 public lastWord;

    constructor(address provider_) {
        provider = IRelicPricedRandomnessProviderV2(provider_);
    }

    function setRevertDelivery(bool value) external {
        revertDelivery = value;
    }

    function request(uint256 context, uint32 gasEnvelope) external payable returns (uint256) {
        return provider.requestRandomness{value: msg.value}(context, gasEnvelope);
    }

    function fulfillRandomness(uint256 requestId, uint256 word) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (revertDelivery) revert RF_BadRequest();
        lastRequestId = requestId;
        lastWord = word;
    }
}

contract ForgeRevealV2Phase2DSubscriptionAdapterTest is TestBase {
    uint256 constant SUB_ID = 77;
    bytes32 constant KEY_HASH = keccak256("RF_R2_TEST_LANE");
    uint256 constant RESERVATION = 0.001 ether;
    address constant CREATOR = address(0xC0FFEE);
    address constant TREASURY = address(0x7EA5);

    function _adapterFixture(uint32 maxPending)
        internal
        returns (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);
        coordinator = new RelicChainlinkVRFV25SubscriptionCoordinatorMockV2();
        coordinator.createSubscription(SUB_ID, address(this));
        registry = new RelicSubscriptionRegistryMockV2();
        adapter = new RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness(
            address(coordinator), address(registry), SUB_ID, KEY_HASH, 3, RESERVATION, maxPending
        );
        coordinator.addConsumer(SUB_ID, address(adapter));
    }

    function testSubscriptionRequestUsesExactCoordinatorShapeAndThinCallback() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        uint256 id = consumer.request{value: RESERVATION}(9, 2_450_000);
        assertEq(id, 1, "local request id");
        (
            address upstreamConsumer,
            bytes32 keyHash,
            uint256 subId,
            uint16 confirms,
            uint32 callbackGas,
            uint32 numWords,,,,,
        ) = coordinator.requests(1);
        assertEq(upstreamConsumer, address(adapter), "coordinator consumer adapter");
        assertEq(uint256(keyHash), uint256(KEY_HASH), "key hash");
        assertEq(subId, SUB_ID, "sub id");
        assertEq(confirms, 3, "confirmations");
        assertEq(callbackGas, 300_000, "thin callback fixed");
        assertEq(numWords, 1, "one word");
        (,, uint32 envelope,,,,,) = adapter.deliveries(1);
        assertEq(envelope, 2_450_000, "collection settlement envelope retained only as telemetry");
    }

    function testReservationFundsSubscriptionBeforeRequestAndTracksConsumerResponsibility() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        (, uint96 nativeBalance,,,) = coordinator.getSubscription(SUB_ID);
        assertEq(nativeBalance, RESERVATION, "reservation forwarded to subscription");
        assertEq(
            adapter.totalReservationFundingByConsumer(address(consumer)), RESERVATION, "consumer responsibility tracked"
        );
        assertEq(adapter.reservationByLocalRequestId(1), RESERVATION, "request reservation tracked");
    }

    function testUnauthorizedCollectionCannotConsumeSharedSubscription() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        vm.expectRevert(RF_NotAuthorized.selector);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        assertEq(coordinator.nextRequestId(), 1, "no upstream request");
    }

    function testAdapterMustBeAdmittedSubscriptionConsumer() public {
        vm.deal(address(this), 10 ether);
        RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator =
            new RelicChainlinkVRFV25SubscriptionCoordinatorMockV2();
        coordinator.createSubscription(SUB_ID, address(this));
        RelicSubscriptionRegistryMockV2 registry = new RelicSubscriptionRegistryMockV2();
        RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter = new RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness(
            address(coordinator), address(registry), SUB_ID, KEY_HASH, 3, RESERVATION, 2
        );
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        vm.expectRevert(RFV2_SubscriptionConsumerNotAdmitted.selector);
        consumer.request{value: RESERVATION}(1, 2_450_000);
    }

    function testPendingLimitThrottlesOneConsumerWithoutBlockingAnother() public {
        (, RelicSubscriptionRegistryMockV2 registry, RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter) =
            _adapterFixture(1);
        RelicSubscriptionConsumerMockV2 a = new RelicSubscriptionConsumerMockV2(address(adapter));
        RelicSubscriptionConsumerMockV2 b = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(a), true);
        registry.setCanonical(address(b), true);
        a.request{value: RESERVATION}(1, 2_450_000);
        vm.expectRevert(RFV2_PendingRequestLimit.selector);
        a.request{value: RESERVATION}(2, 2_450_000);
        b.request{value: RESERVATION}(3, 2_450_000);
        assertEq(adapter.pendingRequestsByConsumer(address(a)), 1, "a capped");
        assertEq(adapter.pendingRequestsByConsumer(address(b)), 1, "b independently admitted");
    }

    function testSufficientReservationDoesNotDrainPreexistingSharedLiquidity() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        coordinator.fundSubscriptionWithNative{value: 0.01 ether}(SUB_ID);
        coordinator.setActualPayment(0.0008 ether);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        coordinator.fulfill(1, 0xBEEF);
        (, uint96 afterBalance,,,) = coordinator.getSubscription(SUB_ID);
        assertEq(afterBalance, 0.0102 ether, "request replenishes more than it consumes");
    }

    function testUnderReservationDemonstratesSharedBufferDrainRisk() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        coordinator.fundSubscriptionWithNative{value: 0.01 ether}(SUB_ID);
        coordinator.setActualPayment(0.0012 ether);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        coordinator.fulfill(1, 0xBEEF);
        (, uint96 afterBalance,,,) = coordinator.getSubscription(SUB_ID);
        assertEq(afterBalance, 0.0098 ether, "under-reserved request drains shared buffer");
    }

    function testCallbackPersistsExactWordAndReplayCannotReroll() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        coordinator.setActualPayment(0.0005 ether);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        consumer.setRevertDelivery(true);
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        bool success = coordinator.fulfill(1, 0xCAFE);
        assertTrue(success, "adapter callback survives consumer failure");
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(word, 0xCAFE, "exact word stored");
        assertTrue(ready, "word ready");
        assertFalse(delivered, "replay remains available");
        consumer.setRevertDelivery(false);
        adapter.replayFulfillment(1);
        assertEq(consumer.lastWord(), 0xCAFE, "exact stored word replayed");
        vm.expectRevert(RF_AlreadyFulfilled.selector);
        coordinator.forceDuplicateCallback(1, 0xDEAD);
    }

    function testOnlyCoordinatorCanInjectWord() public {
        (,, RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter) = _adapterFixture(4);
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        vm.expectRevert(RFV2_OnlyChainlinkCoordinator.selector);
        adapter.rawFulfillRandomWords(1, words);
    }

    function testPostCallbackChargeOrderingIsExplicitlyObservable() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        coordinator.setActualPayment(0.0006 ether);
        RelicSubscriptionConsumerMockV2 consumer = new RelicSubscriptionConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        coordinator.fulfill(1, 123);
        (,,,,,,,,,, uint256 chargedPayment) = coordinator.requests(1);
        assertEq(chargedPayment, 0.0006 ether, "mock records exact payment only after callback");
        assertEq(
            adapter.reservationByLocalRequestId(1), RESERVATION, "adapter knows reservation, not final provider charge"
        );
    }

    function testQueueStillDefersTwentyNftSettlement() public {
        (
            RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 coordinator,
            RelicSubscriptionRegistryMockV2 registry,
            RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness adapter
        ) = _adapterFixture(4);
        coordinator.setActualPayment(0.0005 ether);
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, RESERVATION / 20, RESERVATION / 40, 0.01 ether
        );
        registry.setCanonical(address(collection), true);
        reserve.registerCollection(address(collection));
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x6000 + i));
            vm.deal(buyer, RESERVATION / 20);
            vm.prank(buyer);
            collection.requestForgeMint{value: RESERVATION / 20}(buyer, 1);
        }
        collection.requestRandomnessForBatch(1);
        coordinator.fulfill(1, 0x1234);
        assertEq(collection.totalMinted(), 0, "thin callback does not settle NFTs");
        assertEq(collection.settleReady(20), 20, "permissionless settlement completes batch");
    }
}
