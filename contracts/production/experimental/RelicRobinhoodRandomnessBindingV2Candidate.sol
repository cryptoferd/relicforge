// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicPricedRandomnessQueueMockV2.sol";
import "./RelicDiceEntropyV10RobinhoodAdapterV2Candidate.sol";

/// @notice Generic Relic Forge V2 randomness seam that future collection/factory code may depend on.
/// @dev Provider-specific configuration and recovery mechanisms stay outside this interface.
interface IRelicForgeRandomnessAdapterV2 is IRelicPricedRandomnessProviderV2 {
    function replayFulfillment(uint256 localRequestId) external returns (bool delivered);
}

/// @notice Robinhood-specific deployment/binding diagnostics layered on the generic V2 randomness seam.
/// @dev These selectors let Factory V2 / deployment tooling reject the wrong chain or adapter family
///      without teaching collection contracts any Dice-specific behavior.
interface IRelicRobinhoodRandomnessAdapterV2 is IRelicForgeRandomnessAdapterV2 {
    function relicForgeRandomnessInterfaceVersion() external pure returns (uint32);
    function targetChainId() external pure returns (uint256);
    function factoryBindingFingerprint() external pure returns (bytes32);
    function contributionInterfaceFingerprint() external pure returns (bytes32);
    function bindingValidForCurrentChain() external view returns (bool);
    function providerReady() external view returns (bool);
    function upstreamCallbackIsStorageOnly() external pure returns (bool);
    function automaticProviderRefundEnabled() external pure returns (bool);
}

/// @title RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate
/// @notice Phase 2D R10 Robinhood factory-interface-freeze candidate.
/// @dev EXPERIMENTAL / NOT PRODUCTION ENABLED.
///
///      R10 intentionally inherits the locally certified R9 adapter rather than changing the Dice request
///      or callback path. The only new behavior is a small, provider-agnostic deployment descriptor that
///      future Factory V2 tooling can verify before binding a Robinhood collection to an adapter.
///
///      This contract DOES NOT solve or certify the independent contribution source. The source remains
///      immutable per adapter deployment and its production implementation remains a separate activation gate.
contract RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate is RelicDiceEntropyV10RobinhoodAdapterV2Candidate {
    uint32 internal constant RELIC_FORGE_RANDOMNESS_INTERFACE_VERSION = 2;
    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    bytes32 internal constant ROBINHOOD_FACTORY_BINDING_FINGERPRINT = keccak256(
        "RELIC_FORGE_RANDOMNESS_V2|ROBINHOOD_4663|DICE_V10|STORAGE_ONLY|EXACT_NATIVE_QUOTE|EXACT_WORD_REPLAY"
    );
    bytes32 internal constant DICE_CONTRIBUTION_INTERFACE_FINGERPRINT =
        keccak256("contributionForRequest(address,uint256,uint256)");

    constructor(address dice_, address registry_, address provider_, address contributionSource_)
        RelicDiceEntropyV10RobinhoodAdapterV2Candidate(dice_, registry_, provider_, contributionSource_)
    {}

    function relicForgeRandomnessInterfaceVersion() external pure returns (uint32) {
        return RELIC_FORGE_RANDOMNESS_INTERFACE_VERSION;
    }

    function targetChainId() external pure returns (uint256) {
        return ROBINHOOD_MAINNET_CHAIN_ID;
    }

    function factoryBindingFingerprint() external pure returns (bytes32) {
        return ROBINHOOD_FACTORY_BINDING_FINGERPRINT;
    }

    function contributionInterfaceFingerprint() external pure returns (bytes32) {
        return DICE_CONTRIBUTION_INTERFACE_FINGERPRINT;
    }

    /// @notice Factory/deployment preflight helper. R10 does not itself activate production.
    function bindingValidForCurrentChain() external view returns (bool) {
        return block.chainid == ROBINHOOD_MAINNET_CHAIN_ID;
    }
}
