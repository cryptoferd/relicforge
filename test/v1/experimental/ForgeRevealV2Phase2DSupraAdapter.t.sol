// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3DepositMockV2.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3RouterMockV2.sol";
import "../../../contracts/production/experimental/RelicSupraDVRFV3ThinAdapterV2Harness.sol";

contract RelicSupraRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicSupraWordConsumerMockV2 is IRelicRandomnessConsumerV1 {
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

    function request(uint256 context, uint32 envelope) external payable returns (uint256 requestId) {
        requestId = provider.requestRandomness{value: msg.value}(context, envelope);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (revertDelivery) revert RF_BadRequest();
        lastRequestId = requestId;
        lastWord = randomWord;
    }
}

contract RelicDirectSupraRetryConsumerMockV2 is IRelicSupraDVRFV3CallbackV2 {
    IRelicSupraDVRFV3Router public immutable router;
    address public immutable clientWallet;
    bool public revertCallback = true;
    uint256 public lastNonce;
    uint256 public lastWord;

    constructor(address router_, address clientWallet_) {
        router = IRelicSupraDVRFV3Router(router_);
        clientWallet = clientWallet_;
    }

    function setRevertCallback(bool value) external {
        revertCallback = value;
    }

    function request(uint256 seed) external returns (uint256) {
        return router.generateRequest("supraCallback(uint256,uint256[])", 1, 3, seed, clientWallet);
    }

    function supraCallback(uint256 nonce, uint256[] calldata rngList) external {
        if (msg.sender != address(router)) revert RF_NotRandomnessProvider();
        if (revertCallback) revert RF_BadRequest();
        if (rngList.length != 1) revert RF_BadRequest();
        lastNonce = nonce;
        lastWord = rngList[0];
    }
}

