// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./TestBase.sol";
import "../../contracts/production/RFCoreV1.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicRandomnessMockV1.sol";

contract RevealInvariantHandlerV1 {
    uint32 public constant SUPPLY = 12;
    address public constant HOLDER = address(0xBEEF);

    RelicCollectionV1 public collection;
    RelicProjectDataV1 public data;
    RelicRandomnessMockV1 public randomness;

    constructor(RelicForgeFactoryV1 factory, RelicRandomnessMockV1 randomness_) {
        randomness = randomness_;
        (address c, address d) = factory.createCollection(
            "Invariant", "INV", "stateful invariant target", SUPPLY, 32, 32, 1,
            address(0xCAFE), address(0xFEE), 500
        );
        collection = RelicCollectionV1(c);
        data = RelicProjectDataV1(d);
        _configure();
    }

    function _configure() internal {
        bytes memory trait0 = bytes('<rect width="32" height="32" fill="#111"/>');
        bytes memory trait1 = bytes('<rect width="32" height="32" fill="#eee"/>');
        address shard = data.addArtShard(abi.encodePacked(trait0, trait1));
        RelicProjectDataV1.TraitInput[] memory inputs = new RelicProjectDataV1.TraitInput[](2);
        inputs[0] = RelicProjectDataV1.TraitInput(0, 0, "A", shard, 0, uint32(trait0.length), 0, false);
        inputs[1] = RelicProjectDataV1.TraitInput(0, 1, "B", shard, uint32(trait0.length), uint32(trait1.length), 0, false);
        data.addTraits(inputs);
        string[] memory names = new string[](1);
        names[0] = "Layer";
        data.setLayerNames(names);
        bool[] memory hidden = new bool[](1);
        data.setLayerMetadataVisibility(hidden);
        data.setPlaceholder(bytes('<rect width="32" height="32"/>'));
        bytes memory dna = new bytes(SUPPLY);
        for (uint256 i; i < SUPPLY; ++i) dna[i] = bytes1(uint8(i % 2));
        data.addDnaShard(dna);
        data.setDNAConfig(SUPPLY, uint16(SUPPLY));
        data.validateNextRecipes(SUPPLY);
        data.sealContent(keccak256("invariant"));
    }

    function actionMint(uint256 rawQuantity, uint256 rawMode) external {
        if (collection.totalMinted() >= SUPPLY) return;
        uint8 mode = uint8(rawMode % 2);
        collection.setFutureRevealMode(mode);
        uint32 remaining = SUPPLY - collection.totalMinted();
        uint32 quantity = uint32(1 + (rawQuantity % 4));
        if (quantity > remaining) quantity = remaining;
        collection.creatorMint(HOLDER, quantity);
    }

    function actionRequestEpoch() external {
        if (collection.deferredPendingCount() == 0) return;
        try collection.requestRevealEpoch() returns (uint64 sequence, uint256 requestId) { sequence; requestId; } catch {}
    }

    function actionFulfill(uint256 rawRequest, uint256 seed) external {
        uint256 next = randomness.nextRequestId();
        if (next <= 1) return;
        uint256 id = 1 + (rawRequest % (next - 1));
        try randomness.fulfill(id, seed) {} catch {}
    }

    function actionProcess(uint256 rawSteps) external {
        uint32 steps = uint32(1 + (rawSteps % 24));
        try collection.processReveal(steps) {} catch {}
    }

    function actionSetMode(uint256 rawMode) external {
        collection.setFutureRevealMode(uint8(rawMode % 2));
    }
}

contract RelicForgeStatefulInvariantTest is TestBase {
    RevealInvariantHandlerV1 internal handler;
    RelicCollectionV1 internal collection;
    address[] private _targetedContracts;

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function setUp() public {
        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicRendererV1 renderer = new RelicRendererV1();
        RelicRandomnessMockV1 randomness = new RelicRandomnessMockV1();
        RelicForgeFactoryV1 factory = new RelicForgeFactoryV1(
            address(collectionImpl), address(dataImpl), address(renderer), address(randomness)
        );
        handler = new RevealInvariantHandlerV1(factory, randomness);
        collection = handler.collection();
        _targetedContracts.push(address(handler));
    }

    function invariantSupplyAndAssignmentsNeverExceedBounds() public view {
        uint256 minted = collection.totalMinted();
        uint256 assigned = collection.totalAssignedRecipes();
        require(minted <= handler.SUPPLY(), "supply exceeded");
        require(assigned <= minted, "more recipes than tokens");
        require(collection.deferredPendingCount() <= minted, "deferred count exceeds minted");
    }

    function invariantAssignedRecipesAreUniqueAndInRange() public view {
        uint256 minted = collection.totalMinted();
        bool[] memory seen = new bool[](handler.SUPPLY() + 1);
        uint256 counted;
        for (uint256 tokenId = 1; tokenId <= minted; ++tokenId) {
            uint256 plusOne = collection.assignedRecipePlusOne(tokenId);
            if (plusOne == 0) continue;
            require(plusOne <= handler.SUPPLY(), "recipe out of range");
            require(!seen[plusOne], "duplicate recipe assignment");
            seen[plusOne] = true;
            ++counted;
        }
        require(counted == collection.totalAssignedRecipes(), "assignment counter mismatch");
    }

    function invariantEveryMintedTokenHasAnOwner() public view {
        uint256 minted = collection.totalMinted();
        for (uint256 tokenId = 1; tokenId <= minted; ++tokenId) {
            require(collection.ownerOf(tokenId) != address(0), "minted token missing owner");
        }
    }
}
