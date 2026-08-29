// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./TestBase.sol";
import "../../contracts/production/RFCoreV1.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicRandomnessMockV1.sol";
import "../../contracts/production/RelicForgeFeePolicyV1.sol";

contract MockRFFeePriceFeedV1 is IRFAggregatorV3V1 {
    uint8 public immutable override decimals = 8;
    int256 public answer = 2_000e8;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;
    uint256 public updatedAt;
    bool public shouldRevert;

    constructor() { updatedAt = block.timestamp; }

    function setAnswer(int256 answer_) external {
        answer = answer_;
        ++roundId;
        answeredInRound = roundId;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external { updatedAt = updatedAt_; }

    function setAnsweredInRound(uint80 value) external { answeredInRound = value; }

    function setShouldRevert(bool value) external { shouldRevert = value; }

    function latestRoundData()
        external view override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (shouldRevert) revert("mock oracle revert");
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

abstract contract RelicForgeV1Fixture is TestBase {
    uint32 internal constant SUPPLY = 16;

    RelicCollectionV1 internal collection;
    RelicProjectDataV1 internal data;
    RelicRandomnessMockV1 internal randomness;
    RelicForgeFactoryV1 internal factory;
    RelicRendererV1 internal renderer;
    RelicForgeFeePolicyV1 internal feePolicy;
    MockRFFeePriceFeedV1 internal feePriceFeed;

    address internal constant BOB = address(0xB0B);
    address internal constant ALICE = address(0xA11CE);
    address internal constant CAROL = address(0xCA501);
    address internal constant PAYOUT = address(0xCAFE);
    address internal constant ROYALTY = address(0xFEE);
    address internal constant PLATFORM_ADMIN = address(0xFEEA);
    address internal constant FEE_TREASURY = address(0xFEEBEEF);

    function setUp() public virtual {
        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        renderer = new RelicRendererV1();
        randomness = new RelicRandomnessMockV1();

        feePriceFeed = new MockRFFeePriceFeedV1();
        feePolicy = new RelicForgeFeePolicyV1(
            PLATFORM_ADMIN,
            FEE_TREASURY,
            address(feePriceFeed),
            1 days
        );

        // Existing security suites remain fee-neutral. PlatformFeeSecurityTest explicitly enables fees.
        vm.prank(PLATFORM_ADMIN);
        feePolicy.setFeesEnabled(false);

        factory = new RelicForgeFactoryV1(
            address(collectionImpl),
            address(dataImpl),
            address(renderer),
            address(randomness)
        );
        factory.bindFeePolicy(address(feePolicy));

        (address collectionAddress, address dataAddress) = factory.createCollection(
            "Relic Test", "RLT", "V1 test", SUPPLY, 32, 32, 1, PAYOUT, ROYALTY, 500
        );
        collection = RelicCollectionV1(collectionAddress);
        data = RelicProjectDataV1(dataAddress);
        _configureAndSealData(data, SUPPLY);

        vm.deal(address(this), 100 ether);
        vm.deal(BOB, 100 ether);
        vm.deal(ALICE, 100 ether);
        vm.deal(CAROL, 100 ether);
        vm.deal(PLATFORM_ADMIN, 100 ether);
    }

    function _configureAndSealData(RelicProjectDataV1 target, uint32 supply) internal {
        bytes memory trait0 = bytes('<rect x="0" y="0" width="32" height="32" fill="#111"/>');
        bytes memory trait1 = bytes('<rect x="0" y="0" width="32" height="32" fill="#eee"/>');
        bytes memory art = abi.encodePacked(trait0, trait1);
        address shard = target.addArtShard(art);

        RelicProjectDataV1.TraitInput[] memory inputs = new RelicProjectDataV1.TraitInput[](2);
        inputs[0] = RelicProjectDataV1.TraitInput(0, 0, "Dark", shard, 0, uint32(trait0.length), 0, false);
        inputs[1] = RelicProjectDataV1.TraitInput(0, 1, "Light", shard, uint32(trait0.length), uint32(trait1.length), 0, false);
        target.addTraits(inputs);

        string[] memory names = new string[](1);
        names[0] = "Background";
        target.setLayerNames(names);
        bool[] memory hidden = new bool[](1);
        target.setLayerMetadataVisibility(hidden);
        target.setPlaceholder(bytes('<rect x="0" y="0" width="32" height="32" fill="#777"/>'));

        bytes memory dna = new bytes(supply);
        for (uint256 i; i < supply; ++i) dna[i] = bytes1(uint8(i % 2));
        target.addDnaShard(dna);
        target.setDNAConfig(supply, uint16(supply));

        uint32 left = supply;
        while (left != 0) {
            uint32 batch = left > target.MAX_VALIDATE_BATCH() ? target.MAX_VALIDATE_BATCH() : left;
            target.validateNextRecipes(batch);
            left -= batch;
        }
        target.sealContent(keccak256(abi.encode("relicforge-v1-fixture", supply)));
    }

    function _newUnsealed(uint32 supply, uint8 layers)
        internal returns (RelicCollectionV1 c, RelicProjectDataV1 d)
    {
        (address cAddr, address dAddr) = factory.createCollection(
            "Unsealed", "UNS", "unsealed", supply, 32, 32, layers, PAYOUT, ROYALTY, 500
        );
        c = RelicCollectionV1(cAddr);
        d = RelicProjectDataV1(dAddr);
    }

    function _createPublicPhase(uint96 price, uint64 startTime) internal returns (uint32) {
        return collection.createPhase(price, startTime, 0, 0, 0, bytes32(0), collection.ACCESS_PUBLIC(), 100, true);
    }

    function _createPublicPhaseWithLimits(uint96 price, uint32 phaseSupply, uint32 maxPerWallet)
        internal returns (uint32)
    {
        return collection.createPhase(
            price, uint64(block.timestamp), 0, phaseSupply, maxPerWallet, bytes32(0), collection.ACCESS_PUBLIC(), 100, true
        );
    }

    function _leaf(address c, uint32 phaseId, address wallet, uint32 allowance) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, c, phaseId, wallet, allowance));
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b)
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    function _fulfillAll(uint256 seedBase) internal {
        uint256 end = randomness.nextRequestId();
        for (uint256 id = 1; id < end; ++id) {
            (,,, bool ready,) = randomness.deliveries(id);
            if (!ready) randomness.fulfill(id, uint256(keccak256(abi.encode(seedBase, id))));
        }
    }
}