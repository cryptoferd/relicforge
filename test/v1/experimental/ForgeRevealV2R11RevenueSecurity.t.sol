// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicForgeV2Core.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

interface IR11R2RandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

contract R11R2DataMock {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed = true;

    constructor(address creator_, uint32 maxSupply_) {
        creator = creator_;
        maxSupply = maxSupply_;
    }
}

contract R11R2RendererMock {
    function tokenURI(address, uint256) external pure returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function contractURI(address) external pure returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function renderToken(address, uint256) external pure returns (string memory) {
        return "<svg/>";
    }
}

contract R11R2ProviderMock {
    uint256 public nextRequestId = 1;
    uint256 public immutable price;

    constructor(uint256 price_) {
        price = price_;
    }

    function quoteRequestPrice(uint32) external view returns (uint256) {
        return price;
    }

    function requestRandomness(uint256, uint32) external payable returns (uint256 requestId) {
        require(msg.value == price, "wrong provider payment");
        requestId = nextRequestId++;
    }

    function deliver(address collection, uint256 requestId, uint256 randomWord) external {
        IR11R2RandomnessConsumer(collection).fulfillRandomness(requestId, randomWord);
    }
}

contract R11R2FeePolicyMock {
    uint256 public immutable feePerToken;

    constructor(uint256 feePerToken_) {
        feePerToken = feePerToken_;
    }

    function collectionFeesEnabled(address) external pure returns (bool) {
        return true;
    }

    function currentCollectionFeeCents(address, uint32 lockedFeeCents) external pure returns (uint32) {
        return lockedFeeCents;
    }

    function quoteUsdCents(uint256 usdCents) external view returns (uint256 nativeAmount, bool oracleHealthy) {
        return ((usdCents * feePerToken) / 50, true);
    }

    function quoteMintFee(address, uint32, uint32 quantity)
        external
        view
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        return (feePerToken * quantity, true, true);
    }
}

contract R11R2FactoryMock {
    address public reserve;

    constructor(address reserve_) {
        reserve = reserve_;
    }

    function register(address collection) external {
        RelicForgeReserveV2(payable(reserve)).registerCollection(collection);
    }
}

