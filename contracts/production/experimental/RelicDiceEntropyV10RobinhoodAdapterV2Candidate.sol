// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicDiceEntropyV10StorageOnlyAdapterV2Harness.sol";

/// @title RelicDiceEntropyV10RobinhoodAdapterV2Candidate
/// @notice Phase 2D R9 production-integration candidate for Robinhood Chain Dice Entropy v10.
/// @dev EXPERIMENTAL / NOT PRODUCTION ENABLED. This contract intentionally inherits the exact R8
///      storage-only Dice callback path instead of forking or reimplementing it. The upstream Dice
///      callback therefore only authenticates and persists the exact word. Collection delivery remains
///      a later permissionless replayFulfillment(localRequestId) transaction, and NFT settlement remains
///      a still-later collection settleReady(...) transaction.
///
///      The independent contribution source is still an explicit production gate. Passing an implementation
///      here does not certify that implementation's independence, freshness, governance, or liveness.
contract RelicDiceEntropyV10RobinhoodAdapterV2Candidate is RelicDiceEntropyV10StorageOnlyAdapterV2Harness {
    constructor(address dice_, address registry_, address provider_, address contributionSource_)
        RelicDiceEntropyV10StorageOnlyAdapterV2Harness(dice_, registry_, provider_, contributionSource_)
    {}
}
