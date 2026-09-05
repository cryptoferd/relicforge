// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";

contract R11R4R3OracleMock {
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

contract ForgeRevealV2R11R4FeePolicyHardeningR3Test is TestBase {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant ATTACKER = address(0xBAD);
    address internal constant TREASURY = address(0x7001);
    address internal constant NEW_TREASURY = address(0x7002);
    address internal constant NEW_ADMIN = address(0xA22CE);

    function _policy() internal returns (RelicForgeFeePolicyV1 policy) {
        R11R4R3OracleMock oracle = new R11R4R3OracleMock();
        policy = new RelicForgeFeePolicyV1(ADMIN, TREASURY, address(oracle), 1 days);
    }

    function testR3TreasuryAndAdminRequireTargetAcceptance() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.prank(ADMIN);
        policy.setTreasury(NEW_TREASURY);
        assertEq(policy.treasury(), TREASURY, "treasury changed before acceptance");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptTreasury();

        vm.prank(NEW_TREASURY);
        policy.acceptTreasury();
        assertEq(policy.treasury(), NEW_TREASURY, "treasury acceptance failed");

        vm.prank(ADMIN);
        policy.transferPlatformAdmin(NEW_ADMIN);
        assertEq(policy.platformAdmin(), ADMIN, "admin changed before acceptance");

        vm.prank(ATTACKER);
        vm.expectRevert();
        policy.acceptPlatformAdmin();

        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();
        assertEq(policy.platformAdmin(), NEW_ADMIN, "admin acceptance failed");
    }

    function testR3OldAdminTreasuryProposalCannotSurviveAdminHandoff() public {
        RelicForgeFeePolicyV1 policy = _policy();

        vm.startPrank(ADMIN);
        policy.setTreasury(NEW_TREASURY);
        policy.transferPlatformAdmin(NEW_ADMIN);
        vm.stopPrank();

        vm.prank(NEW_ADMIN);
        policy.acceptPlatformAdmin();

        assertEq(policy.pendingTreasury(), address(0), "old-admin treasury proposal survived handoff");

        vm.prank(NEW_TREASURY);
        vm.expectRevert();
        policy.acceptTreasury();
    }

    function testFuzzR3OnlyPendingTreasuryCanAccept(address candidate, address wrongActor) public {
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

    function testFuzzR3OnlyPendingAdminCanAccept(address candidate, address wrongActor) public {
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
