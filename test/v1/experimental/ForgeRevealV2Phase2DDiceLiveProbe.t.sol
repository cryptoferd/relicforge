// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10LiveProbeV2.sol";

contract R7NoRefundRegistryMock is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) internal allowed;

    function setCanonical(address who) external {
        allowed[who] = true;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return allowed[who];
    }
}

contract R7NoRefundContributionSourceMock is IRelicDiceContributionSourceV2 {
    uint256 internal nonce;

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32)
    {
        ++nonce;
        return keccak256(abi.encode("R7_NO_REFUND_ACCESSOR", consumer, context, localRequestId, nonce));
    }
}

/// @notice ABI-compatible with the Dice request path but intentionally omits getRefundDelayBlocks().
contract R7DiceWithoutRefundAccessorMock {
    address public immutable provider;
    uint128 public immutable fee;
    IRelicDiceEntropyV10.ProviderInfo internal info;

    constructor(address provider_, uint128 fee_) {
        provider = provider_;
        fee = fee_;
        info.sequenceNumber = 1;
        info.endSequenceNumber = 1000;
        info.currentCommitment = keccak256("R7_CURRENT_COMMITMENT");
        info.defaultGasLimit = 200_000;
    }

    function getProviderInfoV2(address provider_) external view returns (IRelicDiceEntropyV10.ProviderInfo memory out) {
        if (provider_ == provider) return info;
    }

    function getFeeV2(address provider_, uint32) external view returns (uint128) {
        if (provider_ != provider) revert RF_BadRequest();
        return fee;
    }

    function requestV2(address provider_, bytes32 userRandomNumber, uint32) external payable returns (uint64 seq) {
        if (provider_ != provider || userRandomNumber == bytes32(0) || msg.value != fee) revert RF_BadRequest();
        seq = info.sequenceNumber++;
    }
}

contract R7RevertingDiceConsumer is IRelicDiceEntropyConsumerV2 {
    RelicDiceEntropyV10Mock public immutable dice;
    address public immutable provider;

    constructor(address dice_, address provider_) {
        dice = RelicDiceEntropyV10Mock(payable(dice_));
        provider = provider_;
    }

    function request(bytes32 userRandomNumber, uint32 gasLimit) external payable returns (uint64) {
        return dice.requestV2{value: msg.value}(provider, userRandomNumber, gasLimit);
    }

    function _entropyCallback(uint64, address, bytes32) external pure {
        revert RF_BadRequest();
    }
}

