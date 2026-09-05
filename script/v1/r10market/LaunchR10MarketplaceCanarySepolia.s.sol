// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R10MarketplaceSepoliaBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

contract LaunchR10MarketplaceCanarySepolia is R10MarketplaceSepoliaBase {
    function run() external returns (RelicCollectionV2 collection, RelicProjectDataV1 data, RelicMintPhasesV2 phases) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicForgeFactoryV2 factory = RelicForgeFactoryV2(_deploymentAddress("factory"));
        RelicForgeCanonicalRegistryV2 registry = RelicForgeCanonicalRegistryV2(_deploymentAddress("canonicalRegistry"));
        RelicForgeReserveV2 reserve = RelicForgeReserveV2(payable(_deploymentAddress("reserve")));

        require(factory.infrastructureReady(), "R10M: infrastructure not ready");

        vm.startBroadcast(deployerKey);

        RelicForgeFactoryV2.LaunchConfig memory cfg = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic Forge V2 R10 Marketplace Canary",
            symbol: "RFV2R10",
            description: "Sepolia standards and marketplace compatibility canary",
            maxSupply: CANARY_SUPPLY,
            canvasWidth: 32,
            canvasHeight: 32,
            layerCount: 2,
            payoutReceiver: deployer,
            royaltyReceiver: deployer,
            royaltyBps: 500,
            feeMode: factory.FEE_MODE_MINTER_SUPPORTED(),
            initialRevealMode: factory.REVEAL_DEFERRED(),
            batchWindowSeconds: COLLECTION_BATCH_WINDOW_SECONDS,
            maxRandomnessCostPerBatchWei: COLLECTION_MAX_RANDOMNESS_COST_WEI
        });

        (address collectionAddress, address dataAddress) = factory.createCollectionV2(cfg);
        collection = RelicCollectionV2(payable(collectionAddress));
        data = RelicProjectDataV1(dataAddress);
        phases = RelicMintPhasesV2(factory.mintPhasesForCollection(collectionAddress));

        bytes memory bgDark = bytes('<rect x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory bgLight = bytes('<rect x="0" y="0" width="32" height="32" fill="#eee"/>');
        bytes memory orb = bytes('<circle cx="16" cy="16" r="8" fill="#f90"/>');
        bytes memory slash = bytes('<path d="M4 28L28 4" stroke="#09f" stroke-width="4"/>');

        address artShardA = data.addArtShard(abi.encodePacked(bgDark, bgLight));
        address artShardB = data.addArtShard(abi.encodePacked(orb, slash));

        RelicProjectDataV1.TraitInput[] memory traits = new RelicProjectDataV1.TraitInput[](4);
        traits[0] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 0,
            name: "Dark",
            shard: artShardA,
            offset: 0,
            length: uint32(bgDark.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[1] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 1,
            name: "Light",
            shard: artShardA,
            offset: uint32(bgDark.length),
            length: uint32(bgLight.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[2] = RelicProjectDataV1.TraitInput({
            layer: 1,
            index: 0,
            name: "Orb",
            shard: artShardB,
            offset: 0,
            length: uint32(orb.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[3] = RelicProjectDataV1.TraitInput({
            layer: 1,
            index: 1,
            name: "Slash",
            shard: artShardB,
            offset: uint32(orb.length),
            length: uint32(slash.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        data.addTraits(traits);

        string[] memory layerNames = new string[](2);
        layerNames[0] = "Background";
        layerNames[1] = "Glyph";
        data.setLayerNames(layerNames);

        bool[] memory hiddenLayers = new bool[](2);
        data.setLayerMetadataVisibility(hiddenLayers);

        data.setPlaceholder(bytes('<rect x="0" y="0" width="32" height="32" fill="#777"/>'));

        address dnaShard = data.addDnaShard(hex"00000101");
        data.setDNAConfig(CANARY_SUPPLY, 2);
        data.validateNextRecipes(CANARY_SUPPLY);

        bytes32 provenance = keccak256("Relic Forge V2 R10 marketplace compatibility canary");
        data.sealContent(provenance);

        uint32 phaseId =
            phases.createPhase(0, 0, 0, CANARY_SUPPLY, CANARY_SUPPLY, bytes32(0), phases.ACCESS_PUBLIC(), 100, true);
        phases.setMasterMintEnabled(true);

        (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(CANARY_SUPPLY);
        require(oracleHealthy, "R10M: mint fee oracle unhealthy");
        require(feeActive && mintFeeWei != 0, "R10M: minter fee inactive");

        bytes32[] memory emptyProof = new bytes32[](0);
        collection.mint{value: mintFeeWei}(phaseId, CANARY_SUPPLY, 0, emptyProof);

        vm.stopBroadcast();

        require(collection.totalSupply() == CANARY_SUPPLY, "R10M: totalSupply after mint");
        require(collection.totalMinted() == CANARY_SUPPLY, "R10M: totalMinted after mint");
        require(collection.maxSupply() == CANARY_SUPPLY, "R10M: maxSupply");
        require(collection.owner() == deployer, "R10M: ERC173 owner");
        require(!collection.delayedRevealRequested(), "R10M: reveal request unexpectedly created");
        require(data.contentSealed(), "R10M: data not sealed");

        require(collection.supportsInterface(0x01ffc9a7), "R10M: ERC165");
        require(collection.supportsInterface(0x80ac58cd), "R10M: ERC721");
        require(collection.supportsInterface(0x5b5e139f), "R10M: ERC721 metadata");
        require(collection.supportsInterface(0x2a55205a), "R10M: ERC2981");
        require(collection.supportsInterface(0x49064906), "R10M: ERC4906");
        require(collection.supportsInterface(0x7f5828d0), "R10M: ERC173");
        require(!collection.supportsInterface(0x780e9d63), "R10M: enumerable falsely claimed");

        require(factory.isRelicForgeCollection(address(collection)), "R10M: factory registry");
        require(registry.isCanonicalCollection(address(collection)), "R10M: provider registry");
        require(reserve.canonicalCollection(address(collection)), "R10M: reserve registry");

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));

        vm.createDir(_manifestDir(), true);
        string memory key = "r10-marketplace-canary";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "projectData", address(data));
        vm.serializeAddress(key, "mintPhases", address(phases));
        vm.serializeAddress(key, "randomnessAdapter", _deploymentAddress("randomnessAdapter"));
        vm.serializeAddress(key, "reserve", address(reserve));
        vm.serializeAddress(key, "artShardA", artShardA);
        vm.serializeAddress(key, "artShardB", artShardB);
        vm.serializeAddress(key, "dnaShard", dnaShard);
        vm.serializeBytes32(key, "provenanceHash", provenance);
        vm.serializeUint(key, "phaseId", phaseId);
        vm.serializeUint(key, "mintFeeWei", mintFeeWei);
        string memory json = vm.serializeUint(key, "mintedSupply", CANARY_SUPPLY);

        vm.writeJson(json, _canaryPath());
    }
}
