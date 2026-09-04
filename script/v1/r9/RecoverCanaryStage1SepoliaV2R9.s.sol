// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice R9 live-canary recovery after the first delayed-reveal request exhausted its
///         broadcast gas limit after the Chainlink wrapper returned.
/// @dev The failed outer transaction reverted the Reserve draw, adapter request, and coordinator
///      request atomically. This script retries ONLY requestDelayedReveal() against the already
///      deployed/sealed canary and rewrites the stage-1 manifest with the real persisted IDs.
contract RecoverCanaryStage1SepoliaV2R9 is R9SepoliaV2Base {
    function run() external returns (uint256 localRequestId, uint256 upstreamRequestId) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        string memory oldJson = vm.readFile(_canaryStage1Path());
        address collectionAddress = vm.parseJsonAddress(oldJson, ".collection");
        address projectDataAddress = vm.parseJsonAddress(oldJson, ".projectData");
        address mintPhasesAddress = vm.parseJsonAddress(oldJson, ".mintPhases");
        address adapterAddress = vm.parseJsonAddress(oldJson, ".randomnessAdapter");
        address reserveAddress = vm.parseJsonAddress(oldJson, ".reserve");
        uint256 phaseId = vm.parseJsonUint(oldJson, ".phaseId");

        RelicCollectionV2 collection = RelicCollectionV2(payable(collectionAddress));
        RelicProjectDataV1 data = RelicProjectDataV1(projectDataAddress);
        RelicChainlinkVRFV25DirectAdapterV2 adapter = RelicChainlinkVRFV25DirectAdapterV2(adapterAddress);

        require(collection.creator() == deployer, "R9 recovery: creator mismatch");
        require(data.creator() == deployer, "R9 recovery: data creator mismatch");
        require(data.contentSealed(), "R9 recovery: data not sealed");
        require(collection.totalMinted() == 2, "R9 recovery: minted count");
        require(collection.totalCommitted() == 2, "R9 recovery: committed count");
        require(!collection.delayedRevealRequested(), "R9 recovery: request already persisted");
        require(!collection.delayedRevealed(), "R9 recovery: already revealed");
        require(adapter.nextRequestId() == 1, "R9 recovery: adapter state not reverted");

        vm.startBroadcast(deployerKey);
        localRequestId = collection.requestDelayedReveal();
        vm.stopBroadcast();

        upstreamRequestId = adapter.upstreamRequestIdForLocalRequest(localRequestId);

        require(localRequestId == 1, "R9 recovery: unexpected local request");
        require(upstreamRequestId != 0, "R9 recovery: missing upstream request");
        require(collection.delayedRevealRequested(), "R9 recovery: request flag missing");
        require(collection.delayedRevealRequestId() == localRequestId, "R9 recovery: collection request mismatch");
        require(adapter.nextRequestId() == 2, "R9 recovery: adapter request not persisted");

        (
            address consumer,
            uint256 context,,
            uint256 storedUpstreamRequestId,
            uint256 requestPrice,,
            bool wordReady,
            bool delivered
        ) = adapter.deliveries(localRequestId);

        require(consumer == collectionAddress, "R9 recovery: consumer mismatch");
        require(context == 0, "R9 recovery: delayed context");
        require(storedUpstreamRequestId == upstreamRequestId, "R9 recovery: upstream mismatch");
        require(requestPrice != 0, "R9 recovery: zero request price");
        require(!wordReady && !delivered, "R9 recovery: unexpected synchronous callback");

        // Replace the stale simulation-only request IDs in the stage-1 manifest with
        // the IDs that actually survived onchain.
        string memory key = "r9-sepolia-canary-stage1";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "collection", collectionAddress);
        vm.serializeAddress(key, "projectData", projectDataAddress);
        vm.serializeAddress(key, "mintPhases", mintPhasesAddress);
        vm.serializeAddress(key, "randomnessAdapter", adapterAddress);
        vm.serializeAddress(key, "reserve", reserveAddress);
        vm.serializeUint(key, "phaseId", phaseId);
        vm.serializeUint(key, "delayedLocalRequestId", localRequestId);
        string memory json = vm.serializeUint(key, "delayedUpstreamRequestId", upstreamRequestId);

        vm.writeJson(json, _canaryStage1Path());
    }
}
