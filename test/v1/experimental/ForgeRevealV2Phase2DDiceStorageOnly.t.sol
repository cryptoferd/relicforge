// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10StorageOnlyAdapterV2Harness.sol";

contract R8DiceRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract R8DiceContributionSourceMockV2 is IRelicDiceContributionSourceV2 {
    bytes32 public nextContribution;

    function setContribution(bytes32 value) external {
        nextContribution = value;
    }

    function contributionForRequest(address, uint256, uint256) external returns (bytes32 userRandomNumber) {
        return nextContribution;
    }
}

contract R8DiceConsumerMockV2 is IRelicRandomnessConsumerV1 {
    IRelicPricedRandomnessProviderV2 public immutable provider;
    bool public revertDelivery;
    uint256 public lastRequestId;
    uint256 public lastWord;
    uint256 public deliveryCount;

    constructor(address provider_) {
        provider = IRelicPricedRandomnessProviderV2(provider_);
    }

    function setRevertDelivery(bool value) external {
        revertDelivery = value;
    }

    function request(uint256 context, uint32 envelope) external payable returns (uint256 requestId) {
        requestId = provider.requestRandomness{value: msg.value}(context, envelope);
        lastRequestId = requestId;
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (revertDelivery) revert RF_BadRequest();
        if (deliveryCount != 0) revert RF_AlreadyFulfilled();
        lastRequestId = requestId;
        lastWord = randomWord;
        deliveryCount = 1;
    }
}

