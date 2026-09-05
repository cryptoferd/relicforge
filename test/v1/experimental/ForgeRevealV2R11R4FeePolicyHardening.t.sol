// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";

contract R11R4R2OracleMock {
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

contract ForgeRevealV2R11R4FeePolicyHardeningTest is TestBase {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant ATTACKER = address(0xBAD);
    address internal constant TREASURY = address(0x7001);
    address internal constant NEW_TREASURY = address(0x7002);
    address internal constant NEW_ADMIN = address(0xA22CE);

    function _policy() internal returns (RelicForgeFeePolicyV1 policy) {
        R11R4R2OracleMock oracle = new R11R4R2OracleMock();
        policy = new RelicForgeFeePolicyV1(ADMIN, TREASURY, address(oracle), 1 days);
    }

    function testR2TreasuryProposalCannotRedirectUntilDestinationAccepts() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.setTreasury(NEW_TREASURY);

        assertEq(policy.treasury(), TREASURY, "proposal redirected treasury");
        assertEq(policy.pendingTreasury(), NEW_TREASURY, "pending treasury missing");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptTreasury();

        vm.prank(NEW_TREASURY);
        policy.acceptTreasury();

        assertEq(policy.treasury(), NEW_TREASURY, "destination acceptance failed");
        assertEq(policy.pendingTreasury(), address(0), "pending treasury not cleared");
    }

    function testR2LatestTreasuryProposalInvalidatesOlderTarget() public {
        RelicForgeFeePolicyV1 policy = _policy();
        address second = address(0x7003);

        vm.startPrank(ADMIN);
        policy.setTreasury(NEW_TREASURY);
        policy.setTreasury(second);
        vm.stopPrank();

        vm.prank(NEW_TREASURY);
        vm.expectRevert();
        policy.acceptTreasury();

        vm.prank(second);
        policy.acceptTreasury();

        assertEq(policy.treasury(), second, "latest treasury target not finalized");
    }

    function testR2PlatformAdminTransferRequiresNewAdminAcceptance() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.transferPlatformAdmin(NEW_ADMIN);

        assertEq(policy.platformAdmin(), ADMIN, "proposal changed admin");
        assertEq(policy.pendingPlatformAdmin(), NEW_ADMIN, "pending admin missing");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptPlatformAdmin();

        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();

        assertEq(policy.platformAdmin(), NEW_ADMIN, "admin acceptance failed");
        assertEq(policy.pendingPlatformAdmin(), address(0), "pending admin not cleared");
    }

    function testR2OldAdminTreasuryProposalDiesOnAdminHandoff() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.startPrank(ADMIN);
        policy.setTreasury(NEW_TREASURY);
        policy.transferPlatformAdmin(NEW_ADMIN);
        vm.stopPrank();

        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();

        assertEq(policy.pendingTreasury(), address(0), "old-admin treasury proposal survived");

        vm.prank(NEW_TREASURY);
        vm.expectRevert();
        policy.acceptTreasury();
    }

    function testR2OldAdminLosesAuthorityAfterAcceptedHandoff() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.transferPlatformAdmin(NEW_ADMIN);
        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();

        vm.prank(ADMIN);
        vm.expectRevert();
        policy.setDefaultFeeCents(1, 1);

        vm.prank(NEW_ADMIN);
        policy.setDefaultFeeCents(1, 1);
        assertEq(policy.sponsoredFeeCents(), 1, "new admin lacks authority");
    }

    function testR2SameAddressAndZeroAddressCannotBeProposed() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.startPrank(ADMIN);
        vm.expectRevert();
        policy.setTreasury(address(0));
        vm.expectRevert();
        policy.setTreasury(TREASURY);
        vm.expectRevert();
        policy.transferPlatformAdmin(address(0));
        vm.expectRevert();
        policy.transferPlatformAdmin(ADMIN);
        vm.stopPrank();
    }

    function testFuzzR2OnlyPendingTreasuryCanAccept(address candidate, address wrongActor) public {
        vm.assume(candidate != address(0));
        vm.assume(candidate != TREASURY);
        vm.assume(wrongActor != candidate);

        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.setTreasury(candidate);

        vm.prank(wrongActor);
        vm.expectRevert();
        policy.acceptTreasury();

        assertEq(policy.treasury(), TREASURY, "wrong actor changed treasury");

        vm.prank(candidate);
        policy.acceptTreasury();
        assertEq(policy.treasury(), candidate, "pending treasury could not accept");
    }

    function testFuzzR2OnlyPendingAdminCanAccept(address candidate, address wrongActor) public {
        vm.assume(candidate != address(0));
        vm.assume(candidate != ADMIN);
        vm.assume(wrongActor != candidate);

        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.transferPlatformAdmin(candidate);

        vm.prank(wrongActor);
        vm.expectRevert();
        policy.acceptPlatformAdmin();

        assertEq(policy.platformAdmin(), ADMIN, "wrong actor changed admin");

        vm.prank(candidate);
        policy.acceptPlatformAdmin();
        assertEq(policy.platformAdmin(), candidate, "pending admin could not accept");
    }
}
