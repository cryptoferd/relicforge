// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicCollectorBatchContributionV2Candidate.sol";

contract R11CanonicalRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who, bool value) external {
        canonical[who] = value;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract ForgeRevealV2Phase2DRobinhoodContributionSourceTest is TestBase {
    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);
    address internal constant EXECUTOR_A = address(0xE001);
    address internal constant EXECUTOR_B = address(0xE002);
    address internal constant SETTLER = address(0xE003);
    address internal constant BUYER = address(0xB001);

    uint128 internal constant DICE_FEE = 0.000025 ether;
    uint256 internal constant MINTER_FEE = 0.001 ether;
    uint256 internal constant MAX_RNG_COST = 0.02 ether;

    struct Fixture {
        RelicDiceEntropyV10Mock dice;
        R11CanonicalRegistryMockV2 registry;
        RelicCollectorBatchContributionSourceV2Candidate source;
        RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate adapter;
        RelicForgeReserveV2Harness reserve;
        RelicForgeContributionQueueV2Harness collection;
    }

    function _fixture(uint32 supply, uint256 reserveFunding, bool canonical) internal returns (Fixture memory f) {
        vm.chainId(4663);
        vm.deal(address(this), 20 ether);
        f.dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 200_000, 6);
        f.registry = new R11CanonicalRegistryMockV2();
        f.source = new RelicCollectorBatchContributionSourceV2Candidate(address(f.registry));
        f.adapter = new RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate(
            address(f.dice), address(f.registry), DICE_PROVIDER, address(f.source)
        );
        f.reserve = new RelicForgeReserveV2Harness{value: reserveFunding}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        f.collection = new RelicForgeContributionQueueV2Harness(
            CREATOR,
            address(f.adapter),
            address(f.reserve),
            2,
            supply,
            3,
            0,
            0,
            MINTER_FEE,
            MINTER_FEE / 2,
            MAX_RNG_COST
        );
        if (canonical) f.registry.setCanonical(address(f.collection), true);
        f.reserve.registerCollection(address(f.collection));
    }

    function _mint(Fixture memory f, uint32 quantity, bytes32 entropy) internal {
        uint256 value = MINTER_FEE * quantity;
        vm.deal(BUYER, value + 1 ether);
        vm.prank(BUYER);
        f.collection.requestForgeMint{value: value}(BUYER, quantity, entropy);
    }

    function testR11LegacyMintEntrypointsFailClosedWithoutExplicitEntropy() public {
        Fixture memory f = _fixture(100, 1 ether, true);
        vm.deal(BUYER, 1 ether);
        vm.deal(CREATOR, 1 ether);

        vm.expectRevert(RFV2_ContributionRequired.selector);
        vm.prank(BUYER);
        f.collection.requestForgeMint{value: MINTER_FEE}(BUYER, 1);

        vm.expectRevert(RFV2_ContributionRequired.selector);
        vm.prank(CREATOR);
        f.collection.creatorMint{value: MINTER_FEE / 2}(CREATOR, 1);

        assertEq(f.collection.totalCommitted(), 0, "entropy-less paths cannot reserve supply");
    }

    function testR11ZeroEntropyRejectsWithoutTouchingMintState() public {
        Fixture memory f = _fixture(100, 1 ether, true);
        vm.deal(BUYER, 1 ether);
        vm.expectRevert(RFV2_BadContribution.selector);
        vm.prank(BUYER);
        f.collection.requestForgeMint{value: MINTER_FEE}(BUYER, 1, bytes32(0));
        assertEq(f.collection.totalCommitted(), 0, "bad entropy cannot reserve supply");
    }

    function testR11FullBatchHasFrozenContributionBeforeAnyProviderRequest() public {
        Fixture memory f = _fixture(100, 1 ether, true);
        _mint(f, 20, keccak256("R11_COLLECTOR_A"));

        (bytes32 contribution, bool ready) = f.collection.frozenRandomnessContribution(1);
        assertTrue(ready, "full batch contribution must be frozen");
        assertTrue(contribution != bytes32(0), "frozen contribution must be nonzero");
        assertEq(f.adapter.nextRequestId(), 1, "collector transaction must not request Dice");
    }

    function testR11TimedOutPartialBatchFreezesContributionWithoutCallingProvider() public {
        Fixture memory f = _fixture(100, 1 ether, true);
        _mint(f, 1, keccak256("R11_PARTIAL"));
        (, bool readyBefore) = f.collection.frozenRandomnessContribution(1);
        assertFalse(readyBefore, "open batch is not yet frozen");

        vm.warp(block.timestamp + 4);
        f.collection.lockTimedOutBatch();
        (bytes32 contribution, bool readyAfter) = f.collection.frozenRandomnessContribution(1);
        assertTrue(readyAfter, "timeout lock freezes contribution");
        assertTrue(contribution != bytes32(0), "timeout contribution must be nonzero");
        assertEq(f.adapter.nextRequestId(), 1, "timeout lock cannot call Dice");
    }

    function testR11MintOutPartialBatchFreezesImmediately() public {
        Fixture memory f = _fixture(3, 1 ether, true);
        _mint(f, 3, keccak256("R11_MINT_OUT"));
        (bytes32 contribution, bool ready) = f.collection.frozenRandomnessContribution(1);
        assertTrue(ready, "mint-out partial batch freezes immediately");
        assertTrue(contribution != bytes32(0), "mint-out contribution must be nonzero");
    }

    function testR11DifferentCollectorEntropyChangesFrozenContribution() public {
        Fixture memory a = _fixture(20, 1 ether, true);
        _mint(a, 20, keccak256("R11_ENTROPY_A"));
        (bytes32 contributionA, bool readyA) = a.collection.frozenRandomnessContribution(1);
        assertTrue(readyA, "A contribution ready");

        Fixture memory b = _fixture(20, 1 ether, true);
        _mint(b, 20, keccak256("R11_ENTROPY_B"));
        (bytes32 contributionB, bool readyB) = b.collection.frozenRandomnessContribution(1);
        assertTrue(readyB, "B contribution ready");
        assertTrue(contributionA != contributionB, "collector entropy must influence contribution");
    }

    function testR11PermissionlessExecutorCannotSelectOrChangeContribution() public {
        Fixture memory f = _fixture(100, 1 ether, true);
        bytes32 entropy = keccak256("R11_EXECUTOR_INDEPENDENT");
        _mint(f, 20, entropy);
        bytes32 previewBefore = f.source.previewContribution(address(f.collection), 1);

        vm.prank(EXECUTOR_B);
        uint256 requestId = f.collection.requestRandomnessForBatch(1);
        assertEq(requestId, 1, "first request id");
        assertEq(
            f.adapter.userContributionByLocalRequestId(1),
            previewBefore,
            "executor cannot select a different contribution"
        );
    }

    function testR11OnlyCollectionBoundAdapterMayConsumeCanonicalContribution() public {
        Fixture memory f = _fixture(20, 1 ether, true);
        _mint(f, 20, keccak256("R11_BOUND_ADAPTER_ONLY"));

        vm.expectRevert(RF_NotAuthorized.selector);
        f.source.contributionForRequest(address(f.collection), 1, 77);

        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);
        assertTrue(f.adapter.userContributionByLocalRequestId(1) != bytes32(0), "bound adapter consumes contribution");
    }

    function testR11CollectorContributionRunsThroughStorageOnlyReplayAndSettlementPipeline() public {
        Fixture memory f = _fixture(20, 1 ether, true);
        bytes32 entropy = keccak256("R11_FULL_PIPELINE");
        bytes32 providerReveal = keccak256("R11_PROVIDER_REVEAL");
        _mint(f, 20, entropy);
        bytes32 preview = f.source.previewContribution(address(f.collection), 1);

        vm.prank(EXECUTOR_A);
        f.collection.requestRandomnessForBatch(1);
        assertEq(f.adapter.userContributionByLocalRequestId(1), preview, "Dice receives frozen collector contribution");

        f.dice.revealWithCallback(DICE_PROVIDER, 1, preview, providerReveal);
        assertTrue(f.adapter.wordReadyForLocalRequest(1), "storage-only callback records exact word");
        assertFalse(f.adapter.deliveredForLocalRequest(1), "callback does not call collection");
        assertEq(f.collection.totalMinted(), 0, "callback does not settle NFTs");

        vm.prank(EXECUTOR_B);
        assertTrue(f.adapter.replayFulfillment(1), "later actor replays exact stored word");
        vm.prank(SETTLER);
        assertEq(f.collection.settleReady(20), 20, "later actor settles NFTs");
        assertEq(f.collection.totalMinted(), 20, "all accepted NFTs settle");
    }

    function testR11CreatorTeamEntropyCanSpanAndFreezeMultipleBatches() public {
        Fixture memory f = _fixture(25, 1 ether, true);
        uint256 fee = (MINTER_FEE / 2) * 25;
        vm.deal(CREATOR, fee + 1 ether);
        vm.prank(CREATOR);
        f.collection.creatorMint{value: fee}(CREATOR, 25, keccak256("R11_TEAM_ENTROPY"));

        (bytes32 firstContribution, bool firstReady) = f.collection.frozenRandomnessContribution(1);
        (bytes32 secondContribution, bool secondReady) = f.collection.frozenRandomnessContribution(2);
        assertTrue(firstReady, "full first team batch ready");
        assertTrue(secondReady, "mint-out second team batch ready");
        assertTrue(firstContribution != bytes32(0), "first contribution nonzero");
        assertTrue(secondContribution != bytes32(0), "second contribution nonzero");
        assertTrue(firstContribution != secondContribution, "batch domains separate team contribution");
        assertEq(f.adapter.nextRequestId(), 1, "team mint still makes no provider call");
    }
}