contract ForgeRevealV2R11RevenueSecurityTest is TestBase {
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant COLLECTOR = address(0xB0B);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant NEW_TREASURY = address(0xBEEF);
    address internal constant NEW_FOUNDER = address(0xF00D);

    uint256 internal constant MINIMUM_RESERVE = 0.05 ether;
    uint96 internal constant CREATOR_PRICE = 0.02 ether;
    uint256 internal constant PLATFORM_FEE_PER_TOKEN = 0.001 ether;
    uint256 internal constant RANDOMNESS_COST = 0.0005 ether;
    uint256 internal constant MAX_RANDOMNESS_COST = 0.01 ether;
    uint32 internal constant SUPPLY = 2;

    struct Fixture {
        RelicCollectionV2 collection;
        RelicMintPhasesV2 phases;
        RelicForgeReserveV2 reserve;
        R11R2ProviderMock provider;
        R11R2FactoryMock factory;
    }

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

    function _newReserve(address payable treasury)
        internal
        returns (RelicForgeReserveV2 reserve, R11R2FactoryMock factory)
    {
        vm.deal(address(this), 100 ether);
        reserve = new RelicForgeReserveV2{value: MINIMUM_RESERVE}(
            address(this), treasury, MINIMUM_RESERVE, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        factory = new R11R2FactoryMock(address(reserve));
        reserve.bindFactory(address(factory));
    }

    function _fixture() internal returns (Fixture memory f) {
        (f.reserve, f.factory) = _newReserve(payable(TREASURY));

        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicMintPhasesV2 phasesImpl = new RelicMintPhasesV2();
        address collectionAddress = _clone(address(collectionImpl));
        address phasesAddress = _clone(address(phasesImpl));

        R11R2DataMock data = new R11R2DataMock(CREATOR, SUPPLY);
        R11R2RendererMock renderer = new R11R2RendererMock();
        f.provider = new R11R2ProviderMock(RANDOMNESS_COST);
        R11R2FeePolicyMock feePolicy = new R11R2FeePolicyMock(PLATFORM_FEE_PER_TOKEN);

        f.phases = RelicMintPhasesV2(phasesAddress);
        f.phases.initialize(collectionAddress, CREATOR, address(feePolicy), 2, 50);

        f.collection = RelicCollectionV2(payable(collectionAddress));
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "Relic Forge R11 Revenue",
            symbol: "RFR11R2",
            description: "R11 end-to-end platform revenue settlement",
            creator: CREATOR,
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(f.provider),
            forgeReserve: address(f.reserve),
            feePolicy: address(feePolicy),
            mintPhases: address(f.phases),
            maxSupply: SUPPLY,
            payoutReceiver: CREATOR,
            royaltyReceiver: CREATOR,
            royaltyBps: 500,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: 0,
            batchWindowSeconds: 3,
            maxRandomnessCostPerBatchWei: MAX_RANDOMNESS_COST
        });
        f.collection.initialize(init);
        f.factory.register(address(f.collection));

        vm.prank(CREATOR);
        f.phases.createPhase(CREATOR_PRICE, 0, 0, SUPPLY, SUPPLY, bytes32(0), 0, 100, true);
        vm.prank(CREATOR);
        f.phases.setMasterMintEnabled(true);
    }

    function testR11R2OnlyFounderCanProposeTreasuryAndOnlyTargetCanAccept() public {
        (RelicForgeReserveV2 reserve,) = _newReserve(payable(TREASURY));

        vm.prank(COLLECTOR);
        vm.expectRevert();
        reserve.proposeRevenueTreasury(payable(NEW_TREASURY));

        reserve.proposeRevenueTreasury(payable(NEW_TREASURY));
        assertEq(reserve.revenueTreasury(), TREASURY, "proposal cannot redirect funds");
        assertEq(reserve.pendingRevenueTreasury(), NEW_TREASURY, "pending treasury recorded");

        vm.prank(COLLECTOR);
        vm.expectRevert();
        reserve.acceptRevenueTreasury();

        vm.prank(NEW_TREASURY);
        reserve.acceptRevenueTreasury();

        assertEq(reserve.revenueTreasury(), NEW_TREASURY, "target accepted treasury role");
        assertEq(reserve.pendingRevenueTreasury(), address(0), "pending treasury cleared");
    }

    function testR11R2FounderTransferIsTwoStepAndClearsOldPendingTreasuryProposal() public {
        (RelicForgeReserveV2 reserve,) = _newReserve(payable(TREASURY));

        reserve.proposeRevenueTreasury(payable(NEW_TREASURY));
        reserve.proposeFounder(NEW_FOUNDER);

        assertEq(reserve.founder(), address(this), "proposal cannot change founder");
        assertEq(reserve.pendingFounder(), NEW_FOUNDER, "pending founder recorded");

        vm.prank(COLLECTOR);
        vm.expectRevert();
        reserve.acceptFounder();

        vm.prank(NEW_FOUNDER);
        reserve.acceptFounder();

        assertEq(reserve.founder(), NEW_FOUNDER, "new founder accepted role");
        assertEq(reserve.pendingFounder(), address(0), "pending founder cleared");
        assertEq(
            reserve.pendingRevenueTreasury(),
            address(0),
            "old founder treasury proposal cannot survive ownership handoff"
        );

        vm.expectRevert();
        reserve.proposeRevenueTreasury(payable(NEW_TREASURY));
    }

    function testR11R2LegacyOneStepRedirectSelectorsDoNotExist() public {
        (RelicForgeReserveV2 reserve,) = _newReserve(payable(TREASURY));

        (bool treasurySetterExists,) =
            address(reserve).call(abi.encodeWithSignature("setRevenueTreasury(address)", NEW_TREASURY));
        assertFalse(treasurySetterExists, "legacy one-step treasury setter must not exist");

        (bool founderSetterExists,) =
            address(reserve).call(abi.encodeWithSignature("transferFounder(address)", NEW_FOUNDER));
        assertFalse(founderSetterExists, "legacy one-step founder transfer must not exist");

        assertEq(reserve.revenueTreasury(), TREASURY, "failed selectors cannot redirect treasury");
        assertEq(reserve.founder(), address(this), "failed selectors cannot transfer founder");
    }

    function testR11R2PlatformFeesFundRevealThenExactSurplusReachesTreasuryAndCreatorFundsStaySeparate() public {
        Fixture memory f = _fixture();

        uint256 platformFees = PLATFORM_FEE_PER_TOKEN * SUPPLY;
        uint256 creatorRevenue = CREATOR_PRICE * SUPPLY;
        uint256 mintValue = platformFees + creatorRevenue;

        vm.deal(COLLECTOR, mintValue + 1 ether);
        bytes32[] memory emptyProof = new bytes32[](0);
        vm.prank(COLLECTOR);
        f.collection.mint{value: mintValue}(1, SUPPLY, 0, emptyProof);

        assertEq(f.collection.hopperBalance(), platformFees, "platform fees enter reveal hopper");
        assertEq(
            f.collection.accruedCreatorProceeds(), creatorRevenue, "creator sale proceeds are separately accounted"
        );

        vm.prank(CREATOR);
        uint256 requestId = f.collection.requestDelayedReveal();

        assertEq(
            f.collection.hopperBalance(),
            platformFees - RANDOMNESS_COST,
            "reveal randomness consumes platform hopper first"
        );
        assertEq(f.collection.totalReserveSubsidy(), 0, "reserve subsidy unnecessary");

        f.provider.deliver(address(f.collection), requestId, 123456789);
        assertTrue(f.collection.completed(), "collection completed after sold-out delayed reveal");
        assertEq(f.collection.protectedHopperWei(), 0, "completed collection protects no hopper runway");

        uint256 platformSurplus = platformFees - RANDOMNESS_COST;
        uint256 reserveBeforeSweep = address(f.reserve).balance;
        uint256 treasuryBefore = TREASURY.balance;

        uint256 swept = f.reserve.pullCollectionExcess(address(f.collection));
        assertEq(swept, platformSurplus, "exact unused platform fee swept to Reserve");
        assertEq(
            address(f.reserve).balance, reserveBeforeSweep + platformSurplus, "Reserve receives exact platform surplus"
        );
        assertEq(
            f.collection.accruedCreatorProceeds(), creatorRevenue, "platform sweep cannot consume creator proceeds"
        );

        uint256 released = f.reserve.releaseRevenue();
        assertEq(released, platformSurplus, "only true surplus released");
        assertEq(TREASURY.balance, treasuryBefore + platformSurplus, "configured treasury receives exact surplus");
        assertEq(address(f.reserve).balance, MINIMUM_RESERVE, "required Reserve floor remains untouched");
        assertEq(
            f.collection.accruedCreatorProceeds(), creatorRevenue, "platform release cannot consume creator proceeds"
        );

        uint256 creatorBefore = CREATOR.balance;
        f.collection.withdraw();
        assertEq(CREATOR.balance, creatorBefore + creatorRevenue, "creator separately receives exact sale proceeds");
        assertEq(f.collection.accruedCreatorProceeds(), 0, "creator proceeds cleared only by creator withdrawal");
    }
}
