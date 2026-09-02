// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicRobinhoodRandomnessBindingV2Candidate.sol";

contract R10DiceRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract R10DiceContributionSourceMockV2 is IRelicDiceContributionSourceV2 {
    bytes32 public nextContribution;
    address public lastCaller;
    address public lastConsumer;
    uint256 public lastContext;
    uint256 public lastLocalRequestId;

    function setContribution(bytes32 value) external {
        nextContribution = value;
    }

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32 userRandomNumber)
    {
        lastCaller = msg.sender;
        lastConsumer = consumer;
        lastContext = context;
        lastLocalRequestId = localRequestId;
        return nextContribution;
    }
}

contract R10RandomnessConsumerV2 is IRelicRandomnessConsumerV1 {
    IRelicForgeRandomnessAdapterV2 public immutable adapter;
    uint256 public lastRequestId;
    uint256 public lastWord;
    uint256 public deliveryCount;

    constructor(address adapter_) {
        adapter = IRelicForgeRandomnessAdapterV2(adapter_);
    }

    function request(uint256 context, uint32 callbackGas) external payable returns (uint256 requestId) {
        requestId = adapter.requestRandomness{value: msg.value}(context, callbackGas);
        lastRequestId = requestId;
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(adapter)) revert RF_NotRandomnessProvider();
        if (deliveryCount != 0) revert RF_AlreadyFulfilled();
        lastRequestId = requestId;
        lastWord = randomWord;
        deliveryCount = 1;
    }
}

