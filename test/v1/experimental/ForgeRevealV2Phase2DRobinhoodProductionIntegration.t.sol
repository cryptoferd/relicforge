// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10RobinhoodAdapterV2Candidate.sol";

contract R9DiceRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract R9DiceContributionSourceMockV2 is IRelicDiceContributionSourceV2 {
    bytes32 public nextContribution;

    function setContribution(bytes32 value) external {
        nextContribution = value;
    }

    function contributionForRequest(address, uint256, uint256) external returns (bytes32 userRandomNumber) {
        return nextContribution;
    }
}

contract R9RejectingConsumerV2 is IRelicRandomnessConsumerV1 {
    IRelicPricedRandomnessProviderV2 public immutable provider;
    bool public rejectDelivery;
    uint256 public deliveryCount;
    uint256 public lastRequestId;
    uint256 public lastWord;

    constructor(address provider_) {
        provider = IRelicPricedRandomnessProviderV2(provider_);
    }

    function setRejectDelivery(bool value) external {
        rejectDelivery = value;
    }

    function request(uint256 context, uint32 callbackGas) external payable returns (uint256 requestId) {
        requestId = provider.requestRandomness{value: msg.value}(context, callbackGas);
        lastRequestId = requestId;
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(provider)) revert RF_NotRandomnessProvider();
        if (rejectDelivery) revert RF_BadRequest();
        if (deliveryCount != 0) revert RF_AlreadyFulfilled();
        lastRequestId = requestId;
        lastWord = randomWord;
        deliveryCount = 1;
    }
}

