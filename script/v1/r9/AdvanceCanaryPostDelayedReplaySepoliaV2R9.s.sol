// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice R9 R6 continuation after delayed VRF has been explicitly replayed with a fixed gas limit.
/// @dev Restart-safe:
///      - if the final two NFTs are not yet reserved, mint/reserve them;
///      - if batch 1 does not yet have a randomness request, request it;
///      - if either step already persisted, skip it.
contract AdvanceCanaryPostDelayedReplaySepoliaV2R9 is R9SepoliaV2Base {
    function run() external returns (uint256 forgeLocalRequestId) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        RelicCollectionV2 collection = RelicCollectionV2(payable(_stage1Address("collection")));
        RelicMintPhasesV2 phases = RelicMintPhasesV2(_stage1Address("mintPhases"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_stage1Address("randomnessAdapter"));

        uint256 delayedLocalRequestId = _stage1Uint("delayedLocalRequestId");

        require(adapter.wordReadyForLocalRequest(delayedLocalRequestId), "R9 R6: delayed word not ready");
        require(adapter.deliveredForLocalRequest(delayedLocalRequestId), "R9 R6: delayed word not delivered");
        require(collection.delayedRevealed(), "R9 R6: delayed reveal incomplete");
        require(collection.futureRevealMode() == collection.REVEAL_FORGE(), "R9 R6: future mode not Forge");
        require(collection.hybridForgeActive(), "R9 R6: hybrid mode inactive");
        require(collection.totalMinted() == 2, "R9 R6: unexpected minted count");

        vm.startBroadcast(deployerKey);

        if (collection.totalCommitted() == 2) {
            uint32 phaseId = uint32(_stage1Uint("phaseId"));

            (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(2);
            require(oracleHealthy, "R9 R6: second mint oracle unhealthy");
            require(feeActive && mintFeeWei != 0, "R9 R6: second minter fee inactive");

            bytes32[] memory emptyProof = new bytes32[](0);
            collection.mint{value: mintFeeWei}(phaseId, 2, 0, emptyProof);
        }

        require(collection.totalCommitted() == CANARY_SUPPLY, "R9 R6: sellout not committed");
        require(collection.totalMinted() == 2, "R9 R6: Forge minted too early");
        require(collection.openBatchId() == 2, "R9 R6: batch 1 not locked");

        (,,,,, uint32 batchQuantity,, uint256 existingRequestId,, bool locked,, bool settled) = collection.batches(1);

        require(locked, "R9 R6: batch 1 not locked");
        require(batchQuantity == 2, "R9 R6: wrong batch quantity");
        require(!settled, "R9 R6: batch already settled");

        if (existingRequestId == 0) {
            forgeLocalRequestId = collection.requestRandomnessForBatch(1);
        } else {
            forgeLocalRequestId = existingRequestId;
        }

        vm.stopBroadcast();

        require(forgeLocalRequestId != 0, "R9 R6: Forge request missing");
        require(collection.requestIdToBatchId(forgeLocalRequestId) == 1, "R9 R6: request/batch mismatch");
        require(adapter.upstreamRequestIdForLocalRequest(forgeLocalRequestId) != 0, "R9 R6: upstream missing");
    }
}
