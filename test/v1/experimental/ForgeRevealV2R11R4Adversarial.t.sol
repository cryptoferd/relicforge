// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";

contract R11R4OracleMock {
    uint8 public constant decimals = 8;
    int256 public answer = 3000e8;
    uint256 public updatedAt = block.timestamp;

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract R11R4FactoryViewMock {
    address public reserve;

    constructor(address reserve_) {
        reserve = reserve_;
    }

    function register(address collection) external {
        RelicForgeReserveV2(payable(reserve)).registerCollection(collection);
    }
}

contract R11R4CollectionMetricsMock {
    uint256 public exposure;
    uint256 public restricted;
    uint256 public active;
    uint256 public shortfall;
    uint256 public sweepAmount;

    function setMetrics(uint256 e, uint256 r, uint256 a) external {
        exposure = e;
        restricted = r;
        active = a;
    }

    function setShortfall(uint256 s) external {
        shortfall = s;
    }

    function setSweepAmount(uint256 s) external {
        sweepAmount = s;
    }

    function reserveExposureWei() external view returns (uint256) {
        return exposure;
    }

    function restrictedSponsoredLiabilityWei() external view returns (uint256) {
        return restricted;
    }

    function activeForgeBatchCount() external view returns (uint256) {
        return active;
    }

    function randomnessShortfallFor(uint64) external view returns (uint256) {
        return shortfall;
    }

    function sweepExcessToReserve() external returns (uint256 amount) {
        amount = sweepAmount;
        if (amount != 0) {
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "sweep transfer failed");
        }
    }

    receive() external payable {}
}

contract R11R4ReentrantTreasury {
    RelicForgeReserveV2 public reserve;
    bool public triedRelease;
    bool public triedSync;
    bool public releaseBlocked;
    bool public syncBlocked;
    address public collection;

    function configure(RelicForgeReserveV2 reserve_, address collection_) external {
        reserve = reserve_;
        collection = collection_;
    }

    receive() external payable {
        triedRelease = true;
        (bool okRelease,) = address(reserve).call(abi.encodeWithSignature("releaseRevenue()"));
        releaseBlocked = !okRelease;

        triedSync = true;
        (bool okSync,) = address(reserve).call(abi.encodeCall(RelicForgeReserveV2.syncCollection, (collection)));
        syncBlocked = !okSync;
    }
}

contract R11R4RejectingTreasury {
    receive() external payable {
        revert("reject");
    }
}

contract R11R4ForceEth {
    constructor() payable {}

    function boom(address payable target) external {
        selfdestruct(target);
    }
}

