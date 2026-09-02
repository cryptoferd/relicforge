// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicProviderDecisionMatrixV2Harness.sol";

contract ForgeRevealV2Phase2DProviderDecisionTest is TestBase {
    RelicProviderDecisionMatrixV2Harness internal matrix;

    function setUp() public {
        matrix = new RelicProviderDecisionMatrixV2Harness();
    }

    function testEthereumPrimaryAdvancementIsChainlinkDirectNative() public view {
        RelicProviderDecisionMatrixV2Harness.ChainDecision memory d = matrix.decisionForChain(1);
        assertEq(
            uint256(d.primaryAdvancementProvider),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE),
            "Ethereum primary advancement provider"
        );
        assertEq(
            uint256(d.secondaryResearchCandidate),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.NONE),
            "Ethereum has no selected secondary"
        );
        assertTrue(d.supportedForAdvancement, "Ethereum is an advancement target");
        assertFalse(d.productionEnabled, "R5 does not production-enable Ethereum");
    }

    function testBasePrimaryIsChainlinkDirectAndPythIsSecondaryResearchCandidate() public view {
        RelicProviderDecisionMatrixV2Harness.ChainDecision memory d = matrix.decisionForChain(8453);
        assertEq(
            uint256(d.primaryAdvancementProvider),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE),
            "Base primary advancement provider"
        );
        assertEq(
            uint256(d.secondaryResearchCandidate),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2),
            "Pyth is Base secondary research candidate"
        );
        assertTrue(d.supportedForAdvancement, "Base is an advancement target");
        assertFalse(d.productionEnabled, "R5 does not production-enable Base");
    }

    function testRobinhoodChainRemainsUnsupportedFailClosed() public view {
        RelicProviderDecisionMatrixV2Harness.ChainDecision memory d = matrix.decisionForChain(4663);
        assertEq(
            uint256(d.primaryAdvancementProvider),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.NONE),
            "Robinhood has no selected provider"
        );
        assertFalse(d.supportedForAdvancement, "Robinhood remains unsupported for provider advancement");
        assertFalse(d.productionEnabled, "Robinhood remains production disabled");
    }

    function testUnknownChainFailsClosed() public view {
        RelicProviderDecisionMatrixV2Harness.ChainDecision memory d = matrix.decisionForChain(999_999);
        assertEq(uint256(d.primaryAdvancementProvider), 0, "unknown chain has no primary");
        assertEq(uint256(d.secondaryResearchCandidate), 0, "unknown chain has no secondary");
        assertFalse(d.supportedForAdvancement, "unknown chain is unsupported");
        assertFalse(d.productionEnabled, "unknown chain cannot be production enabled");
    }

    function testNoProductionProviderCanBeResolvedInR5() public {
        vm.expectRevert(RFV2_NoProductionRandomnessProvider.selector);
        matrix.requireProductionProvider(1);
        vm.expectRevert(RFV2_NoProductionRandomnessProvider.selector);
        matrix.requireProductionProvider(8453);
        vm.expectRevert(RFV2_NoProductionRandomnessProvider.selector);
        matrix.requireProductionProvider(4663);
    }

    function testAutomaticProviderFallbackIsAlwaysDisabled() public view {
        assertFalse(
            matrix.automaticFallbackAllowed(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE,
                RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2
            ),
            "no automatic cross-provider fallback"
        );
        assertFalse(
            matrix.automaticFallbackAllowed(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_SUBSCRIPTION_NATIVE,
                RelicProviderDecisionMatrixV2Harness.Provider.SUPRA_DVRF_V3
            ),
            "blocked candidates cannot auto-fallback either"
        );
    }

    function testAtomicPerRequestNativePaymentClassification() public view {
        assertTrue(
            matrix.usesAtomicPerRequestNativePayment(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE
            ),
            "Chainlink direct uses per-request native payment"
        );
        assertTrue(
            matrix.usesAtomicPerRequestNativePayment(RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2),
            "Pyth uses per-request native payment"
        );
        assertFalse(
            matrix.usesAtomicPerRequestNativePayment(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_SUBSCRIPTION_NATIVE
            ),
            "Chainlink subscription is shared liquidity"
        );
        assertFalse(
            matrix.usesAtomicPerRequestNativePayment(RelicProviderDecisionMatrixV2Harness.Provider.SUPRA_DVRF_V3),
            "Supra V3 is shared subscription liquidity"
        );
    }

    function testSharedLiquidityAttributionGateClassification() public view {
        assertTrue(
            matrix.hasSharedLiquidityAttributionGate(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_SUBSCRIPTION_NATIVE
            ),
            "Chainlink subscription attribution gate"
        );
        assertTrue(
            matrix.hasSharedLiquidityAttributionGate(RelicProviderDecisionMatrixV2Harness.Provider.SUPRA_DVRF_V3),
            "Supra shared subscription attribution gate"
        );
        assertFalse(
            matrix.hasSharedLiquidityAttributionGate(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE
            ),
            "Chainlink direct has no shared-liquidity attribution gate"
        );
        assertFalse(
            matrix.hasSharedLiquidityAttributionGate(RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2),
            "Pyth exact request payment has no shared-liquidity attribution gate"
        );
    }

    function testOnlyPythRequiresIndependentUserContributionPolicy() public view {
        assertTrue(
            matrix.requiresIndependentUserContribution(RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2),
            "Pyth full-custom path requires independent contribution policy"
        );
        assertFalse(
            matrix.requiresIndependentUserContribution(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE
            ),
            "Chainlink direct does not require external user contribution"
        );
        assertFalse(
            matrix.requiresIndependentUserContribution(RelicProviderDecisionMatrixV2Harness.Provider.SUPRA_DVRF_V3),
            "Supra custom seed is request binding, not R3-style independent contribution requirement"
        );
    }

    function testDecisionMatrixNeverTreatsResearchCandidateAsAutomaticFallback() public view {
        RelicProviderDecisionMatrixV2Harness.Provider baseSecondary = matrix.secondaryResearchCandidate(8453);
        assertEq(
            uint256(baseSecondary),
            uint256(RelicProviderDecisionMatrixV2Harness.Provider.PYTH_ENTROPY_V2),
            "Base secondary exists"
        );
        assertFalse(
            matrix.automaticFallbackAllowed(
                RelicProviderDecisionMatrixV2Harness.Provider.CHAINLINK_VRF_V2_5_DIRECT_NATIVE, baseSecondary
            ),
            "secondary means research candidate only"
        );
    }
}
