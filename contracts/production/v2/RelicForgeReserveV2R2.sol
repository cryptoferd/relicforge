// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeReserveV2.sol";

/// @title RelicForgeReserveV2R2
/// @notice R2 reserve extension for two-step delayed reveal preparation.
/// @dev The R1 reserve policy remains intact. This adds only an exact repayment path for
///      unused subsidy that was provisioned during PREPARE DELAYED REVEAL but not consumed
///      by the eventual Chainlink request.
contract RelicForgeReserveV2R2 is RelicForgeReserveV2 {
    event RandomnessSubsidyRefunded(address indexed collection, uint64 indexed reserveKey, uint256 amount);

    constructor(
        address founder_,
        address payable revenueTreasury_,
        uint256 minimumReserveWei_,
        uint256 perActiveBatchBufferWei_,
        uint32 exposureSafetyBps_,
        uint256 maxSubsidyPerRequestWei_,
        uint256 maxSubsidyPerCollectionWei_
    )
        payable
        RelicForgeReserveV2(
            founder_,
            revenueTreasury_,
            minimumReserveWei_,
            perActiveBatchBufferWei_,
            exposureSafetyBps_,
            maxSubsidyPerRequestWei_,
            maxSubsidyPerCollectionWei_
        )
    {}

    function refundRandomnessSubsidy(uint64 reserveKey) external payable reserveUnlocked {
        if (!canonicalCollection[msg.sender]) revert RFV2_CollectionNotRegisteredProd();
        if (msg.value == 0) revert RF_ZeroQuantity();

        uint256 lifetime = collectionLifetimeSubsidyWei[msg.sender];
        if (msg.value > lifetime) revert RFV2_BadReserveDrawProd();

        collectionLifetimeSubsidyWei[msg.sender] = lifetime - msg.value;
        emit RandomnessSubsidyRefunded(msg.sender, reserveKey, msg.value);
    }
}
