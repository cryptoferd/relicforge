// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";

contract R12V2FeePolicyMock {
    uint32 public sponsoredFeeCents = 25;
    uint32 public minterFeeCents = 50;
    address public platformAdmin = address(0xA11CE);
    address public treasury = address(0x7EA5);

    function collectionFeesEnabled(address) external pure returns (bool) {
        return true;
    }

    function currentCollectionFeeCents(address, uint32 lockedFeeCents) external pure returns (uint32) {
        return lockedFeeCents;
    }

    function quoteUsdCents(uint256 usdCents) external pure returns (uint256 nativeAmount, bool oracleHealthy) {
        return (usdCents * 0.00001 ether, true);
    }

    function quoteSponsoredFee(uint32 maxSupply)
        external
        pure
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        return (uint256(maxSupply) * 25 * 0.00001 ether, true, true);
    }

    function quoteMintFee(address, uint32 lockedFeeCents, uint32 quantity)
        external
        pure
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        return (uint256(lockedFeeCents) * quantity * 0.00001 ether, true, lockedFeeCents != 0);
    }
}

contract R12V2ProjectDataMock {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed = true;

    constructor(address creator_, uint32 maxSupply_) {
        creator = creator_;
        maxSupply = maxSupply_;
    }
}

contract R12V2RendererMock {
    function tokenURI(address, uint256 tokenId) external pure returns (string memory) {
        tokenId;
        return "data:application/json;base64,e30=";
    }

    function contractURI(address) external pure returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function renderToken(address, uint256) external pure returns (string memory) {
        return "<svg/>";
    }
}

contract R12V2ReserveMock {
    function factory() external pure returns (address) {
        return address(0);
    }

    function canonicalCollection(address) external pure returns (bool) {
        return true;
    }

    function registerCollection(address) external {}
    function syncCollection(address) external {}

    function fundRandomnessShortfall(uint64, uint256) external {
        revert("unexpected reserve draw");
    }

    function depositFromCollection() external payable {}
}

contract R12V2CanonicalRegistryMock is IRelicCanonicalCollectionRegistryR12 {
    mapping(address => bool) public canonical;

    function setCanonical(address collection, bool value) external {
        canonical[collection] = value;
    }

    function isCanonicalCollection(address collection) external view returns (bool) {
        return canonical[collection];
    }
}

