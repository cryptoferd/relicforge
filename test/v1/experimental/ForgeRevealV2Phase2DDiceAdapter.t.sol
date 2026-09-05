// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10ThinAdapterV2Harness.sol";

contract RelicDiceRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicDiceContributionSourceMockV2 is IRelicDiceContributionSourceV2 {
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

contract RelicDiceWordConsumerMockV2 is IRelicRandomnessConsumerV1 {
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

contract RelicDirectDiceCallbackConsumerMockV2 is IRelicDiceEntropyConsumerV2 {
    RelicDiceEntropyV10Mock public immutable dice;
    address public immutable provider;
    bool public revertCallback = true;
    bytes32 public lastRandomNumber;
    uint64 public lastSequenceNumber;

    constructor(address dice_, address provider_) {
        dice = RelicDiceEntropyV10Mock(payable(dice_));
        provider = provider_;
    }

    receive() external payable {}

    function setRevertCallback(bool value) external {
        revertCallback = value;
    }

    function request(bytes32 userRandomNumber, uint32 gasLimit) external payable returns (uint64) {
        return dice.requestV2{value: msg.value}(provider, userRandomNumber, gasLimit);
    }

    function _entropyCallback(uint64 sequenceNumber, address callbackProvider, bytes32 randomNumber) external {
        if (msg.sender != address(dice) || callbackProvider != provider) revert RF_NotRandomnessProvider();
        if (revertCallback) revert RF_BadRequest();
        lastSequenceNumber = sequenceNumber;
        lastRandomNumber = randomNumber;
    }
}

contract ForgeRevealV2Phase2DDiceAdapterTest is TestBase {
    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    uint128 internal constant DICE_FEE = 0.000025 ether;
    uint32 internal constant DEFAULT_GAS = 200_000;
    uint64 internal constant REFUND_DELAY = 6;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;

    function _fixture()
        internal
        returns (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        )
    {
        vm.deal(address(this), address(this).balance + 10 ether);
        dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, DEFAULT_GAS, REFUND_DELAY);
        registry = new RelicDiceRegistryMockV2();
        contributionSource = new RelicDiceContributionSourceMockV2();
        adapter = new RelicDiceEntropyV10ThinAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(contributionSource)
        );
    }

    function _collectionFixture()
        internal
        returns (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter,
            RelicForgeReserveV2Harness reserve,
            RelicForgeBatchQueueV2Harness collection
        )
    {
        (dice, registry, contributionSource, adapter) = _fixture();
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
            address buyer = address(uint160(0xA100 + i));
            vm.deal(buyer, MINTER_FEE);
            vm.prank(buyer);
            collection.requestForgeMint{value: MINTER_FEE}(buyer, 1);
        }
    }

    function testCollectorMintSucceedsWhileDiceProviderOfflineThenRecovers() public {
        (
            RelicDiceEntropyV10Mock dice,,
            RelicDiceContributionSourceMockV2 contributionSource,,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        dice.setProviderCommitment(bytes32(0));

        _mintTwenty(collection);
        assertEq(collection.totalCommitted(), 20, "collector reservations succeed while Dice is offline");
        assertEq(collection.totalMinted(), 0, "settlement waits for randomness");
        assertEq(collection.unrequestedLockedBatches(), 1, "full batch is safely queued");

        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        collection.requestRandomnessForBatch(1);
        assertEq(collection.totalCommitted(), 20, "failed executor transaction cannot erase collector reservations");
        assertEq(collection.unrequestedLockedBatches(), 1, "batch remains retryable after provider outage");
        assertEq(collection.totalRandomnessSpend(), 0, "no provider spend booked on failed executor request");

        dice.setProviderCommitment(keccak256("DICE_RECOVERED"));
        bytes32 contribution = keccak256("R6_RECOVERY_CONTRIBUTION");
        contributionSource.setContribution(contribution);
        collection.requestRandomnessForBatch(1);
        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, keccak256("R6_RECOVERY_REVEAL"));
        assertEq(collection.totalMinted(), 0, "Dice callback remains thin");
        assertEq(collection.settleReady(20), 20, "queued collectors settle after provider recovery");
        assertEq(collection.totalMinted(), 20, "all accepted collector mints complete");
    }

    function testCollectorMintSucceedsDuringDiceFeeSpikeThenExecutorRetriesAfterFeeNormalizes() public {
        (
            RelicDiceEntropyV10Mock dice,,
            RelicDiceContributionSourceMockV2 contributionSource,,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        dice.setFee(uint128(MAX_RNG_COST + 1));

        _mintTwenty(collection);
        assertEq(collection.totalCommitted(), 20, "fee spike cannot revert collector mint path");
        vm.expectRevert(RFV2_RandomnessQuoteTooHigh.selector);
        collection.requestRandomnessForBatch(1);
        assertEq(collection.unrequestedLockedBatches(), 1, "batch remains queued after capped executor rejection");

        dice.setFee(DICE_FEE);
        bytes32 contribution = keccak256("R6_FEE_RECOVERY");
        contributionSource.setContribution(contribution);
        collection.requestRandomnessForBatch(1);
        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, keccak256("R6_FEE_REVEAL"));
        collection.settleReady(20);
        assertEq(collection.totalMinted(), 20, "all collectors settle after fee normalizes");
    }

    function testDiceUsesExactFlatFeeFullCustomContributionAndThinCallback() public {
        (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicDiceWordConsumerMockV2 consumer = new RelicDiceWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        bytes32 contribution = keccak256("RF_R6_DICE_CONTRIBUTION_1");
        contributionSource.setContribution(contribution);

        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        assertEq(quote, DICE_FEE, "adapter exposes exact Dice v10 flat fee");
        uint256 localRequestId = consumer.request{value: quote}(9, 2_450_000);
        assertEq(localRequestId, 1, "local request id");

        (
            address requester,
            address provider,
            bytes32 userRandomNumber,
            uint32 requestedGas,
            uint32 effectiveGas,
            uint128 feePaid,
            uint64 requestBlock,
            bytes32 storedProviderRevelation,
            bytes32 storedRandomNumber,
            uint8 callbackStatus,
            bool exists,
            bool refunded
        ) = dice.requests(1);
        requestBlock;
        storedProviderRevelation;
        storedRandomNumber;
        callbackStatus;
        exists;
        refunded;
        assertEq(requester, address(adapter), "Dice requester is adapter");
        assertEq(provider, DICE_PROVIDER, "configured provider used");
        assertEq(uint256(userRandomNumber), uint256(contribution), "full custom contribution used");
        assertEq(requestedGas, 300_000, "thin callback requested");
        assertEq(effectiveGas, 300_000, "Dice callback gas remains thin");
        assertEq(uint256(feePaid), DICE_FEE, "exact fee paid");
        assertEq(uint256(adapter.userContributionByLocalRequestId(1)), uint256(contribution), "contribution retained");
        assertEq(contributionSource.lastContext(), 9, "immutable collection context reaches contribution source");
        assertEq(contributionSource.lastLocalRequestId(), 1, "exact local id reaches contribution source");
    }

    function testUnauthorizedCollectionCannotCreateDiceRequest() public {
        (
            RelicDiceEntropyV10Mock dice,,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        ) = _fixture();
        contributionSource.setContribution(keccak256("UNAUTHORIZED"));
        RelicDiceWordConsumerMockV2 consumer = new RelicDiceWordConsumerMockV2(address(adapter));
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        vm.expectRevert(RF_NotAuthorized.selector);
        consumer.request{value: quote}(1, 2_450_000);
        assertEq(dice.totalFeesCollected(), 0, "unauthorized consumer spends no Dice fee");
    }

    function testDiceProviderConfigDriftFailsClosed() public {
        (RelicDiceEntropyV10Mock dice,,, RelicDiceEntropyV10ThinAdapterV2Harness adapter) = _fixture();
        assertTrue(adapter.providerReady(), "fixture provider ready");

        dice.setDefaultGasLimit(600_000);
        assertFalse(adapter.providerReady(), "provider callback floor above RF ceiling is not ready");
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);

        dice.setDefaultGasLimit(DEFAULT_GAS);
        dice.setProviderCommitment(bytes32(0));
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);

        dice.setProviderCommitment(keccak256("RESTORED"));
        dice.setRefundDelayBlocks(100);
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        adapter.quoteRequestPrice(2_450_000);
    }

    function testDiceContributionMustBeFreshAndNonzero() public {
        (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicDiceWordConsumerMockV2 consumer = new RelicDiceWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        uint256 quote = adapter.quoteRequestPrice(2_450_000);

        contributionSource.setContribution(bytes32(0));
        vm.expectRevert(RFV2_BadDiceContribution.selector);
        consumer.request{value: quote}(1, 2_450_000);
        assertEq(dice.totalFeesCollected(), 0, "zero contribution creates no Dice request");

        bytes32 contribution = keccak256("FRESH_ONCE_DICE");
        contributionSource.setContribution(contribution);
        consumer.request{value: quote}(2, 2_450_000);
        vm.expectRevert(RFV2_BadDiceContribution.selector);
        consumer.request{value: quote}(3, 2_450_000);
    }

    function testThinDiceCallbackStoresWordAndDefersTwentyNftSettlement() public {
        (
            RelicDiceEntropyV10Mock dice,,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        bytes32 contribution = keccak256("R6_BATCH_USER_RANDOM");
        bytes32 providerRevelation = keccak256("R6_DICE_PROVIDER_REVELATION");
        contributionSource.setContribution(contribution);
        collection.requestRandomnessForBatch(1);

        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerRevelation);
        bytes32 expected = keccak256(abi.encodePacked(contribution, providerRevelation, bytes32(0)));
        assertEq(collection.totalMinted(), 0, "no NFT settlement inside thin Dice callback");
        (,,,,, uint256 adapterWord, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(adapterWord, uint256(expected), "adapter stores exact Dice result");
        assertTrue(ready, "adapter word ready");
        assertTrue(delivered, "collection accepted thin word delivery");
        assertEq(collection.settleReady(20), 20, "permissionless settlement completes later");
        assertEq(collection.totalMinted(), 20, "twenty final NFTs minted after callback");
    }

    function testCollectionDeliveryFailureReplaysExactStoredDiceWordAndCannotReroll() public {
        (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicDiceWordConsumerMockV2 consumer = new RelicDiceWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        consumer.setRevertDelivery(true);
        bytes32 contribution = keccak256("DICE_REPLAY_USER_RANDOM");
        bytes32 providerRevelation = keccak256("DICE_REPLAY_PROVIDER_RANDOM");
        contributionSource.setContribution(contribution);
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        consumer.request{value: quote}(77, 2_450_000);

        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerRevelation);
        bytes32 expected = keccak256(abi.encodePacked(contribution, providerRevelation, bytes32(0)));
        (,,,,, uint256 word, bool ready, bool delivered) = adapter.deliveries(1);
        assertEq(word, uint256(expected), "verified Dice word committed before collection delivery");
        assertTrue(ready, "word remains ready");
        assertFalse(delivered, "failed collection remains replayable");

        consumer.setRevertDelivery(false);
        assertTrue(adapter.replayFulfillment(1), "permissionless local replay succeeds");
        assertEq(consumer.lastWord(), uint256(expected), "same exact Dice word replayed");
        vm.expectRevert(RF_AlreadyFulfilled.selector);
        dice.forceDuplicateCallback(1, keccak256("DIFFERENT_DICE_WORD"));
    }

    function testOnlyDiceContractAndConfiguredProviderCanInjectWord() public {
        (
            RelicDiceEntropyV10Mock dice,
            RelicDiceRegistryMockV2 registry,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter
        ) = _fixture();
        RelicDiceWordConsumerMockV2 consumer = new RelicDiceWordConsumerMockV2(address(adapter));
        registry.setCanonical(address(consumer), true);
        contributionSource.setContribution(keccak256("AUTH_DICE_CALLBACK"));
        uint256 quote = adapter.quoteRequestPrice(2_450_000);
        consumer.request{value: quote}(1, 2_450_000);

        vm.expectRevert(RFV2_OnlyDiceEntropy.selector);
        adapter._entropyCallback(1, DICE_PROVIDER, bytes32(uint256(1)));

        vm.expectRevert(RFV2_WrongDiceProvider.selector);
        dice.forceCallbackWithProvider(1, address(0xBAD), bytes32(uint256(2)));
    }

    function testDiceCallbackFailureRetryUsesSameCommittedResultWithoutNewRequest() public {
        vm.deal(address(this), 1 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, DEFAULT_GAS, REFUND_DELAY);
        RelicDirectDiceCallbackConsumerMockV2 consumer =
            new RelicDirectDiceCallbackConsumerMockV2(address(dice), DICE_PROVIDER);
        bytes32 userRandom = keccak256("R6_DIRECT_RETRY_USER");
        bytes32 providerReveal = keccak256("R6_DIRECT_RETRY_PROVIDER");
        uint64 sequence = consumer.request{value: DICE_FEE}(userRandom, 300_000);
        assertEq(sequence, 1, "first Dice sequence");

        dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerReveal);
        (
            address requester,
            address requestProvider,
            bytes32 storedUserRandom,
            uint32 requestedGas,
            uint32 effectiveGas,
            uint128 feePaid,
            uint64 requestBlock,
            bytes32 storedProviderReveal,
            bytes32 firstRandom,
            uint8 firstStatus,
            bool exists,
            bool refunded
        ) = dice.requests(sequence);
        requester;
        requestProvider;
        storedUserRandom;
        requestedGas;
        effectiveGas;
        feePaid;
        requestBlock;
        storedProviderReveal;
        exists;
        refunded;
        assertEq(firstStatus, 1, "first callback failure remains retryable");

        consumer.setRevertCallback(false);
        dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerReveal);
        assertEq(uint256(consumer.lastRandomNumber()), uint256(firstRandom), "retry uses identical Dice result");
        assertEq(consumer.lastSequenceNumber(), 1, "retry does not create a second request");
    }

    function testStalledDiceRequestDoesNotFailCollectorsAndLateRevealStillCompletesMint() public {
        (
            RelicDiceEntropyV10Mock dice,,
            RelicDiceContributionSourceMockV2 contributionSource,
            RelicDiceEntropyV10ThinAdapterV2Harness adapter,,
            RelicForgeBatchQueueV2Harness collection
        ) = _collectionFixture();
        _mintTwenty(collection);
        bytes32 contribution = keccak256("R6_STALLED_USER");
        bytes32 providerReveal = keccak256("R6_STALLED_PROVIDER");
        contributionSource.setContribution(contribution);
        collection.requestRandomnessForBatch(1);

        dice.advanceSimulatedBlocks(REFUND_DELAY + 10);
        assertEq(
            collection.totalCommitted(), 20, "accepted collector reservations remain committed during provider delay"
        );
        assertEq(collection.totalMinted(), 0, "collector outcome remains pending rather than failed");
        assertEq(collection.lockedUnsettledBatches(), 1, "stalled batch remains live");
        assertFalse(adapter.automaticProviderRefundEnabled(), "adapter never auto-refunds a live Dice sequence");

        address outsider = address(0xBEEF);
        vm.startPrank(outsider);
        vm.expectRevert(RF_NotAuthorized.selector);
        dice.refundRequest(DICE_PROVIDER, 1);
        vm.stopPrank();

        vm.expectRevert(RFV2_BatchAlreadyRequested.selector);
        collection.requestRandomnessForBatch(1);

        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        collection.settleReady(20);
        assertEq(collection.totalMinted(), 20, "late same-sequence reveal completes every accepted mint");
    }

    function testAdapterExposesNoAutomaticDiceRefundSurface() public {
        (,,, RelicDiceEntropyV10ThinAdapterV2Harness adapter) = _fixture();
        assertFalse(adapter.automaticProviderRefundEnabled(), "refund/reroll is deliberately disabled");
        (bool ok,) = address(adapter).call(abi.encodeWithSignature("refundDiceRequest(uint64)", uint64(1)));
        assertFalse(ok, "no callable refund forwarding surface exists");
    }
}
