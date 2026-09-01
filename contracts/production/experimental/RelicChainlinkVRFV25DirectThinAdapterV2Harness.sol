// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";

error RFV2_OnlyChainlinkWrapper();

interface IRelicCanonicalCollectionRegistryV2 {
    function isCanonicalCollection(address collection) external view returns (bool);
}

interface IRelicChainlinkVRFV25WrapperV2 {
    function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords) external view returns (uint256);

    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId);
}

/// @title RelicChainlinkVRFV25DirectThinAdapterV2Harness
/// @notice Phase 2D Chainlink VRF v2.5 native direct-funding thin-callback adapter.
/// @dev EXPERIMENTAL ONLY. Uses the current wrapper ABI without importing production dependencies.
contract RelicChainlinkVRFV25DirectThinAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));
    uint32 public constant NUM_WORDS = 1;

    IRelicChainlinkVRFV25WrapperV2 public immutable chainlinkWrapper;
    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    uint16 public immutable requestConfirmations;

    constructor(address wrapper_, address canonicalCollectionRegistry_, uint16 requestConfirmations_) {
        if (
            wrapper_ == address(0) || wrapper_.code.length == 0 || canonicalCollectionRegistry_ == address(0)
                || canonicalCollectionRegistry_.code.length == 0 || requestConfirmations_ == 0
        ) revert RF_BadConfig();

        chainlinkWrapper = IRelicChainlinkVRFV25WrapperV2(wrapper_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(canonicalCollectionRegistry_);
        requestConfirmations = requestConfirmations_;
    }

    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(chainlinkWrapper)) revert RFV2_OnlyChainlinkWrapper();
        if (randomWords.length != NUM_WORDS) revert RF_BadRequest();
        _recordVerifiedWord(upstreamRequestId, randomWords[0]);
    }

    function nativePaymentExtraArgs() public pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, true);
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
    }

    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view override returns (uint256) {
        return chainlinkWrapper.calculateRequestPriceNative(upstreamCallbackGas, NUM_WORDS);
    }

    function _requestUpstream(uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        override
        returns (uint256 upstreamRequestId)
    {
        upstreamRequestId = chainlinkWrapper.requestRandomWordsInNative{value: requestPrice}(
            upstreamCallbackGas, requestConfirmations, NUM_WORDS, nativePaymentExtraArgs()
        );
    }
}
