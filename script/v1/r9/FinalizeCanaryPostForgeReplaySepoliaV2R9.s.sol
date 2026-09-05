// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice Settles the canary only after the Forge word has already been explicitly delivered.
/// @dev Restart-safe: if already complete, performs validation only and sends no settlement.
contract FinalizeCanaryPostForgeReplaySepoliaV2R9 is R9SepoliaV2Base {
    function run() external {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicCollectionV2 collection = RelicCollectionV2(payable(_stage1Address("collection")));
        RelicProjectDataV1 data = RelicProjectDataV1(_stage1Address("projectData"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_stage1Address("randomnessAdapter"));

        uint256 forgeLocalRequestId = _stage2Uint("forgeLocalRequestId");

        require(adapter.wordReadyForLocalRequest(forgeLocalRequestId), "R9 R6: Forge word not ready");
        require(adapter.deliveredForLocalRequest(forgeLocalRequestId), "R9 R6: Forge word not delivered");

        if (!collection.completed()) {
            vm.startBroadcast(deployerKey);
            uint32 settled = collection.settleReady(20);
            vm.stopBroadcast();
            require(settled == 2, "R9 R6: wrong settlement count");
        }

        require(collection.totalCommitted() == CANARY_SUPPLY, "R9 R6: committed supply");
        require(collection.totalMinted() == CANARY_SUPPLY, "R9 R6: minted supply");
        require(collection.totalAssignedRecipes() == CANARY_SUPPLY, "R9 R6: assigned recipes");
        require(collection.completed(), "R9 R6: incomplete");
        require(data.contentSealed(), "R9 R6: data unsealed");

        bool[] memory seen = new bool[](CANARY_SUPPLY);
        for (uint256 tokenId = 1; tokenId <= CANARY_SUPPLY; ++tokenId) {
            require(collection.ownerOf(tokenId) == deployer, "R9 R6: owner");
            require(collection.isRevealed(tokenId), "R9 R6: hidden token");

            uint256 recipe = collection.recipeForToken(tokenId);
            require(recipe < CANARY_SUPPLY, "R9 R6: recipe range");
            require(!seen[recipe], "R9 R6: duplicate recipe");
            seen[recipe] = true;

            require(data.readRecipe(recipe).length == 2, "R9 R6: DNA length");
            require(bytes(collection.renderToken(tokenId)).length != 0, "R9 R6: empty SVG");
            require(bytes(collection.tokenURI(tokenId)).length != 0, "R9 R6: empty tokenURI");
        }
    }
}
