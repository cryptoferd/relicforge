// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./TestBase.sol";
import "../../contracts/production/RFCoreV1.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicRandomnessMockV1.sol";

contract RelicForgeV1Test is TestBase {
    RelicCollectionV1 internal collection;
    RelicProjectDataV1 internal data;
    RelicRandomnessMockV1 internal randomness;
    RelicForgeFactoryV1 internal factory;

    address internal constant BOB = address(0xB0B);
    address internal constant PAYOUT = address(0xCAFE);
    address internal constant ROYALTY = address(0xFEE);

    function setUp() public {
        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicRendererV1 renderer = new RelicRendererV1();
        randomness = new RelicRandomnessMockV1();
        factory = new RelicForgeFactoryV1(address(collectionImpl), address(dataImpl), address(renderer), address(randomness));

        (address collectionAddress, address dataAddress) = factory.createCollection(
            "Relic Test", "RLT", "V1 test", 2, 32, 32, 1, PAYOUT, ROYALTY, 500
        );
        collection = RelicCollectionV1(collectionAddress);
        data = RelicProjectDataV1(dataAddress);
        _configureAndSealData();
        vm.deal(BOB, 10 ether);
    }

    function _configureAndSealData() internal {
        bytes memory trait0 = bytes('<rect x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory trait1 = bytes('<rect x="0" y="0" width="32" height="32" fill="#eee"/>');
        bytes memory art = abi.encodePacked(trait0, trait1);
        address shard = data.addArtShard(art);

        RelicProjectDataV1.TraitInput[] memory inputs = new RelicProjectDataV1.TraitInput[](2);
        inputs[0] = RelicProjectDataV1.TraitInput(0, 0, "Dark", shard, 0, uint32(trait0.length), 0, false);
        inputs[1] = RelicProjectDataV1.TraitInput(0, 1, "Light", shard, uint32(trait0.length), uint32(trait1.length), 0, false);
        data.addTraits(inputs);

        string[] memory names = new string[](1);
        names[0] = "Background";
        data.setLayerNames(names);
        bool[] memory hidden = new bool[](1);
        data.setLayerMetadataVisibility(hidden);
        data.setPlaceholder(bytes('<rect x="0" y="0" width="32" height="32" fill="#777"/>'));
        data.addDnaShard(hex"0001");
        data.setDNAConfig(2, 2);
        data.validateNextRecipes(2);
        data.sealContent(keccak256("relicforge-v1-test"));
    }

    function _createPublicPhase(uint96 price, uint64 startTime) internal returns (uint32) {
        return collection.createPhase(price, startTime, 0, 0, 0, bytes32(0), 0, 100, true);
    }

    function testCollectionStartsPaused() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        vm.expectRevert(RF_PublicSalePaused.selector);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));
    }

    function testDynamicPhaseSchedule() public {
        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp + 1 days));
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_PhaseNotStarted.selector);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));

        collection.updatePhase(phase, 1 ether, uint64(block.timestamp), 0, 0, 0, bytes32(0), 0, 100);
        vm.prank(BOB);
        collection.mint{value: 1 ether}(phase, 1, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 1, "dynamic start should permit mint");
    }

    function testHybridEpochThenForgeOutOfOrderFulfillment() public {
        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0)); // token 1 deferred
        collection.requestRevealEpoch(); // request 1 / sequence 1

        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0)); // token 2 forge / request 2

        randomness.fulfill(2, 222); // later Forge callback arrives first
        collection.processReveal(10);
        assertTrue(!collection.isRevealed(2), "sequence 2 must wait for sequence 1");

        randomness.fulfill(1, 111);
        collection.processReveal(10);

        assertTrue(collection.isRevealed(1), "epoch token should reveal");
        assertTrue(collection.isRevealed(2), "forge token should reveal");
        uint256 recipe1 = collection.recipeForToken(1);
        uint256 recipe2 = collection.recipeForToken(2);
        assertNotEq(recipe1, recipe2, "shared pool must never duplicate recipes");
    }

    function testRenouncePreservesRoyaltyAndPayout() public {
        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        collection.renounceControl();
        assertEq(collection.controller(), address(0), "controller must be burned");
        assertEq(collection.payoutReceiver(), PAYOUT, "payout survives renounce");
        (address receiver, uint256 amount) = collection.royaltyInfo(1, 1 ether);
        assertEq(receiver, ROYALTY, "royalty receiver survives renounce");
        assertEq(amount, 0.05 ether, "royalty bps survives renounce");

        vm.expectRevert(RF_Renounced.selector);
        collection.setMasterMintEnabled(true);
    }
}
