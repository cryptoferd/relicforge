// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R10MarketplaceSepoliaBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

contract VerifyR10MarketplaceCanarySepolia is R10MarketplaceSepoliaBase {
    function run() external view {
        _assertSepolia();

        address deployer = _canaryAddress("deployer");
        RelicCollectionV2 collection = RelicCollectionV2(payable(_canaryAddress("collection")));
        RelicProjectDataV1 data = RelicProjectDataV1(_canaryAddress("projectData"));
        RelicMintPhasesV2 phases = RelicMintPhasesV2(_canaryAddress("mintPhases"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_canaryAddress("randomnessAdapter"));

        uint256 localRequestId = _requestUint("localRequestId");

        require(collection.totalSupply() == CANARY_SUPPLY, "R10M: totalSupply");
        require(collection.totalMinted() == CANARY_SUPPLY, "R10M: totalMinted");
        require(collection.totalCommitted() == CANARY_SUPPLY, "R10M: totalCommitted");
        require(collection.maxSupply() == CANARY_SUPPLY, "R10M: maxSupply");
        require(collection.owner() == deployer, "R10M: owner");
        require(collection.controller() == deployer, "R10M: controller");
        require(phases.controller() == deployer, "R10M: phases controller");

        require(collection.delayedRevealRequested(), "R10M: request flag");
        require(collection.delayedRevealed(), "R10M: reveal flag");
        require(adapter.wordReadyForLocalRequest(localRequestId), "R10M: word not ready");
        require(adapter.deliveredForLocalRequest(localRequestId), "R10M: word not delivered");

        require(collection.supportsInterface(0x01ffc9a7), "R10M: ERC165");
        require(collection.supportsInterface(0x80ac58cd), "R10M: ERC721");
        require(collection.supportsInterface(0x5b5e139f), "R10M: ERC721 metadata");
        require(collection.supportsInterface(0x2a55205a), "R10M: ERC2981");
        require(collection.supportsInterface(0x49064906), "R10M: ERC4906");
        require(collection.supportsInterface(0x7f5828d0), "R10M: ERC173");
        require(!collection.supportsInterface(0x780e9d63), "R10M: enumerable claim");

        require(data.contentSealed(), "R10M: data unsealed");
        require(bytes(collection.contractURI()).length != 0, "R10M: contractURI");

        bool[] memory seen = new bool[](CANARY_SUPPLY);
        for (uint256 tokenId = 1; tokenId <= CANARY_SUPPLY; ++tokenId) {
            require(collection.ownerOf(tokenId) == deployer, "R10M: ownerOf");
            require(collection.isRevealed(tokenId), "R10M: token hidden");

            uint256 recipe = collection.recipeForToken(tokenId);
            require(recipe < CANARY_SUPPLY, "R10M: recipe range");
            require(!seen[recipe], "R10M: duplicate recipe");
            seen[recipe] = true;

            require(bytes(collection.tokenURI(tokenId)).length != 0, "R10M: tokenURI");
            require(bytes(collection.renderToken(tokenId)).length != 0, "R10M: renderToken");
        }

        (address royaltyReceiver, uint256 royaltyAmount) = collection.royaltyInfo(1, 1 ether);
        require(royaltyReceiver == deployer, "R10M: royalty receiver");
        require(royaltyAmount == 0.05 ether, "R10M: royalty amount");

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));
    }
}
