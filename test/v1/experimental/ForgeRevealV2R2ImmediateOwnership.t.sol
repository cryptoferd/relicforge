// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicCollectionV2R2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2R2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/experimental/RelicChainlinkVRFV25WrapperMockV2.sol";

contract R2ImmediateFeePolicyMock {
    address public platformAdmin = address(0xA11CE);
    address public treasury = address(0x7EA5);

    function collectionFeesEnabled(address) external pure returns (bool) {
        return true;
    }

    function currentCollectionFeeCents(address, uint32 lockedFeeCents) external pure returns (uint32) {
        return lockedFeeCents;
    }

    function quoteUsdCents(uint256 usdCents) external pure returns (uint256 nativeAmount, bool oracleHealthy) {
        return (usdCents * 0.00001 ether, true);
    }

    function quoteMintFee(address, uint32 lockedFeeCents, uint32 quantity)
        external
        pure
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        return (uint256(lockedFeeCents) * quantity * 0.00001 ether, true, lockedFeeCents != 0);
    }
}

contract R2ImmediateProjectDataMock {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed = true;

    constructor(address creator_, uint32 maxSupply_) {
        creator = creator_;
        maxSupply = maxSupply_;
    }
}

contract R2ImmediateRendererMock {
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

contract R2ImmediateReserveMock {
    address public founder;
    uint256 public funded;
    uint256 public refunded;
    uint256 public deposited;

    constructor(address founder_) {
        founder = founder_;
    }

    receive() external payable {}

    function factory() external pure returns (address) {
        return address(0);
    }

    function canonicalCollection(address) external pure returns (bool) {
        return true;
    }
    function registerCollection(address) external {}
    function syncCollection(address) external {}

    function fundRandomnessShortfall(uint64, uint256 amount) external {
        funded += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "fund failed");
    }

    function refundRandomnessSubsidy(uint64) external payable {
        refunded += msg.value;
    }

    function depositFromCollection() external payable {
        deposited += msg.value;
    }

    function pullCollectionExcess(RelicCollectionV2R2 collection) external returns (uint256 amount) {
        amount = collection.sweepExcessToReserve();
    }
}

contract R2ImmediateRegistryMock {
    mapping(address => bool) public canonical;

    function setCanonical(address collection, bool value) external {
        canonical[collection] = value;
    }

    function isCanonicalCollection(address collection) external view returns (bool) {
        return canonical[collection];
    }
}

