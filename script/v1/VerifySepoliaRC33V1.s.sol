// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./SepoliaRC33Base.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

contract VerifySepoliaRC33V1 is SepoliaRC33Base {
    function run() external view {
        _assertSepolia();

        string memory deploymentJson = vm.readFile(_deploymentPath());
        string memory smokeJson = vm.readFile(_smokePath());

        address deployer = vm.parseJsonAddress(deploymentJson, ".deployer");
        address collectionImplementation = vm.parseJsonAddress(deploymentJson, ".collectionImplementation");
        address dataImplementation = vm.parseJsonAddress(deploymentJson, ".dataImplementation");
        address renderer = vm.parseJsonAddress(deploymentJson, ".renderer");
        address adapterAddress = vm.parseJsonAddress(deploymentJson, ".adapter");
        address factoryAddress = vm.parseJsonAddress(deploymentJson, ".factory");

        address collectionAddress = vm.parseJsonAddress(smokeJson, ".collection");
        address projectDataAddress = vm.parseJsonAddress(smokeJson, ".projectData");
        uint256 localRequestId = vm.parseJsonUint(smokeJson, ".localRequestId");
        uint256 upstreamRequestId = vm.parseJsonUint(smokeJson, ".upstreamRequestId");

        RelicForgeFactoryV1 factory = RelicForgeFactoryV1(factoryAddress);
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter =
            RelicChainlinkVRFV25DirectFundingAdapterV1(payable(adapterAddress));
        RelicCollectionV1 collection = RelicCollectionV1(collectionAddress);
        RelicProjectDataV1 data = RelicProjectDataV1(projectDataAddress);

        require(collectionImplementation.code.length != 0, "RC33 verify: collection impl missing");
        require(dataImplementation.code.length != 0, "RC33 verify: data impl missing");
        require(renderer.code.length != 0, "RC33 verify: renderer missing");
        require(adapterAddress.code.length != 0, "RC33 verify: adapter missing");
        require(factoryAddress.code.length != 0, "RC33 verify: factory missing");

        require(factory.collectionImplementation() == collectionImplementation, "RC33 verify: collection impl mismatch");
        require(factory.dataImplementation() == dataImplementation, "RC33 verify: data impl mismatch");
        require(factory.renderer() == renderer, "RC33 verify: renderer mismatch");
        require(factory.randomnessProvider() == adapterAddress, "RC33 verify: provider mismatch");

        require(adapter.factory() == factoryAddress, "RC33 verify: adapter factory mismatch");
        require(adapter.bootstrapAuthority() == address(0), "RC33 verify: bootstrap authority alive");
        require(adapter.wrapper() == SEPOLIA_VRF_WRAPPER, "RC33 verify: wrapper mismatch");
        require(adapter.callbackGasLimit() == CALLBACK_GAS_LIMIT, "RC33 verify: callback gas mismatch");
        require(adapter.requestConfirmations() == REQUEST_CONFIRMATIONS, "RC33 verify: confirmations mismatch");
        require(adapter.maxRequestPriceWei() == MAX_REQUEST_PRICE_WEI, "RC33 verify: max price mismatch");

        require(factory.isRelicForgeCollection(collectionAddress), "RC33 verify: collection unregistered");
        require(factory.dataForCollection(collectionAddress) == projectDataAddress, "RC33 verify: data registry mismatch");

        require(data.creator() == deployer, "RC33 verify: data creator mismatch");
        require(data.contentSealed(), "RC33 verify: data unsealed");
        require(data.maxSupply() == 2, "RC33 verify: data supply mismatch");
        require(data.provenanceHash() != bytes32(0), "RC33 verify: missing provenance");

        require(collection.creator() == deployer, "RC33 verify: creator mismatch");
        require(collection.controller() == deployer, "RC33 verify: controller mismatch");
        require(collection.payoutReceiver() == deployer, "RC33 verify: payout mismatch");
        require(collection.randomnessProvider() == adapterAddress, "RC33 verify: collection provider mismatch");
        require(collection.maxSupply() == 2, "RC33 verify: collection supply mismatch");
        require(collection.totalMinted() == 1, "RC33 verify: minted count mismatch");
        require(collection.ownerOf(1) == deployer, "RC33 verify: owner mismatch");
        require(collection.isRevealed(1), "RC33 verify: token not revealed");
        require(collection.recipeForToken(1) < 2, "RC33 verify: recipe out of range");

        (
            address consumer,
            ,
            ,
            bool wordReady,
            bool delivered
        ) = adapter.deliveries(localRequestId);

        require(consumer == collectionAddress, "RC33 verify: delivery consumer mismatch");
        require(wordReady && delivered, "RC33 verify: VRF delivery incomplete");
        require(adapter.localToUpstreamRequestId(localRequestId) == upstreamRequestId, "RC33 verify: request mapping mismatch");
        require(adapter.requestCost(localRequestId) != 0, "RC33 verify: zero request cost");
        require(adapter.requestCost(localRequestId) <= MAX_REQUEST_PRICE_WEI, "RC33 verify: request cost above ceiling");
        require(adapter.nativeCredit(collectionAddress) == 0, "RC33 verify: credit not recovered");

        require(bytes(collection.tokenURI(1)).length != 0, "RC33 verify: empty tokenURI");
        require(bytes(collection.renderToken(1)).length != 0, "RC33 verify: empty render");
    }
}
