// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";

/// @notice R13.4 release regression. All mocks are local and deliberately small.
/// @dev Exercises the real production contracts. No production source is modified.

contract R134SaleState is IRelicCollectionSaleStateV2 {
    uint32 public override totalCommitted;
    uint32 public override maxSupply = 100;
    bool public override delayedRevealRequested;
    bool public override delayedRevealed;

    function setState(uint32 committed, uint32 supply, bool requested, bool revealed) external {
        totalCommitted = committed;
        maxSupply = supply;
        delayedRevealRequested = requested;
        delayedRevealed = revealed;
    }

    function consume(RelicMintPhasesV2 phases, address payer, uint32 id, uint32 qty, uint32 allowance, bytes32[] memory proof)
        external
        returns (uint256, uint256, bool, bool)
    {
        return phases.consumeMint(payer, id, qty, allowance, proof);
    }
}

contract R134Oracle is IRFAggregatorV3V1 {
    uint8 public override decimals;
    uint80 public roundId = 10;
    int256 public answer = 3000e8;
    uint256 public updatedAt;
    uint80 public answeredInRound = 10;
    bool public shouldRevert;

    constructor(uint8 decimals_) {
        decimals = decimals_;
        updatedAt = block.timestamp;
    }

    function setRound(uint80 round_, int256 answer_, uint256 updated_, uint80 answered_) external {
        roundId = round_;
        answer = answer_;
        updatedAt = updated_;
        answeredInRound = answered_;
    }

    function setRevert(bool value) external { shouldRevert = value; }

    function latestRoundData()
        external view override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        if (shouldRevert) revert("oracle unavailable");
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

contract R134FeeView is IRelicCollectionFeeViewV1 {
    address public override feePolicy;
    address public override creator;
    address public override factory;
    uint32 public override maxSupply = 100;
    uint8 public override platformFeeMode = 2;
    uint32 public override lockedPlatformFeeCents = 50;

    constructor(address policy) {
        feePolicy = policy;
        creator = msg.sender;
        factory = msg.sender;
    }
}

contract R134Data {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed = true;

    constructor(address creator_, uint32 supply_) {
        creator = creator_;
        maxSupply = supply_;
    }
}

contract R134Renderer {
    function tokenURI(address, uint256) external pure returns (string memory) { return ""; }
    function contractURI(address) external pure returns (string memory) { return ""; }
    function renderToken(address, uint256) external pure returns (string memory) { return ""; }
    function renderPlaceholder(address) external pure returns (string memory) { return ""; }
}

contract R134Randomness {
    uint256 public quote = 0.001 ether;
    uint256 public nextRequestId = 1;
    uint256 public requests;

    function quoteRequestPrice(uint32) external view returns (uint256) { return quote; }
    function requestRandomness(uint256, uint32) external payable returns (uint256 id) {
        require(msg.value == quote, "wrong randomness price");
        id = nextRequestId++;
        ++requests;
    }
}

contract R134Reserve {
    uint256 public syncs;
    uint256 public lastExposure;
    uint256 public lastActiveBatches;
    uint256 public lastRestricted;
    uint256 public totalDeposits;

    function factory() external pure returns (address) { return address(0); }
    function canonicalCollection(address) external pure returns (bool) { return true; }
    function registerCollection(address) external {}

    function syncCollection(address collection) external {
        ++syncs;
        lastExposure = IRelicForgeReserveCollectionV2Prod(collection).reserveExposureWei();
        lastActiveBatches = IRelicForgeReserveCollectionV2Prod(collection).activeForgeBatchCount();
        lastRestricted = IRelicForgeReserveCollectionV2Prod(collection).restrictedSponsoredLiabilityWei();
    }

    function fundRandomnessShortfall(uint64, uint256) external {
        revert("unexpected reserve draw");
    }

    function depositFromCollection() external payable {
        totalDeposits += msg.value;
    }

    receive() external payable {}
}

/// @notice Isolated state-machine boundary tests for the real MintPhases implementation.
contract R134SaleBoundaryTest is TestBase {
    uint256 internal constant T = 1_800_000_000;
    uint96 internal constant PRICE = 0.01 ether;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    R134SaleState internal sale;
    RelicMintPhasesV2 internal phases;

    function setUp() public {
        vm.chainId(1);
        vm.warp(T);
        sale = new R134SaleState();
        RelicMintPhasesV2 implementation = new RelicMintPhasesV2();
        // EIP-1167 clone: never initialize the implementation itself.
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(address(implementation)),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        address clone;
        assembly ("memory-safe") { clone := create(0, add(code, 0x20), mload(code)) }
        require(clone != address(0), "clone failed");
        phases = RelicMintPhasesV2(clone);
        // Sponsored mode isolates sale timing from fee-oracle behavior.
        phases.initialize(address(sale), address(this), address(sale), 1, 0);
        phases.setMasterMintEnabled(true);
    }

    function _phase(uint64 start, uint64 end, uint32 supply, uint32 walletCap)
        internal returns (uint32)
    {
        return phases.createPhase(PRICE, start, end, supply, walletCap, bytes32(0), 0, 1, true);
    }

    function _consume(uint32 id, address payer, uint32 qty)
        internal returns (uint256, uint256, bool, bool)
    {
        return sale.consume(phases, payer, id, qty, 0, new bytes32[](0));
    }

    function _minted(uint32 id) internal view returns (uint32 minted) {
        (,,,, minted,,,,,) = phases.phases(id);
    }

    function testStartInclusiveAndEndExclusive() public {
        uint32 id = _phase(uint64(T + 10), uint64(T + 20), 10, 5);
        vm.warp(T + 9);
        assertFalse(phases.phaseIsOpen(id), "start minus one");
        vm.expectRevert(RF_PhaseNotStarted.selector);
        _consume(id, ALICE, 1);
        vm.warp(T + 10);
        assertTrue(phases.phaseIsOpen(id), "start inclusive");
        (uint256 creatorPrice,,,) = _consume(id, ALICE, 1);
        assertEq(creatorPrice, PRICE, "price at exact start");
        vm.warp(T + 19);
        assertTrue(phases.phaseIsOpen(id), "end minus one");
        _consume(id, ALICE, 1);
        vm.warp(T + 20);
        assertFalse(phases.phaseIsOpen(id), "end exclusive");
        vm.expectRevert(RF_PhaseClosed.selector);
        _consume(id, ALICE, 1);
        assertEq(_minted(id), 2, "only valid mints counted");
        assertEq(phases.phaseWalletMinted(id, ALICE), 2, "wallet count unchanged by rejection");
    }

    function testImmediateStartAndUnboundedEnd() public {
        uint32 id = _phase(0, 0, 0, 0);
        assertTrue(phases.phaseIsOpen(id), "immediate phase");
        vm.warp(T + 1_000_000);
        assertTrue(phases.phaseIsOpen(id), "no end means no deadline");
        _consume(id, ALICE, 1);
    }

    function testMasterAndPhaseSwitchesFailClosed() public {
        uint32 id = _phase(uint64(T), 0, 10, 0);
        phases.setMasterMintEnabled(false);
        assertFalse(phases.phaseIsOpen(id), "master paused");
        vm.expectRevert(RF_PublicSalePaused.selector);
        _consume(id, ALICE, 1);
        phases.setMasterMintEnabled(true);
        phases.setPhaseEnabled(id, false);
        assertFalse(phases.phaseIsOpen(id), "phase disabled");
        vm.expectRevert(RF_PhaseDisabled.selector);
        _consume(id, ALICE, 1);
        phases.setPhaseEnabled(id, true);
        _consume(id, ALICE, 1);
        assertEq(_minted(id), 1, "one accepted mint");
    }

    function testOverlappingPhasesHaveIndependentCounters() public {
        uint32 first = _phase(uint64(T), uint64(T + 100), 2, 1);
        uint32 second = _phase(uint64(T), uint64(T + 100), 3, 2);
        _consume(first, ALICE, 1);
        vm.expectRevert(RF_WalletLimit.selector);
        _consume(first, ALICE, 1);
        _consume(second, ALICE, 2);
        assertEq(_minted(first), 1, "first phase count");
        assertEq(_minted(second), 2, "second phase count");
        assertEq(phases.phaseWalletMinted(first, ALICE), 1, "first wallet count");
        assertEq(phases.phaseWalletMinted(second, ALICE), 2, "second wallet count");
    }

    function testScheduleUpdateDoesNotResetConsumedAllowance() public {
        uint32 id = _phase(uint64(T), uint64(T + 100), 3, 2);
        _consume(id, ALICE, 1);
        phases.updatePhase(id, PRICE, uint64(T + 20), uint64(T + 40), 3, 2, bytes32(0), 0, 1);
        assertEq(_minted(id), 1, "phase count preserved");
        vm.warp(T + 19);
        vm.expectRevert(RF_PhaseNotStarted.selector);
        _consume(id, ALICE, 1);
        vm.warp(T + 20);
        _consume(id, ALICE, 1);
        vm.expectRevert(RF_WalletLimit.selector);
        _consume(id, ALICE, 1);
        vm.warp(T + 40);
        vm.expectRevert(RF_PhaseClosed.selector);
        _consume(id, BOB, 1);
        assertEq(_minted(id), 2, "update cannot reset counts");
    }

    function testInvalidScheduleAndReductionBelowMintedReject() public {
        vm.expectRevert(RF_BadTimeRange.selector);
        _phase(uint64(T + 10), uint64(T + 10), 10, 0);
        uint32 id = _phase(uint64(T), 0, 10, 0);
        _consume(id, ALICE, 2);
        vm.expectRevert(RF_PhaseSoldOut.selector);
        phases.updatePhase(id, PRICE, uint64(T), 0, 1, 0, bytes32(0), 0, 1);
        assertEq(_minted(id), 2, "invalid update is atomic");
    }

    function testPhaseAndCollectionSupplyBoundaries() public {
        uint32 id = _phase(uint64(T), 0, 2, 0);
        _consume(id, ALICE, 2);
        assertFalse(phases.phaseIsOpen(id), "phase sold out");
        vm.expectRevert(RF_PhaseSoldOut.selector);
        _consume(id, BOB, 1);
        uint32 other = _phase(uint64(T), 0, 0, 0);
        sale.setState(100, 100, false, false);
        assertFalse(phases.phaseIsOpen(other), "collection supply exhausted");
    }

    function testPendingDelayedRevealClosesEligibility() public {
        uint32 id = _phase(uint64(T), 0, 10, 0);
        sale.setState(1, 100, true, false);
        assertFalse(phases.phaseIsOpen(id), "reveal pending");
        sale.setState(1, 100, true, true);
        assertTrue(phases.phaseIsOpen(id), "reveal completed");
    }

    function testOnlyBoundCollectionCanConsumeAndRevertsAreAtomic() public {
        uint32 id = _phase(uint64(T), 0, 2, 1);
        vm.expectRevert(RF_NotAuthorized.selector);
        phases.consumeMint(ALICE, id, 1, 0, new bytes32[](0));
        _consume(id, ALICE, 1);
        vm.expectRevert(RF_WalletLimit.selector);
        _consume(id, ALICE, 1);
        assertEq(_minted(id), 1, "rejected call did not advance supply");
    }

    function testMerkleProofCannotBypassExpiredWindow() public {
        uint32 id = phases.phaseCount() + 1;
        uint32 allowance = 2;
        bytes32 leaf = keccak256(abi.encode(block.chainid, address(sale), id, ALICE, allowance));
        uint32 created = phases.createPhase(PRICE, uint64(T), uint64(T + 10), 5, 0, leaf, 1, 1, true);
        assertEq(created, id, "expected phase id");
        bytes32[] memory proof = new bytes32[](0);
        vm.warp(T + 10);
        vm.expectRevert(RF_PhaseClosed.selector);
        sale.consume(phases, ALICE, id, 1, allowance, proof);
        assertEq(_minted(id), 0, "valid proof cannot bypass deadline");
    }

    function testMerkleAllowanceAndChainBinding() public {
        uint32 id = phases.phaseCount() + 1;
        bytes32 leaf = keccak256(abi.encode(block.chainid, address(sale), id, ALICE, uint32(2)));
        phases.createPhase(PRICE, uint64(T), 0, 5, 0, leaf, 1, 1, true);
        bytes32[] memory proof = new bytes32[](0);
        sale.consume(phases, ALICE, id, 2, 2, proof);
        vm.expectRevert(RF_InsufficientAllowance.selector);
        sale.consume(phases, ALICE, id, 1, 2, proof);
        vm.chainId(2);
        vm.expectRevert(RF_BadProof.selector);
        sale.consume(phases, ALICE, id, 1, 2, proof);
        assertEq(_minted(id), 2, "invalid proofs do not consume supply");
    }
}

/// @notice Real FeePolicy with a controllable AggregatorV3-compatible oracle.
contract R134OracleBoundaryTest is TestBase {
    uint256 internal constant T = 1_800_000_000;
    uint256 internal constant AGE = 1 days;
    R134Oracle internal oracle;
    RelicForgeFeePolicyV1 internal policy;
    R134FeeView internal collectionView;

    function setUp() public {
        vm.warp(T);
        oracle = new R134Oracle(8);
        policy = new RelicForgeFeePolicyV1(address(this), address(0x7EA5), address(oracle), uint64(AGE));
        collectionView = new R134FeeView(address(policy));
    }

    function _healthy(uint256 cents) internal view returns (bool) {
        (, bool healthy) = policy.quoteUsdCents(cents);
        return healthy;
    }

    function testExactMaximumAgeAndOneSecondStale() public {
        oracle.setRound(10, 3000e8, T, 10);
        vm.warp(T + AGE);
        assertTrue(_healthy(50), "exact maximum age accepted");
        vm.warp(T + AGE + 1);
        assertFalse(_healthy(50), "one second stale rejected");
    }

    function testFutureZeroNegativeAndIncompleteRoundsFailClosed() public {
        oracle.setRound(10, 3000e8, T + 1, 10);
        assertFalse(_healthy(50), "future timestamp");
        oracle.setRound(10, 3000e8, 0, 10);
        assertFalse(_healthy(50), "zero timestamp");
        oracle.setRound(10, 0, T, 10);
        assertFalse(_healthy(50), "zero answer");
        oracle.setRound(10, -1, T, 10);
        assertFalse(_healthy(50), "negative answer");
        oracle.setRound(10, 3000e8, T, 9);
        assertFalse(_healthy(50), "incomplete round");
        oracle.setRound(10, 3000e8, T, 10);
        assertTrue(_healthy(50), "valid round restored");
    }

    function testOracleRevertAndZeroCentsAreExplicitlyHandled() public {
        oracle.setRevert(true);
        assertFalse(_healthy(50), "oracle revert rejected");
        (uint256 amount, bool healthy) = policy.quoteUsdCents(0);
        assertEq(amount, 0, "zero amount");
        assertTrue(healthy, "zero charge does not need an oracle");
    }

    function testOracleDecimalsAboveEighteenRejectAtConstruction() public {
        R134Oracle bad = new R134Oracle(19);
        vm.expectRevert(RF_BadOracleConfig.selector);
        new RelicForgeFeePolicyV1(address(this), address(0x7EA5), address(bad), uint64(AGE));
    }

    function testOracleAgeMustBePositive() public {
        vm.expectRevert(RF_BadOracleConfig.selector);
        new RelicForgeFeePolicyV1(address(this), address(0x7EA5), address(oracle), 0);
    }

    function testWeiQuoteRoundsUpWithoutUndercharging() public {
        uint256 cents = 1;
        uint256 numerator = cents * 1 ether * 1e8;
        uint256 denominator = 3000e8 * 100;
        uint256 expected = numerator / denominator;
        if (numerator % denominator != 0) ++expected;
        (uint256 amount, bool healthy) = policy.quoteUsdCents(cents);
        assertTrue(healthy, "healthy quote");
        assertEq(amount, expected, "exact ceiling division");
        assertTrue(amount * denominator >= numerator, "does not undercharge");
        assertTrue((amount - 1) * denominator < numerator, "minimal integer wei");
    }

    function testLargeAnswerAndExcessCentsFailClosed() public {
        oracle.setRound(10, type(int256).max, T, 10);
        assertFalse(_healthy(50), "denominator multiplication overflow guard");
        oracle.setRound(10, 3000e8, T, 10);
        assertFalse(_healthy(uint256(type(uint32).max) * 500 + 1), "USD bound");
        assertTrue(_healthy(uint256(type(uint32).max) * 500), "maximum allowed USD amount");
    }

    function testMinterQuoteRetainsActiveFlagWhenOracleUnhealthy() public {
        oracle.setRound(10, 3000e8, 0, 10);
        (uint256 fee, bool healthy, bool active) =
            policy.quoteMintFee(address(collectionView), 50, 1);
        assertEq(fee, 0, "no unreliable fee quote");
        assertFalse(healthy, "oracle unhealthy");
        assertTrue(active, "fee policy still active");
        policy.setCollectionFeesEnabled(address(collectionView), false);
        (fee, healthy, active) = policy.quoteMintFee(address(collectionView), 50, 1);
        assertEq(fee, 0, "disabled fee");
        assertTrue(healthy, "disabled fee needs no oracle");
        assertFalse(active, "disabled fee is inactive");
    }

    function testConfigurableShorterAgePolicy() public {
        RelicForgeFeePolicyV1 strict = new RelicForgeFeePolicyV1(
            address(this), address(0x7EA5), address(oracle), 1 hours
        );
        oracle.setRound(10, 3000e8, T, 10);
        vm.warp(T + 1 hours);
        (, bool healthy) = strict.quoteUsdCents(50);
        assertTrue(healthy, "exact one-hour limit");
        vm.warp(T + 1 hours + 1);
        (, healthy) = strict.quoteUsdCents(50);
        assertFalse(healthy, "shorter policy expires");
    }
}

/// @notice Full Collection -> MintPhases -> FeePolicy -> Reserve-mock boundary tests.
/// @dev Uses real production collection and sale clones, not a recreated mint algorithm.
contract R134CollectionBoundaryTest is TestBase {
    uint256 internal constant T = 1_800_000_000;
    uint96 internal constant PRICE = 0.01 ether;
    uint32 internal constant SUPPLY = 50;
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    struct BatchView {
        uint64 firstReservationId;
        uint64 lastReservationId;
        uint64 openedAt;
        uint64 lockedAt;
        uint32 reservationCount;
        uint32 totalQuantity;
        uint256 randomnessCost;
        uint256 requestId;
        uint256 randomWord;
        bool locked;
        bool wordReady;
        bool settled;
    }

    RelicCollectionV2 internal collection;
    RelicMintPhasesV2 internal phases;
    RelicForgeFeePolicyV1 internal policy;
    R134Oracle internal oracle;
    R134Reserve internal reserve;
    R134Randomness internal randomness;

    function _clone(address implementation) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(implementation),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly ("memory-safe") { instance := create(0, add(code, 0x20), mload(code)) }
        require(instance != address(0), "clone failed");
    }

    function setUp() public {
        vm.chainId(1);
        vm.warp(T);
        oracle = new R134Oracle(8);
        policy = new RelicForgeFeePolicyV1(address(this), address(0x7EA5), address(oracle), 1 days);
        reserve = new R134Reserve();
        randomness = new R134Randomness();
        R134Data data = new R134Data(address(this), SUPPLY);
        R134Renderer renderer = new R134Renderer();

        collection = RelicCollectionV2(payable(_clone(address(new RelicCollectionV2()))));
        phases = RelicMintPhasesV2(_clone(address(new RelicMintPhasesV2())));
        phases.initialize(address(collection), address(this), address(policy), 2, 50);

        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "R13 Boundary",
            symbol: "R13",
            description: "Local regression only",
            creator: address(this),
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(randomness),
            forgeReserve: address(reserve),
            feePolicy: address(policy),
            mintPhases: address(phases),
            maxSupply: SUPPLY,
            payoutReceiver: address(this),
            royaltyReceiver: address(this),
            royaltyBps: 0,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: 0,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        collection.initialize(init);
        vm.deal(ALICE, 10 ether);
        vm.deal(BOB, 10 ether);
    }

    function _phase(uint64 start, uint64 end, uint32 supply) internal returns (uint32) {
        uint32 id = phases.createPhase(PRICE, start, end, supply, 0, bytes32(0), 0, 1, true);
        phases.setMasterMintEnabled(true);
        return id;
    }

    function _mint(address payer, uint32 phaseId, uint32 qty) internal {
        (,, uint256 value, bool healthy,) = phases.quoteMint(phaseId, qty);
        assertTrue(healthy, "fixture oracle must be healthy");
        vm.prank(payer);
        collection.mint{value: value}(phaseId, qty, 0, new bytes32[](0));
    }

    function _batch(uint64 id) internal view returns (BatchView memory b) {
        (bool ok, bytes memory data) = address(collection).staticcall(
            abi.encodeWithSignature("batches(uint64)", id)
        );
        require(ok, "batch getter failed");
        b = abi.decode(data, (BatchView));
    }

    function _minted(uint32 id) internal view returns (uint32 minted) {
        (,,,, minted,,,,,) = phases.phases(id);
    }

    function testRealMintBoundariesAndExactPayments() public {
        uint32 id = _phase(uint64(T + 10), uint64(T + 20), 5);
        vm.warp(T + 9);
        vm.expectRevert(RF_PhaseNotStarted.selector);
        collection.mint(id, 1, 0, new bytes32[](0));
        vm.warp(T + 10);
        _mint(ALICE, id, 1);
        vm.warp(T + 19);
        _mint(BOB, id, 1);
        vm.warp(T + 20);
        vm.prank(ALICE);
        vm.expectRevert(RF_PhaseClosed.selector);
        collection.mint(id, 1, 0, new bytes32[](0));
        assertEq(collection.totalCommitted(), 2, "only two accepted");
        assertEq(collection.totalMinted(), 2, "two real NFTs");
        assertEq(_minted(id), 2, "sale counter");
        assertEq(phases.phaseWalletMinted(id, ALICE), 1, "Alice count");
        assertEq(phases.phaseWalletMinted(id, BOB), 1, "Bob count");
        assertEq(collection.balanceOf(ALICE), 1, "Alice ownership");
        assertEq(collection.balanceOf(BOB), 1, "Bob ownership");
        assertEq(reserve.lastActiveBatches(), 1, "deferred reveal liability synchronized");
    }

    function testRealMintPaymentRevertRollsBackSaleCounters() public {
        uint32 id = _phase(uint64(T), 0, 5);
        (,, uint256 required,,) = phases.quoteMint(id, 1);
        vm.prank(ALICE);
        vm.expectRevert(RF_WrongPrice.selector);
        collection.mint{value: required - 1}(id, 1, 0, new bytes32[](0));
        assertEq(_minted(id), 0, "phase count rolled back");
        assertEq(phases.phaseWalletMinted(id, ALICE), 0, "wallet count rolled back");
        assertEq(collection.totalCommitted(), 0, "supply rolled back");
        assertEq(collection.hopperBalance(), 0, "hopper unchanged");
        assertEq(reserve.syncs(), 0, "no reserve sync on rejected mint");
        _mint(ALICE, id, 1);
        assertEq(_minted(id), 1, "valid mint succeeds");
    }

    function testExpiredPhaseCannotQueueAdditionalForgeReservations() public {
        collection.setFutureRevealMode(1);
        uint32 id = _phase(uint64(T), uint64(T + 10), 5);
        _mint(ALICE, id, 1);
        vm.warp(T + 10);
        vm.prank(BOB);
        vm.expectRevert(RF_PhaseClosed.selector);
        collection.mint(id, 1, 0, new bytes32[](0));
        assertEq(collection.totalCommitted(), 1, "no new reservation");
        assertEq(collection.nextReservationId(), 2, "reservation cursor unchanged");
        assertEq(_minted(id), 1, "phase count unchanged");
        assertEq(collection.openBatchId(), 1, "existing batch still open");
    }

    function testForgeTimeoutExactBoundaryAndAccountingConservation() public {
        collection.setFutureRevealMode(1);
        uint32 id = _phase(uint64(T), 0, SUPPLY);
        _mint(ALICE, id, 2);
        BatchView memory beforeLock = _batch(1);
        assertEq(beforeLock.openedAt, T, "batch start");
        assertEq(beforeLock.totalQuantity, 2, "two reserved");
        assertFalse(beforeLock.locked, "not locked prematurely");
        assertEq(collection.totalCommitted(), 2, "committed supply");
        assertEq(collection.totalMinted(), 0, "no NFTs before settlement");

        uint256 escrow = collection.creatorEscrow();
        uint256 hopper = collection.hopperBalance();
        uint256 exposure = collection.reserveExposureWei();
        uint256 active = collection.activeForgeBatchCount();
        uint256 balance = address(collection).balance;

        vm.warp(T + 179);
        vm.expectRevert(RF_PhaseNotStarted.selector);
        collection.lockTimedOutBatch();
        vm.warp(T + 180);
        assertEq(collection.lockTimedOutBatch(), 1, "exact deadline succeeds");

        BatchView memory afterLock = _batch(1);
        assertTrue(afterLock.locked, "locked");
        assertEq(afterLock.lockedAt, T + 180, "exact lock timestamp");
        assertFalse(afterLock.wordReady, "no randomness delivered");
        assertFalse(afterLock.settled, "no settlement");
        assertEq(afterLock.requestId, 0, "no randomness request");
        assertEq(collection.openBatchId(), 2, "next batch");
        assertEq(collection.unrequestedLockedBatches(), 1, "one outstanding request");
        assertEq(collection.lockedUnsettledBatches(), 1, "one unsettled batch");
        assertEq(collection.totalCommitted(), 2, "supply conserved");
        assertEq(collection.totalMinted(), 0, "no token minted by lock");
        assertEq(collection.creatorEscrow(), escrow, "escrow conserved");
        assertEq(collection.hopperBalance(), hopper, "hopper conserved");
        assertEq(address(collection).balance, balance, "ETH balance conserved");
        assertEq(collection.reserveExposureWei(), exposure, "reserve exposure conserved");
        assertEq(collection.activeForgeBatchCount(), active, "active liability conserved");
        assertEq(randomness.requests(), 0, "lock never calls VRF");

        vm.expectRevert(RF_BadRequest.selector);
        collection.lockTimedOutBatch();
        assertEq(collection.openBatchId(), 2, "repeated lock cannot advance cursor");
        assertEq(collection.unrequestedLockedBatches(), 1, "no double liability");
    }

    function testFullBatchAndSelloutCloseWithoutWaitingForTimeout() public {
        collection.setFutureRevealMode(1);
        uint32 id = _phase(uint64(T), 0, SUPPLY);
        _mint(ALICE, id, 20);
        assertTrue(_batch(1).locked, "full batch immediately locked");
        assertEq(collection.openBatchId(), 2, "second batch opens");
        _mint(BOB, id, 30);
        assertTrue(_batch(2).locked, "second full batch");
        assertTrue(_batch(3).locked, "sellout closes partial final batch");
        assertEq(_batch(3).totalQuantity, 10, "last batch size");
        assertEq(collection.openBatchId(), 4, "three locked batches");
        assertEq(collection.totalCommitted(), SUPPLY, "all supply committed");
        assertEq(collection.totalMinted(), 0, "no premature NFT delivery");
        assertEq(collection.pendingSupply(), SUPPLY, "pending supply");
        assertEq(_minted(id), SUPPLY, "phase supply count");
        assertEq(collection.unrequestedLockedBatches(), 3, "three pending VRF obligations");
        assertEq(collection.lockedUnsettledBatches(), 3, "three unsettled batches");
        assertEq(reserve.lastActiveBatches(), 3, "reserve sync includes all batches");
        assertEq(randomness.requests(), 0, "collector mints do not request VRF");
        assertFalse(phases.phaseIsOpen(id), "sold-out collection closes sale");
        vm.expectRevert(RF_BadRequest.selector);
        collection.lockTimedOutBatch();
    }
}
