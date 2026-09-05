// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice Run only after the second real Chainlink word is ready.
///         Replays the exact stored word and settles the real Forge batch.
contract FinalizeCanarySepoliaV2R9 is R9SepoliaV2Base {
    function run() external {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicCollectionV2 collection = RelicCollectionV2(payable(_stage1Address("collection")));
        RelicProjectDataV1 data = RelicProjectDataV1(_stage1Address("projectData"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_stage1Address("randomnessAdapter"));

        uint256 forgeLocalRequestId = _stage2Uint("forgeLocalRequestId");
        uint256 forgeUpstreamRequestId = _stage2Uint("forgeUpstreamRequestId");

        require(adapter.wordReadyForLocalRequest(forgeLocalRequestId), "R9: Forge VRF word not ready");
        uint256 forgeRandomWord = adapter.storedWordForLocalRequest(forgeLocalRequestId);
        require(forgeRandomWord != 0, "R9: Forge word zero");

        vm.startBroadcast(deployerKey);

        require(adapter.replayFulfillment(forgeLocalRequestId), "R9: Forge replay failed");
        uint32 settled = collection.settleReady(20);

        vm.stopBroadcast();

        require(settled == 2, "R9: wrong settlement count");
        require(collection.totalCommitted() == CANARY_SUPPLY, "R9: committed supply");
        require(collection.totalMinted() == CANARY_SUPPLY, "R9: minted supply");
        require(collection.totalAssignedRecipes() == CANARY_SUPPLY, "R9: assigned recipes");
        require(collection.completed(), "R9: collection incomplete");
        require(data.contentSealed(), "R9: data unsealed");

        bool[] memory seen = new bool[](CANARY_SUPPLY);
        for (uint256 tokenId = 1; tokenId <= CANARY_SUPPLY; ++tokenId) {
            require(collection.ownerOf(tokenId) == deployer, "R9: token owner");
            require(collection.isRevealed(tokenId), "R9: token hidden");

            uint256 recipe = collection.recipeForToken(tokenId);
            require(recipe < CANARY_SUPPLY, "R9: recipe range");
            require(!seen[recipe], "R9: duplicate recipe");
            seen[recipe] = true;

            require(data.readRecipe(recipe).length == 2, "R9: DNA length");
            require(bytes(collection.renderToken(tokenId)).length != 0, "R9: empty SVG");
            require(bytes(collection.tokenURI(tokenId)).length != 0, "R9: empty tokenURI");
        }

        require(adapter.deliveredForLocalRequest(_stage1Uint("delayedLocalRequestId")), "R9: delayed not delivered");
        require(adapter.deliveredForLocalRequest(forgeLocalRequestId), "R9: Forge not delivered");
        require(adapter.upstreamRequestIdForLocalRequest(forgeLocalRequestId) == forgeUpstreamRequestId, "R9: upstream");

        vm.createDir(_manifestDir(), true);
        string memory key = "r9-sepolia-canary-final";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "projectData", address(data));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeUint(key, "delayedLocalRequestId", _stage1Uint("delayedLocalRequestId"));
        vm.serializeUint(key, "forgeLocalRequestId", forgeLocalRequestId);
        vm.serializeUint(key, "forgeUpstreamRequestId", forgeUpstreamRequestId);
        vm.serializeUint(key, "forgeRandomWord", forgeRandomWord);
        vm.serializeUint(key, "totalMinted", collection.totalMinted());
        string memory json = vm.serializeUint(key, "totalAssignedRecipes", collection.totalAssignedRecipes());

        vm.writeJson(json, _canaryFinalPath());
    }
}
