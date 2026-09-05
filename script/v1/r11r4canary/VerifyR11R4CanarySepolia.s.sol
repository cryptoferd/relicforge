// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R11R4SepoliaBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

contract VerifyR11R4CanarySepolia is R11R4SepoliaBase {
    function run() external view {
        _assertSepolia();

        address deployer = _canaryAddress("deployer");
        RelicCollectionV2 collection = RelicCollectionV2(payable(_canaryAddress("collection")));
        RelicProjectDataV1 data = RelicProjectDataV1(_canaryAddress("projectData"));
        RelicMintPhasesV2 phases = RelicMintPhasesV2(_canaryAddress("mintPhases"));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_canaryAddress("randomnessAdapter"));
        RelicForgeFeePolicyV1 feePolicy = RelicForgeFeePolicyV1(payable(_canaryAddress("feePolicy")));
        RelicForgeReserveV2 reserve = RelicForgeReserveV2(payable(_canaryAddress("reserve")));

        uint256 localRequestId = collection.delayedRevealRequestId();

        require(collection.totalSupply() == CANARY_SUPPLY, "R11R4C: totalSupply");
        require(collection.totalMinted() == CANARY_SUPPLY, "R11R4C: totalMinted");
        require(collection.totalCommitted() == CANARY_SUPPLY, "R11R4C: totalCommitted");
        require(collection.maxSupply() == CANARY_SUPPLY, "R11R4C: maxSupply");
        require(collection.owner() == deployer, "R11R4C: owner");
        require(collection.controller() == deployer, "R11R4C: controller");
        require(phases.controller() == deployer, "R11R4C: phases controller");

        require(collection.delayedRevealRequested(), "R11R4C: request flag");
        require(collection.delayedRevealed(), "R11R4C: reveal flag");
        require(localRequestId != 0, "R11R4C: local request");
        require(adapter.wordReadyForLocalRequest(localRequestId), "R11R4C: word not ready");
        require(adapter.deliveredForLocalRequest(localRequestId), "R11R4C: word not delivered");

        require(collection.supportsInterface(0x01ffc9a7), "R11R4C: ERC165");
        require(collection.supportsInterface(0x80ac58cd), "R11R4C: ERC721");
        require(collection.supportsInterface(0x5b5e139f), "R11R4C: metadata");
        require(collection.supportsInterface(0x2a55205a), "R11R4C: ERC2981");
        require(collection.supportsInterface(0x49064906), "R11R4C: ERC4906");
        require(collection.supportsInterface(0x7f5828d0), "R11R4C: ERC173");
        require(collection.supportsInterface(0xe8a3d485), "R11R4C: ERC7572");
        require(!collection.supportsInterface(0x780e9d63), "R11R4C: enumerable");
        require(!collection.supportsInterface(0xffffffff), "R11R4C: invalid ERC165");

        require(data.contentSealed(), "R11R4C: data unsealed");
        require(bytes(collection.contractURI()).length != 0, "R11R4C: contractURI");

        bool[] memory seen = new bool[](CANARY_SUPPLY);
        for (uint256 tokenId = 1; tokenId <= CANARY_SUPPLY; ++tokenId) {
            require(collection.ownerOf(tokenId) == deployer, "R11R4C: ownerOf");
            require(collection.isRevealed(tokenId), "R11R4C: token hidden");

            uint256 recipe = collection.recipeForToken(tokenId);
            require(recipe < CANARY_SUPPLY, "R11R4C: recipe range");
            require(!seen[recipe], "R11R4C: duplicate recipe");
            seen[recipe] = true;

            require(bytes(collection.tokenURI(tokenId)).length != 0, "R11R4C: tokenURI");
            require(bytes(collection.renderToken(tokenId)).length != 0, "R11R4C: renderToken");
        }

        (address royaltyReceiver, uint256 royaltyAmount) = collection.royaltyInfo(1, 1 ether);
        require(royaltyReceiver == deployer, "R11R4C: royalty receiver");
        require(royaltyAmount == 0.05 ether, "R11R4C: royalty amount");

        require(feePolicy.platformAdmin() == deployer, "R11R4C: fee admin");
        require(feePolicy.treasury() == deployer, "R11R4C: fee treasury");
        require(feePolicy.pendingTreasury() == address(0), "R11R4C: pending fee treasury");
        require(feePolicy.pendingPlatformAdmin() == address(0), "R11R4C: pending fee admin");

        require(reserve.founder() == deployer, "R11R4C: reserve founder");
        require(reserve.revenueTreasury() == deployer, "R11R4C: reserve treasury");
        require(reserve.pendingRevenueTreasury() == address(0), "R11R4C: pending reserve treasury");
        require(reserve.pendingFounder() == address(0), "R11R4C: pending reserve founder");

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));
    }
}
