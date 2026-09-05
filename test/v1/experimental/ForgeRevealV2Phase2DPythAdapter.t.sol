// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicPythEntropyV2Mock.sol";
import "../../../contracts/production/experimental/RelicPythEntropyV2ThinAdapterV2Harness.sol";

contract RelicPythRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicPythContributionSourceMockV2 is IRelicPythContributionSourceV2 {
    bytes32 public nextContribution;
    address public lastConsumer;
    uint256 public lastContext;
    uint256 public lastLocalRequestId;
    uint256 public calls;

    function setContribution(bytes32 value) external {
        nextContribution = value;
    }

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32 userRandomNumber)
    {
        lastConsumer = consumer;
        lastContext = context;
        lastLocalRequestId = localRequestId;
        ++calls;
        return nextContribution;
    }
}

contract RelicPythWordConsumerMockV2 is IRelicRandomnessConsumerV1 {
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

contract RelicDirectPythCallbackConsumerMockV2 is IRelicPythEntropyConsumerV2 {
    IRelicPythEntropyV2 public immutable entropy;
    address public immutable provider;
    bool public revertCallback = true;
    bytes32 public lastRandomNumber;
    uint64 public lastSequenceNumber;

    constructor(address entropy_, address provider_) {
        entropy = IRelicPythEntropyV2(entropy_);
        provider = provider_;
    }

    function setRevertCallback(bool value) external {
        revertCallback = value;
    }

    function request(bytes32 userRandomNumber, uint32 gasLimit) external payable returns (uint64) {
        return entropy.requestV2{value: msg.value}(provider, userRandomNumber, gasLimit);
    }

    function _entropyCallback(uint64 sequenceNumber, address callbackProvider, bytes32 randomNumber) external {
        if (msg.sender != address(entropy) || callbackProvider != provider) revert RF_NotRandomnessProvider();
        if (revertCallback) revert RF_BadRequest();
        lastSequenceNumber = sequenceNumber;
        lastRandomNumber = randomNumber;
    }
}

contract ForgeRevealV2Phase2DPythAdapterTest is TestBase {
    address internal constant PYTH_PROVIDER = address(0x52DEAA1);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant ALICE = address(0xA11CE);

    uint128 internal constant PROVIDER_FEE = 0.0002 ether;
    uint128 internal constant PYTH_FEE = 0.00005 ether;
    uint32 internal constant DEFAULT_GAS = 150_000;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;

    function _fixture()
        internal
        returns (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);
        entropy = new RelicPythEntropyV2Mock(PYTH_PROVIDER, PROVIDER_FEE, PYTH_FEE, DEFAULT_GAS);
        registry = new RelicPythRegistryMockV2();
        contributionSource = new RelicPythContributionSourceMockV2();
        adapter = new RelicPythEntropyV2ThinAdapterV2Harness(
            address(entropy), address(registry), PYTH_PROVIDER, address(contributionSource)
        );
    }

    function _collectionFixture()
        internal
        returns (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        (entropy, registry, contributionSource, adapter) = _fixture();
        reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, MINTER_FEE, MINTER_FEE / 2, MAX_RNG_COST
        );
        registry.setCanonical(address(collection), true);
        reserve.registerCollection(address(collection));
    }

    function _mintTwenty(RelicForgeBatchQueueV2Harness collection) internal {
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x7100 + i));
            vm.deal(buyer, MINTER_FEE);
            vm.prank(buyer);
            collection.requestForgeMint{value: MINTER_FEE}(buyer, 1);
        }
    }

    function testPythUsesLiveFeeFullCustomContributionAndThinCallback() public {
        (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicPythWordConsumerMockV2 consumer = new RelicPythWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        bytes32 contribution = keccak256("RF_R3_CONTRIBUTION_1");
        contributionSource.setContribution(contribution);

        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        assertEq(quote, entropy.getFeeV2(PYTH_PROVIDER, 300_000), "adapter uses live Pyth V2 fee");
        uint256 localRequestId = consumer.request{value: quote}(9, 2_450_000);
        assertEq(localRequestId, 1, "local request id");

        (
            address requester,
            address provider,
            bytes32 userRandomNumber,
            uint32 requestedGas,
            uint32 effectiveGas,
            uint256 paid,,,,
        ) = entropy.requests(1);
        assertEq(requester, address(adapter), "Entropy requester is adapter");
        assertEq(provider, PYTH_PROVIDER, "configured provider used");
        assertEq(uint256(userRandomNumber), uint256(contribution), "full custom contribution used");
        assertEq(requestedGas, 300_000, "thin callback requested");
        assertEq(effectiveGas, 300_000, "provider floor does not inflate thin callback");
        assertEq(paid, quote, "exact live fee paid");
        assertEq(uint256(adapter.userContributionByLocalRequestId(1)), uint256(contribution), "contribution retained");
        assertEq(contributionSource.lastContext(), 9, "immutable collection context reaches contribution source");
        assertEq(contributionSource.lastLocalRequestId(), 1, "exact local id reaches contribution source");
        (,, uint32 envelope,,,,,) = adapter.deliveries(1);
        assertEq(envelope, 2_450_000, "collection settlement envelope remains telemetry only");
    }

    function testUnauthorizedCollectionCannotCreatePythRequest() public {
        (
            RelicPythEntropyV2Mock entropy,,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        contributionSource.setContribution(keccak256("UNAUTHORIZED"));
        RelicPythWordConsumerMockV2 consumer = new RelicPythWordConsumerMockV2(address(adapter));
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        vm.expectRevert(RF_NotAuthorized.selector);
        consumer.request{value: quote}(1, 2_450_000);
        assertEq(entropy.totalFeesCollected(), 0, "unauthorized consumer spends no provider fee");
    }

    function testProviderConfigDriftFailsClosed() public {
        (
            RelicPythEntropyV2Mock entropy,,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        contributionSource;
        assertTrue(adapter.providerReady(), "fixture provider ready");
        entropy.setDefaultGasLimit(600_000);
        assertFalse(adapter.providerReady(), "provider floor above RF R3 ceiling is not ready");
        vm.expectRevert(RFV2_PythProviderNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);

        entropy.setDefaultGasLimit(DEFAULT_GAS);
        entropy.setProviderCommitment(bytes32(0));
        vm.expectRevert(RFV2_PythProviderNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);
    }

    function testContributionSourceMustReturnFreshNonzeroValue() public {
        (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicPythWordConsumerMockV2 consumer = new RelicPythWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        uint256 quote = adapter.quoteRequestPrice(2_450_000);

        contributionSource.setContribution(bytes32(0));
        vm.expectRevert(RFV2_BadPythContribution.selector);
        consumer.request{value: quote}(1, 2_450_000);
        assertEq(entropy.totalFeesCollected(), 0, "zero contribution creates no Pyth request");

        bytes32 contribution = keccak256("FRESH_ONCE");
        contributionSource.setContribution(contribution);
        consumer.request{value: quote}(2, 2_450_000);
        vm.expectRevert(RFV2_BadPythContribution.selector);
        consumer.request{value: quote}(3, 2_450_000);
    }

    function testThinPythCallbackStoresWordAndDefersTwentyNftSettlement() public {
        (
            RelicPythEntropyV2Mock entropy,,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        contributionSource.setContribution(keccak256("BATCH_ONE_USER_RANDOM"));
        collection.requestRandomnessForBatch(1);

        bytes32 providerRevelation = keccak256("PYTH_PROVIDER_REVELATION_1");
        bool callbackSucceeded = entropy.revealWithCallback(1, providerRevelation);
        assertTrue(callbackSucceeded, "Pyth callback succeeds");
        bytes32 expected =
            keccak256(abi.encodePacked(keccak256("BATCH_ONE_USER_RANDOM"), providerRevelation, bytes32(0)));
        assertEq(collection.totalMinted(), 0, "no NFT settlement inside thin callback");
        (,,,,, uint256 adapterWord, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(adapterWord, uint256(expected), "adapter stores exact Entropy result");
        assertTrue(ready, "adapter word ready");
        assertTrue(delivered, "collection accepted thin word delivery");
        assertEq(collection.settleReady(20), 20, "permissionless settlement completes later");
        assertEq(collection.totalMinted(), 20, "twenty final NFTs minted after callback");
    }

    function testCollectionDeliveryFailureReplaysExactStoredPythWord() public {
        (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicPythWordConsumerMockV2 consumer = new RelicPythWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.setRevertDelivery(true);
        bytes32 contribution = keccak256("REPLAY_USER_RANDOM");
        contributionSource.setContribution(contribution);
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        consumer.request{value: quote}(77, 2_450_000);

        bytes32 providerRevelation = keccak256("REPLAY_PROVIDER_RANDOM");
        bool pythCallbackSucceeded = entropy.revealWithCallback(1, providerRevelation);
        assertTrue(pythCallbackSucceeded, "adapter callback succeeds despite collection rejection");
        bytes32 expected = keccak256(abi.encodePacked(contribution, providerRevelation, bytes32(0)));
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(word, uint256(expected), "verified word committed before collection delivery");
        assertTrue(ready, "word remains ready");
        assertFalse(delivered, "failed collection remains replayable");

        consumer.setRevertDelivery(false);
        assertTrue(adapter.replayFulfillment(1), "permissionless replay succeeds");
        assertEq(consumer.lastWord(), uint256(expected), "same exact Pyth word replayed");
        vm.expectRevert(RF_AlreadyFulfilled.selector);
        entropy.forceDuplicateCallback(1, keccak256("DIFFERENT_WORD"));
    }

    function testOnlyEntropyAndConfiguredProviderCanInjectWord() public {
        (
            RelicPythEntropyV2Mock entropy,
            RelicPythRegistryMockV2 registry,
            RelicPythContributionSourceMockV2 contributionSource,
            RelicPythEntropyV2ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicPythWordConsumerMockV2 consumer = new RelicPythWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        contributionSource.setContribution(keccak256("AUTH_CALLBACK"));
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        consumer.request{value: quote}(1, 2_450_000);

        vm.expectRevert(RFV2_OnlyPythEntropy.selector);
        adapter._entropyCallback(1, PYTH_PROVIDER, bytes32(uint256(1)));

        vm.expectRevert(RFV2_WrongPythProvider.selector);
        entropy.forceCallbackWithProvider(1, address(0xBAD), bytes32(uint256(2)));
    }

    function testPythFailedCallbackRetryUsesSameCommittedResultWithoutNewRequest() public {
        RelicPythEntropyV2Mock entropy = new RelicPythEntropyV2Mock(PYTH_PROVIDER, PROVIDER_FEE, PYTH_FEE, DEFAULT_GAS);
        RelicDirectPythCallbackConsumerMockV2 consumer =
            new RelicDirectPythCallbackConsumerMockV2(address(entropy), PYTH_PROVIDER);
        bytes32 userRandom = keccak256("DIRECT_PYTH_USER");
        bytes32 providerRevelation = keccak256("DIRECT_PYTH_PROVIDER");
        uint256 fee = entropy.getFeeV2(PYTH_PROVIDER, 300_000);
        vm.deal(address(consumer), fee);
        vm.deal(address(this), fee);
        consumer.request{value: fee}(userRandom, 300_000);
        uint256 feesBeforeReveal = entropy.totalFeesCollected();

        bool first = entropy.revealWithCallback(1, providerRevelation);
        assertFalse(first, "first consumer callback fails");
        (,,,,,,, bytes32 firstRandom, uint8 statusAfterFirst,) = entropy.requests(1);
        assertEq(statusAfterFirst, 1, "request retained in failed callback state");

        consumer.setRevertCallback(false);
        bool second = entropy.revealWithCallback(1, providerRevelation);
        assertTrue(second, "same request recovers");
        assertEq(uint256(consumer.lastRandomNumber()), uint256(firstRandom), "retry returns exact same result");
        assertEq(entropy.totalFeesCollected(), feesBeforeReveal, "retry creates no second request fee");
    }

    function testLiveFeeSpikeOverCollectionCapFailsClosed() public {
        (
            RelicPythEntropyV2Mock entropy,,
            RelicPythContributionSourceMockV2 contributionSource,,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        contributionSource.setContribution(keccak256("PRICE_SPIKE"));
        entropy.setPricing(0.02 ether, 0.01 ether);
        vm.expectRevert(RFV2_RandomnessQuoteTooHigh.selector);
        collection.requestRandomnessForBatch(1);
        assertEq(entropy.totalFeesCollected(), 0, "cap blocks upstream Pyth fee");
    }
}
