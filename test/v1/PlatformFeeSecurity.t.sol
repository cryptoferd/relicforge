// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract RejectingFeeTreasuryV1 {
    receive() external payable { revert("reject treasury"); }
}

contract PlatformFeeSecurityTest is RelicForgeV1Fixture {
    function _setFeesEnabled(bool enabled) internal {
        vm.prank(PLATFORM_ADMIN);
        feePolicy.setFeesEnabled(enabled);
    }

    function _setDefaults(uint32 sponsoredCents, uint32 minterCents) internal {
        vm.prank(PLATFORM_ADMIN);
        feePolicy.setDefaultFeeCents(sponsoredCents, minterCents);
    }

    function _newSponsored(uint32 supply)
        internal
        returns (RelicCollectionV1 c, RelicProjectDataV1 d, uint256 upfrontFee)
    {
        (upfrontFee,,,) = _sponsoredQuote(supply);

        (address cAddr, address dAddr) = factory.createCollectionWithFeeMode{value: upfrontFee}(
            "Sponsored",
            "SPON",
            "sponsored fee test",
            supply,
            32,
            32,
            1,
            PAYOUT,
            ROYALTY,
            500,
            factory.FEE_MODE_SPONSORED()
        );

        c = RelicCollectionV1(cAddr);
        d = RelicProjectDataV1(dAddr);
    }

    function _sponsoredQuote(uint32 supply)
        internal view
        returns (uint256 upfrontFee, uint32 lockedCents, bool healthy, bool active)
    {
        (lockedCents, upfrontFee, healthy, active) =
            factory.quoteCollectionFeeTerms(supply, factory.FEE_MODE_SPONSORED());
    }

    function testDefaultRatesAreTwentyFiveAndFiftyCents() public view {
        assertEq(uint256(feePolicy.sponsoredFeeCents()), 25, "sponsored default");
        assertEq(uint256(feePolicy.minterFeeCents()), 50, "minter default");
        assertEq(uint256(collection.lockedPlatformFeeCents()), 50, "existing collection locks minter cents");
        assertEq(uint256(collection.platformFeeMode()), uint256(factory.FEE_MODE_MINTER_SUPPORTED()), "default path minter-supported");
    }

    function testOnlyPlatformAdminCanChangeFeePolicy() public {
        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(BOB);
        feePolicy.setFeesEnabled(true);

        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(BOB);
        feePolicy.setDefaultFeeCents(1, 1);

        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(BOB);
        feePolicy.setTreasury(BOB);

        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(BOB);
        feePolicy.waiveCollection(address(collection));
    }

    function testFeeAdminCannotControlCreatorCollection() public {
        vm.expectRevert(RF_NotController.selector);
        vm.prank(PLATFORM_ADMIN);
        collection.setMasterMintEnabled(true);

        vm.expectRevert(RF_NotController.selector);
        vm.prank(PLATFORM_ADMIN);
        collection.setPayoutReceiver(PLATFORM_ADMIN);
    }

    function testFactoryFeePolicyBindingIsOneTimeAndBurnsBootstrapAuthority() public {
        assertEq(factory.feePolicy(), address(feePolicy), "policy bound");
        assertEq(factory.feePolicyBootstrapAuthority(), address(0), "bootstrap burned");

        vm.expectRevert(RF_NotAuthorized.selector);
        factory.bindFeePolicy(address(feePolicy));
    }

    function testFactoryCannotCreateBeforeFeePolicyBinding() public {
        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicForgeFactoryV1 unbound = new RelicForgeFactoryV1(
            address(collectionImpl),
            address(dataImpl),
            address(renderer),
            address(randomness)
        );

        vm.expectRevert(RF_FeePolicyNotBound.selector);
        unbound.createCollection("No", "NO", "no policy", 2, 32, 32, 1, PAYOUT, ROYALTY, 500);
    }

    function testChangingDefaultsCannotRaiseExistingCollectionFee() public {
        assertEq(uint256(collection.lockedPlatformFeeCents()), 50, "initial locked rate");

        _setDefaults(40, 90);

        assertEq(uint256(collection.lockedPlatformFeeCents()), 50, "existing rate unchanged");

        (address cAddr,) = factory.createCollection(
            "New",
            "NEW",
            "new defaults",
            2,
            32,
            32,
            1,
            PAYOUT,
            ROYALTY,
            500
        );
        assertEq(uint256(RelicCollectionV1(cAddr).lockedPlatformFeeCents()), 90, "new collection gets new default");
    }

    function testDefaultFeeHardCapPreventsAccidentalExtremeRate() public {
        uint32 overCap = feePolicy.MAX_DEFAULT_FEE_CENTS() + 1;
        vm.expectRevert(RF_FeeLimit.selector);
        vm.prank(PLATFORM_ADMIN);
        feePolicy.setDefaultFeeCents(overCap, 50);
    }

    function testSponsoredCreatorPaysSupplyBasedFeeUpfront() public {
        _setFeesEnabled(true);

        uint32 supply = 100;
        (uint256 upfrontFee, uint32 cents, bool healthy, bool active) = _sponsoredQuote(supply);
        assertEq(uint256(cents), 25, "locked sponsored cents");
        assertTrue(healthy, "oracle healthy");
        assertTrue(active, "fee active");
        assertGt(upfrontFee, 0, "upfront fee quoted");

        uint256 beforeAccrued = feePolicy.accruedFees();
        (RelicCollectionV1 c,, uint256 paid) = _newSponsored(supply);

        assertEq(paid, upfrontFee, "quoted and paid match");
        assertEq(feePolicy.accruedFees(), beforeAccrued + upfrontFee, "platform accrued upfront");
        assertEq(uint256(c.platformFeeMode()), uint256(factory.FEE_MODE_SPONSORED()), "sponsored mode locked");
        assertEq(uint256(c.lockedPlatformFeeCents()), 25, "sponsored cents locked");
    }

    function testSponsoredLaunchRejectsWrongUpfrontPayment() public {
        _setFeesEnabled(true);

        uint32 supply = 100;
        (uint256 upfrontFee,,,) = _sponsoredQuote(supply);
        assertGt(upfrontFee, 0, "nonzero quote");
        uint8 sponsoredMode = factory.FEE_MODE_SPONSORED();

        vm.expectRevert(RF_WrongPrice.selector);
        factory.createCollectionWithFeeMode{value: upfrontFee - 1}(
            "Sponsored",
            "SPON",
            "wrong fee",
            supply,
            32,
            32,
            1,
            PAYOUT,
            ROYALTY,
            500,
            sponsoredMode
        );
    }

    function testSponsoredLaunchRequiresHealthyOracleWhileMinterModeCanStillLaunch() public {
        _setFeesEnabled(true);
        feePriceFeed.setShouldRevert(true);

        uint8 sponsoredMode = factory.FEE_MODE_SPONSORED();

        vm.expectRevert(RF_FeeOracleUnavailable.selector);
        factory.createCollectionWithFeeMode(
            "No Free Sponsor",
            "NFS",
            "oracle-down sponsored launch",
            10,
            32,
            32,
            1,
            PAYOUT,
            ROYALTY,
            500,
            sponsoredMode
        );

        // Minter Supported can still be created. If the oracle remains unhealthy at
        // mint time, only the platform fee fails open; the creator's mint remains usable.
        (address cAddr,) = factory.createCollection(
            "Minter Still Live",
            "MSL",
            "oracle-down minter-supported launch",
            10,
            32,
            32,
            1,
            PAYOUT,
            ROYALTY,
            500
        );

        RelicCollectionV1 c = RelicCollectionV1(cAddr);
        assertEq(
            uint256(c.platformFeeMode()),
            uint256(factory.FEE_MODE_MINTER_SUPPORTED()),
            "minter-supported launch remains available"
        );
        assertEq(uint256(c.lockedPlatformFeeCents()), 50, "locked cents preserved");
    }

    function testSponsoredCollectionNeverChargesMintersLater() public {
        _setFeesEnabled(true);
        (RelicCollectionV1 c, RelicProjectDataV1 d,) = _newSponsored(4);
        _configureAndSealData(d, 4);

        uint32 phase = c.createPhase(
            0,
            uint64(block.timestamp),
            0,
            0,
            0,
            bytes32(0),
            c.ACCESS_PUBLIC(),
            1,
            true
        );
        c.setMasterMintEnabled(true);

        (uint256 fee,, bool active) = c.platformMintFeeQuote(1);
        assertEq(fee, 0, "sponsored mint fee zero");
        assertFalse(active, "sponsored mode not minter-billed");

        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        assertEq(c.accruedPlatformFees(), 0, "no minter fee accrued");
    }

    function testMinterSupportedChargesFiftyCentsPerNftEquivalent() public {
        _setFeesEnabled(true);

        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (
            uint256 creatorPrice,
            uint256 platformFee,
            uint256 minimumValue,
            bool healthy,
            bool active
        ) = collection.quoteMint(phase, 2);

        assertEq(creatorPrice, 2 ether, "creator price");
        assertTrue(healthy, "oracle healthy");
        assertTrue(active, "fee active");
        assertGt(platformFee, 0, "platform fee");
        assertEq(minimumValue, creatorPrice + platformFee, "minimum includes fee");

        vm.prank(BOB);
        collection.mint{value: minimumValue}(phase, 2, 0, new bytes32[](0));

        assertEq(collection.accruedPlatformFees(), platformFee, "fee reserved");
        assertEq(address(collection).balance, minimumValue, "full payment held");
    }

    function testPlatformFeeScalesExactlyWithQuantity() public {
        _setFeesEnabled(true);

        (uint256 one,,) = collection.platformMintFeeQuote(1);
        (uint256 four,,) = collection.platformMintFeeQuote(4);
        assertEq(four, one * 4, "four NFTs = four per-token fees at fixed oracle price");
    }

    function testGlobalToggleCanPauseAndRestoreLockedMinterFee() public {
        _setFeesEnabled(true);
        (uint256 feeBefore, bool healthyBefore, bool activeBefore) = collection.platformMintFeeQuote(1);
        assertTrue(healthyBefore && activeBefore, "fee initially active");
        assertGt(feeBefore, 0, "fee quoted");

        _setFeesEnabled(false);
        (uint256 feeOff,, bool activeOff) = collection.platformMintFeeQuote(1);
        assertEq(feeOff, 0, "fee paused");
        assertFalse(activeOff, "inactive while globally off");

        _setFeesEnabled(true);
        (uint256 feeAfter, bool healthyAfter, bool activeAfter) = collection.platformMintFeeQuote(1);
        assertTrue(healthyAfter && activeAfter, "fee restored");
        assertEq(feeAfter, feeBefore, "same locked cents restored");
    }

    function testPermanentCollectionWaiverCannotBeReactivatedByGlobalToggle() public {
        _setFeesEnabled(true);

        vm.prank(PLATFORM_ADMIN);
        feePolicy.waiveCollection(address(collection));

        _setFeesEnabled(false);
        _setFeesEnabled(true);

        (uint256 fee,, bool active) = collection.platformMintFeeQuote(1);
        assertEq(fee, 0, "waiver remains zero");
        assertFalse(active, "waiver remains inactive");

        (bool ok,) = address(feePolicy).call(
            abi.encodeWithSignature("setCollectionWaived(address,bool)", address(collection), false)
        );
        assertFalse(ok, "no unwaive backdoor");
    }

    function testStaleOracleFailsOpenInsteadOfBlockingMint() public {
        _setFeesEnabled(true);

        vm.warp(10 days);
        feePriceFeed.setUpdatedAt(1);

        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (
            uint256 creatorPrice,
            uint256 platformFee,
            uint256 minimumValue,
            bool healthy,
            bool active
        ) = collection.quoteMint(phase, 1);

        assertEq(creatorPrice, 1 ether, "creator price preserved");
        assertEq(platformFee, 0, "stale fee zero");
        assertEq(minimumValue, creatorPrice, "no platform amount required");
        assertFalse(healthy, "oracle unhealthy");
        assertTrue(active, "policy still logically active");

        vm.prank(BOB);
        collection.mint{value: creatorPrice}(phase, 1, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 1, "mint remains live");
        assertEq(collection.accruedPlatformFees(), 0, "no fee accrued from stale oracle");
    }

    function testRevertingOracleFailsOpenInsteadOfBlockingMint() public {
        _setFeesEnabled(true);
        feePriceFeed.setShouldRevert(true);

        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (, uint256 platformFee, uint256 minimumValue, bool healthy, bool active) =
            collection.quoteMint(phase, 1);

        assertEq(platformFee, 0, "oracle failure fee zero");
        assertEq(minimumValue, 0, "free mint remains free");
        assertFalse(healthy, "oracle unhealthy");
        assertTrue(active, "fee policy enabled");

        vm.prank(BOB);
        collection.mint(phase, 1, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 1, "mint succeeded");
    }

    function testCreatorWithdrawalCannotTakeReservedPlatformFees() public {
        _setFeesEnabled(true);

        uint32 phase = _createPublicPhase(1 ether, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (, uint256 platformFee, uint256 minimumValue,,) = collection.quoteMint(phase, 1);

        vm.prank(BOB);
        collection.mint{value: minimumValue}(phase, 1, 0, new bytes32[](0));

        uint256 payoutBefore = PAYOUT.balance;
        collection.withdraw();

        assertEq(PAYOUT.balance - payoutBefore, 1 ether, "creator receives only creator proceeds");
        assertEq(address(collection).balance, platformFee, "platform fee remains reserved");
        assertEq(collection.accruedPlatformFees(), platformFee, "reservation accounting intact");
    }

    function testPlatformFeesForwardThenWithdrawOnlyToTreasury() public {
        _setFeesEnabled(true);

        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (, uint256 platformFee, uint256 minimumValue,,) = collection.quoteMint(phase, 2);

        vm.prank(BOB);
        collection.mint{value: minimumValue}(phase, 2, 0, new bytes32[](0));

        collection.withdrawPlatformFees();

        assertEq(collection.accruedPlatformFees(), 0, "collection reservation cleared");
        assertEq(feePolicy.accruedFees(), platformFee, "policy received exact reserved fee");

        uint256 treasuryBefore = FEE_TREASURY.balance;
        vm.prank(ALICE);
        feePolicy.withdrawFees();

        assertEq(FEE_TREASURY.balance - treasuryBefore, platformFee, "only treasury receives platform funds");
        assertEq(feePolicy.accruedFees(), 0, "central accrual cleared");
    }

    function testRejectingTreasuryCannotBurnAccruedPlatformFees() public {
        _setFeesEnabled(true);

        RejectingFeeTreasuryV1 rejector = new RejectingFeeTreasuryV1();
        vm.prank(PLATFORM_ADMIN);
        feePolicy.setTreasury(address(rejector));

        uint32 phase = _createPublicPhase(0, uint64(block.timestamp));
        collection.setMasterMintEnabled(true);

        (, uint256 platformFee, uint256 minimumValue,,) = collection.quoteMint(phase, 1);
        vm.prank(BOB);
        collection.mint{value: minimumValue}(phase, 1, 0, new bytes32[](0));
        collection.withdrawPlatformFees();

        vm.expectRevert(RF_WithdrawFailed.selector);
        feePolicy.withdrawFees();

        assertEq(feePolicy.accruedFees(), platformFee, "failed treasury transfer rolls accounting back");
        assertEq(address(feePolicy).balance, platformFee, "funds remain recoverable");
    }

    function testFeeAccountingSurvivesCreatorRenunciation() public {
        _setFeesEnabled(true);

        collection.setFutureRevealMode(collection.REVEAL_FORGE());
        collection.renounceControl();

        (uint256 fee, bool healthy, bool active) = collection.platformMintFeeQuote(1);
        assertTrue(healthy && active, "fee policy independent of controller");
        assertGt(fee, 0, "fee remains quoteable");
    }
}