// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";

error RFV2_OnlyChainlinkWrapperR12();
error RFV2_WrongTargetChainR12();

interface IRelicCanonicalCollectionRegistryR12 {
    function isCanonicalCollection(address collection) external view returns (bool);
}

interface IRelicChainlinkVRFV25WrapperR12 {
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

    function link() external view returns (address);
}

/// @title RelicChainlinkVRFV25DirectAdapterV2
/// @notice Production-shaped Relic Forge V2 direct-funded Chainlink VRF v2.5 adapter.
/// @dev R12 ETHEREUM SEPOLIA CANDIDATE. NOT MAINNET-ACTIVATED.
///      Chainlink's rawFulfillRandomWords callback is STORAGE ONLY.
///      Delivery is a later permissionless replayFulfillment() transaction.
contract RelicChainlinkVRFV25DirectAdapterV2 is RelicThinRandomnessAdapterBaseV2Prod {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));
    uint32 public constant NUM_WORDS = 1;

    uint256 public immutable targetChainId;
    IRelicChainlinkVRFV25WrapperR12 public immutable chainlinkWrapper;
    IRelicCanonicalCollectionRegistryR12 public immutable canonicalCollectionRegistry;
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
        chainlinkWrapper = IRelicChainlinkVRFV25WrapperR12(wrapper_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryR12(canonicalCollectionRegistry_);
        requestConfirmations = requestConfirmations_;
    }

    function bindingValidForCurrentChain() external view returns (bool) {
        return block.chainid == targetChainId;
    }

    function upstreamCallbackIsStorageOnly() external pure returns (bool) {
        return true;
    }

    function automaticProviderRefundEnabled() external pure returns (bool) {
        return false;
    }

    function nativePaymentExtraArgs() public pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, ExtraArgsV1({nativePayment: true}));
    }

    function estimateRequestPriceAtGasPrice(uint256 requestGasPriceWei) external view returns (uint256) {
        _requireTargetChain();
        return chainlinkWrapper.estimateRequestPriceNative(UPSTREAM_CALLBACK_GAS, NUM_WORDS, requestGasPriceWei);
    }

    /// @notice Chainlink VRF v2.5 wrapper callback entrypoint.
    /// @dev STORAGE ONLY. It stores the exact verified word and returns.
    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external {
        _requireTargetChain();
        if (msg.sender != address(chainlinkWrapper)) revert RFV2_OnlyChainlinkWrapperR12();
        if (randomWords.length != NUM_WORDS) revert RF_BadRequest();

        _storeVerifiedWordOnly(upstreamRequestId, randomWords[0]);
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

    function _requireTargetChain() internal view {
        if (block.chainid != targetChainId) revert RFV2_WrongTargetChainR12();
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
