// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice Run only after the first real Chainlink word is ready in the adapter.
///         Replays that exact word, proves the automatic Deferred -> Forge switch,
///         mints the remaining supply, and requests the second real Chainlink word.
contract AdvanceCanarySepoliaV2R9 is R9SepoliaV2Base {
    function run() external returns (uint256 forgeLocalRequestId, uint256 forgeUpstreamRequestId) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicCollectionV2 collection = RelicCollectionV2(payable(_stage1Address("collection")));
        RelicMintPhasesV2 phases = RelicMintPhasesV2(_stage1Address("mintPhases"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_stage1Address("randomnessAdapter"));

        uint256 delayedLocalRequestId = _stage1Uint("delayedLocalRequestId");
        require(adapter.wordReadyForLocalRequest(delayedLocalRequestId), "R9: delayed VRF word not ready");

        uint256 delayedRandomWord = adapter.storedWordForLocalRequest(delayedLocalRequestId);
        require(delayedRandomWord != 0, "R9: delayed word zero");

        uint32 phaseId = uint32(_stage1Uint("phaseId"));

        vm.startBroadcast(deployerKey);

        require(adapter.replayFulfillment(delayedLocalRequestId), "R9: delayed replay failed");

        require(collection.delayedRevealed(), "R9: delayed reveal incomplete");
        require(collection.futureRevealMode() == collection.REVEAL_FORGE(), "R9: future mode not Forge");
        require(collection.hybridForgeActive(), "R9: hybrid mode inactive");

        (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(2);
        require(oracleHealthy, "R9: second mint oracle unhealthy");
        require(feeActive && mintFeeWei != 0, "R9: second minter fee inactive");

        bytes32[] memory emptyProof = new bytes32[](0);
        collection.mint{value: mintFeeWei}(phaseId, 2, 0, emptyProof);

        require(collection.totalCommitted() == CANARY_SUPPLY, "R9: sellout not committed");
        require(collection.totalMinted() == 2, "R9: Forge minted too early");
        require(collection.openBatchId() == 2, "R9: final partial batch not locked as batch 1");

        forgeLocalRequestId = collection.requestRandomnessForBatch(1);

        vm.stopBroadcast();

        forgeUpstreamRequestId = adapter.upstreamRequestIdForLocalRequest(forgeLocalRequestId);
        require(forgeLocalRequestId != 0 && forgeUpstreamRequestId != 0, "R9: Forge request missing");
        require(collection.requestIdToBatchId(forgeLocalRequestId) == 1, "R9: Forge batch mapping");

        vm.createDir(_manifestDir(), true);
        string memory key = "r9-sepolia-canary-stage2";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeUint(key, "delayedLocalRequestId", delayedLocalRequestId);
        vm.serializeUint(key, "delayedRandomWord", delayedRandomWord);
        vm.serializeUint(key, "secondMintFeeWei", mintFeeWei);
        vm.serializeUint(key, "forgeBatchId", 1);
        vm.serializeUint(key, "forgeLocalRequestId", forgeLocalRequestId);
        string memory json = vm.serializeUint(key, "forgeUpstreamRequestId", forgeUpstreamRequestId);

        vm.writeJson(json, _canaryStage2Path());
    }
}