contract ForgeRevealV2Phase2DRobinhoodInterfaceFreezeTest is TestBase {
    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant EXECUTOR = address(0xE010);
    address internal constant BUYER = address(0xB010);

    uint128 internal constant DICE_FEE = 0.000025 ether;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;
    uint32 internal constant CONSUMER_ENVELOPE = 2_450_000;

    struct Fixture {
        RelicDiceEntropyV10Mock dice;
        R10DiceRegistryMockV2 registry;
        R10DiceContributionSourceMockV2 source;
        RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate adapter;
        R10RandomnessConsumerV2 consumer;
    }

    function _fixture(bool canonicalConsumer) internal returns (Fixture memory f) {
        vm.deal(address(this), 20 ether);
        f.dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 0, 6);
        f.registry = new R10DiceRegistryMockV2();
        f.source = new R10DiceContributionSourceMockV2();
        f.adapter = new RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate(
            address(f.dice), address(f.registry), DICE_PROVIDER, address(f.source)
        );
        f.consumer = new R10RandomnessConsumerV2(address(f.adapter));
        if (canonicalConsumer) f.registry.setCanonical(address(f.consumer), true);
    }

    function _request(Fixture memory f, bytes32 contribution, uint256 context) internal returns (uint256 requestId) {
        f.source.setContribution(contribution);
        requestId = f.consumer.request{value: DICE_FEE}(context, CONSUMER_ENVELOPE);
    }

    function testR10FactoryBindingIdentityIsFrozen() public {
        Fixture memory f = _fixture(true);

        assertEq(
            uint256(f.adapter.relicForgeRandomnessInterfaceVersion()),
            2,
            "Factory V2 must bind randomness interface version 2"
        );
        assertEq(f.adapter.targetChainId(), 4663, "Robinhood production binding must target chain 4663");
        assertEq(
            uint256(f.adapter.factoryBindingFingerprint()),
            uint256(
                keccak256(
                    bytes(
                        "RELIC_FORGE_RANDOMNESS_V2|ROBINHOOD_4663|DICE_V10|STORAGE_ONLY|EXACT_NATIVE_QUOTE|EXACT_WORD_REPLAY"
                    )
                )
            ),
            "factory binding fingerprint drifted"
        );
        assertEq(
            uint256(f.adapter.contributionInterfaceFingerprint()),
            uint256(keccak256(bytes("contributionForRequest(address,uint256,uint256)"))),
            "contribution ABI fingerprint drifted"
        );
    }

    function testR10ChainBindingFailsClosedOutsideRobinhoodMainnet() public {
        Fixture memory f = _fixture(true);

        vm.chainId(1);
        assertFalse(f.adapter.bindingValidForCurrentChain(), "Ethereum must not satisfy Robinhood binding");

        vm.chainId(46630);
        assertFalse(f.adapter.bindingValidForCurrentChain(), "Robinhood testnet is not production chain binding");

        vm.chainId(4663);
        assertTrue(f.adapter.bindingValidForCurrentChain(), "Robinhood mainnet must satisfy frozen chain binding");
    }

    function testR10GenericFactoryFacingQuoteRequestAndReplaySelectorsRemainUsable() public {
        Fixture memory f = _fixture(true);
        IRelicForgeRandomnessAdapterV2 genericAdapter = IRelicForgeRandomnessAdapterV2(address(f.adapter));

        assertEq(genericAdapter.quoteRequestPrice(CONSUMER_ENVELOPE), DICE_FEE, "generic quote must use exact Dice fee");

        bytes32 contribution = keccak256("R10_GENERIC_USER");
        bytes32 providerReveal = keccak256("R10_GENERIC_PROVIDER");
        uint256 requestId = _request(f, contribution, 41);
        assertEq(requestId, 1, "first local request identity must remain deterministic");

        f.dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        uint256 storedWord = f.adapter.storedWordForLocalRequest(1);
        assertTrue(storedWord != 0, "storage-only callback must persist a word");
        assertEq(f.consumer.deliveryCount(), 0, "upstream callback must not call consumer");

        assertTrue(genericAdapter.replayFulfillment(1), "generic replay selector must deliver stored word");
        assertEq(f.consumer.lastWord(), storedWord, "generic replay must deliver exact stored word");
    }

    function testR10ContributionSourceReceivesOnlyAdapterBoundRequestContext() public {
        Fixture memory f = _fixture(true);
        bytes32 contribution = keccak256("R10_BOUND_CONTRIBUTION");
        uint256 context = 88;

        _request(f, contribution, context);

        assertEq(f.source.lastCaller(), address(f.adapter), "only adapter calls the contribution source");
        assertEq(f.source.lastConsumer(), address(f.consumer), "source receives canonical consumer identity");
        assertEq(f.source.lastContext(), context, "source receives collection request context");
        assertEq(f.source.lastLocalRequestId(), 1, "source receives adapter-assigned local request id");
        assertEq(
            uint256(f.adapter.userContributionByLocalRequestId(1)),
            uint256(contribution),
            "adapter commits the source result to the local request"
        );
    }

    function testR10CanonicalRegistryRemainsAuthoritativeAtRequestBoundary() public {
        Fixture memory f = _fixture(false);
        f.source.setContribution(keccak256("R10_NONCANONICAL"));

        vm.expectRevert(RF_NotAuthorized.selector);
        f.consumer.request{value: DICE_FEE}(12, CONSUMER_ENVELOPE);

        assertEq(f.adapter.nextRequestId(), 1, "unauthorized consumer must create no request");

        f.registry.setCanonical(address(f.consumer), true);
        f.source.setContribution(keccak256("R10_CANONICAL"));
        assertEq(
            f.consumer.request{value: DICE_FEE}(12, CONSUMER_ENVELOPE),
            1,
            "canonical registry admission enables first request"
        );
    }

    function testR10DiceProviderRegistryAndContributionSourceAreImmutablePerAdapter() public {
        Fixture memory f = _fixture(true);

        assertEq(address(f.adapter.dice()), address(f.dice), "Dice oracle binding drifted");
        assertEq(
            address(f.adapter.canonicalCollectionRegistry()), address(f.registry), "canonical registry binding drifted"
        );
        assertEq(address(f.adapter.contributionSource()), address(f.source), "contribution source binding drifted");
        assertEq(f.adapter.diceProvider(), DICE_PROVIDER, "Dice provider binding drifted");

        (bool providerSetter,) =
            address(f.adapter).call(abi.encodeWithSignature("setDiceProvider(address)", address(0xBEEF)));
        (bool sourceSetter,) =
            address(f.adapter).call(abi.encodeWithSignature("setContributionSource(address)", address(0xBEEF)));
        (bool registrySetter,) =
            address(f.adapter).call(abi.encodeWithSignature("setCanonicalCollectionRegistry(address)", address(0xBEEF)));

        assertFalse(providerSetter, "adapter must expose no Dice provider setter");
        assertFalse(sourceSetter, "adapter must expose no contribution source setter");
        assertFalse(registrySetter, "adapter must expose no canonical registry setter");

        assertEq(f.adapter.diceProvider(), DICE_PROVIDER, "failed setter probe cannot change provider");
        assertEq(address(f.adapter.contributionSource()), address(f.source), "failed setter probe cannot change source");
    }

    function testR10StorageOnlyAndNoRefundPoliciesRemainFrozen() public {
        Fixture memory f = _fixture(true);

        assertTrue(f.adapter.upstreamCallbackIsStorageOnly(), "Robinhood upstream callback must remain storage-only");
        assertFalse(f.adapter.automaticProviderRefundEnabled(), "automatic Dice refunds remain prohibited");
        assertTrue(f.adapter.providerReady(), "healthy zero-default Dice mock must remain ready for storage-only mode");
        assertTrue(f.adapter.providerUsesRemainingGasMode(), "zero default gas is the certified remaining-gas mode");
        assertFalse(f.adapter.providerSideCallbackRetryExpected(), "zero-default mode must not assume provider retry");
    }

    function testR10DuplicateCallbackCannotChangeFrozenRequestOutcome() public {
        Fixture memory f = _fixture(true);
        bytes32 contribution = keccak256("R10_DUP_USER");

        _request(f, contribution, 77);
        f.dice.revealWithCallback(DICE_PROVIDER, 1, contribution, keccak256("R10_DUP_PROVIDER"));
        uint256 storedWord = f.adapter.storedWordForLocalRequest(1);

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        f.dice.forceDuplicateCallback(1, keccak256("R10_DIFFERENT_WORD"));

        assertEq(f.adapter.storedWordForLocalRequest(1), storedWord, "duplicate callback cannot replace exact word");
        assertEq(f.adapter.nextRequestId(), 2, "duplicate callback cannot create replacement randomness");
    }

    function testR10DangerousProviderDriftFailsClosedThroughFrozenQuoteInterface() public {
        Fixture memory f = _fixture(true);
        IRelicForgeRandomnessAdapterV2 genericAdapter = IRelicForgeRandomnessAdapterV2(address(f.adapter));

        f.dice.setDefaultGasLimit(600_000);
        vm.expectRevert(RFV2_DiceProviderNotReady.selector);
        genericAdapter.quoteRequestPrice(CONSUMER_ENVELOPE);

        f.dice.setDefaultGasLimit(0);
        assertEq(genericAdapter.quoteRequestPrice(CONSUMER_ENVELOPE), DICE_FEE, "restored provider returns exact quote");
    }

    function testR10QueueOwnsHopperReserveAccountingAndPaysAdapterExactQuote() public {
        Fixture memory f = _fixture(false);

        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(f.adapter), address(reserve), 2, 20, 3, 0, 0, MINTER_FEE, MINTER_FEE / 2, MAX_RNG_COST
        );
        f.registry.setCanonical(address(collection), true);
        reserve.registerCollection(address(collection));

        uint256 mintValue = MINTER_FEE * 20;
        vm.deal(BUYER, mintValue + 1 ether);
        vm.prank(BUYER);
        collection.requestForgeMint{value: mintValue}(BUYER, 20);

        uint256 hopperBefore = collection.hopperBalance();
        f.source.setContribution(keccak256("R10_QUEUE_CONTRIBUTION"));
        vm.prank(EXECUTOR);
        uint256 requestId = collection.requestRandomnessForBatch(1);

        assertEq(requestId, 1, "locked batch receives one adapter request");
        assertEq(
            hopperBefore - collection.hopperBalance(), DICE_FEE, "queue pays exact adapter quote from hopper first"
        );
        assertEq(collection.totalRandomnessSpend(), DICE_FEE, "queue owns provider spend accounting");
        assertEq(collection.totalReserveSubsidy(), 0, "healthy hopper needs no reserve shortfall");
        assertEq(
            f.adapter.upstreamRequestIdForLocalRequest(1), 1, "adapter binds one local request to one Dice sequence"
        );
    }
}
