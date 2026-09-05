// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicForgeV2Core.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

interface IR11RandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

contract R11DataMock {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed = true;

    constructor(address creator_, uint32 maxSupply_) {
        creator = creator_;
        maxSupply = maxSupply_;
    }
}

contract R11RendererMock {
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

contract R11ProviderMock {
    uint256 public nextRequestId = 1;

    function quoteRequestPrice(uint32) external pure returns (uint256) {
        return 0;
    }

    function requestRandomness(uint256, uint32) external returns (uint256 requestId) {
        requestId = nextRequestId++;
    }

    function deliver(address collection, uint256 requestId, uint256 randomWord) external {
        IR11RandomnessConsumer(collection).fulfillRandomness(requestId, randomWord);
    }
}

contract R11FeePolicyCodeMock {}

contract R11ReserveFactoryMock {
    address public reserve;

    constructor(address reserve_) {
        reserve = reserve_;
    }

    function register(address collection) external {
        RelicForgeReserveV2(payable(reserve)).registerCollection(collection);
    }
}

contract R11ReadBombCollection {
    uint256 public exposure;
    uint256 public restricted;
    uint256 public active;
    bool public armed;

    function setMetrics(uint256 exposure_, uint256 restricted_, uint256 active_) external {
        exposure = exposure_;
        restricted = restricted_;
        active = active_;
    }

    function setArmed(bool armed_) external {
        armed = armed_;
    }

    function reserveExposureWei() external view returns (uint256) {
        if (armed) revert("R11 read bomb");
        return exposure;
    }

    function restrictedSponsoredLiabilityWei() external view returns (uint256) {
        if (armed) revert("R11 read bomb");
        return restricted;
    }

    function activeForgeBatchCount() external view returns (uint256) {
        if (armed) revert("R11 read bomb");
        return active;
    }

    function randomnessShortfallFor(uint64) external pure returns (uint256) {
        return 0;
    }

    function sweepExcessToReserve() external pure returns (uint256) {
        return 0;
    }
}

contract R11TreasuryProbe {
    RelicForgeReserveV2 public reserve;
    address public collection;
    bool public attempted;
    bool public accountingMutationBlocked;

    function configure(RelicForgeReserveV2 reserve_, address collection_) external {
        reserve = reserve_;
        collection = collection_;
    }

    receive() external payable {
        attempted = true;
        (bool ok,) = address(reserve).call(abi.encodeCall(RelicForgeReserveV2.syncCollection, (collection)));
        accountingMutationBlocked = !ok;
    }
}

contract R11FailingReserveMock {
    bool public failSync = true;

    function syncCollection(address) external view {
        if (failSync) revert("R11 required sync failure");
    }

    function setFailSync(bool value) external {
        failSync = value;
    }

    function fundRandomnessShortfall(uint64, uint256) external pure {
        revert("unexpected reserve draw");
    }

    function depositFromCollection() external payable {}
}

contract ForgeRevealV2R11ReserveScalingTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA5);
    uint256 internal constant MAX_RNG_COST = 0.01 ether;

    struct Fixture {
        RelicCollectionV2 collection;
        RelicMintPhasesV2 phases;
        R11ProviderMock provider;
        RelicForgeReserveV2 reserve;
        R11ReserveFactoryMock factory;
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
        returns (RelicForgeReserveV2 reserve, R11ReserveFactoryMock factory)
    {
        vm.deal(address(this), 100 ether);
        reserve = new RelicForgeReserveV2{value: 1 ether}(
            address(this), treasury, 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        factory = new R11ReserveFactoryMock(address(reserve));
        reserve.bindFactory(address(factory));
    }

    function _fixture(uint32 supply, uint8 initialRevealMode) internal returns (Fixture memory f) {
        (f.reserve, f.factory) = _newReserve(payable(TREASURY));

        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicMintPhasesV2 phasesImpl = new RelicMintPhasesV2();

        address collectionAddress = _clone(address(collectionImpl));
        address phasesAddress = _clone(address(phasesImpl));

        R11DataMock data = new R11DataMock(ALICE, supply);
        R11RendererMock renderer = new R11RendererMock();
        f.provider = new R11ProviderMock();
        R11FeePolicyCodeMock feePolicy = new R11FeePolicyCodeMock();

        f.phases = RelicMintPhasesV2(phasesAddress);
        f.phases.initialize(collectionAddress, ALICE, address(feePolicy), 1, 0);

        f.collection = RelicCollectionV2(payable(collectionAddress));
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "Relic Forge R11 Reserve",
            symbol: "RFR11",
            description: "R11 scale-safe reserve accounting",
            creator: ALICE,
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(f.provider),
            forgeReserve: address(f.reserve),
            feePolicy: address(feePolicy),
            mintPhases: address(f.phases),
            maxSupply: supply,
            payoutReceiver: ALICE,
            royaltyReceiver: ALICE,
            royaltyBps: 500,
            feeMode: 1,
            lockedFeeCents: 0,
            initialRevealMode: initialRevealMode,
            batchWindowSeconds: 3,
            maxRandomnessCostPerBatchWei: MAX_RNG_COST
        });
        f.collection.initialize(init);
        f.factory.register(address(f.collection));
    }

    function _assertExact(Fixture memory f, string memory label) internal view {
        assertEq(
            f.reserve.collectionExposureWei(address(f.collection)),
            f.collection.reserveExposureWei(),
            string.concat(label, " exposure")
        );
        assertEq(
            f.reserve.collectionRestrictedSponsoredLiabilityWei(address(f.collection)),
            f.collection.restrictedSponsoredLiabilityWei(),
            string.concat(label, " restricted")
        );
        assertEq(
            f.reserve.collectionActiveBatches(address(f.collection)),
            f.collection.activeForgeBatchCount(),
            string.concat(label, " active")
        );
    }

    function testR11LiabilityIncreasingMintsPushSyncAtomically() public {
        Fixture memory f = _fixture(4, 0);

        _assertExact(f, "initial");

        vm.prank(ALICE);
        f.collection.creatorMint(ALICE, 1);

        _assertExact(f, "deferred mint");
        assertEq(f.reserve.totalExposureWei(), MAX_RNG_COST, "deferred mint exposure pushed");
        assertEq(f.reserve.totalActiveBatches(), 1, "deferred reveal obligation pushed");

        vm.prank(ALICE);
        uint256 delayedRequestId = f.collection.requestDelayedReveal();

        // Delayed request can only reduce/no-increase liability. A stale cache is intentionally conservative.
        assertTrue(
            f.reserve.collectionExposureWei(address(f.collection)) >= f.collection.reserveExposureWei(),
            "delayed request cache must not underestimate exposure"
        );
        assertTrue(
            f.reserve.collectionActiveBatches(address(f.collection)) >= f.collection.activeForgeBatchCount(),
            "delayed request cache must not underestimate active count"
        );

        f.provider.deliver(address(f.collection), delayedRequestId, 123456789);

        assertTrue(
            f.reserve.collectionExposureWei(address(f.collection)) >= f.collection.reserveExposureWei(),
            "delayed reveal stale exposure remains conservative"
        );
        assertTrue(
            f.reserve.collectionActiveBatches(address(f.collection)) >= f.collection.activeForgeBatchCount(),
            "delayed reveal stale active count remains conservative"
        );

        // Permissionless correction unlocks revenue after a decrease-only transition.
        f.reserve.syncCollection(address(f.collection));
        _assertExact(f, "post delayed sync");

        vm.prank(ALICE);
        f.collection.creatorMint(ALICE, 1);
        _assertExact(f, "Forge reservation");
        assertEq(f.reserve.totalExposureWei(), MAX_RNG_COST, "open Forge exposure pushed");
        assertEq(f.reserve.totalActiveBatches(), 1, "open Forge batch pushed");

        vm.warp(block.timestamp + 3);
        f.collection.lockTimedOutBatch();
        _assertExact(f, "timeout lock metric-equivalent");

        f.collection.requestRandomnessForBatch(1);
        _assertExact(f, "request best-effort decrease sync");
        assertEq(f.reserve.totalExposureWei(), 0, "requested batch no longer reserve exposure");

        f.provider.deliver(address(f.collection), 2, 987654321);
        f.collection.settleReady(1);
        _assertExact(f, "settlement");
        assertEq(f.reserve.totalActiveBatches(), 0, "settled batch removed from active count");
    }

    function testR11RequiredMintSyncFailureRevertsEntireMint() public {
        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicMintPhasesV2 phasesImpl = new RelicMintPhasesV2();
        address collectionAddress = _clone(address(collectionImpl));
        address phasesAddress = _clone(address(phasesImpl));

        R11DataMock data = new R11DataMock(ALICE, 4);
        R11RendererMock renderer = new R11RendererMock();
        R11ProviderMock provider = new R11ProviderMock();
        R11FeePolicyCodeMock feePolicy = new R11FeePolicyCodeMock();
        R11FailingReserveMock failingReserve = new R11FailingReserveMock();

        RelicMintPhasesV2 phases = RelicMintPhasesV2(phasesAddress);
        phases.initialize(collectionAddress, ALICE, address(feePolicy), 1, 0);

        RelicCollectionV2 collection = RelicCollectionV2(payable(collectionAddress));
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "R11 Atomic Sync",
            symbol: "R11A",
            description: "required sync rollback",
            creator: ALICE,
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(provider),
            forgeReserve: address(failingReserve),
            feePolicy: address(feePolicy),
            mintPhases: address(phases),
            maxSupply: 4,
            payoutReceiver: ALICE,
            royaltyReceiver: ALICE,
            royaltyBps: 0,
            feeMode: 1,
            lockedFeeCents: 0,
            initialRevealMode: 0,
            batchWindowSeconds: 3,
            maxRandomnessCostPerBatchWei: MAX_RNG_COST
        });
        collection.initialize(init);

        vm.prank(ALICE);
        vm.expectRevert();
        collection.creatorMint(ALICE, 1);

        assertEq(collection.totalCommitted(), 0, "failed required sync rolls back commitment");
        assertEq(collection.totalMinted(), 0, "failed required sync rolls back mint");
        assertEq(collection.balanceOf(ALICE), 0, "failed required sync rolls back ownership");
    }

    function testR11ReleaseRevenueDoesNotReadAnyRegisteredCollection() public {
        (RelicForgeReserveV2 reserve, R11ReserveFactoryMock factory) = _newReserve(payable(TREASURY));

        R11ReadBombCollection bomb = new R11ReadBombCollection();
        factory.register(address(bomb));
        bomb.setArmed(true);

        uint256 before = address(reserve).balance;
        uint256 treasuryBefore = TREASURY.balance;
        uint256 expectedRequired = reserve.requiredReserveWei();

        uint256 released = reserve.releaseRevenue();

        assertEq(released, before - expectedRequired, "O(1) release amount");
        assertEq(address(reserve).balance, expectedRequired, "required reserve remains");
        assertEq(TREASURY.balance, treasuryBefore + released, "treasury receives surplus");
    }

    function testR11BoundedMaintenanceSyncUsesCursorAndHardCap() public {
        (RelicForgeReserveV2 reserve, R11ReserveFactoryMock factory) = _newReserve(payable(TREASURY));

        R11ReadBombCollection[] memory c = new R11ReadBombCollection[](5);
        for (uint256 i; i < c.length; ++i) {
            c[i] = new R11ReadBombCollection();
            factory.register(address(c[i]));
            c[i].setMetrics((i + 1) * 1 ether, 0, i + 1);
        }

        uint256 next = reserve.syncCollections(1, 2);
        assertEq(next, 3, "cursor advances only requested bounded range");

        assertEq(reserve.collectionExposureWei(address(c[0])), 0, "index zero untouched");
        assertEq(reserve.collectionExposureWei(address(c[1])), 2 ether, "index one synced");
        assertEq(reserve.collectionExposureWei(address(c[2])), 3 ether, "index two synced");
        assertEq(reserve.collectionExposureWei(address(c[3])), 0, "index three untouched");
        assertEq(reserve.totalExposureWei(), 5 ether, "only bounded slice contributes");

        vm.expectRevert();
        reserve.syncCollections(0, 65);
    }

    function testR11RevenueTreasuryCannotMutateReserveAccountingDuringExternalCall() public {
        R11TreasuryProbe treasury = new R11TreasuryProbe();
        (RelicForgeReserveV2 reserve, R11ReserveFactoryMock factory) = _newReserve(payable(address(treasury)));

        R11ReadBombCollection collection = new R11ReadBombCollection();
        factory.register(address(collection));
        treasury.configure(reserve, address(collection));

        reserve.releaseRevenue();

        assertTrue(treasury.attempted(), "treasury attempted reentrant accounting mutation");
        assertTrue(treasury.accountingMutationBlocked(), "reserve accounting mutation blocked during ETH call");
    }
}
