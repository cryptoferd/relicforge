// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

contract RelicCanonicalCollectionRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonicalCollections;

    function setCanonicalCollection(address collection, bool canonical) external {
        canonicalCollections[collection] = canonical;
    }

    function isCanonicalCollection(address collection) external view returns (bool) {
        return canonicalCollections[collection];
    }
}

contract RelicRevertingWordConsumerMockV2 is IRelicRandomnessConsumerV1 {
    IRelicPricedRandomnessProviderV2 public immutable provider;
    bool public revertDelivery = true;
    uint256 public receivedRequestId;
    uint256 public receivedWord;

    constructor(address provider_) {
        provider = IRelicPricedRandomnessProviderV2(provider_);
    }

    function setRevertDelivery(bool value) external {
        revertDelivery = value;
    }

    function request(uint256 context, uint32 callbackGasLimit) external payable returns (uint256 requestId) {
        requestId = provider.requestRandomness{value: msg.value}(context, callbackGasLimit);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (revertDelivery) revert RF_BadRequest();
        receivedRequestId = requestId;
        receivedWord = randomWord;
    }
}

contract ForgeRevealV2Phase2DChainlinkAdapterTest is TestBase {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA5);

    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;

    function _fixture()
        internal
        returns (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);

        wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        registry = new RelicCanonicalCollectionRegistryMockV2();
        adapter = new RelicChainlinkVRFV25DirectThinAdapterV2Harness(address(wrapper), address(registry), 3);
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, MINTER_FEE, MINTER_FEE / 2, MAX_RNG_COST
        );
        registry.setCanonicalCollection(address(collection), true);
        reserve.registerCollection(address(collection));
    }

    function _mintTwentyOneNftCollectors(RelicForgeBatchQueueV2Harness collection) internal {
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x2100 + i));
            vm.deal(buyer, MINTER_FEE);
            vm.prank(buyer);
            collection.requestForgeMint{value: MINTER_FEE}(buyer, 1);
        }
    }

    function testLiveWrapperQuoteAndRequestRemainThinForTwentyNftEnvelope() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;

        vm.deal(ALICE, 20 * MINTER_FEE);
        vm.prank(ALICE);
        collection.requestForgeMint{value: 20 * MINTER_FEE}(ALICE, 20);

        uint32 settlementEnvelope = collection.callbackGasForQuantity(20);
        uint256 thinQuote = adapter.quoteRequestPrice(settlementEnvelope);
        assertEq(
            thinQuote,
            wrapper.calculateRequestPriceNative(adapter.UPSTREAM_CALLBACK_GAS(), 1),
            "adapter uses wrapper live thin quote"
        );

        uint256 localRequestId = collection.requestRandomnessForBatch(1);
        assertEq(localRequestId, 1, "collection tracks local adapter request id");

        (address wrapperConsumer, uint32 upstreamCallbackGas, uint16 confirmations, uint32 numWords, uint256 paid,,,,) =
            wrapper.requests(1);
        assertEq(wrapperConsumer, address(adapter), "wrapper callback targets adapter");
        assertEq(upstreamCallbackGas, 300_000, "2.45m settlement envelope is not sent upstream");
        assertEq(confirmations, 3, "configured confirmations preserved");
        assertEq(numWords, 1, "one shared batch word requested");
        assertEq(paid, thinQuote, "live quote paid exactly");

        (
            address deliveryConsumer,
            uint256 context,
            uint32 requestedConsumerCallbackGas,
            uint256 upstreamRequestId,
            uint256 requestPrice,,,
        ) = adapter.deliveries(localRequestId);
        assertEq(deliveryConsumer, address(collection), "exact consumer identity retained");
        assertEq(context, 1, "exact batch context retained");
        assertEq(requestedConsumerCallbackGas, settlementEnvelope, "consumer envelope retained for audit");
        assertEq(upstreamRequestId, 1, "upstream request identity mapped exactly");
        assertEq(requestPrice, thinQuote, "adapter request price retained");
    }

    function testThinCallbackStoresWordAndDefersTwentyNftSettlement() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;

        _mintTwentyOneNftCollectors(collection);
        collection.requestRandomnessForBatch(1);

        bool callbackSucceeded = wrapper.fulfill(1, 0xBEEF);
        assertTrue(callbackSucceeded, "thin upstream callback succeeds");
        assertEq(collection.totalMinted(), 0, "no nft settlement inside thin callback");

        (,,,,, uint256 adapterWord, bool adapterWordReady, bool delivered) = adapter.deliveries(1);
        assertEq(adapterWord, 0xBEEF, "adapter persisted verified word");
        assertTrue(adapterWordReady, "adapter word ready before delivery completion");
        assertTrue(delivered, "collection accepted thin word delivery");

        (,,,,,,,,, uint256 collectionWord,, bool collectionWordReady, bool settledBefore) = collection.batches(1);
        assertEq(collectionWord, 0xBEEF, "collection stored exact adapter word");
        assertTrue(collectionWordReady, "collection word ready");
        assertFalse(settledBefore, "batch intentionally remains unsettled");

        uint32 settled = collection.settleReady(20);
        assertEq(settled, 20, "permissionless transaction settles full batch");
        assertEq(collection.totalMinted(), 20, "twenty final nfts minted afterward");
    }

    function testConsumerDeliveryFailureReplaysOnlyExactStoredWord() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        reserve;
        collection;

        RelicRevertingWordConsumerMockV2 consumer = new RelicRevertingWordConsumerMockV2(address(adapter));
        registry.setCanonicalCollection(address(consumer), true);

        uint32 envelope = 2_450_000;
        uint256 quote = adapter.quoteRequestPrice(envelope);
        uint256 localRequestId = consumer.request{value: quote}(77, envelope);
        assertEq(localRequestId, 1, "local request created");

        bool callbackSucceeded = wrapper.fulfill(1, 0xCAFE);
        assertTrue(callbackSucceeded, "adapter callback does not revert on consumer failure");

        (,,,,, uint256 storedWord, bool wordReady, bool deliveredBefore) = adapter.deliveries(1);
        assertEq(storedWord, 0xCAFE, "verified word persisted before failed delivery");
        assertTrue(wordReady, "stored word remains ready");
        assertFalse(deliveredBefore, "failed consumer remains replayable");

        consumer.setRevertDelivery(false);
        bool replayed = adapter.replayFulfillment(1);
        assertTrue(replayed, "permissionless exact-word replay succeeds");
        assertEq(consumer.receivedRequestId(), 1, "same local request replayed");
        assertEq(consumer.receivedWord(), 0xCAFE, "same exact word replayed");

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        wrapper.forceDuplicateCallback(1, 0xDEAD);

        (,,,,, uint256 wordAfter,,) = adapter.deliveries(1);
        assertEq(wordAfter, 0xCAFE, "duplicate callback cannot reroll stored word");
    }

    function testUnauthorizedConsumerCannotCreateBillableProviderRequest() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;
        collection;

        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        vm.deal(ALICE, quote);
        vm.startPrank(ALICE);
        vm.expectRevert(RF_NotAuthorized.selector);
        adapter.requestRandomness{value: quote}(1, 2_450_000);
        vm.stopPrank();

        assertEq(wrapper.nextRequestId(), 1, "unauthorized caller creates no upstream request");
        assertEq(adapter.nextRequestId(), 1, "unauthorized caller creates no local request");
        assertEq(wrapper.totalFeesPaid(), 0, "unauthorized caller consumes no provider funds");
    }

    function testLiveQuoteSpikeOverCollectionCapFailsClosed() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        adapter;
        reserve;

        vm.deal(ALICE, 20 * MINTER_FEE);
        vm.prank(ALICE);
        collection.requestForgeMint{value: 20 * MINTER_FEE}(ALICE, 20);

        wrapper.setPricing(0.03 ether, 100 gwei);
        vm.expectRevert(RFV2_RandomnessQuoteTooHigh.selector);
        collection.requestRandomnessForBatch(1);

        assertEq(wrapper.nextRequestId(), 1, "price cap blocks upstream request");
        assertEq(collection.unrequestedLockedBatches(), 1, "batch remains queued for later request");
    }

    function testOnlyConfiguredWrapperCanInjectRandomWords() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            RelicCanonicalCollectionRegistryMockV2 registry,
            RelicChainlinkVRFV25DirectThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        wrapper;
        registry;
        reserve;
        collection;

        uint256[] memory words = new uint256[](1);
        words[0] = 123;
        vm.expectRevert(RFV2_OnlyChainlinkWrapper.selector);
        adapter.rawFulfillRandomWords(1, words);
    }
}