contract ForgeRevealV2R12ProductionStackTest is TestBase {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    address internal constant ALICE = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA5);

    function _clone(address implementation) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(implementation),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly ("memory-safe") {
            instance := create(0, add(code, 0x20), mload(code))
        }
        require(instance != address(0), "clone failed");
    }

    function testR12V2FactoryCreatesIndependentCanonicalMinimalProxyCollections() public {
        vm.chainId(SEPOLIA_CHAIN_ID);

        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicMintPhasesV2 mintPhasesImpl = new RelicMintPhasesV2();
        R12V2RendererMock renderer = new R12V2RendererMock();
        R12V2FeePolicyMock feePolicy = new R12V2FeePolicyMock();

        RelicForgeCanonicalRegistryV2 registry = new RelicForgeCanonicalRegistryV2();
        RelicForgeReserveV2 reserve =
            new RelicForgeReserveV2(address(this), payable(TREASURY), 0, 0, 20_000, 0.01 ether, 10 ether);

        RelicChainlinkVRFV25WrapperMockV2 wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        RelicForgeFactoryV2 factory = new RelicForgeFactoryV2(
            address(collectionImpl),
            address(dataImpl),
            address(mintPhasesImpl),
            address(renderer),
            address(adapter),
            address(registry),
            address(reserve),
            address(feePolicy)
        );

        registry.bindFactory(address(factory));
        reserve.bindFactory(address(factory));
        assertTrue(factory.infrastructureReady(), "factory infrastructure bound");

        vm.prank(ALICE);
        RelicForgeFactoryV2.LaunchConfig memory launchA = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic A",
            symbol: "RA",
            description: "A",
            maxSupply: 100,
            canvasWidth: 32,
            canvasHeight: 32,
            layerCount: 2,
            payoutReceiver: ALICE,
            royaltyReceiver: ALICE,
            royaltyBps: 500,
            feeMode: 2,
            initialRevealMode: 0,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        (address collectionA, address dataA) = factory.createCollectionV2(launchA);

        vm.prank(ALICE);
        RelicForgeFactoryV2.LaunchConfig memory launchB = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic B",
            symbol: "RB",
            description: "B",
            maxSupply: 50,
            canvasWidth: 32,
            canvasHeight: 32,
            layerCount: 2,
            payoutReceiver: ALICE,
            royaltyReceiver: ALICE,
            royaltyBps: 500,
            feeMode: 2,
            initialRevealMode: 1,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        (address collectionB, address dataB) = factory.createCollectionV2(launchB);

        assertTrue(collectionA != collectionB, "unique collection clone addresses");
        assertTrue(dataA != dataB, "unique data clone addresses");
        assertEq(collectionA.code.length, 45, "collection is EIP-1167 minimal proxy");
        assertEq(dataA.code.length, 45, "project data is EIP-1167 minimal proxy");
        address phasesA = factory.mintPhasesForCollection(collectionA);
        assertEq(phasesA.code.length, 45, "mint phases is EIP-1167 minimal proxy");
        assertEq(RelicMintPhasesV2(phasesA).controller(), ALICE, "creator controls sale clone");

        assertTrue(factory.isRelicForgeCollection(collectionA), "factory registry A");
        assertTrue(factory.isRelicForgeCollection(collectionB), "factory registry B");
        assertTrue(registry.isCanonicalCollection(collectionA), "provider registry A");
        assertTrue(reserve.canonicalCollection(collectionA), "reserve registry A");

        assertEq(RelicCollectionV2(payable(collectionA)).creator(), ALICE, "creator owns clone A");
        assertEq(
            uint256(RelicCollectionV2(payable(collectionA)).nextReservationId()),
            1,
            "clone reservation sentinel initialized"
        );
        assertEq(
            uint256(RelicCollectionV2(payable(collectionA)).openBatchId()), 1, "clone open batch sentinel initialized"
        );
        assertEq(
            uint256(RelicCollectionV2(payable(collectionA)).nextSettleBatchId()), 1, "clone settle sentinel initialized"
        );
        assertEq(RelicCollectionV2(payable(collectionB)).creator(), ALICE, "creator owns clone B");
        assertEq(factory.creatorCollectionCount(ALICE), 2, "creator collection index");
    }

    function testR12V2DelayedRevealThenAutomaticForgeUsesComplementWithoutDuplicates() public {
        vm.chainId(SEPOLIA_CHAIN_ID);

        uint32 supply = 5;
        RelicCollectionV2 implementation = new RelicCollectionV2();
        R12V2ProjectDataMock data = new R12V2ProjectDataMock(address(this), supply);
        R12V2RendererMock renderer = new R12V2RendererMock();
        R12V2ReserveMock reserve = new R12V2ReserveMock();
        R12V2FeePolicyMock feePolicy = new R12V2FeePolicyMock();

        RelicChainlinkVRFV25WrapperMockV2 wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        R12V2CanonicalRegistryMock registry = new R12V2CanonicalRegistryMock();
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        RelicMintPhasesV2 mintPhasesImplementation = new RelicMintPhasesV2();
        address clone = _clone(address(implementation));
        address mintPhasesClone = _clone(address(mintPhasesImplementation));
        RelicCollectionV2 collection = RelicCollectionV2(payable(clone));
        RelicMintPhasesV2(mintPhasesClone).initialize(address(collection), address(this), address(feePolicy), 2, 50);
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "Hybrid",
            symbol: "HYB",
            description: "Hybrid reveal",
            creator: address(this),
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(adapter),
            forgeReserve: address(reserve),
            feePolicy: address(feePolicy),
            mintPhases: mintPhasesClone,
            maxSupply: supply,
            payoutReceiver: address(this),
            royaltyReceiver: address(this),
            royaltyBps: 500,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: 0,
            batchWindowSeconds: 3,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        collection.initialize(init);
        registry.setCanonical(address(collection), true);

        RelicMintPhasesV2 phases = RelicMintPhasesV2(collection.mintPhases());
        phases.createPhase(0, 0, 0, supply, supply, bytes32(0), 0, 1, true);
        phases.setMasterMintEnabled(true);

        uint256 perTokenFee = 50 * 0.00001 ether;
        vm.deal(ALICE, 1 ether);

        vm.prank(ALICE);
        collection.mint{value: perTokenFee * 3}(1, 3, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 3, "three hidden ERC721s minted immediately");
        assertEq(collection.totalCommitted(), 3, "three supply committed");
        assertFalse(collection.isRevealed(1), "starts hidden");
        assertEq(wrapper.nextRequestId(), 1, "collector mint did not call Chainlink");

        uint256 delayedLocalRequest = collection.requestDelayedReveal();
        assertEq(delayedLocalRequest, 1, "delayed reveal request id");
        assertEq(wrapper.nextRequestId(), 2, "executor created one upstream request");

        assertTrue(wrapper.fulfill(1, 0xBEEF), "Chainlink callback stores adapter word");
        assertFalse(collection.delayedRevealed(), "upstream callback did not call collection");

        assertTrue(adapter.replayFulfillment(1), "permissionless delayed reveal replay");
        assertTrue(collection.delayedRevealed(), "delayed reveal completed");
        assertEq(collection.futureRevealMode(), 1, "future mints auto-switched to Forge");
        assertTrue(collection.hybridForgeActive(), "hybrid complement deck active");

        uint256 r1 = collection.recipeForToken(1);
        uint256 r2 = collection.recipeForToken(2);
        uint256 r3 = collection.recipeForToken(3);
        assertTrue(r1 != r2 && r1 != r3 && r2 != r3, "delayed recipes unique");

        vm.prank(ALICE);
        collection.mint{value: perTokenFee * 2}(1, 2, 0, new bytes32[](0));

        assertEq(collection.totalCommitted(), 5, "sellout committed");
        assertEq(collection.totalMinted(), 3, "Forge reservations are not placeholder NFTs");

        assertEq(uint256(collection.openBatchId()), 2, "sellout closes final partial Forge batch");
        (,,,,,,,,, bool batchLocked,, bool batchSettled) = collection.batches(1);
        assertTrue(batchLocked, "batch 1 locked before VRF request");
        assertFalse(batchSettled, "batch 1 not settled before VRF");

        uint256 forgeLocalRequest = collection.requestRandomnessForBatch(1);
        assertEq(forgeLocalRequest, 2, "second local VRF request");

        assertTrue(wrapper.fulfill(2, 0xCAFE), "second upstream callback stores word");
        assertTrue(adapter.replayFulfillment(2), "permissionless Forge word replay");
        assertEq(collection.totalMinted(), 3, "word delivery still does not settle NFTs");

        uint32 settled = collection.settleReady(20);
        assertEq(settled, 2, "two Forge NFTs settled");
        assertEq(collection.totalMinted(), 5, "full collection minted");
        assertEq(collection.balanceOf(ALICE), 5, "collector owns all five");

        bool[] memory seen = new bool[](supply);
        for (uint256 tokenId = 1; tokenId <= supply; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < supply, "recipe in range");
            assertFalse(seen[recipe], "recipe cannot duplicate across delayed + Forge");
            seen[recipe] = true;
        }

        assertTrue(collection.completed(), "collection complete");
        assertEq(collection.totalAssignedRecipes(), supply, "all recipes consumed exactly once");
    }

    function testR12V2RevealRequestFreezesDeferredMintsUntilExactWordReplay() public {
        vm.chainId(SEPOLIA_CHAIN_ID);

        uint32 supply = 10;
        RelicCollectionV2 implementation = new RelicCollectionV2();
        R12V2ProjectDataMock data = new R12V2ProjectDataMock(address(this), supply);
        R12V2RendererMock renderer = new R12V2RendererMock();
        R12V2ReserveMock reserve = new R12V2ReserveMock();
        R12V2FeePolicyMock feePolicy = new R12V2FeePolicyMock();

        RelicChainlinkVRFV25WrapperMockV2 wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        R12V2CanonicalRegistryMock registry = new R12V2CanonicalRegistryMock();
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        RelicMintPhasesV2 mintPhasesImplementation = new RelicMintPhasesV2();
        address clone = _clone(address(implementation));
        address mintPhasesClone = _clone(address(mintPhasesImplementation));
        RelicCollectionV2 collection = RelicCollectionV2(payable(clone));
        RelicMintPhasesV2(mintPhasesClone).initialize(address(collection), address(this), address(feePolicy), 2, 50);
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "Freeze",
            symbol: "FRZ",
            description: "Freeze",
            creator: address(this),
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(adapter),
            forgeReserve: address(reserve),
            feePolicy: address(feePolicy),
            mintPhases: mintPhasesClone,
            maxSupply: supply,
            payoutReceiver: address(this),
            royaltyReceiver: address(this),
            royaltyBps: 0,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: 0,
            batchWindowSeconds: 3,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        collection.initialize(init);
        registry.setCanonical(address(collection), true);

        RelicMintPhasesV2 phases = RelicMintPhasesV2(collection.mintPhases());
        phases.createPhase(0, 0, 0, supply, supply, bytes32(0), 0, 1, true);
        phases.setMasterMintEnabled(true);

        uint256 fee = 50 * 0.00001 ether;
        vm.deal(ALICE, 1 ether);
        vm.prank(ALICE);
        collection.mint{value: fee}(1, 1, 0, new bytes32[](0));

        collection.requestDelayedReveal();

        vm.prank(ALICE);
        vm.expectRevert(RFV2_DelayedRevealPendingProd.selector);
        collection.mint{value: fee}(1, 1, 0, new bytes32[](0));

        assertTrue(wrapper.fulfill(1, 12345), "word reaches adapter");
        assertFalse(collection.delayedRevealed(), "still frozen before replay");
        assertTrue(adapter.replayFulfillment(1), "same stored word replayed");
        assertTrue(collection.delayedRevealed(), "replay unlocks Forge future minting");
    }

    function testR12V2AdapterFailsClosedOnWrongChain() public {
        vm.chainId(31337);

        RelicChainlinkVRFV25WrapperMockV2 wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        R12V2CanonicalRegistryMock registry = new R12V2CanonicalRegistryMock();
        RelicChainlinkVRFV25DirectAdapterV2 adapter =
            new RelicChainlinkVRFV25DirectAdapterV2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        vm.expectRevert(RFV2_WrongTargetChainR12.selector);
        adapter.quoteRequestPrice(400_000);
    }

    function testR12V2PermutationCoversTenThousandRecipesWithoutDuplicates() public pure {
        uint256 supply = 10_000;
        (uint256 multiplier, uint256 offset) = RFRevealPermutationV2.derive(0xDEADBEEF, supply);
        bool[] memory seen = new bool[](supply);

        for (uint256 i; i < supply; ++i) {
            uint256 recipe = RFRevealPermutationV2.permute(i, supply, multiplier, offset);
            require(!seen[recipe], "duplicate recipe");
            seen[recipe] = true;
        }
    }
}
