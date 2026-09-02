// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

error RFV2_NoProductionRandomnessProvider();

/// @title RelicProviderDecisionMatrixV2Harness
/// @notice Phase 2D R5 provider-selection policy harness.
/// @dev EXPERIMENTAL ONLY. This encodes advancement priority, not production enablement.
///      No chain is production-enabled by R5. Unknown/unsupported chains fail closed, and
///      provider fallback is never automatic once a randomness request has been created.
contract RelicProviderDecisionMatrixV2Harness {
    enum Provider {
        NONE,
        CHAINLINK_VRF_V2_5_DIRECT_NATIVE,
        PYTH_ENTROPY_V2,
        CHAINLINK_VRF_V2_5_SUBSCRIPTION_NATIVE,
        SUPRA_DVRF_V3
    }

    uint256 public constant ETHEREUM_CHAIN_ID = 1;
    uint256 public constant BASE_CHAIN_ID = 8453;
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;

    struct ChainDecision {
        Provider primaryAdvancementProvider;
        Provider secondaryResearchCandidate;
        bool productionEnabled;
        bool supportedForAdvancement;
    }

    function decisionForChain(uint256 chainId) public pure returns (ChainDecision memory d) {
        if (chainId == ETHEREUM_CHAIN_ID) {
            d.primaryAdvancementProvider = Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE;
            d.secondaryResearchCandidate = Provider.NONE;
            d.productionEnabled = false;
            d.supportedForAdvancement = true;
            return d;
        }

        if (chainId == BASE_CHAIN_ID) {
            d.primaryAdvancementProvider = Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE;
            d.secondaryResearchCandidate = Provider.PYTH_ENTROPY_V2;
            d.productionEnabled = false;
            d.supportedForAdvancement = true;
            return d;
        }

        // Robinhood Chain and every unknown chain intentionally return the all-zero fail-closed decision.
        return d;
    }

    function primaryAdvancementProvider(uint256 chainId) external pure returns (Provider) {
        return decisionForChain(chainId).primaryAdvancementProvider;
    }

    function secondaryResearchCandidate(uint256 chainId) external pure returns (Provider) {
        return decisionForChain(chainId).secondaryResearchCandidate;
    }

    function productionEnabled(uint256 chainId) external pure returns (bool) {
        return decisionForChain(chainId).productionEnabled;
    }

    function requireProductionProvider(uint256) external pure returns (Provider) {
        // R5 deliberately certifies no production route yet.
        revert RFV2_NoProductionRandomnessProvider();
    }

    function automaticFallbackAllowed(Provider, Provider) external pure returns (bool) {
        // Switching providers after a request exists can become a reroll/selection surface.
        return false;
    }

    function usesAtomicPerRequestNativePayment(Provider provider) external pure returns (bool) {
        return provider == Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE || provider == Provider.PYTH_ENTROPY_V2;
    }

    function hasSharedLiquidityAttributionGate(Provider provider) external pure returns (bool) {
        return provider == Provider.CHAINLINK_VRF_V2_5_SUBSCRIPTION_NATIVE || provider == Provider.SUPRA_DVRF_V3;
    }

    function requiresIndependentUserContribution(Provider provider) external pure returns (bool) {
        return provider == Provider.PYTH_ENTROPY_V2;
    }
}