contract ForgeRevealV2Phase2DSupraAdapterTest is TestBase {
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

    function _fixture(uint32 maxPending)
        internal
        returns (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        )
    {
        vm.deal(CLIENT_WALLET, 10 ether);
        deposit = new RelicSupraDVRFV3DepositMockV2();
        router = new RelicSupraDVRFV3RouterMockV2(address(deposit));
        deposit.setRouter(address(router));
        deposit.configureClient(CLIENT_WALLET, MIN_BALANCE, MAX_GAS_PRICE, MAX_GAS_LIMIT);
        vm.prank(CLIENT_WALLET);
        deposit.depositFundClient{value: INITIAL_FUND}();
        registry = new RelicSupraRegistryMockV2();
        adapter = new RelicSupraDVRFV3ThinAdapterV2Harness(
            address(router),
            address(deposit),
            address(registry),
            CLIENT_WALLET,
            3,
            RESERVATION,
            CALLBACK_GAS_PRICE,
            maxPending
        );
        deposit.configureContract(CLIENT_WALLET, address(adapter), CALLBACK_GAS_PRICE, CALLBACK_GAS_LIMIT, true);
    }

    function _collectionFixture()
        internal
        returns (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        (deposit, router, registry, adapter) = _fixture(4);
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, RESERVATION / 20, RESERVATION / 40, 0.01 ether
        );
        registry.setCanonical(address(collection), true);
        reserve.registerCollection(address(collection));
    }

    function _mintTwenty(RelicForgeBatchQueueV2Harness collection) internal {
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x9100 + i));
            vm.deal(buyer, RESERVATION / 20);
            vm.prank(buyer);
            collection.requestForgeMint{value: RESERVATION / 20}(buyer, 1);
        }
    }

    function testSupraRequestUsesDocumentedV3ShapeCustomSeedAndThinCallback() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);

        uint256 localId = consumer.request{value: RESERVATION}(77, 2_450_000);
        assertEq(localId, 1, "local request id");
        (
            address requester,
            bytes32 functionSigHash,
            uint8 rngCount,
            uint256 confirmations,
            uint256 clientSeed,
            address clientWallet,
            uint128 callbackGasPrice,
            uint128 callbackGasLimit,,,,,,
        ) = router.requests(1);
        assertEq(requester, address(adapter), "router requester adapter");
        assertEq(functionSigHash, keccak256(bytes("supraCallback(uint256,uint256[])")), "callback signature hash");
        assertEq(rngCount, 1, "one random word");
        assertEq(confirmations, 3, "configured confirmations");
        assertTrue(clientSeed != 0, "request-bound seed nonzero");
        assertEq(clientSeed, adapter.clientSeedByLocalRequestId(1), "adapter retains exact client seed");
        assertEq(clientWallet, CLIENT_WALLET, "fixed subscription client wallet");
        assertEq(callbackGasPrice, CALLBACK_GAS_PRICE, "contract callback gas price");
        assertEq(callbackGasLimit, CALLBACK_GAS_LIMIT, "thin callback gas limit");
        assertEq(adapter.reservationByLocalRequestId(1), RESERVATION, "reservation retained");
        assertEq(address(adapter).balance, RESERVATION, "reservation remains isolated escrow");
        assertEq(
            deposit.checkClientFund(CLIENT_WALLET), INITIAL_FUND, "request does not atomically top up EOA subscription"
        );
    }

    function testUnauthorizedCollectionCannotCreateSupraRequest() public {
        (, RelicSupraDVRFV3RouterMockV2 router,, RelicSupraDVRFV3ThinAdapterV2Harness adapter) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        vm.expectRevert(RF_NotAuthorized.selector);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        assertEq(router.nextNonce(), 1, "no upstream request");
    }

    function testAdapterFailsClosedIfWhitelistOrGasConfigurationDrifts() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        assertTrue(adapter.providerReady(), "fixture ready");

        deposit.configureContract(CLIENT_WALLET, address(adapter), 0, 0, false);
        assertFalse(adapter.providerReady(), "removed contract fails closed");
        vm.expectRevert(RFV2_SupraSubscriptionNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);

        deposit.configureContract(CLIENT_WALLET, address(adapter), CALLBACK_GAS_PRICE, 400_000, true);
        assertFalse(adapter.providerReady(), "callback gas drift fails closed");
        deposit.configureContract(CLIENT_WALLET, address(adapter), 3 gwei, CALLBACK_GAS_LIMIT, true);
        assertFalse(adapter.providerReady(), "gas price above RF ceiling fails closed");
    }

    function testClientMinimumBalanceFailsClosed() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        deposit.setClientFundForTest(CLIENT_WALLET, MIN_BALANCE);
        assertFalse(adapter.providerReady(), "at minimum balance is blocked");
        vm.expectRevert(RFV2_SupraSubscriptionNotReady.selector);
        consumer.request{value: RESERVATION}(1, 2_450_000);
    }

    function testPendingLimitThrottlesOneConsumerWithoutBlockingAnother() public {
        (,, RelicSupraRegistryMockV2 registry, RelicSupraDVRFV3ThinAdapterV2Harness adapter) = _fixture(1);
        RelicSupraWordConsumerMockV2 a = new RelicSupraWordConsumerMockV2(address(adapter));
        RelicSupraWordConsumerMockV2 b = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(a), true);
        registry.setCanonical(address(b), true);
        a.request{value: RESERVATION}(1, 2_450_000);
        vm.expectRevert(RFV2_SupraPendingRequestLimit.selector);
        a.request{value: RESERVATION}(2, 2_450_000);
        b.request{value: RESERVATION}(3, 2_450_000);
        assertEq(adapter.pendingRequestsByConsumer(address(a)), 1, "a capped");
        assertEq(adapter.pendingRequestsByConsumer(address(b)), 1, "b independent");
    }

    function testThinSupraCallbackStoresWordAndDefersTwentyNftSettlement() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        collection.requestRandomnessForBatch(1);
        router.setCharges(0.0006 ether, 0.0001 ether);
        bool callbackSucceeded = router.attemptFulfill(1, 0xA55A);
        assertTrue(callbackSucceeded, "router callback succeeds");
        assertEq(collection.totalMinted(), 0, "no NFT settlement inside provider callback");
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(word, 0xA55A, "exact Supra word stored");
        assertTrue(ready, "word ready");
        assertTrue(delivered, "collection accepted word");
        assertEq(deposit.checkClientFund(CLIENT_WALLET), INITIAL_FUND - 0.0006 ether, "shared subscription charged");
        assertEq(collection.settleReady(20), 20, "permissionless settlement completes later");
        assertEq(collection.totalMinted(), 20, "twenty final NFTs minted");
    }

    function testCollectionDeliveryFailureReplaysExactStoredSupraWordAndNoReroll() public {
        (
            ,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.setRevertDelivery(true);
        consumer.request{value: RESERVATION}(5, 2_450_000);
        assertTrue(router.attemptFulfill(1, 0xCAFE), "adapter callback survives collection rejection");
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(word, 0xCAFE, "verified word stored first");
        assertTrue(ready, "word remains ready");
        assertFalse(delivered, "collection replay available");

        consumer.setRevertDelivery(false);
        assertTrue(adapter.replayFulfillment(1), "local replay succeeds");
        assertEq(consumer.lastWord(), 0xCAFE, "same exact word replayed");
        vm.expectRevert(RF_AlreadyFulfilled.selector);
        router.forceDuplicateCallback(1, 0xDEAD);
    }

    function testOnlyRouterCanInjectSupraWord() public {
        (,,, RelicSupraDVRFV3ThinAdapterV2Harness adapter) = _fixture(4);
        uint256[] memory words = new uint256[](1);
        words[0] = 1;
        vm.expectRevert(RFV2_OnlySupraRouter.selector);
        adapter.supraCallback(1, words);
    }

    function testStoredRequestHashRejectsTamperedFulfillmentParameters() public {
        (
            ,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        vm.expectRevert(RF_BadRequest.selector);
        router.attemptFulfillWithRequestHash(1, 777, keccak256("tampered"));
        (,,,,,,,, bytes32 requestHash,,,,,) = router.requests(1);
        assertTrue(requestHash != bytes32(0), "request hash stored");
        assertTrue(router.attemptFulfillWithRequestHash(1, 777, requestHash), "exact stored request hash accepted");
    }

    function testRetryUsesSameNonceAndCommittedWordWithoutNewRequest() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        registry;
        adapter;
        RelicDirectSupraRetryConsumerMockV2 consumer =
            new RelicDirectSupraRetryConsumerMockV2(address(router), CLIENT_WALLET);
        deposit.configureContract(CLIENT_WALLET, address(consumer), CALLBACK_GAS_PRICE, CALLBACK_GAS_LIMIT, true);
        router.setCharges(0.0006 ether, 0.0001 ether);
        uint256 nonce = consumer.request(12345);
        assertEq(nonce, 1, "first nonce");
        assertFalse(router.attemptFulfill(nonce, 0xBEEF), "first callback intentionally fails");
        consumer.setRevertCallback(false);
        assertTrue(router.retry(nonce), "same request retries");
        assertEq(consumer.lastNonce(), nonce, "same nonce retried");
        assertEq(consumer.lastWord(), 0xBEEF, "same committed word retried");
        assertEq(router.nextNonce(), 2, "retry created no new request");
        (,,,,,,,,,, uint256 totalCharged, uint32 attempts,, bool fulfilled) = router.requests(nonce);
        assertEq(totalCharged, 0.0007 ether, "failed attempt plus success charge visible in shared balance");
        assertEq(attempts, 2, "two callback attempts");
        assertTrue(fulfilled, "request fulfilled after retry");
    }

    function testReservationEscrowDoesNotPretendToBeExactProviderCharge() public {
        (
            RelicSupraDVRFV3DepositMockV2 deposit,
            RelicSupraDVRFV3RouterMockV2 router,
            RelicSupraRegistryMockV2 registry,
            RelicSupraDVRFV3ThinAdapterV2Harness adapter
        ) = _fixture(4);
        RelicSupraWordConsumerMockV2 consumer = new RelicSupraWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.request{value: RESERVATION}(1, 2_450_000);
        router.setCharges(0.0004 ether, 0);
        router.attemptFulfill(1, 999);
        assertEq(adapter.reservationByLocalRequestId(1), RESERVATION, "adapter knows reservation");
        assertEq(address(adapter).balance, RESERVATION, "reservation remains escrowed");
        assertEq(
            deposit.checkClientFund(CLIENT_WALLET),
            INITIAL_FUND - 0.0004 ether,
            "provider charged separate shared balance"
        );
    }
}
