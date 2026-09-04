// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R10MarketplaceSepoliaBase.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

contract RecordR10MarketplaceRequestSepolia is R10MarketplaceSepoliaBase {
    function run() external returns (uint256 localRequestId, uint256 upstreamRequestId) {
        _assertSepolia();

        RelicCollectionV2 collection = RelicCollectionV2(payable(_canaryAddress("collection")));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_canaryAddress("randomnessAdapter"));

        require(collection.delayedRevealRequested(), "R10M: delayed request not persisted");
        require(!collection.delayedRevealed(), "R10M: reveal unexpectedly done");

        localRequestId = collection.delayedRevealRequestId();
        upstreamRequestId = adapter.upstreamRequestIdForLocalRequest(localRequestId);

        require(localRequestId != 0, "R10M: local request missing");
        require(upstreamRequestId != 0, "R10M: upstream request missing");

        vm.createDir(_manifestDir(), true);
        string memory key = "r10-marketplace-request";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeUint(key, "localRequestId", localRequestId);
        string memory json = vm.serializeUint(key, "upstreamRequestId", upstreamRequestId);
        vm.writeJson(json, _requestPath());
    }
}
