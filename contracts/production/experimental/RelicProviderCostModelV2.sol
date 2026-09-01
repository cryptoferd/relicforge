// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

/// @title RelicProviderCostModelV2
/// @notice Deterministic Phase 2D comparison model for provider callback and lifecycle economics.
/// @dev EXPERIMENTAL ONLY. Production request payment MUST use each provider's live quote.
contract RelicProviderCostModelV2 {
    uint256 public constant BPS_DENOMINATOR = 10_000;

    function chainlinkDirectNativeCost(
        uint256 gasPriceWei,
        uint32 callbackGasLimit,
        uint32 coordinatorNativeOverheadGas,
        uint32 wrapperOverheadGas,
        uint32 perWordOverheadGas,
        uint32 numWords,
        uint16 premiumBps
    ) public pure returns (uint256) {
        if (numWords == 0) revert RF_BadConfig();

        uint256 billableGas = uint256(callbackGasLimit) + coordinatorNativeOverheadGas + wrapperOverheadGas
            + uint256(perWordOverheadGas) * numWords;

        return _applyPremium(billableGas * gasPriceWei, premiumBps);
    }

    function chainlinkThinLifecycleCost(
        uint256 gasPriceWei,
        uint32 thinCallbackGasLimit,
        uint32 settlementGas,
        uint32 coordinatorNativeOverheadGas,
        uint32 wrapperOverheadGas,
        uint32 perWordOverheadGas,
        uint16 premiumBps
    ) external pure returns (uint256) {
        uint256 randomnessCost = chainlinkDirectNativeCost(
            gasPriceWei,
            thinCallbackGasLimit,
            coordinatorNativeOverheadGas,
            wrapperOverheadGas,
            perWordOverheadGas,
            1,
            premiumBps
        );
        return randomnessCost + uint256(settlementGas) * gasPriceWei;
    }

    function chainlinkSubscriptionActualCost(
        uint256 gasPriceWei,
        uint32 verificationGasUsed,
        uint32 callbackGasUsed,
        uint16 premiumBps
    ) external pure returns (uint256) {
        return _applyPremium((uint256(verificationGasUsed) + callbackGasUsed) * gasPriceWei, premiumBps);
    }

    function supraSubscriptionCost(
        uint256 networkExecutionCostWei,
        uint256 minimumRequestFeeWei,
        uint16 servicePremiumBps
    ) external pure returns (uint256) {
        uint256 premiumCost = _applyPremium(networkExecutionCostWei, servicePremiumBps);
        return premiumCost > minimumRequestFeeWei ? premiumCost : minimumRequestFeeWei;
    }

    function _applyPremium(uint256 baseCost, uint16 premiumBps) internal pure returns (uint256) {
        return baseCost * (BPS_DENOMINATOR + premiumBps) / BPS_DENOMINATOR;
    }
}
