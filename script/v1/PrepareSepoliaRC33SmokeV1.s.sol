// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./SepoliaRC33Base.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

contract PrepareSepoliaRC33SmokeV1 is SepoliaRC33Base {
    function run()
        external
        returns (
            RelicCollectionV1 collection,
            RelicProjectDataV1 data,
            uint256 localRequestId,
            uint256 upstreamRequestId
        )
    {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 simulationGasPrice = vm.envUint("RC33_SIM_GAS_PRICE_WEI");
        require(simulationGasPrice != 0, "RC33: zero simulation gas price");
        vm.txGasPrice(simulationGasPrice);

        RelicForgeFactoryV1 factory =
            RelicForgeFactoryV1(_deploymentAddress("factory"));
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter =
            RelicChainlinkVRFV25DirectFundingAdapterV1(payable(_deploymentAddress("adapter")));

        require(adapter.factory() == address(factory), "RC33: unbound adapter");
        require(factory.randomnessProvider() == address(adapter), "RC33: wrong provider");
        require(adapter.quoteRequestPrice() <= MAX_REQUEST_PRICE_WEI, "RC33: quote above ceiling");

        vm.startBroadcast(deployerKey);

        (address collectionAddress, address dataAddress) = factory.createCollection(
            "RelicForge RC3.3 Sepolia Probe",
            "RF33",
            "Disposable live Chainlink VRF v2.5 integration probe",
            2,
            32,
            32,
            1,
            deployer,
            deployer,
            500
        );

        collection = RelicCollectionV1(collectionAddress);
        data = RelicProjectDataV1(dataAddress);

        bytes memory traitA = bytes('<rect width="32" height="32" fill="#111"/>');
        bytes memory traitB = bytes('<circle cx="16" cy="16" r="12" fill="#eee"/>');
        bytes memory art = bytes.concat(traitA, traitB);

        address artShard = data.addArtShard(art);

        require(traitA.length <= type(uint32).max && traitB.length <= type(uint32).max, "RC33: trait too large");
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 traitALength = uint32(traitA.length);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 traitBLength = uint32(traitB.length);

        RelicProjectDataV1.TraitInput[] memory inputs =
            new RelicProjectDataV1.TraitInput[](2);

        inputs[0] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 0,
            name: "Obsidian",
            shard: artShard,
            offset: 0,
            length: traitALength,
            encoding: 0,
            hiddenFromMetadata: false
        });

        inputs[1] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 1,
            name: "Ivory",
            shard: artShard,
            offset: traitALength,
            length: traitBLength,
            encoding: 0,
            hiddenFromMetadata: false
        });

        data.addTraits(inputs);

        string[] memory layerNames = new string[](1);
        layerNames[0] = "Relic";
        data.setLayerNames(layerNames);

        bool[] memory hiddenLayers = new bool[](1);
        hiddenLayers[0] = false;
        data.setLayerMetadataVisibility(hiddenLayers);

        data.setPlaceholder(bytes('<rect width="32" height="32" fill="#777"/>'));
        data.addDnaShard(hex"0001");
        data.setDNAConfig(2, 2);
        data.validateNextRecipes(2);
        data.sealContent(keccak256("RelicForge RC3.3 Ethereum Sepolia live probe v1"));

        collection.setFutureRevealMode(1); // REVEAL_FORGE

        // Fully fund up to the immutable single-request spend ceiling. Only the actual
        // wrapper request cost is consumed; FinalizeSepoliaRC33SmokeV1 returns the remainder.
        adapter.fundConsumer{value: MAX_REQUEST_PRICE_WEI}(address(collection));

        // Broadcast simulation can reset transaction context between scripted transactions.
        // Re-apply the real Sepolia gas price immediately before the billable VRF request.
        vm.txGasPrice(simulationGasPrice);

        localRequestId = adapter.nextRequestId();
        collection.creatorMint(deployer, 1);

        vm.stopBroadcast();

        upstreamRequestId = adapter.localToUpstreamRequestId(localRequestId);
        uint256 requestCost = adapter.requestCost(localRequestId);

        require(upstreamRequestId != 0, "RC33: no upstream request id");
        require(requestCost != 0 && requestCost <= MAX_REQUEST_PRICE_WEI, "RC33: invalid request cost");
        require(collection.ownerOf(1) == deployer, "RC33: probe owner mismatch");
        require(!collection.isRevealed(1), "RC33: unexpectedly synchronous reveal");

        vm.createDir(_manifestDir(), true);
        string memory objectKey = "rc33-smoke";

        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "deployer", deployer);
        vm.serializeAddress(objectKey, "factory", address(factory));
        vm.serializeAddress(objectKey, "adapter", address(adapter));
        vm.serializeAddress(objectKey, "collection", address(collection));
        vm.serializeAddress(objectKey, "projectData", address(data));
        vm.serializeUint(objectKey, "localRequestId", localRequestId);
        vm.serializeUint(objectKey, "upstreamRequestId", upstreamRequestId);
        vm.serializeUint(objectKey, "requestCostWei", requestCost);
        string memory json = vm.serializeUint(objectKey, "fundedCreditWei", MAX_REQUEST_PRICE_WEI);

        vm.writeJson(json, _smokePath());
    }
}