contract ForgeRevealV2R2ImmediateOwnershipTest is TestBase {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;
    address internal constant ALICE = address(0xBEEF);
    address internal constant FOUNDER = address(0xF0A6E);

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

    function _deployCollection(uint8 initialRevealMode, uint32 supply)
        internal
        returns (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        )
    {
        vm.chainId(SEPOLIA_CHAIN_ID);

        RelicCollectionV2R2 implementation = new RelicCollectionV2R2();
        R2ImmediateProjectDataMock data = new R2ImmediateProjectDataMock(address(this), supply);
        R2ImmediateRendererMock renderer = new R2ImmediateRendererMock();
        R2ImmediateFeePolicyMock feePolicy = new R2ImmediateFeePolicyMock();
        reserve = new R2ImmediateReserveMock(FOUNDER);
        vm.deal(address(reserve), 2 ether);

        R2ImmediateRegistryMock registry = new R2ImmediateRegistryMock();
        wrapper = new RelicChainlinkVRFV25WrapperMockV2(0.0001 ether, 1 gwei);
        adapter = new RelicChainlinkVRFV25DirectAdapterV2R2(SEPOLIA_CHAIN_ID, address(wrapper), address(registry), 3);

        RelicMintPhasesV2 phaseImpl = new RelicMintPhasesV2();
        address collectionClone = _clone(address(implementation));
        address phaseClone = _clone(address(phaseImpl));
        collection = RelicCollectionV2R2(payable(collectionClone));
        phases = RelicMintPhasesV2(phaseClone);
        phases.initialize(address(collection), address(this), address(feePolicy), 2, 50);

        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "R2 Test",
            symbol: "R2T",
            description: "R2 immediate ownership",
            creator: address(this),
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(adapter),
            forgeReserve: address(reserve),
            feePolicy: address(feePolicy),
            mintPhases: address(phases),
            maxSupply: supply,
            payoutReceiver: address(this),
            royaltyReceiver: address(this),
            royaltyBps: 500,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: initialRevealMode,
            batchWindowSeconds: 777,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });
        collection.initialize(init);
        registry.setCanonical(address(collection), true);

        phases.createPhase(0, 0, 0, supply, supply, bytes32(0), 0, 1, true);
        phases.setMasterMintEnabled(true);
        vm.deal(ALICE, 2 ether);
    }

    function testR2ForgeMintCreatesERC721BeforeAutomaticReveal() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, 10);
        reserve;
        phases;

        uint256 fee = 50 * 0.00001 ether;
        vm.prank(ALICE);
        collection.mint{value: fee * 2}(1, 2, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 2, "R2 mints ownership immediately");
        assertEq(collection.totalCommitted(), 2, "committed supply equals minted supply");
        assertEq(collection.balanceOf(ALICE), 2, "collector owns both NFTs immediately");
        assertEq(collection.ownerOf(1), ALICE, "token 1 owner exists before reveal");
        assertEq(collection.ownerOf(2), ALICE, "token 2 owner exists before reveal");
        assertFalse(collection.isRevealed(1), "token 1 begins hidden");
        assertEq(collection.pendingSupply(), 0, "R2 has no reservation limbo");
        assertEq(wrapper.nextRequestId(), 2, "mint created one upstream randomness request");

        assertTrue(wrapper.fulfill(1, 0xCAFE), "wrapper callback succeeds");
        assertTrue(adapter.deliveredForLocalRequest(1), "adapter auto-delivered verified word");
        assertTrue(collection.isRevealed(1), "token 1 reveals automatically");
        assertTrue(collection.isRevealed(2), "token 2 reveals automatically");
        assertTrue(collection.recipeForToken(1) != collection.recipeForToken(2), "recipes remain unique");
    }

    function testR2HopperProtectsOnlyRealObligationsAndExcessSweepsOnlyToReserve() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, 10);
        adapter;
        phases;

        // Make the VRF request cheaper than the per-token platform fee so this mint leaves
        // real excess in the single collection hopper after its request is fully funded.
        wrapper.setPricing(0.0001 ether, 0);
        uint256 fee = 50 * 0.00001 ether;

        vm.prank(ALICE);
        collection.mint{value: fee * 2}(1, 2, 0, new bytes32[](0));

        assertEq(collection.protectedHopperWei(), 0, "paid in-flight auto reveal needs no extra hopper protection");
        uint256 sweepable = collection.sweepableHopperWei();
        assertTrue(sweepable > 0, "unused hopper funds become sweepable immediately");

        uint256 swept = reserve.pullCollectionExcess(collection);
        assertEq(swept, sweepable, "reserve pulls exactly the calculated excess");
        assertEq(collection.hopperBalance(), 0, "excess leaves collection hopper");
        assertEq(reserve.deposited(), sweepable, "sweep destination is the reserve only");
    }

    function testR2DelayedRevealIsPrepareThenLightweightRequestAndFutureMintAutoReveals() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(0, 5);
        phases;

        uint256 fee = 50 * 0.00001 ether;
        vm.prank(ALICE);
        collection.mint{value: fee * 3}(1, 3, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 3, "three deferred NFTs exist immediately");
        assertEq(wrapper.nextRequestId(), 1, "deferred mint does not request VRF yet");

        (uint32 frozenSupply, uint256 preparedBudget) = collection.prepareDelayedReveal();
        assertEq(uint256(frozenSupply), 3, "prepare freezes current minted supply only");
        assertEq(preparedBudget, 0.005 ether, "prepare reserves platform request ceiling");
        assertTrue(collection.delayedRevealPrepared(), "prepared state recorded");
        assertTrue(collection.delayedRevealRequested(), "mint phases freeze during prepared state");
        assertTrue(reserve.funded() > 0, "prepare performs reserve funding work");

        vm.prank(ALICE);
        vm.expectRevert(RFV2_DelayedRevealPendingProd.selector);
        collection.mint{value: fee}(1, 1, 0, new bytes32[](0));

        uint256 localRequestId = collection.requestDelayedReveal();
        assertEq(localRequestId, 1, "TX2 creates the local request");
        assertEq(
            uint256(adapter.requestedConsumerGasForLocalRequest(localRequestId)),
            500_000,
            "delayed reveal keeps its separate 500k callback path"
        );
        assertFalse(collection.delayedRevealPrepared(), "prepared budget reconciled in TX2");
        assertTrue(collection.pendingDelayedReserveRefundWei() > 0, "unused reserve prep queued for callback refund");

        assertTrue(wrapper.fulfill(1, 0xBEEF), "delayed reveal wrapper callback succeeds");
        assertTrue(adapter.deliveredForLocalRequest(1), "delayed word auto-delivered");
        assertTrue(collection.delayedRevealed(), "frozen set reveals automatically");
        assertTrue(reserve.refunded() > 0, "callback returns unused prepared reserve subsidy");
        assertEq(collection.futureRevealMode(), 1, "future mints switch to fresh auto reveal");
        assertTrue(collection.hybridForgeActive(), "hybrid complement deck activated");

        uint256 r1 = collection.recipeForToken(1);
        uint256 r2 = collection.recipeForToken(2);
        uint256 r3 = collection.recipeForToken(3);
        assertTrue(r1 != r2 && r1 != r3 && r2 != r3, "delayed recipes unique");

        vm.prank(ALICE);
        collection.mint{value: fee * 2}(1, 2, 0, new bytes32[](0));
        assertEq(collection.totalMinted(), 5, "future tokens also exist immediately");
        assertFalse(collection.isRevealed(4), "future token waits only for its fresh VRF word");
        assertEq(wrapper.nextRequestId(), 3, "future mint created a second fresh upstream request");

        assertTrue(wrapper.fulfill(2, 0x123456), "future auto reveal callback succeeds");
        assertTrue(collection.isRevealed(4), "future token 4 auto reveals");
        assertTrue(collection.isRevealed(5), "future token 5 auto reveals");
        assertTrue(collection.completed(), "collection completes after all existing NFTs reveal");

        bool[] memory seen = new bool[](5);
        for (uint256 tokenId = 1; tokenId <= 5; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < 5, "recipe in collection range");
            assertFalse(seen[recipe], "no duplicate recipe across delayed + future auto reveal");
            seen[recipe] = true;
        }
    }

    function _expectedAdaptiveGas(uint32 quantity) internal pure returns (uint32) {
        if (quantity == 1) return 400_000;
        if (quantity <= 4) return 550_000;
        if (quantity <= 10) return 900_000;
        if (quantity <= 15) return 1_150_000;
        return 1_400_000;
    }

    function testR2PlatformPolicyDefaultsAndFounderOnlyLiveAdjustments() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, 10);
        adapter;
        wrapper;
        reserve;
        phases;

        assertEq(collection.batchWindowSeconds(), 30, "creator-supplied batch window ignored");
        assertEq(collection.maxRandomnessCostPerBatchWei(), 0.005 ether, "creator-supplied ceiling ignored");

        vm.expectRevert(RF_NotAuthorized.selector);
        collection.setForgeBatchWindowSeconds(45);
        vm.expectRevert(RF_NotAuthorized.selector);
        collection.setMaxRandomnessCostPerBatchWei(0.007 ether);

        vm.startPrank(FOUNDER);
        collection.setForgeBatchWindowSeconds(45);
        collection.setMaxRandomnessCostPerBatchWei(0.007 ether);
        vm.stopPrank();

        assertEq(collection.batchWindowSeconds(), 45, "founder can adjust live batch window");
        assertEq(collection.maxRandomnessCostPerBatchWei(), 0.007 ether, "founder can adjust live ceiling");

        vm.prank(FOUNDER);
        vm.expectRevert(RF_BadConfig.selector);
        collection.setForgeBatchWindowSeconds(0);
        vm.prank(FOUNDER);
        vm.expectRevert(RF_BadConfig.selector);
        collection.setMaxRandomnessCostPerBatchWei(0);
    }

    function testR2AdaptiveCallbackGasTierSelectionCoversEveryQuantity1Through20() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, 20);
        adapter;
        wrapper;
        reserve;
        phases;

        for (uint32 quantity = 1; quantity <= 20; ++quantity) {
            assertEq(
                uint256(collection.autoRevealCallbackGasForQuantity(quantity)),
                uint256(_expectedAdaptiveGas(quantity)),
                "wrong adaptive callback gas"
            );
        }

        vm.expectRevert(RF_BadRequest.selector);
        collection.autoRevealCallbackGasForQuantity(0);
        vm.expectRevert(RF_BadRequest.selector);
        collection.autoRevealCallbackGasForQuantity(21);
    }

    function testR2AdaptiveCallbackGasQuoteRequestAndRevealMatrix1Through20() public {
        uint32 supply = 210;
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, supply);
        reserve;
        phases;

        uint256 fee = 50 * 0.00001 ether;
        uint256 nextRequest = 1;
        uint256 nextToken = 1;
        uint256 expectedTotalSpend;

        for (uint32 quantity = 1; quantity <= 20; ++quantity) {
            uint32 expectedGas = _expectedAdaptiveGas(quantity);
            uint256 expectedPrice = adapter.quoteRequestPrice(expectedGas);
            assertTrue(expectedPrice <= collection.maxRandomnessCostPerBatchWei(), "adaptive quote exceeds platform ceiling");
            expectedTotalSpend += expectedPrice;

            vm.prank(ALICE);
            collection.mint{value: fee * quantity}(1, quantity, 0, new bytes32[](0));

            assertEq(collection.totalCommitted(), collection.totalMinted(), "committed must equal minted");
            assertEq(collection.pendingSupply(), 0, "ownership must never be pending");
            assertEq(collection.ownerOf(nextToken), ALICE, "ownership exists before randomness");
            assertEq(
                uint256(adapter.requestedConsumerGasForLocalRequest(nextRequest)),
                uint256(expectedGas),
                "request stored wrong consumer gas"
            );
            assertEq(
                uint256(adapter.upstreamCallbackGasForLocalRequest(nextRequest)),
                uint256(expectedGas) + 250_000,
                "wrong upstream callback gas"
            );
            assertEq(adapter.requestPriceForLocalRequest(nextRequest), expectedPrice, "quote/request price drift");
            assertEq(collection.totalRandomnessSpend(), expectedTotalSpend, "total randomness spend drift");

            (
                uint32 firstTokenId,
                uint32 groupQuantity,
                uint256 randomnessCost,
                uint256 requestId,
                uint256 hopperPaid,
                uint256 reservePaid,
                bool revealed
            ) = collection.autoRevealGroups(uint64(nextRequest));
            hopperPaid;
            reservePaid;
            revealed;
            assertEq(uint256(firstTokenId), nextToken, "wrong group first token");
            assertEq(uint256(groupQuantity), quantity, "wrong group quantity");
            assertEq(randomnessCost, expectedPrice, "wrong group cost");
            assertEq(requestId, nextRequest, "wrong local request id");

            assertTrue(wrapper.fulfill(nextRequest, 0xA000 + nextRequest), "adaptive callback failed");
            assertTrue(adapter.deliveredForLocalRequest(nextRequest), "adaptive word not delivered");
            assertTrue(collection.isRevealed(nextToken), "first token not revealed");
            assertTrue(collection.isRevealed(nextToken + quantity - 1), "last token not revealed");
            assertEq(collection.activeAutoRevealRequests(), 0, "active request counter did not reconcile");
            assertEq(collection.pendingAutoRevealTokens(), 0, "pending reveal token counter did not reconcile");

            nextToken += quantity;
            ++nextRequest;
        }

        bool[] memory seen = new bool[](supply);
        for (uint256 tokenId = 1; tokenId <= supply; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < supply, "recipe out of range");
            assertFalse(seen[recipe], "duplicate recipe in adaptive matrix");
            seen[recipe] = true;
        }
    }

    function testR2AdaptiveSplitMint50Uses20_20_10IndependentTiers() public {
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, 50);
        reserve;
        phases;

        uint256 fee = 50 * 0.00001 ether;
        vm.prank(ALICE);
        collection.mint{value: fee * 50}(1, 50, 0, new bytes32[](0));

        assertEq(collection.totalMinted(), 50, "all ownership minted immediately");
        assertEq(collection.totalCommitted(), 50, "committed equals minted");
        assertEq(collection.pendingSupply(), 0, "no ownership limbo");
        assertEq(collection.activeAutoRevealRequests(), 3, "50 split creates three requests");
        assertEq(collection.pendingAutoRevealTokens(), 50, "all split tokens await metadata only");

        uint32[3] memory quantities = [uint32(20), uint32(20), uint32(10)];
        uint32[3] memory expectedGas = [uint32(1_400_000), uint32(1_400_000), uint32(900_000)];
        for (uint64 groupId = 1; groupId <= 3; ++groupId) {
            (
                uint32 firstTokenId,
                uint32 groupQuantity,
                uint256 randomnessCost,
                uint256 requestId,
                uint256 hopperPaid,
                uint256 reservePaid,
                bool revealed
            ) = collection.autoRevealGroups(groupId);
            firstTokenId;
            randomnessCost;
            hopperPaid;
            reservePaid;
            revealed;
            assertEq(uint256(groupQuantity), uint256(quantities[groupId - 1]), "wrong split quantity");
            assertEq(
                uint256(adapter.requestedConsumerGasForLocalRequest(requestId)),
                uint256(expectedGas[groupId - 1]),
                "wrong split callback tier"
            );
            assertEq(
                uint256(adapter.upstreamCallbackGasForLocalRequest(requestId)),
                uint256(expectedGas[groupId - 1]) + 250_000,
                "wrong split upstream gas"
            );
        }

        // Fulfill deliberately out of order to preserve callback-order independence.
        assertTrue(wrapper.fulfill(3, 0x3333), "10 group callback failed");
        assertTrue(wrapper.fulfill(1, 0x1111), "first 20 group callback failed");
        assertTrue(wrapper.fulfill(2, 0x2222), "second 20 group callback failed");
        assertEq(collection.activeAutoRevealRequests(), 0, "split active counter reconciled");
        assertEq(collection.pendingAutoRevealTokens(), 0, "split pending counter reconciled");
        assertTrue(collection.completed(), "50 mint completes after three callbacks");

        bool[] memory seen = new bool[](50);
        for (uint256 tokenId = 1; tokenId <= 50; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < 50, "split recipe out of range");
            assertFalse(seen[recipe], "duplicate split recipe");
            seen[recipe] = true;
        }
    }


    function testR2AdaptiveSplitMatrix21_24_30_40_50() public {
        uint32 supply = 165;
        (
            RelicCollectionV2R2 collection,
            RelicChainlinkVRFV25DirectAdapterV2R2 adapter,
            RelicChainlinkVRFV25WrapperMockV2 wrapper,
            R2ImmediateReserveMock reserve,
            RelicMintPhasesV2 phases
        ) = _deployCollection(1, supply);
        reserve;
        phases;

        uint32[5] memory mintQuantities = [uint32(21), uint32(24), uint32(30), uint32(40), uint32(50)];
        uint256 fee = 50 * 0.00001 ether;
        uint64 nextGroupId = 1;

        for (uint256 mintIndex; mintIndex < mintQuantities.length; ++mintIndex) {
            uint32 mintQuantity = mintQuantities[mintIndex];
            vm.prank(ALICE);
            collection.mint{value: fee * mintQuantity}(1, mintQuantity, 0, new bytes32[](0));

            uint32 remaining = mintQuantity;
            while (remaining != 0) {
                uint32 expectedQuantity = remaining > 20 ? 20 : remaining;
                uint32 expectedGas = _expectedAdaptiveGas(expectedQuantity);
                (
                    uint32 firstTokenId,
                    uint32 groupQuantity,
                    uint256 randomnessCost,
                    uint256 requestId,
                    uint256 hopperPaid,
                    uint256 reservePaid,
                    bool revealed
                ) = collection.autoRevealGroups(nextGroupId);
                firstTokenId;
                randomnessCost;
                hopperPaid;
                reservePaid;
                revealed;

                assertEq(uint256(groupQuantity), uint256(expectedQuantity), "split matrix quantity mismatch");
                assertEq(
                    uint256(adapter.requestedConsumerGasForLocalRequest(requestId)),
                    uint256(expectedGas),
                    "split matrix callback tier mismatch"
                );
                assertEq(
                    uint256(adapter.upstreamCallbackGasForLocalRequest(requestId)),
                    uint256(expectedGas) + 250_000,
                    "split matrix upstream envelope mismatch"
                );

                uint256 upstreamRequestId = adapter.upstreamRequestIdForLocalRequest(requestId);
                assertTrue(wrapper.fulfill(upstreamRequestId, 0xD000 + nextGroupId), "split matrix callback failed");
                assertTrue(adapter.deliveredForLocalRequest(requestId), "split matrix word not delivered");

                remaining -= expectedQuantity;
                ++nextGroupId;
            }

            assertEq(collection.activeAutoRevealRequests(), 0, "split matrix active requests did not reconcile");
            assertEq(collection.pendingAutoRevealTokens(), 0, "split matrix pending tokens did not reconcile");
            assertEq(collection.pendingSupply(), 0, "split matrix created ownership limbo");
            assertEq(collection.totalCommitted(), collection.totalMinted(), "split matrix committed/minted drift");
        }

        assertEq(collection.totalMinted(), supply, "split matrix total supply mismatch");
        assertTrue(collection.completed(), "split matrix collection should complete");
        bool[] memory seen = new bool[](supply);
        for (uint256 tokenId = 1; tokenId <= supply; ++tokenId) {
            uint256 recipe = collection.recipeForToken(tokenId);
            assertTrue(recipe < supply, "split matrix recipe out of range");
            assertFalse(seen[recipe], "split matrix duplicate recipe");
            seen[recipe] = true;
        }
    }

}