contract ForgeRevealV2Phase2DDiceLiveProbeTest is TestBase {
    address internal constant DICE_PROVIDER = address(0x8741B8A8);
    uint128 internal constant FEE = 0.000025 ether;
    uint32 internal constant CALLBACK_GAS = 300_000;

    function _fixture() internal returns (RelicDiceEntropyV10Mock dice, RelicDiceEntropyV10LiveProbeV2 probe) {
        vm.deal(address(this), 10 ether);
        dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, FEE, 200_000, 6);
        probe = new RelicDiceEntropyV10LiveProbeV2(address(dice), DICE_PROVIDER);
    }

    function testLiveProbeUsesExactDiceFeeAndRecordsSuccessfulCallback() public {
        (RelicDiceEntropyV10Mock dice, RelicDiceEntropyV10LiveProbeV2 probe) = _fixture();
        bytes32 userRandom = keccak256("R7_LIVE_PROBE_USER");
        bytes32 providerRevelation = keccak256("R7_LIVE_PROBE_PROVIDER");

        uint64 sequence = probe.request{value: FEE}(userRandom, CALLBACK_GAS);
        assertEq(uint256(sequence), 1, "first sequence");
        assertEq(probe.requestFeeWei(), FEE, "exact live-style fee retained");
        assertEq(uint256(probe.requestedCallbackGas()), CALLBACK_GAS, "thin callback gas retained");
        assertFalse(probe.fulfilled(), "request begins pending");

        assertTrue(
            dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation),
            "mock keeper callback succeeds"
        );
        bytes32 expected = keccak256(abi.encodePacked(userRandom, providerRevelation, bytes32(0)));
        assertTrue(probe.fulfilled(), "probe fulfilled");
        assertEq(probe.randomNumber(), expected, "exact Dice result retained");
        assertEq(probe.callbackCount(), 1, "one accepted callback");
    }

    function testLiveProbeRejectsUnauthorizedOrWrongProviderCallback() public {
        (RelicDiceEntropyV10Mock dice, RelicDiceEntropyV10LiveProbeV2 probe) = _fixture();
        bytes32 userRandom = keccak256("R7_CALLBACK_AUTH");
        probe.request{value: FEE}(userRandom, CALLBACK_GAS);

        vm.expectRevert(RFV2_OnlyDiceEntropy.selector);
        probe._entropyCallback(1, DICE_PROVIDER, bytes32(uint256(1)));

        vm.expectRevert(RFV2_WrongDiceProvider.selector);
        dice.forceCallbackWithProvider(1, address(0xBAD), bytes32(uint256(2)));
    }

    function testLiveProbeIsOneShotAndDuplicateCallbackCannotReroll() public {
        (RelicDiceEntropyV10Mock dice, RelicDiceEntropyV10LiveProbeV2 probe) = _fixture();
        bytes32 userRandom = keccak256("R7_NO_REROLL_USER");
        bytes32 providerRevelation = keccak256("R7_NO_REROLL_PROVIDER");
        uint64 sequence = probe.request{value: FEE}(userRandom, CALLBACK_GAS);

        vm.expectRevert(RFV2_LiveProbeAlreadyRequested.selector);
        probe.request{value: FEE}(keccak256("SECOND_REQUEST"), CALLBACK_GAS);

        assertTrue(
            dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation), "first callback succeeds"
        );
        bytes32 committedWord = probe.randomNumber();

        vm.expectRevert(RF_AlreadyFulfilled.selector);
        dice.forceDuplicateCallback(sequence, keccak256("DIFFERENT_WORD"));
        assertEq(probe.randomNumber(), committedWord, "duplicate cannot replace committed word");
        assertEq(probe.callbackCount(), 1, "callback count remains one");
    }

    function testLiveProbeLateRevealStillSucceedsWhenRequestWasNeverRefunded() public {
        (RelicDiceEntropyV10Mock dice, RelicDiceEntropyV10LiveProbeV2 probe) = _fixture();
        bytes32 userRandom = keccak256("R7_LATE_USER");
        bytes32 providerRevelation = keccak256("R7_LATE_PROVIDER");
        uint64 sequence = probe.request{value: FEE}(userRandom, CALLBACK_GAS);

        dice.advanceSimulatedBlocks(100);
        assertFalse(probe.fulfilled(), "collector-equivalent obligation remains pending through delay");
        assertTrue(
            dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation),
            "late same request still fulfills when no refund/reroll was taken"
        );
        assertTrue(probe.fulfilled(), "late reveal completes");
        assertEq(probe.callbackCount(), 1, "single final callback");
    }

    function testAdapterReadinessDoesNotDependOnOptionalRefundDelayAccessor() public {
        R7DiceWithoutRefundAccessorMock dice = new R7DiceWithoutRefundAccessorMock(DICE_PROVIDER, FEE);
        R7NoRefundRegistryMock registry = new R7NoRefundRegistryMock();
        R7NoRefundContributionSourceMock source = new R7NoRefundContributionSourceMock();
        RelicDiceEntropyV10ThinAdapterV2Harness adapter = new RelicDiceEntropyV10ThinAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(source)
        );

        assertTrue(adapter.providerReady(), "request path is ready without refund-delay selector");
        assertEq(adapter.quoteRequestPrice(CALLBACK_GAS), FEE, "live request quote remains usable");
        (bool supported, uint64 delayBlocks) = adapter.tryProviderRefundDelayBlocks();
        assertFalse(supported, "missing refund-delay selector is reported, not fatal");
        assertEq(uint256(delayBlocks), 0, "unsupported delay decodes as zero");
        assertFalse(adapter.automaticProviderRefundEnabled(), "Relic still never auto-refunds Dice requests");
    }

    function testZeroProviderDefaultGasAllowsLivenessProbeButProductionAdapterStaysFailClosed() public {
        vm.deal(address(this), 10 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, FEE, 0, 6);
        RelicDiceEntropyV10LiveProbeV2 probe = new RelicDiceEntropyV10LiveProbeV2(address(dice), DICE_PROVIDER);
        R7NoRefundRegistryMock registry = new R7NoRefundRegistryMock();
        R7NoRefundContributionSourceMock source = new R7NoRefundContributionSourceMock();
        RelicDiceEntropyV10ThinAdapterV2Harness adapter = new RelicDiceEntropyV10ThinAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(source)
        );

        assertFalse(adapter.providerReady(), "zero default gas remains a production-adapter gate");

        bytes32 userRandom = keccak256("R7_ZERO_DEFAULT_LIVE_USER");
        bytes32 providerRevelation = keccak256("R7_ZERO_DEFAULT_LIVE_PROVIDER");
        uint64 sequence = probe.request{value: FEE}(userRandom, CALLBACK_GAS);
        assertEq(uint256(probe.providerDefaultGasLimitAtRequest()), 0, "live provider zero default recorded");
        assertTrue(probe.providerRemainingGasModeAtRequest(), "probe records Dice remaining-gas mode");

        (
            address requester,
            address requestProvider,
            bytes32 storedUserRandom,
            uint32 requestedGas,
            uint32 effectiveGas,
            uint128 feePaid,
            uint64 requestBlock,
            bytes32 storedReveal,
            bytes32 storedWord,
            uint8 callbackStatus,
            bool exists,
            bool refunded
        ) = dice.requests(sequence);
        requester;
        requestProvider;
        storedUserRandom;
        feePaid;
        requestBlock;
        storedReveal;
        storedWord;
        callbackStatus;
        refunded;
        assertEq(uint256(requestedGas), CALLBACK_GAS, "caller still requests 300k");
        assertEq(uint256(effectiveGas), 0, "Dice zero-default mode ignores requested provider gas cap");
        assertTrue(exists, "request is live before reveal");

        assertTrue(
            dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation),
            "fixed liveness probe succeeds in remaining-gas mode"
        );
        assertTrue(probe.fulfilled(), "realistic zero-default callback reaches probe");
    }

    function testZeroProviderDefaultGasCallbackFailureClearsProviderRetryState() public {
        vm.deal(address(this), 10 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, FEE, 0, 6);
        R7RevertingDiceConsumer consumer = new R7RevertingDiceConsumer(address(dice), DICE_PROVIDER);
        bytes32 userRandom = keccak256("R7_ZERO_DEFAULT_FAIL_USER");
        bytes32 providerRevelation = keccak256("R7_ZERO_DEFAULT_FAIL_PROVIDER");
        uint64 sequence = consumer.request{value: FEE}(userRandom, CALLBACK_GAS);

        assertFalse(
            dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation),
            "consumer callback failure is contained"
        );
        (
            address requester,
            address requestProvider,
            bytes32 storedUserRandom,
            uint32 requestedGas,
            uint32 effectiveGas,
            uint128 feePaid,
            uint64 requestBlock,
            bytes32 storedReveal,
            bytes32 storedWord,
            uint8 callbackStatus,
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
        storedReveal;
        storedWord;
        refunded;
        assertEq(uint256(callbackStatus), 1, "failed callback recorded diagnostically");
        assertFalse(exists, "zero-default Dice mode has no provider retry state after reveal attempt");

        vm.expectRevert(RF_BadRequest.selector);
        dice.revealWithCallback(DICE_PROVIDER, sequence, userRandom, providerRevelation);
    }
}
