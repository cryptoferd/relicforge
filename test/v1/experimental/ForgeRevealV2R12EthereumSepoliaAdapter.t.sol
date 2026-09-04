// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";

contract R12CanonicalRegistryMock is IRelicCanonicalCollectionRegistryR12 {
    mapping(address => bool) public canonical;

    function setCanonical(address collection, bool value) external {
        canonical[collection] = value;
    }

    function isCanonicalCollection(address collection) external view returns (bool) {
        return canonical[collection];
    }
}

contract R12RejectingConsumer is IRelicRandomnessConsumerV1 {
    IRelicPricedRandomnessProviderV2 public immutable provider;
    bool public reject = true;
    uint256 public receivedRequestId;
    uint256 public receivedWord;

    constructor(address provider_) {
        provider = IRelicPricedRandomnessProviderV2(provider_);
    }

    function setReject(bool value) external {
        reject = value;
    }

    function request(uint256 context, uint32 callbackGasLimit) external payable returns (uint256 requestId) {
        requestId = provider.requestRandomness{value: msg.value}(context, callbackGasLimit);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (reject) revert RF_BadRequest();
        receivedRequestId = requestId;
        receivedWord = randomWord;
    }
}

contract ForgeRevealV2R12EthereumSepoliaAdapterTest is TestBase {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA5);

    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    function _fixture()
        internal
        returns (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);
        wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        registry = new R12CanonicalRegistryMock();
        adapter = new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, MINTER_FEE, MINTER_FEE / 2, MAX_RNG_COST
        );

        registry.setCanonical(address(collection), true);
        reserve.registerCollection(address(collection));
    }

    function testR12CollectorMintDoesNotCallChainlink() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        adapter;
        reserve;

        vm.deal(ALICE, 20 * MINTER_FEE);
        vm.prank(ALICE);
        collection.requestForgeMint{value: 20 * MINTER_FEE}(ALICE, 20);

        assertEq(wrapper.nextRequestId(), 1, "collector transaction must not create upstream VRF request");
        assertEq(collection.totalCommitted(), 20, "collector mint accepted");
        assertEq(collection.unrequestedLockedBatches(), 1, "full batch locked for later executor");
    }

    function testR12UpstreamChainlinkCallbackIsStorageOnly() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;

        vm.deal(ALICE, 20 * MINTER_FEE);
        vm.prank(ALICE);
        collection.requestForgeMint{value: 20 * MINTER_FEE}(ALICE, 20);

        uint256 localRequestId = collection.requestRandomnessForBatch(1);
        assertEq(localRequestId, 1, "local request id");

        bool callbackSucceeded = wrapper.fulfill(1, 0xBEEF);
        assertTrue(callbackSucceeded, "wrapper callback succeeds");

        (,,,,, uint256 storedWord, bool wordReady, bool delivered) = adapter.deliveries(localRequestId);
        assertEq(storedWord, 0xBEEF, "exact word stored");
        assertTrue(wordReady, "word stored before downstream work");
        assertFalse(delivered, "storage-only callback never calls collection");

        (,,,,,,,,, uint256 collectionWord,, bool collectionReady,) = collection.batches(1);
        assertEq(collectionWord, 0, "collection untouched by upstream callback");
        assertFalse(collectionReady, "collection delivery deferred");
        assertEq(collection.totalMinted(), 0, "no NFT settlement in upstream callback");
    }

    function testR12PermissionlessReplayThenSettlementCompletesTwentyNftBatch() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;

        vm.deal(ALICE, 20 * MINTER_FEE);
        vm.prank(ALICE);
        collection.requestForgeMint{value: 20 * MINTER_FEE}(ALICE, 20);

        collection.requestRandomnessForBatch(1);
        assertTrue(wrapper.fulfill(1, 0xCAFE), "VRF callback succeeds");

        assertTrue(adapter.replayFulfillment(1), "any executor can replay exact stored word");
        assertEq(collection.totalMinted(), 0, "replay only delivers word");

        (,,,,,,,,, uint256 collectionWord,, bool collectionReady,) = collection.batches(1);
        assertEq(collectionWord, 0xCAFE, "same word reaches collection");
        assertTrue(collectionReady, "collection ready for settlement");

        uint32 settled = collection.settleReady(20);
        assertEq(settled, 20, "permissionless settlement processes full batch");
        assertEq(collection.totalMinted(), 20, "twenty NFTs settled");
        assertEq(collection.balanceOf(ALICE), 20, "collector owns all twenty settled NFTs");
    }

    function testR12DownstreamRejectionCannotEraseOrRerollWord() public {
        RelicChainlinkVRFV25WrapperMockV2 wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        R12CanonicalRegistryMock registry = new R12CanonicalRegistryMock();
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);
        R12RejectingConsumer consumer = new R12RejectingConsumer(address(adapter));
        registry.setCanonical(address(consumer), true);

        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        vm.deal(address(consumer), quote);

        vm.prank(address(consumer));
        uint256 requestId = adapter.requestRandomness{value: quote}(77, 2_450_000);
        assertEq(requestId, 1, "request created");

        assertTrue(wrapper.fulfill(1, 0x123456), "storage-only callback cannot be broken by rejecting consumer");
        assertEq(adapter.storedWordForLocalRequest(1), 0x123456, "verified word retained");
        assertFalse(adapter.deliveredForLocalRequest(1), "delivery remains pending");

        assertFalse(adapter.replayFulfillment(1), "replay may fail while consumer rejects");
        assertEq(adapter.storedWordForLocalRequest(1), 0x123456, "failed replay does not mutate word");

        consumer.setReject(false);
        assertTrue(adapter.replayFulfillment(1), "later executor can replay");
        assertEq(consumer.receivedWord(), 0x123456, "exact same word delivered");

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        wrapper.forceDuplicateCallback(1, 0xDEAD);
        assertEq(adapter.storedWordForLocalRequest(1), 0x123456, "duplicate callback cannot reroll");
    }

    function testR12UnauthorizedConsumerCannotCreateBillableRequest() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        registry;
        reserve;
        collection;

        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        vm.deal(ALICE, quote);
        vm.prank(ALICE);
        vm.expectRevert(RF_NotAuthorized.selector);
        adapter.requestRandomness{value: quote}(1, 2_450_000);

        assertEq(wrapper.nextRequestId(), 1, "no upstream request created");
        assertEq(adapter.nextRequestId(), 1, "no local request billed");
    }

    function testR12AdapterDescriptorIsExplicitlySepoliaAndStorageOnly() public {
        (
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R12CanonicalRegistryMock registry,
            RelicChainlinkVRFV25DirectAdapterV2 adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        ) = _fixture();
        wrapper;
        registry;
        reserve;
        collection;

        assertEq(adapter.targetChainId(), SEPOLIA_CHAIN_ID, "target chain locked");
        assertTrue(adapter.upstreamCallbackIsStorageOnly(), "callback must remain storage-only");
        assertFalse(adapter.automaticProviderRefundEnabled(), "no replacement randomness/refund path");
    }
}
