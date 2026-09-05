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

/// @notice Launches a disposable real Sepolia V2 collection using real code-backed art/DNA shards,
///         mints the first half hidden, and requests the first real Chainlink delayed-reveal word.
contract LaunchCanarySepoliaV2R9 is R9SepoliaV2Base {
    function run()
        external
        returns (
            RelicCollectionV2 collection,
            RelicProjectDataV1 data,
            RelicMintPhasesV2 phases,
            uint256 delayedLocalRequestId,
            uint256 delayedUpstreamRequestId
        )
    {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicForgeFactoryV2 factory = RelicForgeFactoryV2(_deploymentAddress("factory"));
        RelicForgeCanonicalRegistryV2 registry = RelicForgeCanonicalRegistryV2(_deploymentAddress("canonicalRegistry"));
        RelicForgeReserveV2 reserve = RelicForgeReserveV2(payable(_deploymentAddress("reserve")));
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            RelicChainlinkVRFV25DirectAdapterV2(_deploymentAddress("randomnessAdapter"));

        require(factory.infrastructureReady(), "R9: infrastructure not ready");

        vm.startBroadcast(deployerKey);

        RelicForgeFactoryV2.LaunchConfig memory launch = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic Forge V2 R9 Sepolia Canary",
            symbol: "RFV2R9",
            description: "Disposable real Sepolia V2 delayed-to-Forge canary",
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

        (address collectionAddress, address dataAddress) = factory.createCollectionV2(launch);
        collection = RelicCollectionV2(payable(collectionAddress));
        data = RelicProjectDataV1(dataAddress);
        phases = RelicMintPhasesV2(factory.mintPhasesForCollection(collectionAddress));

        bytes memory bgDark = bytes('<rect id="bg-dark" x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory bgLight = bytes('<rect id="bg-light" x="0" y="0" width="32" height="32" fill="#eee"/>');
        bytes memory orb = bytes('<circle id="orb" cx="16" cy="16" r="8" fill="#f90"/>');
        bytes memory slash = bytes('<path id="slash" d="M4 28L28 4" stroke="#09f" stroke-width="4"/>');

        address artShardA = data.addArtShard(abi.encodePacked(bgDark, bgLight));
        address artShardB = data.addArtShard(abi.encodePacked(orb, slash));

        require(
            bgDark.length <= type(uint32).max && bgLight.length <= type(uint32).max && orb.length <= type(uint32).max
                && slash.length <= type(uint32).max,
            "R9: trait length"
        );

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

        data.setPlaceholder(bytes('<rect id="placeholder" x="0" y="0" width="32" height="32" fill="#777"/>'));

        address dnaShardA = data.addDnaShard(hex"00000100");
        address dnaShardB = data.addDnaShard(hex"00010101");
        data.setDNAConfig(CANARY_SUPPLY, 2);
        data.validateNextRecipes(CANARY_SUPPLY);

        bytes32 provenance = keccak256("Relic Forge V2 R9 Ethereum Sepolia real canary");
        data.sealContent(provenance);

        uint32 phaseId =
            phases.createPhase(0, 0, 0, CANARY_SUPPLY, CANARY_SUPPLY, bytes32(0), phases.ACCESS_PUBLIC(), 100, true);
        phases.setMasterMintEnabled(true);

        (uint256 mintFeeWei, bool oracleHealthy, bool feeActive) = phases.platformMintFeeQuote(2);
        require(oracleHealthy, "R9: mint fee oracle unhealthy");
        require(feeActive && mintFeeWei != 0, "R9: minter fee inactive");

        bytes32[] memory emptyProof = new bytes32[](0);
        collection.mint{value: mintFeeWei}(phaseId, 2, 0, emptyProof);

        delayedLocalRequestId = collection.requestDelayedReveal();

        vm.stopBroadcast();

        delayedUpstreamRequestId = adapter.upstreamRequestIdForLocalRequest(delayedLocalRequestId);

        require(delayedLocalRequestId != 0 && delayedUpstreamRequestId != 0, "R9: delayed request missing");
        require(collection.totalMinted() == 2, "R9: initial minted count");
        require(collection.totalCommitted() == 2, "R9: initial committed count");
        require(!collection.delayedRevealed(), "R9: reveal unexpectedly synchronous");
        require(data.contentSealed(), "R9: data not sealed");
        require(data.provenanceHash() == provenance, "R9: provenance");
        require(artShardA.code.length > 1 && artShardB.code.length > 1, "R9: art shards");
        require(dnaShardA.code.length > 1 && dnaShardB.code.length > 1, "R9: DNA shards");

        require(factory.isRelicForgeCollection(address(collection)), "R9: factory registry");
        require(registry.isCanonicalCollection(address(collection)), "R9: provider registry");
        require(reserve.canonicalCollection(address(collection)), "R9: reserve registry");

        _assertMinimalProxy(address(collection), _deploymentAddress("collectionImplementation"));
        _assertMinimalProxy(address(data), _deploymentAddress("dataImplementation"));
        _assertMinimalProxy(address(phases), _deploymentAddress("mintPhasesImplementation"));

        vm.createDir(_manifestDir(), true);
        string memory key = "r9-sepolia-canary-stage1";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "collection", address(collection));
        vm.serializeAddress(key, "projectData", address(data));
        vm.serializeAddress(key, "mintPhases", address(phases));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeAddress(key, "reserve", address(reserve));
        vm.serializeAddress(key, "artShardA", artShardA);
        vm.serializeAddress(key, "artShardB", artShardB);
        vm.serializeAddress(key, "dnaShardA", dnaShardA);
        vm.serializeAddress(key, "dnaShardB", dnaShardB);
        vm.serializeBytes32(key, "provenanceHash", provenance);
        vm.serializeUint(key, "phaseId", phaseId);
        vm.serializeUint(key, "initialMintFeeWei", mintFeeWei);
        vm.serializeUint(key, "delayedLocalRequestId", delayedLocalRequestId);
        string memory json = vm.serializeUint(key, "delayedUpstreamRequestId", delayedUpstreamRequestId);

        vm.writeJson(json, _canaryStage1Path());
    }
}