contract ForgeRevealV2R11R4AdversarialTest is TestBase {
    address internal constant ATTACKER = address(0xBAD);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant NEW_TREASURY = address(0xBEEF);
    address internal constant NEW_ADMIN = address(0xA11CE);

    function _reserve(address payable treasury)
        internal
        returns (RelicForgeReserveV2 reserve, R11R4FactoryViewMock factory)
    {
        vm.deal(address(this), 100 ether);
        reserve = new RelicForgeReserveV2{value: 1 ether}(
            address(this), treasury, 0.5 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        factory = new R11R4FactoryViewMock(address(reserve));
        reserve.bindFactory(address(factory));
    }

    function testRedTeamAttackerCannotRedirectOrReleaseReserveRevenue() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));

        vm.startPrank(ATTACKER);
        vm.expectRevert();
        reserve.proposeRevenueTreasury(payable(ATTACKER));

        vm.expectRevert();
        reserve.proposeFounder(ATTACKER);

        vm.expectRevert();
        reserve.releaseRevenue();

        vm.expectRevert();
        reserve.setReservePolicy(0, 0, 10_000, type(uint256).max, type(uint256).max);
        vm.stopPrank();

        assertEq(reserve.revenueTreasury(), TREASURY, "attacker redirected treasury");
        assertEq(reserve.founder(), address(this), "attacker seized founder");
    }

    function testRedTeamOldPendingTreasuryCannotAcceptAfterProposalIsReplaced() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));

        reserve.proposeRevenueTreasury(payable(ATTACKER));
        reserve.proposeRevenueTreasury(payable(NEW_TREASURY));

        vm.prank(ATTACKER);
        vm.expectRevert();
        reserve.acceptRevenueTreasury();

        vm.prank(NEW_TREASURY);
        reserve.acceptRevenueTreasury();

        assertEq(reserve.revenueTreasury(), NEW_TREASURY, "latest target did not win");
    }

    function testRedTeamFakeUnregisteredCollectionCannotTouchReserve() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));
        R11R4CollectionMetricsMock fake = new R11R4CollectionMetricsMock();
        vm.deal(address(fake), 1 ether);

        vm.prank(address(fake));
        vm.expectRevert();
        reserve.depositFromCollection{value: 1 wei}();

        vm.prank(address(fake));
        vm.expectRevert();
        reserve.fundRandomnessShortfall(1, 1 wei);

        vm.expectRevert();
        reserve.syncCollection(address(fake));

        vm.expectRevert();
        reserve.pullCollectionExcess(address(fake));
    }

    function testRedTeamForcedEthCannotLetAttackerWithdrawOrLowerRequiredReserve() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));

        uint256 requiredBefore = reserve.requiredReserveWei();
        vm.deal(address(this), address(this).balance + 2 ether);
        R11R4ForceEth force = new R11R4ForceEth{value: 2 ether}();
        force.boom(payable(address(reserve)));

        assertEq(reserve.requiredReserveWei(), requiredBefore, "forced ETH changed liability boundary");
        assertEq(address(reserve).balance, 3 ether, "forced ETH not received");

        vm.prank(ATTACKER);
        vm.expectRevert();
        reserve.releaseRevenue();

        uint256 treasuryBefore = TREASURY.balance;
        uint256 released = reserve.releaseRevenue();
        assertEq(address(reserve).balance, requiredBefore, "release crossed required boundary");
        assertEq(TREASURY.balance, treasuryBefore + released, "configured treasury did not receive release");
    }

    function testRedTeamRevenueTreasuryCannotReenterReleaseOrAccounting() public {
        R11R4ReentrantTreasury treasury = new R11R4ReentrantTreasury();
        (RelicForgeReserveV2 reserve, R11R4FactoryViewMock factory) = _reserve(payable(address(treasury)));

        R11R4CollectionMetricsMock c = new R11R4CollectionMetricsMock();
        factory.register(address(c));
        treasury.configure(reserve, address(c));

        reserve.releaseRevenue();

        assertTrue(treasury.triedRelease(), "treasury did not try release reentry");
        assertTrue(treasury.releaseBlocked(), "release reentry succeeded");
        assertTrue(treasury.triedSync(), "treasury did not try sync reentry");
        assertTrue(treasury.syncBlocked(), "accounting reentry succeeded");
    }

    function testRedTeamRejectingTreasuryCannotBurnRevenue() public {
        R11R4RejectingTreasury badTreasury = new R11R4RejectingTreasury();
        (RelicForgeReserveV2 reserve,) = _reserve(payable(address(badTreasury)));

        uint256 beforeBalance = address(reserve).balance;
        uint256 releasedBefore = reserve.totalRevenueReleased();

        vm.expectRevert();
        reserve.releaseRevenue();

        assertEq(address(reserve).balance, beforeBalance, "failed treasury burned Reserve ETH");
        assertEq(reserve.totalRevenueReleased(), releasedBefore, "failed treasury burned accounting");
    }

    function testRedTeamFounderCannotConfigureExposureSafetyBelowOneHundredPercent() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));

        vm.expectRevert();
        reserve.setReservePolicy(0, 0, 9_999, 1 ether, 10 ether);

        reserve.setReservePolicy(0, 0, 10_000, 1 ether, 10 ether);
        assertEq(reserve.exposureSafetyBps(), 10_000, "100 percent floor not retained");
    }

    function testRedTeamBoundedSyncRejectsZeroAndOverCap() public {
        (RelicForgeReserveV2 reserve,) = _reserve(payable(TREASURY));

        vm.expectRevert();
        reserve.syncCollections(0, 0);

        vm.expectRevert();
        reserve.syncCollections(0, 65);
    }

    function testRedTeamFeePolicyUnauthorizedWalletCannotUseAdminSetters() public {
        R11R4OracleMock oracle = new R11R4OracleMock();
        RelicForgeFeePolicyV1 policy = new RelicForgeFeePolicyV1(address(this), TREASURY, address(oracle), 1 days);

        vm.startPrank(ATTACKER);
        vm.expectRevert();
        policy.setTreasury(ATTACKER);
        vm.expectRevert();
        policy.transferPlatformAdmin(ATTACKER);
        vm.expectRevert();
        policy.setDefaultFeeCents(500, 500);
        vm.stopPrank();

        assertEq(policy.treasury(), TREASURY, "unauthorized treasury redirect");
        assertEq(policy.platformAdmin(), address(this), "unauthorized admin takeover");
    }

    function testRedTeamFeePolicyAdminRotationRequiresTargetAcceptance() public {
        R11R4OracleMock oracle = new R11R4OracleMock();
        RelicForgeFeePolicyV1 policy = new RelicForgeFeePolicyV1(address(this), TREASURY, address(oracle), 1 days);

        policy.setTreasury(NEW_TREASURY);
        assertEq(policy.treasury(), TREASURY, "treasury changed before acceptance");
        assertEq(policy.pendingTreasury(), NEW_TREASURY, "pending treasury missing");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptTreasury();

        vm.prank(NEW_TREASURY);
        policy.acceptTreasury();
        assertEq(policy.treasury(), NEW_TREASURY, "treasury acceptance failed");

        policy.transferPlatformAdmin(NEW_ADMIN);
        assertEq(policy.platformAdmin(), address(this), "admin changed before acceptance");
        assertEq(policy.pendingPlatformAdmin(), NEW_ADMIN, "pending admin missing");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptPlatformAdmin();

        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();
        assertEq(policy.platformAdmin(), NEW_ADMIN, "admin acceptance failed");
    }

    function testFuzzRedTeamReserveNeverReleasesBelowRequiredBoundary(
        uint96 forcedAmount,
        uint96 minimumReserve,
        uint32 safetyBpsRaw
    ) public {
        uint32 safetyBps = uint32(10_000 + (uint256(safetyBpsRaw) % 40_001));
        uint256 minimum = uint256(minimumReserve) % 10 ether;

        vm.deal(address(this), 100 ether);
        RelicForgeReserveV2 reserve = new RelicForgeReserveV2{value: 20 ether}(
            address(this), payable(TREASURY), minimum, 0.001 ether, safetyBps, 1 ether, 20 ether
        );

        uint256 extra = uint256(forcedAmount) % 5 ether;
        if (extra != 0) {
            R11R4ForceEth force = new R11R4ForceEth{value: extra}();
            force.boom(payable(address(reserve)));
        }

        uint256 required = reserve.requiredReserveWei();
        uint256 available = reserve.availableRevenueWei();
        if (available == 0) {
            vm.expectRevert();
            reserve.releaseRevenue();
            assertTrue(address(reserve).balance >= required, "zero-revenue path below boundary");
            return;
        }

        reserve.releaseRevenue();
        assertTrue(address(reserve).balance >= reserve.requiredReserveWei(), "release crossed solvency boundary");
    }
}
