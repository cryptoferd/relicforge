// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RFCoreV1.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicRendererV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";

contract R12V2R8FeePolicyMock {
    uint32 public sponsoredFeeCents;
    uint32 public minterFeeCents;
    address public platformAdmin = address(0xA11CE);
    address public treasury = address(0x7EA5);

    function collectionFeesEnabled(address) external pure returns (bool) {
        return false;
    }

    function currentCollectionFeeCents(address, uint32) external pure returns (uint32) {
        return 0;
    }

    function quoteUsdCents(uint256) external pure returns (uint256 nativeAmount, bool oracleHealthy) {
        return (0, true);
    }

    function quoteSponsoredFee(uint32) external pure returns (uint256 feeWei, bool oracleHealthy, bool feeActive) {
        return (0, true, false);
    }

    function quoteMintFee(address, uint32, uint32)
        external
        pure
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        return (0, true, false);
    }
}

/// @notice R8 compatibility certification:
///         exact V1 ProjectData shard machinery + exact V1 Renderer + V2 Factory/Collection.
contract ForgeRevealV2R12V2ShardingCompatibilityTest is TestBase {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    uint32 internal constant SUPPLY = 4;

    RelicCollectionV2 internal collectionImplementation;
    RelicProjectDataV1 internal dataImplementation;
    RelicMintPhasesV2 internal mintPhasesImplementation;
    RelicRendererV1 internal renderer;
    R12V2R8FeePolicyMock internal feePolicy;
    RelicForgeCanonicalRegistryV2 internal registry;
    RelicForgeReserveV2 internal reserve;
    RelicChainlinkVRFV25WrapperMockV2 internal wrapper;
    RelicChainlinkVRFV25DirectAdapterV2 internal adapter;
    RelicForgeFactoryV2 internal factory;

    RelicCollectionV2 internal collection;
    RelicProjectDataV1 internal data;
    RelicMintPhasesV2 internal phases;

    address internal artShardA;
    address internal artShardB;
    address internal dnaShardA;
    address internal dnaShardB;

    function setUp() public {
        vm.chainId(SEPOLIA_CHAIN_ID);
        vm.deal(address(this), 100 ether);

        collectionImplementation = new RelicCollectionV2();
        dataImplementation = new RelicProjectDataV1();
        mintPhasesImplementation = new RelicMintPhasesV2();
        renderer = new RelicRendererV1();
        feePolicy = new R12V2R8FeePolicyMock();
        registry = new RelicForgeCanonicalRegistryV2();

        reserve = new RelicForgeReserveV2{value: 1 ether}(
            address(this), payable(address(0x7EA5)), 0, 0, 20_000, 0.02 ether, 1 ether
        );

        wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        adapter = new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        factory = new RelicForgeFactoryV2(
            address(collectionImplementation),
            address(dataImplementation),
            address(mintPhasesImplementation),
            address(renderer),
            address(adapter),
            address(registry),
            address(reserve),
            address(feePolicy)
        );

        registry.bindFactory(address(factory));
        reserve.bindFactory(address(factory));

        RelicForgeFactoryV2.LaunchConfig memory launch = RelicForgeFactoryV2.LaunchConfig({
            name: "R8 Sharded Relic",
            symbol: "R8SR",
            description: "V1 shards rendered by V2",
            maxSupply: SUPPLY,
            canvasWidth: 32,
            canvasHeight: 32,
            layerCount: 2,
            payoutReceiver: address(this),
            royaltyReceiver: address(this),
            royaltyBps: 500,
            feeMode: 2,
            initialRevealMode: 0,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });

        (address collectionAddress, address dataAddress) = factory.createCollectionV2(launch);
        collection = RelicCollectionV2(payable(collectionAddress));
        data = RelicProjectDataV1(dataAddress);
        phases = RelicMintPhasesV2(factory.mintPhasesForCollection(collectionAddress));

        _configureRealShardedData();

        phases.createPhase(0, 0, 0, SUPPLY, SUPPLY, bytes32(0), 0, 100, true);
        phases.setMasterMintEnabled(true);
    }

    function _configureRealShardedData() internal {
        // Two distinct immutable art shards, exactly as Studio/V1 ProjectData expects.
        bytes memory bgDark = bytes('<rect id="bg-dark" x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory bgLight = bytes('<rect id="bg-light" x="0" y="0" width="32" height="32" fill="#eee"/>');
        bytes memory orb = bytes('<circle id="orb" cx="16" cy="16" r="8" fill="#f90"/>');
        bytes memory slash = bytes('<path id="slash" d="M4 28L28 4" stroke="#09f" stroke-width="4"/>');

        artShardA = data.addArtShard(abi.encodePacked(bgDark, bgLight));
        artShardB = data.addArtShard(abi.encodePacked(orb, slash));

        RelicProjectDataV1.TraitInput[] memory traits = new RelicProjectDataV1.TraitInput[](4);
        traits[0] = RelicProjectDataV1.TraitInput(0, 0, "Dark", artShardA, 0, uint32(bgDark.length), 0, false);
        traits[1] = RelicProjectDataV1.TraitInput(
            0, 1, "Light", artShardA, uint32(bgDark.length), uint32(bgLight.length), 0, false
        );
        traits[2] = RelicProjectDataV1.TraitInput(1, 0, "Orb", artShardB, 0, uint32(orb.length), 0, false);
        traits[3] =
            RelicProjectDataV1.TraitInput(1, 1, "Slash", artShardB, uint32(orb.length), uint32(slash.length), 0, false);
        data.addTraits(traits);

        string[] memory layerNames = new string[](2);
        layerNames[0] = "Background";
        layerNames[1] = "Glyph";
        data.setLayerNames(layerNames);

        bool[] memory hidden = new bool[](2);
        data.setLayerMetadataVisibility(hidden);

        data.setPlaceholder(bytes('<rect id="placeholder" x="0" y="0" width="32" height="32" fill="#777"/>'));

        // Four 2-byte recipes split across TWO immutable DNA shards:
        //   0 -> Dark  + Orb
        //   1 -> Light + Orb
        //   2 -> Dark  + Slash
        //   3 -> Light + Slash
        dnaShardA = data.addDnaShard(hex"00000100");
        dnaShardB = data.addDnaShard(hex"00010101");
        data.setDNAConfig(SUPPLY, 2);
        data.validateNextRecipes(SUPPLY);
        data.sealContent(keccak256("R12-v2-R8-real-shard-compatibility"));
    }

    function testR8FactoryClonesEncodeExactCertifiedImplementations() public view {
        _assertMinimalProxy(address(collection), address(collectionImplementation), "collection clone target");
        _assertMinimalProxy(address(data), address(dataImplementation), "data clone target");
        _assertMinimalProxy(address(phases), address(mintPhasesImplementation), "phase clone target");

        assertEq(factory.dataForCollection(address(collection)), address(data), "factory data registry");
        assertEq(factory.mintPhasesForCollection(address(collection)), address(phases), "factory phases registry");
        assertTrue(factory.isRelicForgeCollection(address(collection)), "factory canonical collection");
        assertTrue(registry.isCanonicalCollection(address(collection)), "provider canonical collection");
        assertTrue(reserve.canonicalCollection(address(collection)), "reserve canonical collection");
    }

    function testR8MainBranchShardPipelineRendersThroughV2DelayedAndForgeReveal() public {
        assertTrue(data.contentSealed(), "real project data sealed");
        assertEq(data.provenanceHash(), keccak256("R12-v2-R8-real-shard-compatibility"), "provenance");
        assertGt(artShardA.code.length, 1, "art shard A code-backed");
        assertGt(artShardB.code.length, 1, "art shard B code-backed");
        assertGt(dnaShardA.code.length, 1, "dna shard A code-backed");
        assertGt(dnaShardB.code.length, 1, "dna shard B code-backed");

        assertEq(keccak256(data.readRecipe(0)), keccak256(hex"0000"), "recipe 0 shard read");
        assertEq(keccak256(data.readRecipe(1)), keccak256(hex"0100"), "recipe 1 shard read");
        assertEq(keccak256(data.readRecipe(2)), keccak256(hex"0001"), "recipe 2 shard read");
        assertEq(keccak256(data.readRecipe(3)), keccak256(hex"0101"), "recipe 3 shard read");

        string memory placeholder = renderer.renderPlaceholder(address(data));
        assertTrue(_contains(placeholder, 'id="placeholder"'), "placeholder shard rendered");

        // First half: normal hidden deferred NFTs.
        collection.mint(1, 2, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 2, "two deferred NFTs minted");
        assertFalse(collection.isRevealed(1), "token 1 hidden before reveal");
        assertTrue(_startsWith(collection.tokenURI(1), "data:application/json;base64,"), "hidden tokenURI");

        uint256 delayedLocalRequest = collection.requestDelayedReveal();
        uint256 delayedUpstreamRequest = adapter.upstreamRequestIdForLocalRequest(delayedLocalRequest);
        assertTrue(wrapper.fulfill(delayedUpstreamRequest, 0xA11CE), "delayed word stored upstream");
        assertFalse(collection.delayedRevealed(), "provider callback remains storage-only");
        assertTrue(adapter.replayFulfillment(delayedLocalRequest), "exact delayed word replayed");
        assertTrue(collection.delayedRevealed(), "delayed reveal completed");
        assertEq(uint256(collection.futureRevealMode()), 1, "unsold future mints switched to Forge");

        // Second half: future mints reserve supply, then settle from a fresh exact VRF word.
        collection.mint(1, 2, 0, new bytes32[](0));
        assertEq(collection.totalCommitted(), SUPPLY, "sellout committed");
        assertEq(collection.totalMinted(), 2, "Forge reservations are not placeholder NFTs");

        uint256 forgeLocalRequest = collection.requestRandomnessForBatch(1);
        uint256 forgeUpstreamRequest = adapter.upstreamRequestIdForLocalRequest(forgeLocalRequest);
        assertTrue(wrapper.fulfill(forgeUpstreamRequest, 0xB0B), "Forge word stored upstream");
        assertTrue(adapter.replayFulfillment(forgeLocalRequest), "exact Forge word replayed");
        assertEq(uint256(collection.settleReady(20)), 2, "two Forge NFTs settled");
        assertEq(collection.totalMinted(), SUPPLY, "full supply minted");

        bool[] memory seen = new bool[](SUPPLY);
        for (uint256 tokenId = 1; tokenId <= SUPPLY; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < SUPPLY, "recipe in range");
            assertFalse(seen[recipe], "no delayed/Forge recipe duplicate");
            seen[recipe] = true;

            bytes memory dna = data.readRecipe(recipe);
            assertEq(dna.length, 2, "two-layer DNA preserved");

            string memory svg = collection.renderToken(tokenId);
            assertTrue(_startsWith(svg, "<svg"), "renderer returned SVG");
            assertTrue(
                _contains(svg, uint8(dna[0]) == 0 ? 'id="bg-dark"' : 'id="bg-light"'),
                "background trait read from art shard"
            );
            assertTrue(
                _contains(svg, uint8(dna[1]) == 0 ? 'id="orb"' : 'id="slash"'), "glyph trait read from art shard"
            );
            assertTrue(_startsWith(collection.tokenURI(tokenId), "data:application/json;base64,"), "revealed tokenURI");
        }

        assertTrue(collection.completed(), "hybrid collection completed");
        assertEq(collection.totalAssignedRecipes(), SUPPLY, "every recipe assigned exactly once");

        vm.expectRevert(RF_ContentSealed.selector);
        data.addArtShard(bytes("immutable-after-seal"));
    }

    function _assertMinimalProxy(address proxy, address expectedImplementation, string memory message) internal view {
        bytes memory expectedRuntime = abi.encodePacked(
            hex"363d3d373d3d3d363d73", bytes20(expectedImplementation), hex"5af43d82803e903d91602b57fd5bf3"
        );

        assertEq(proxy.code.length, 45, message);
        assertEq(keccak256(proxy.code), keccak256(expectedRuntime), message);
    }

    function _startsWith(string memory value, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(value);
        bytes memory b = bytes(prefix);
        if (b.length > a.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _contains(string memory value, string memory needle) internal pure returns (bool) {
        bytes memory a = bytes(value);
        bytes memory b = bytes(needle);
        if (b.length == 0) return true;
        if (b.length > a.length) return false;

        uint256 limit = a.length - b.length;
        for (uint256 i; i <= limit; ++i) {
            bool match_ = true;
            for (uint256 j; j < b.length; ++j) {
                if (a[i + j] != b[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) return true;
        }
        return false;
    }
}