contract ForgeRevealV2Phase2DRobinhoodProductionIntegrationTest is TestBase {
    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant EXECUTOR_A = address(0xE001);
    address internal constant EXECUTOR_B = address(0xE002);
    address internal constant SETTLER = address(0xE003);

    uint128 internal constant DICE_FEE = 0.000025 ether;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;
    uint32 internal constant CONSUMER_ENVELOPE = 2_450_000;

    struct Fixture {
        RelicDiceEntropyV10Mock dice;
        R9DiceRegistryMockV2 registry;
        R9DiceContributionSourceMockV2 source;
        RelicDiceEntropyV10RobinhoodAdapterV2Candidate adapter;
        RelicForgeReserveV2Harness reserve;
        RelicForgeBatchQueueV2Harness collection;
    }

    function _fixture(uint256 reserveFunding, uint256 minterFee, bool canonical) internal returns (Fixture memory f) {
        vm.deal(address(this), 20 ether);
        f.dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 0, 6);
        f.registry = new R9DiceRegistryMockV2();
        f.source = new R9DiceContributionSourceMockV2();
        f.adapter = new RelicDiceEntropyV10RobinhoodAdapterV2Candidate(
            address(f.dice), address(f.registry), DICE_PROVIDER, address(f.source)
        );
        f.reserve = new RelicForgeReserveV2Harness{value: reserveFunding}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        f.collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(f.adapter), address(f.reserve), 2, 100, 3, 0, 0, minterFee, minterFee / 2, MAX_RNG_COST
        );
        if (canonical) f.registry.setCanonical(address(f.collection), true);
        f.reserve.registerCollection(address(f.collection));
    }

    function _mintTwenty(RelicForgeBatchQueueV2Harness collection, uint256 minterFee) internal {
        address buyer = address(0xB001);
        uint256 value = minterFee * 20;
        vm.deal(buyer, value + 1 ether);
        vm.prank(buyer);
        collection.requestForgeMint{value: value}(buyer, 20);
        assertEq(collection.totalCommitted(), 20, "collector reservation must remain accepted");
        assertEq(collection.totalMinted(), 0, "reservation is not synchronous NFT settlement");
    }

    function _requestAs(
        RelicForgeBatchQueueV2Harness collection,
        R9DiceContributionSourceMockV2 source,
        bytes32 contribution,
        address executor
    ) internal returns (uint256 requestId) {
        source.setContribution(contribution);
        vm.prank(executor);
        requestId = collection.requestRandomnessForBatch(1);
    }

    function testR9CollectorAcceptanceSurvivesProviderUnavailableThenLaterDispatches() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        uint256 hopperBefore = f.collection.hopperBalance();

        f.dice.setProviderCommitment(bytes32(0));
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);

        assertEq(f.collection.totalCommitted(), 20, "accepted reservation survives Dice outage");
        assertEq(f.collection.hopperBalance(), hopperBefore, "failed dispatch cannot consume hopper");
        assertEq(f.adapter.nextRequestId(), 1, "failed dispatch creates no replacement request");

        f.dice.setProviderCommitment(keccak256("R9_PROVIDER_RESTORED"));
        uint256 requestId = _requestAs(f.collection, f.source, keccak256("R9_OUTAGE_RECOVERY"), EXECUTOR_B);
        assertEq(requestId, 1, "same batch later receives its first request identity");
        assertEq(f.adapter.upstreamRequestIdForLocalRequest(1), 1, "one local request binds one Dice sequence");
    }

    function testR9FeeSpikeDelaysOnlyDispatchAndCannotInvalidateMint() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        uint256 hopperBefore = f.collection.hopperBalance();

        f.dice.setFee(uint128(MAX_RNG_COST + 1));
        vm.expectRevert(RFV2_RandomnessQuoteTooHigh.selector);
        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);

        assertEq(f.collection.totalCommitted(), 20, "fee spike cannot roll back accepted mint");
        assertEq(f.collection.hopperBalance(), hopperBefore, "fee spike consumes no hopper funds");
        assertEq(f.adapter.nextRequestId(), 1, "fee spike creates no provider request");

        f.dice.setFee(DICE_FEE);
        _requestAs(f.collection, f.source, keccak256("R9_FEE_NORMALIZED"), EXECUTOR_B);
        assertEq(f.collection.hopperBalance(), hopperBefore - DICE_FEE, "later exact Dice fee is paid once");
    }

    function testR9DelayedKeeperKeepsSameRequestAndForbidsReplacementRandomness() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        bytes32 contribution = keccak256("R9_DELAYED_KEEPER");
        _requestAs(f.collection, f.source, contribution, EXECUTOR_A);

        assertFalse(f.adapter.wordReadyForLocalRequest(1), "request can remain pending without harming mint");
        vm.expectRevert(RFV2_BatchAlreadyRequested.selector);
        vm.prank(EXECUTOR_B);
        f.collection.requestRandomnessForBatch(1);
        assertEq(f.adapter.nextRequestId(), 2, "no replacement local request is created");
        assertEq(f.adapter.upstreamRequestIdForLocalRequest(1), 1, "same Dice sequence remains authoritative");

        bytes32 providerReveal = keccak256("R9_DELAYED_KEEPER_REVEAL");
        f.dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        assertTrue(f.adapter.wordReadyForLocalRequest(1), "late keeper callback stores the same request word");
        assertFalse(f.adapter.deliveredForLocalRequest(1), "upstream callback still performs no collection work");
    }

    function testR9DifferentPermissionlessActorsCanRequestReplayAndSettleAfterOriginalExecutorDisappears() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        bytes32 contribution = keccak256("R9_PERMISSIONLESS_PIPELINE");
        bytes32 providerReveal = keccak256("R9_PERMISSIONLESS_PROVIDER");

        _requestAs(f.collection, f.source, contribution, EXECUTOR_A);
        f.dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        uint256 storedWord = f.adapter.storedWordForLocalRequest(1);
        assertTrue(storedWord != 0, "Dice word must be persisted before downstream work");
        assertEq(f.collection.totalMinted(), 0, "callback cannot settle NFTs");

        vm.prank(EXECUTOR_B);
        assertTrue(f.adapter.replayFulfillment(1), "another actor can deliver the exact stored word");
        assertEq(f.collection.totalMinted(), 0, "word delivery remains separate from NFT settlement");

        vm.prank(SETTLER);
        assertEq(f.collection.settleReady(20), 20, "third actor can settle the ready batch");
        assertEq(f.collection.totalMinted(), 20, "all accepted NFTs settle later");
        assertTrue(f.adapter.deliveredForLocalRequest(1), "adapter records one completed downstream delivery");
    }

    function testR9DownstreamRejectCanReplayExactStoredWordWithoutReroll() public {
        vm.deal(address(this), 10 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 0, 6);
        R9DiceRegistryMockV2 registry = new R9DiceRegistryMockV2();
        R9DiceContributionSourceMockV2 source = new R9DiceContributionSourceMockV2();
        RelicDiceEntropyV10RobinhoodAdapterV2Candidate adapter = new RelicDiceEntropyV10RobinhoodAdapterV2Candidate(
            address(dice), address(registry), DICE_PROVIDER, address(source)
        );
        R9RejectingConsumerV2 consumer = new R9RejectingConsumerV2(address(adapter));
        registry.setCanonical(address(consumer), true);

        bytes32 contribution = keccak256("R9_REJECT_USER");
        bytes32 providerReveal = keccak256("R9_REJECT_PROVIDER");
        source.setContribution(contribution);
        consumer.setRejectDelivery(true);
        consumer.request{value: DICE_FEE}(77, CONSUMER_ENVELOPE);
        dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        uint256 storedWord = adapter.storedWordForLocalRequest(1);

        vm.prank(EXECUTOR_A);
        assertFalse(adapter.replayFulfillment(1), "temporary downstream reject is isolated");
        assertEq(adapter.storedWordForLocalRequest(1), storedWord, "reject cannot alter exact Dice word");
        assertFalse(adapter.deliveredForLocalRequest(1), "failed delivery remains replayable");
        assertEq(consumer.deliveryCount(), 0, "rejecting consumer records no delivery");

        consumer.setRejectDelivery(false);
        vm.prank(EXECUTOR_B);
        assertTrue(adapter.replayFulfillment(1), "later permissionless replay succeeds");
        assertEq(consumer.lastWord(), storedWord, "later replay uses exact same stored word");
        assertEq(consumer.deliveryCount(), 1, "delivery occurs exactly once");
        assertEq(adapter.nextRequestId(), 2, "recovery created no replacement randomness request");
    }

    function testR9DuplicateDiceCallbackAndDuplicateReplayCannotChangeOutcome() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        bytes32 contribution = keccak256("R9_DUP_USER");
        bytes32 providerReveal = keccak256("R9_DUP_PROVIDER");
        _requestAs(f.collection, f.source, contribution, EXECUTOR_A);
        f.dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        uint256 storedWord = f.adapter.storedWordForLocalRequest(1);

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        f.dice.forceDuplicateCallback(1, keccak256("R9_DIFFERENT_WORD"));
        assertEq(f.adapter.storedWordForLocalRequest(1), storedWord, "duplicate Dice callback cannot replace word");

        assertTrue(f.adapter.replayFulfillment(1), "first replay delivers word");
        assertTrue(f.adapter.replayFulfillment(1), "duplicate replay is idempotent after delivery");
        assertEq(f.adapter.storedWordForLocalRequest(1), storedWord, "duplicate replay cannot alter word");
        assertEq(f.adapter.nextRequestId(), 2, "duplicate activity creates no new randomness request");
    }

    function testR9ProviderConfigDriftFailsClosedBeforeRequestWithoutTouchingAcceptedMint() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        uint256 hopperBefore = f.collection.hopperBalance();

        f.dice.setDefaultGasLimit(600_000);
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        f.collection.requestRandomnessForBatch(1);
        assertEq(f.collection.totalCommitted(), 20, "dangerous gas drift cannot invalidate reservation");
        assertEq(f.collection.hopperBalance(), hopperBefore, "gas drift cannot consume hopper");

        f.dice.setDefaultGasLimit(0);
        f.dice.setProviderRange(100, 100);
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        f.collection.requestRandomnessForBatch(1);
        assertEq(f.adapter.nextRequestId(), 1, "exhausted provider creates no request");

        f.dice.setProviderRange(1, 1_000_000);
        _requestAs(f.collection, f.source, keccak256("R9_DRIFT_RECOVERY"), EXECUTOR_A);
        assertEq(f.adapter.upstreamRequestIdForLocalRequest(1), 1, "restored provider permits first request only");
    }

    function testR9InsufficientHopperAndReserveDelayDispatchButMintRemainsAccepted() public {
        Fixture memory f = _fixture(0, 0, true);
        _mintTwenty(f.collection, 0);
        assertEq(f.collection.hopperBalance(), 0, "fixture intentionally has empty hopper");

        vm.expectRevert(RFV2_BadReserveDraw.selector);
        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);
        assertEq(f.collection.totalCommitted(), 20, "reserve shortage cannot invalidate mint");
        assertEq(f.adapter.nextRequestId(), 1, "reserve shortage creates no Dice request");

        (bool funded,) = payable(address(f.reserve)).call{value: 1 ether}("");
        assertTrue(funded, "reserve top-up succeeds");
        _requestAs(f.collection, f.source, keccak256("R9_RESERVE_RECOVERY"), EXECUTOR_B);
        assertEq(f.collection.totalReserveSubsidy(), DICE_FEE, "reserve covers exact shortfall only");
    }

    function testR9NonCanonicalCollectionCannotCreateBillableDiceRequest() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, false);
        _mintTwenty(f.collection, MINTER_FEE);
        f.source.setContribution(keccak256("R9_NONCANONICAL"));

        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);

        assertEq(f.adapter.nextRequestId(), 1, "noncanonical collection creates no billable request");
        assertEq(f.collection.totalCommitted(), 20, "canonicality failure affects dispatch, not accepted reservation");
    }

    function testR9ProviderIsImmutableAndCrossProviderFallbackSurfaceDoesNotExist() public {
        Fixture memory f = _fixture(1 ether, MINTER_FEE, true);
        _mintTwenty(f.collection, MINTER_FEE);
        assertEq(
            address(f.collection.randomnessProvider()),
            address(f.adapter),
            "collection is pinned to one provider adapter"
        );

        (bool switched,) =
            address(f.collection).call(abi.encodeWithSignature("setRandomnessProvider(address)", address(0xBEEF)));
        assertFalse(switched, "collection exposes no runtime provider-switch fallback surface");

        _requestAs(f.collection, f.source, keccak256("R9_PINNED_PROVIDER"), EXECUTOR_A);
        vm.expectRevert(RFV2_BatchAlreadyRequested.selector);
        f.collection.requestRandomnessForBatch(1);
        assertEq(
            f.adapter.upstreamRequestIdForLocalRequest(1), 1, "existing request remains pinned to original sequence"
        );
    }
}