contract ForgeRevealV2Phase2DDiceStorageOnlyTest is TestBase {
    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    uint128 internal constant DICE_FEE = 0.000025 ether;
    uint32 internal constant CONSUMER_ENVELOPE = 2_450_000;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;

    event GasMeasured(bytes32 indexed label, uint256 gasUsed);

    function _fixture(uint32 providerDefaultGas)
        internal
        returns (
            RelicDiceEntropyV10Mock dice,
            R8DiceRegistryMockV2 registry,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter
        )
    {
        vm.deal(address(this), 10 ether);
        dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, providerDefaultGas, 6);
        registry = new R8DiceRegistryMockV2();
        source = new R8DiceContributionSourceMockV2();
        adapter = new RelicDiceEntropyV10StorageOnlyAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(source)
        );
    }

    function _consumerFixture(uint32 providerDefaultGas)
        internal
        returns (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        )
    {
        R8DiceRegistryMockV2 registry;
        (dice, registry, source, adapter) = _fixture(providerDefaultGas);
        consumer = new R8DiceConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
    }

    function _collectionFixture()
        internal
        returns (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        R8DiceRegistryMockV2 registry;
        (dice, registry, source, adapter) = _fixture(0);
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
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
            address buyer = address(uint160(0xC100 + i));
            vm.deal(buyer, MINTER_FEE);
            vm.prank(buyer);
            collection.requestForgeMint{value: MINTER_FEE}(buyer, 1);
        }
    }

    function testZeroDefaultProviderIsReadyOnlyForStorageOnlyAdapter() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceRegistryMockV2 registry,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter
        ) = _fixture(0);
        registry;
        source;
        assertTrue(adapter.providerReady(), "R8 storage-only adapter accepts live zero-default mode");
        assertTrue(adapter.providerUsesRemainingGasMode(), "zero-default mode is reported");
        assertFalse(
            adapter.providerSideCallbackRetryExpected(), "provider-side retry is not assumed in zero-default mode"
        );
        assertTrue(adapter.upstreamCallbackIsStorageOnly(), "upstream callback is storage-only");
        assertEq(adapter.quoteRequestPrice(CONSUMER_ENVELOPE), DICE_FEE, "exact Dice fee preserved");
        dice;
    }

    function testStorageOnlyDiceCallbackSucceedsEvenWhenConsumerWouldRevert() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        bytes32 userRandom = keccak256("R8_STORE_ONLY_USER");
        bytes32 providerReveal = keccak256("R8_STORE_ONLY_PROVIDER");
        source.setContribution(userRandom);
        consumer.setRevertDelivery(true);

        uint256 localRequestId = consumer.request{value: DICE_FEE}(1, CONSUMER_ENVELOPE);
        assertTrue(
            dice.revealWithCallback(DICE_PROVIDER, 1, userRandom, providerReveal),
            "Dice callback succeeds without touching reverting consumer"
        );

        bytes32 expected = keccak256(abi.encodePacked(userRandom, providerReveal, bytes32(0)));
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(localRequestId);
        assertEq(word, uint256(expected), "exact Dice word stored");
        assertTrue(ready, "word is durable before downstream delivery");
        assertFalse(delivered, "upstream callback never calls consumer");
        assertEq(consumer.deliveryCount(), 0, "consumer untouched inside Dice callback");
    }

    function testPermissionlessDeliveryFailureReplaysExactStoredWordLater() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        bytes32 userRandom = keccak256("R8_REPLAY_USER");
        bytes32 providerReveal = keccak256("R8_REPLAY_PROVIDER");
        source.setContribution(userRandom);
        consumer.setRevertDelivery(true);

        uint256 localRequestId = consumer.request{value: DICE_FEE}(2, CONSUMER_ENVELOPE);
        dice.revealWithCallback(DICE_PROVIDER, 1, userRandom, providerReveal);
        uint256 committedWord = adapter.storedWordForLocalRequest(localRequestId);

        assertFalse(adapter.replayFulfillment(localRequestId), "first downstream delivery is isolated and may fail");
        assertEq(adapter.storedWordForLocalRequest(localRequestId), committedWord, "failed delivery cannot alter word");
        assertFalse(adapter.deliveredForLocalRequest(localRequestId), "failed downstream delivery stays retryable");

        consumer.setRevertDelivery(false);
        assertTrue(adapter.replayFulfillment(localRequestId), "permissionless retry succeeds later");
        assertEq(consumer.lastWord(), committedWord, "consumer receives exact stored word");
        assertEq(consumer.deliveryCount(), 1, "consumer accepts one final delivery");
        assertTrue(adapter.deliveredForLocalRequest(localRequestId), "adapter marks final delivery");
    }

    function testStorageOnlyPipelineDefersCollectionWordDeliveryAndTwentyNftSettlement() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        bytes32 userRandom = keccak256("R8_COLLECTION_USER");
        bytes32 providerReveal = keccak256("R8_COLLECTION_PROVIDER");
        source.setContribution(userRandom);

        collection.requestRandomnessForBatch(1);
        dice.revealWithCallback(DICE_PROVIDER, 1, userRandom, providerReveal);
        assertEq(collection.totalMinted(), 0, "no NFT work inside Dice callback");
        (,,,,, uint256 storedWord, bool ready, bool delivered) = adapter.deliveries(1);
        assertTrue(ready, "word stored in adapter");
        assertFalse(delivered, "collection not called upstream");

        assertTrue(adapter.replayFulfillment(1), "permissionless word delivery succeeds separately");
        (,,,,, uint256 sameWord, bool stillReady, bool nowDelivered) = adapter.deliveries(1);
        assertEq(sameWord, storedWord, "delivery uses exact stored word");
        assertTrue(stillReady, "word remains durable");
        assertTrue(nowDelivered, "word delivered to collection");
        assertEq(collection.totalMinted(), 0, "20-NFT settlement remains a third transaction");
        assertEq(collection.settleReady(20), 20, "permissionless settlement completes later");
        assertEq(collection.totalMinted(), 20, "all accepted collectors settle");
    }

    function testDuplicateDiceCallbackCannotReplaceStorageOnlyWord() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        bytes32 userRandom = keccak256("R8_DUP_USER");
        bytes32 providerReveal = keccak256("R8_DUP_PROVIDER");
        source.setContribution(userRandom);
        uint256 localRequestId = consumer.request{value: DICE_FEE}(3, CONSUMER_ENVELOPE);
        dice.revealWithCallback(DICE_PROVIDER, 1, userRandom, providerReveal);
        uint256 committedWord = adapter.storedWordForLocalRequest(localRequestId);

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        dice.forceDuplicateCallback(1, keccak256("R8_DIFFERENT_WORD"));
        assertEq(adapter.storedWordForLocalRequest(localRequestId), committedWord, "duplicate callback cannot reroll");
    }

    function testStorageOnlyCallbackAuthenticatesDiceProviderAndSequence() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        bytes32 userRandom = keccak256("R8_AUTH_USER");
        source.setContribution(userRandom);
        consumer.request{value: DICE_FEE}(4, CONSUMER_ENVELOPE);

        vm.expectRevert(RFV2_OnlyDiceEntropy.selector);
        adapter._entropyCallback(1, DICE_PROVIDER, bytes32(uint256(1)));

        vm.expectRevert(RFV2_WrongDiceProvider.selector);
        dice.forceCallbackWithProvider(1, address(0xBAD), bytes32(uint256(2)));

        vm.prank(address(dice));
        vm.expectRevert(RF_BadRequest.selector);
        adapter._entropyCallback(999, DICE_PROVIDER, bytes32(uint256(3)));
    }

    function testStorageOnlyContributionMustBeFreshAndNonzero() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        dice;
        adapter;

        source.setContribution(bytes32(0));
        vm.expectRevert(RFV2_BadDiceContribution.selector);
        consumer.request{value: DICE_FEE}(5, CONSUMER_ENVELOPE);

        bytes32 contribution = keccak256("R8_FRESH_ONCE");
        source.setContribution(contribution);
        consumer.request{value: DICE_FEE}(6, CONSUMER_ENVELOPE);
        vm.expectRevert(RFV2_BadDiceContribution.selector);
        consumer.request{value: DICE_FEE}(7, CONSUMER_ENVELOPE);
    }

    function testStorageOnlyProviderConfigStillFailsClosedOnDangerousDrift() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceRegistryMockV2 registry,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter
        ) = _fixture(0);
        registry;
        source;
        assertTrue(adapter.providerReady(), "live zero-default storage-only mode starts ready");

        dice.setDefaultGasLimit(600_000);
        assertFalse(adapter.providerReady(), "oversized nonzero default fails closed");
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        adapter.quoteRequestPrice(CONSUMER_ENVELOPE);

        dice.setDefaultGasLimit(0);
        dice.setProviderCommitment(bytes32(0));
        assertFalse(adapter.providerReady(), "missing commitment fails closed");

        dice.setProviderCommitment(keccak256("R8_RESTORED"));
        dice.setProviderRange(100, 100);
        assertFalse(adapter.providerReady(), "exhausted provider fails closed");
    }

    function testStorageOnlyUpstreamCallbackUsesSmallBoundedLocalGas() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            R8DiceConsumerMockV2 consumer
        ) = _consumerFixture(0);
        bytes32 contribution = keccak256("R8_GAS_USER");
        source.setContribution(contribution);
        consumer.request{value: DICE_FEE}(8, CONSUMER_ENVELOPE);

        uint256 beforeGas = gasleft();
        vm.prank(address(dice));
        adapter._entropyCallback(1, DICE_PROVIDER, keccak256("R8_GAS_WORD"));
        uint256 gasUsed = beforeGas - gasleft();
        emit GasMeasured(bytes32("DICE_STORE_ONLY"), gasUsed);
        assertTrue(gasUsed < 100_000, "storage-only callback must remain well below 100k local gas");
        assertTrue(adapter.wordReadyForLocalRequest(1), "word stored");
        assertFalse(adapter.deliveredForLocalRequest(1), "gas measurement contains no downstream call");
    }

    function testStorageOnlyAdapterExposesNoRefundAndCollectionCannotRerequestBatch() public {
        (
            RelicDiceEntropyV10Mock dice,
            R8DiceContributionSourceMockV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        source.setContribution(keccak256("R8_NO_REROLL"));
        collection.requestRandomnessForBatch(1);

        vm.expectRevert(RFV2_BatchAlreadyRequested.selector);
        collection.requestRandomnessForBatch(1);

        (bool ok,) = address(adapter).call(abi.encodeWithSignature("refundRequest(address,uint64)", DICE_PROVIDER, 1));
        assertFalse(ok, "R8 adapter exposes no Dice refund forwarding surface");
        assertFalse(adapter.automaticProviderRefundEnabled(), "automatic refund remains disabled");
        dice;
    }
}
