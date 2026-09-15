// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2R2Core.sol";

error RFV2R2_OnlyChainlinkWrapper();
error RFV2R2_WrongTargetChain();

interface IRelicCanonicalCollectionRegistryV2R2 {
    function isCanonicalCollection(address collection) external view returns (bool);
}

interface IRelicChainlinkVRFV25WrapperV2R2 {
    function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords)
        external
        view
        returns (uint256 requestPrice);

    function estimateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords, uint256 requestGasPriceWei)
        external
        view
        returns (uint256 requestPrice);

    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId);
}

/// @title RelicChainlinkVRFV25DirectAdapterV2R2
/// @notice R2 direct-funded Chainlink VRF v2.5 adapter.
/// @dev A verified wrapper callback stores the exact word and immediately attempts bounded
///      consumer delivery. If consumer delivery cannot complete, the word remains stored and
///      replayFulfillment(localRequestId) can safely retry the exact same word.
contract RelicChainlinkVRFV25DirectAdapterV2R2 is RelicThinRandomnessAdapterBaseV2R2Prod {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));
    uint32 public constant NUM_WORDS = 1;

    uint256 public immutable targetChainId;
    IRelicChainlinkVRFV25WrapperV2R2 public immutable chainlinkWrapper;
    IRelicCanonicalCollectionRegistryV2R2 public immutable canonicalCollectionRegistry;
    uint16 public immutable requestConfirmations;

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    constructor(
        uint256 targetChainId_,
        address wrapper_,
        address canonicalCollectionRegistry_,
        uint16 requestConfirmations_
    ) {
        if (
            targetChainId_ == 0 || wrapper_ == address(0) || wrapper_.code.length == 0
                || canonicalCollectionRegistry_ == address(0) || canonicalCollectionRegistry_.code.length == 0
                || requestConfirmations_ == 0 || requestConfirmations_ > 200
        ) revert RF_BadConfig();

        targetChainId = targetChainId_;
        chainlinkWrapper = IRelicChainlinkVRFV25WrapperV2R2(wrapper_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2R2(canonicalCollectionRegistry_);
        requestConfirmations = requestConfirmations_;
    }

    function bindingValidForCurrentChain() external view returns (bool) {
        return block.chainid == targetChainId;
    }

    function upstreamCallbackIsStorageOnly() external pure returns (bool) {
        return false;
    }

    function automaticProviderRefundEnabled() external pure returns (bool) {
        return true;
    }

    function automaticConsumerDeliveryEnabled() external pure returns (bool) {
        return true;
    }

    function nativePaymentExtraArgs() public pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, ExtraArgsV1({nativePayment: true}));
    }

    function estimateRequestPriceAtGasPrice(uint32 requestedConsumerCallbackGas, uint256 requestGasPriceWei)
        external
        view
        returns (uint256)
    {
        _requireTargetChain();
        _validateConsumerCallbackGas(requestedConsumerCallbackGas);
        return chainlinkWrapper.estimateRequestPriceNative(
            _upstreamCallbackGas(requestedConsumerCallbackGas), NUM_WORDS, requestGasPriceWei
        );
    }

    /// @notice Compatibility estimator using the R2 automatic-reveal consumer envelope.
    function estimateRequestPriceAtGasPrice(uint256 requestGasPriceWei) external view returns (uint256) {
        _requireTargetChain();
        return
            chainlinkWrapper.estimateRequestPriceNative(_upstreamCallbackGas(1_500_000), NUM_WORDS, requestGasPriceWei);
    }

    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external {
        _requireTargetChain();
        if (msg.sender != address(chainlinkWrapper)) revert RFV2R2_OnlyChainlinkWrapper();
        if (randomWords.length != NUM_WORDS) revert RF_BadRequest();

        _storeVerifiedWordAndAttemptDelivery(upstreamRequestId, randomWords[0]);
    }

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

    function requestedConsumerGasForLocalRequest(uint256 localRequestId) external view returns (uint32) {
        return deliveries[localRequestId].requestedConsumerCallbackGas;
    }

    function upstreamCallbackGasForLocalRequest(uint256 localRequestId) external view returns (uint32) {
        return deliveries[localRequestId].upstreamCallbackGas;
    }

    function _requireTargetChain() internal view {
        if (block.chainid != targetChainId) revert RFV2R2_WrongTargetChain();
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        _requireTargetChain();
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
    }

    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view override returns (uint256) {
        _requireTargetChain();
        return chainlinkWrapper.calculateRequestPriceNative(upstreamCallbackGas, NUM_WORDS);
    }

    function _requestUpstream(uint256, uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        override
        returns (uint256 upstreamRequestId)
    {
        _requireTargetChain();
        upstreamRequestId = chainlinkWrapper.requestRandomWordsInNative{value: requestPrice}(
            upstreamCallbackGas, requestConfirmations, NUM_WORDS, nativePaymentExtraArgs()
        );
    }
}
