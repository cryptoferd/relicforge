// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";
import "./RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

error RFV2_OnlyDiceEntropy();
error RFV2_WrongDiceProvider();
error RFV2_DiceProviderNotReady();
error RFV2_BadDiceContribution();

interface IRelicDiceContributionSourceV2 {
    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32 userRandomNumber);
}

interface IRelicDiceEntropyV10 {
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
    function getRefundDelayBlocks() external view returns (uint64 delayBlocks);
}

/// @title RelicDiceEntropyV10ThinAdapterV2Harness
/// @notice Phase 2D R6 Robinhood Chain Dice Protocol v10 thin-callback adapter candidate.
/// @dev EXPERIMENTAL ONLY. Collector mint transactions never call this adapter/provider directly;
///      the Phase 2C batch queue dispatches randomness later from a separate permissionless executor path.
///      The adapter intentionally exposes NO Dice refund function. Once a Dice sequence exists, Relic Forge
///      preserves that request and waits/retries the same committed result rather than creating a reroll surface.
contract RelicDiceEntropyV10ThinAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
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

    /// @notice Dice IEntropyConsumer-compatible callback entrypoint.
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external {
        if (msg.sender != address(dice)) revert RFV2_OnlyDiceEntropy();
        if (provider != diceProvider) revert RFV2_WrongDiceProvider();
        _recordVerifiedWord(uint256(sequenceNumber), uint256(randomNumber));
    }

    function providerReady() public view returns (bool) {
        IRelicDiceEntropyV10.ProviderInfo memory info = dice.getProviderInfoV2(diceProvider);
        uint64 refundDelay = dice.getRefundDelayBlocks();
        return info.sequenceNumber != 0 && info.sequenceNumber < info.endSequenceNumber
            && info.currentCommitment != bytes32(0) && info.defaultGasLimit != 0
            && info.defaultGasLimit <= MAX_EFFECTIVE_DICE_CALLBACK_GAS && refundDelay != 0
            && refundDelay <= MAX_ACCEPTABLE_REFUND_DELAY_BLOCKS;
    }

    function providerRefundDelayBlocks() external view returns (uint64) {
        return dice.getRefundDelayBlocks();
    }

    /// @notice R6 policy: automatic provider refunds are forbidden while a collector batch depends on the request.
    function automaticProviderRefundEnabled() external pure returns (bool) {
        return false;
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
