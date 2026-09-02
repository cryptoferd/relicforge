// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicDiceEntropyV10ThinAdapterV2Harness.sol";

/// @title RelicDiceEntropyV10StorageOnlyAdapterV2Harness
/// @notice Phase 2D R8 Robinhood Dice v10 adapter candidate with a storage-only upstream callback.
/// @dev EXPERIMENTAL ONLY. The Dice callback authenticates the upstream contract/provider, resolves the
///      exact local request, stores the exact verified word, emits the record event, and returns. It never
///      calls the collection. Collection delivery is performed later through the inherited permissionless
///      replayFulfillment(localRequestId) path, so a downstream collection revert cannot make Dice's live
///      zero-default-gas callback fail after the word has reached Relic Forge.
contract RelicDiceEntropyV10StorageOnlyAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
    uint32 public constant MAX_EFFECTIVE_DICE_CALLBACK_GAS = 500_000;
    uint64 public constant MAX_ACCEPTABLE_REFUND_DELAY_BLOCKS = 64;

    IRelicDiceEntropyV10 public immutable dice;
    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    IRelicDiceContributionSourceV2 public immutable contributionSource;
    address public immutable diceProvider;

    mapping(uint256 => bytes32) public userContributionByLocalRequestId;
    mapping(bytes32 => bool) public usedUserContribution;

    constructor(address dice_, address registry_, address provider_, address contributionSource_) {
        if (
            dice_ == address(0) || dice_.code.length == 0 || registry_ == address(0) || registry_.code.length == 0
                || provider_ == address(0) || contributionSource_ == address(0) || contributionSource_.code.length == 0
        ) revert RF_BadConfig();

        dice = IRelicDiceEntropyV10(dice_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(registry_);
        diceProvider = provider_;
        contributionSource = IRelicDiceContributionSourceV2(contributionSource_);
    }

    /// @notice Dice IEntropyConsumer-compatible entrypoint.
    /// @dev STORAGE ONLY: no downstream collection call is attempted inside this upstream callback.
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external {
        if (msg.sender != address(dice)) revert RFV2_OnlyDiceEntropy();
        if (provider != diceProvider) revert RFV2_WrongDiceProvider();

        uint256 upstreamRequestId = uint256(sequenceNumber);
        uint256 localRequestId = upstreamRequestIdToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();

        Delivery storage d = deliveries[localRequestId];
        if (d.wordReady) revert RF_AlreadyFulfilled();

        d.wordReady = true;
        d.word = uint256(randomNumber);
        emit ThinRandomWordRecorded(localRequestId, upstreamRequestId, uint256(randomNumber));
    }

    /// @notice R8 accepts the live Dice zero-default remaining-gas mode only because the upstream callback
    ///         is storage-only. Nonzero provider defaults remain bounded by the same conservative ceiling.
    function providerReady() public view returns (bool) {
        IRelicDiceEntropyV10.ProviderInfo memory info = dice.getProviderInfoV2(diceProvider);
        if (
            info.sequenceNumber == 0 || info.sequenceNumber >= info.endSequenceNumber
                || info.currentCommitment == bytes32(0)
                || (info.defaultGasLimit != 0 && info.defaultGasLimit > MAX_EFFECTIVE_DICE_CALLBACK_GAS)
        ) return false;

        (bool refundDelaySupported, uint64 refundDelay) = _tryProviderRefundDelayBlocks();
        if (refundDelaySupported && (refundDelay == 0 || refundDelay > MAX_ACCEPTABLE_REFUND_DELAY_BLOCKS)) {
            return false;
        }
        return true;
    }

    function providerUsesRemainingGasMode() external view returns (bool) {
        return dice.getProviderInfoV2(diceProvider).defaultGasLimit == 0;
    }

    function providerSideCallbackRetryExpected() external view returns (bool) {
        return dice.getProviderInfoV2(diceProvider).defaultGasLimit != 0;
    }

    function upstreamCallbackIsStorageOnly() external pure returns (bool) {
        return true;
    }

    function providerRefundDelayBlocks() external view returns (uint64) {
        return dice.getRefundDelayBlocks();
    }

    function tryProviderRefundDelayBlocks() external view returns (bool supported, uint64 delayBlocks) {
        return _tryProviderRefundDelayBlocks();
    }

    function _tryProviderRefundDelayBlocks() internal view returns (bool supported, uint64 delayBlocks) {
        (bool ok, bytes memory data) =
            address(dice).staticcall(abi.encodeWithSelector(IRelicDiceEntropyV10.getRefundDelayBlocks.selector));
        if (!ok || data.length < 32) return (false, 0);
        delayBlocks = abi.decode(data, (uint64));
        supported = true;
    }

    /// @notice Provider refunds remain forbidden for accepted Forge batches; R8 does not add a reroll surface.
    function automaticProviderRefundEnabled() external pure returns (bool) {
        return false;
    }

    /// @notice Convenience diagnostics for the live R8 runner. The same data is also exposed through deliveries().
    function upstreamRequestIdForLocalRequest(uint256 localRequestId) external view returns (uint256) {
        return deliveries[localRequestId].upstreamRequestId;
    }

    function storedWordForLocalRequest(uint256 localRequestId) external view returns (uint256) {
        return deliveries[localRequestId].word;
    }

    function wordReadyForLocalRequest(uint256 localRequestId) external view returns (bool) {
        return deliveries[localRequestId].wordReady;
    }

    function deliveredForLocalRequest(uint256 localRequestId) external view returns (bool) {
        return deliveries[localRequestId].delivered;
    }

    function _requireProviderReady() internal view {
        if (!providerReady()) revert RFV2_DiceProviderNotReady();
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
    }

    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view override returns (uint256) {
        _requireProviderReady();
        return uint256(dice.getFeeV2(diceProvider, upstreamCallbackGas));
    }

    function _requestUpstream(uint256 localRequestId, uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        override
        returns (uint256 upstreamRequestId)
    {
        _requireProviderReady();
        Delivery storage d = deliveries[localRequestId];
        bytes32 userRandomNumber = contributionSource.contributionForRequest(d.consumer, d.context, localRequestId);
        if (userRandomNumber == bytes32(0) || usedUserContribution[userRandomNumber]) {
            revert RFV2_BadDiceContribution();
        }

        usedUserContribution[userRandomNumber] = true;
        userContributionByLocalRequestId[localRequestId] = userRandomNumber;

        uint64 sequenceNumber = dice.requestV2{value: requestPrice}(diceProvider, userRandomNumber, upstreamCallbackGas);
        upstreamRequestId = uint256(sequenceNumber);
    }
}
