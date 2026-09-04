// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice Reads the persisted Sepolia state and overwrites stage2 JSON with ACTUAL request IDs.
/// @dev No broadcast; this is intentionally run after the transaction receipt exists.
contract RecordCanaryStage2FromChainSepoliaV2R9 is R9SepoliaV2Base {
    function run() external returns (uint256 forgeLocalRequestId, uint256 forgeUpstreamRequestId) {
        _assertSepolia();

        address collectionAddress = _stage1Address("collection");
        address adapterAddress = _stage1Address("randomnessAdapter");

        RelicCollectionV2 collection = RelicCollectionV2(payable(collectionAddress));
        RelicChainlinkVRFV25DirectAdapterV2 adapter = RelicChainlinkVRFV25DirectAdapterV2(adapterAddress);

        (,,,,, uint32 batchQuantity,, uint256 requestId,, bool locked,, bool settled) = collection.batches(1);

        require(locked, "R9 R6 record: batch not locked");
        require(batchQuantity == 2, "R9 R6 record: quantity");
        require(!settled, "R9 R6 record: already settled");
        require(requestId != 0, "R9 R6 record: no request");

        forgeLocalRequestId = requestId;
        forgeUpstreamRequestId = adapter.upstreamRequestIdForLocalRequest(forgeLocalRequestId);

        require(forgeUpstreamRequestId != 0, "R9 R6 record: no upstream request");
        require(collection.requestIdToBatchId(forgeLocalRequestId) == 1, "R9 R6 record: mapping");

        uint256 delayedLocalRequestId = _stage1Uint("delayedLocalRequestId");
        uint256 delayedRandomWord = adapter.storedWordForLocalRequest(delayedLocalRequestId);
        require(delayedRandomWord != 0, "R9 R6 record: delayed word");

        RelicMintPhasesV2 phases = RelicMintPhasesV2(_stage1Address("mintPhases"));
        (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(2);
        oracleHealthy;
        feeActive;

        vm.createDir(_manifestDir(), true);
        string memory key = "r9-sepolia-canary-stage2";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "collection", collectionAddress);
        vm.serializeAddress(key, "randomnessAdapter", adapterAddress);
        vm.serializeUint(key, "delayedLocalRequestId", delayedLocalRequestId);
        vm.serializeUint(key, "delayedRandomWord", delayedRandomWord);
        vm.serializeUint(key, "secondMintFeeWeiAtRecordTime", mintFeeWei);
        vm.serializeUint(key, "forgeBatchId", 1);
        vm.serializeUint(key, "forgeLocalRequestId", forgeLocalRequestId);
        string memory json = vm.serializeUint(key, "forgeUpstreamRequestId", forgeUpstreamRequestId);

        vm.writeJson(json, _canaryStage2Path());
    }
}
