// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R11R4SepoliaBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

contract LaunchR11R4CanarySepolia is R11R4SepoliaBase {
    function run() external returns (RelicCollectionV2 collection, RelicProjectDataV1 data, RelicMintPhasesV2 phases) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicForgeFactoryV2 factory = RelicForgeFactoryV2(_deploymentAddress("factory"));
        RelicForgeCanonicalRegistryV2 registry = RelicForgeCanonicalRegistryV2(_deploymentAddress("canonicalRegistry"));
        RelicForgeReserveV2 reserve = RelicForgeReserveV2(payable(_deploymentAddress("reserve")));

        require(factory.infrastructureReady(), "R11R4C: infrastructure");

        vm.startBroadcast(deployerKey);

        RelicForgeFactoryV2.LaunchConfig memory cfg = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic Forge R11 R4 ERC7572 Canary",
            symbol: "RFR4",
            description: "Sepolia immutable-proxy standards and adversarial-hardening canary",
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

        bytes memory bgA = bytes('<rect x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory bgB = bytes('<rect x="0" y="0" width="32" height="32" fill="#ddd"/>');
        bytes memory glyphA = bytes('<circle cx="16" cy="16" r="8" fill="#f90"/>');
        bytes memory glyphB = bytes('<path d="M4 28L28 4" stroke="#09f" stroke-width="4"/>');

        address artShardA = data.addArtShard(abi.encodePacked(bgA, bgB));
        address artShardB = data.addArtShard(abi.encodePacked(glyphA, glyphB));

        RelicProjectDataV1.TraitInput[] memory traits = new RelicProjectDataV1.TraitInput[](4);
        traits[0] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 0,
            name: "Dark",
            shard: artShardA,
            offset: 0,
            length: uint32(bgA.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[1] = RelicProjectDataV1.TraitInput({
            layer: 0,
            index: 1,
            name: "Light",
            shard: artShardA,
            offset: uint32(bgA.length),
            length: uint32(bgB.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[2] = RelicProjectDataV1.TraitInput({
            layer: 1,
            index: 0,
            name: "Orb",
            shard: artShardB,
            offset: 0,
            length: uint32(glyphA.length),
            encoding: 0,
            hiddenFromMetadata: false
        });
        traits[3] = RelicProjectDataV1.TraitInput({
            layer: 1,
            index: 1,
            name: "Slash",
            shard: artShardB,
            offset: uint32(glyphA.length),
            length: uint32(glyphB.length),
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

        bytes32 provenance = keccak256("Relic Forge R11 R4 ERC7572 immutable proxy canary");
        data.sealContent(provenance);

        uint32 phaseId =
            phases.createPhase(0, 0, 0, CANARY_SUPPLY, CANARY_SUPPLY, bytes32(0), phases.ACCESS_PUBLIC(), 100, true);
        phases.setMasterMintEnabled(true);

        (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(CANARY_SUPPLY);
        require(oracleHealthy, "R11R4C: fee oracle");
        require(feeActive && mintFeeWei != 0, "R11R4C: minter fee");

        bytes32[] memory emptyProof = new bytes32[](0);
        collection.mint{value: mintFeeWei}(phaseId, CANARY_SUPPLY, 0, emptyProof);

        vm.stopBroadcast();

        require(collection.totalSupply() == CANARY_SUPPLY, "R11R4C: totalSupply");
        require(collection.totalMinted() == CANARY_SUPPLY, "R11R4C: totalMinted");
        require(collection.owner() == deployer, "R11R4C: owner");
        require(!collection.delayedRevealRequested(), "R11R4C: unexpected request");
        require(data.contentSealed(), "R11R4C: unsealed");

        require(collection.supportsInterface(0x01ffc9a7), "R11R4C: ERC165");
        require(collection.supportsInterface(0x80ac58cd), "R11R4C: ERC721");
        require(collection.supportsInterface(0x5b5e139f), "R11R4C: metadata");
        require(collection.supportsInterface(0x2a55205a), "R11R4C: ERC2981");
        require(collection.supportsInterface(0x49064906), "R11R4C: ERC4906");
        require(collection.supportsInterface(0x7f5828d0), "R11R4C: ERC173");
        require(collection.supportsInterface(0xe8a3d485), "R11R4C: ERC7572");
        require(!collection.supportsInterface(0x780e9d63), "R11R4C: enumerable");
        require(bytes(collection.contractURI()).length != 0, "R11R4C: contractURI");

        require(factory.isRelicForgeCollection(address(collection)), "R11R4C: factory registry");
        require(registry.isCanonicalCollection(address(collection)), "R11R4C: provider registry");
        require(reserve.canonicalCollection(address(collection)), "R11R4C: reserve registry");

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));

        vm.createDir(_manifestDir(), true);
        string memory key = "r11-r4-sepolia-canary";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "projectData", address(data));
        vm.serializeAddress(key, "mintPhases", address(phases));
        vm.serializeAddress(key, "randomnessAdapter", _deploymentAddress("randomnessAdapter"));
        vm.serializeAddress(key, "reserve", address(reserve));
        vm.serializeAddress(key, "feePolicy", _deploymentAddress("feePolicy"));
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
