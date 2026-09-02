// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";
import "./RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

error RFV2_OnlyPythEntropy();
error RFV2_WrongPythProvider();
error RFV2_PythProviderNotReady();
error RFV2_BadPythContribution();

interface IRelicPythContributionSourceV2 {
    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32 userRandomNumber);
}

interface IRelicPythEntropyV2 {
    struct ProviderInfo {
        uint128 feeInWei;
        uint128 accruedFeesInWei;
        bytes32 originalCommitment;
        uint64 originalCommitmentSequenceNumber;
        bytes commitmentMetadata;
        bytes uri;
        uint64 endSequenceNumber;
        uint64 sequenceNumber;
        bytes32 currentCommitment;
        uint64 currentCommitmentSequenceNumber;
        address feeManager;
        uint32 maxNumHashes;
        uint32 defaultGasLimit;
    }

    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128 feeAmount);

    function requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit)
        external
        payable
        returns (uint64 assignedSequenceNumber);

    function getProviderInfoV2(address provider) external view returns (ProviderInfo memory info);
}

/// @title RelicPythEntropyV2ThinAdapterV2Harness
/// @notice Phase 2D R3 Pyth Entropy V2 thin-callback adapter candidate.
/// @dev EXPERIMENTAL ONLY. Uses the full custom requestV2(provider,userRandomNumber,gasLimit) path.
///      The contribution source is intentionally externalized because production must prove an independent,
///      non-executor-controlled random contribution policy before this path can be certified.
contract RelicPythEntropyV2ThinAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
    uint32 public constant MAX_EFFECTIVE_PYTH_CALLBACK_GAS = 500_000;

    IRelicPythEntropyV2 public immutable entropy;
    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    IRelicPythContributionSourceV2 public immutable contributionSource;
    address public immutable pythProvider;

    mapping(uint256 => bytes32) public userContributionByLocalRequestId;
    mapping(bytes32 => bool) public usedUserContribution;

    constructor(address entropy_, address registry_, address provider_, address contributionSource_) {
        if (
            entropy_ == address(0) || entropy_.code.length == 0 || registry_ == address(0) || registry_.code.length == 0
                || provider_ == address(0) || contributionSource_ == address(0) || contributionSource_.code.length == 0
        ) revert RF_BadConfig();

        entropy = IRelicPythEntropyV2(entropy_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(registry_);
        pythProvider = provider_;
        contributionSource = IRelicPythContributionSourceV2(contributionSource_);
    }

    /// @notice Pyth's IEntropyConsumer-compatible external callback entrypoint.
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external {
        if (msg.sender != address(entropy)) revert RFV2_OnlyPythEntropy();
        if (provider != pythProvider) revert RFV2_WrongPythProvider();
        _recordVerifiedWord(uint256(sequenceNumber), uint256(randomNumber));
    }

    function providerReady() public view returns (bool) {
        IRelicPythEntropyV2.ProviderInfo memory info = entropy.getProviderInfoV2(pythProvider);
        return info.sequenceNumber != 0 && info.sequenceNumber < info.endSequenceNumber
            && info.currentCommitment != bytes32(0) && info.defaultGasLimit != 0
            && info.defaultGasLimit <= MAX_EFFECTIVE_PYTH_CALLBACK_GAS;
    }

    function _requireProviderReady() internal view {
        if (!providerReady()) revert RFV2_PythProviderNotReady();
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
    }

    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view override returns (uint256) {
        _requireProviderReady();
        return uint256(entropy.getFeeV2(pythProvider, upstreamCallbackGas));
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
            revert RFV2_BadPythContribution();
        }

        usedUserContribution[userRandomNumber] = true;
        userContributionByLocalRequestId[localRequestId] = userRandomNumber;

        uint64 sequenceNumber =
            entropy.requestV2{value: requestPrice}(pythProvider, userRandomNumber, upstreamCallbackGas);
        upstreamRequestId = uint256(sequenceNumber);
    }
}
