// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

/// @notice Pure read-only certification of the final live Sepolia canary state.
contract VerifyCanarySepoliaV2R9 is R9SepoliaV2Base {
    function run() external view {
        _assertSepolia();

        address deployer = _stage1Address("deployer");
        RelicForgeFactoryV2 factory = RelicForgeFactoryV2(_deploymentAddress("factory"));
        RelicForgeCanonicalRegistryV2 registry = RelicForgeCanonicalRegistryV2(_deploymentAddress("canonicalRegistry"));
        RelicForgeReserveV2 reserve = RelicForgeReserveV2(payable(_deploymentAddress("reserve")));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_deploymentAddress("randomnessAdapter"));

        RelicCollectionV2 collection = RelicCollectionV2(payable(_stage1Address("collection")));
        RelicProjectDataV1 data = RelicProjectDataV1(_stage1Address("projectData"));
        RelicMintPhasesV2 phases = RelicMintPhasesV2(_stage1Address("mintPhases"));

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));

        require(factory.infrastructureReady(), "R9 verify: infrastructure");
        require(factory.isRelicForgeCollection(address(collection)), "R9 verify: factory canonical");
        require(factory.dataForCollection(address(collection)) == address(data), "R9 verify: data mapping");
        require(factory.mintPhasesForCollection(address(collection)) == address(phases), "R9 verify: phases mapping");
        require(registry.isCanonicalCollection(address(collection)), "R9 verify: registry canonical");
        require(reserve.canonicalCollection(address(collection)), "R9 verify: reserve canonical");

        require(data.creator() == deployer, "R9 verify: data creator");
        require(data.contentSealed(), "R9 verify: data seal");
        require(data.maxSupply() == CANARY_SUPPLY, "R9 verify: data supply");
        require(data.provenanceHash() != bytes32(0), "R9 verify: provenance");

        require(collection.creator() == deployer, "R9 verify: collection creator");
        require(collection.controller() == deployer, "R9 verify: controller");
        require(collection.maxSupply() == CANARY_SUPPLY, "R9 verify: supply");
        require(collection.delayedRevealed(), "R9 verify: delayed reveal");
        require(collection.hybridForgeActive(), "R9 verify: hybrid");
        require(collection.totalMinted() == CANARY_SUPPLY, "R9 verify: minted");
        require(collection.totalAssignedRecipes() == CANARY_SUPPLY, "R9 verify: assigned");
        require(collection.completed(), "R9 verify: completion");

        uint256 delayedLocal = _stage1Uint("delayedLocalRequestId");
        uint256 forgeLocal = _stage2Uint("forgeLocalRequestId");
        require(adapter.wordReadyForLocalRequest(delayedLocal), "R9 verify: delayed word");
        require(adapter.deliveredForLocalRequest(delayedLocal), "R9 verify: delayed delivery");
        require(adapter.wordReadyForLocalRequest(forgeLocal), "R9 verify: Forge word");
        require(adapter.deliveredForLocalRequest(forgeLocal), "R9 verify: Forge delivery");

        bool[] memory seen = new bool[](CANARY_SUPPLY);
        for (uint256 tokenId = 1; tokenId <= CANARY_SUPPLY; ++tokenId) {
            require(collection.ownerOf(tokenId) == deployer, "R9 verify: owner");
            uint256 recipe = collection.recipeForToken(tokenId);
            require(recipe < CANARY_SUPPLY && !seen[recipe], "R9 verify: recipe");
            seen[recipe] = true;
            require(bytes(collection.tokenURI(tokenId)).length != 0, "R9 verify: tokenURI");
            require(bytes(collection.renderToken(tokenId)).length != 0, "R9 verify: render");
        }
    }
}
