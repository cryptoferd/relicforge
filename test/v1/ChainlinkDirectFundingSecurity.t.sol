// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

contract MockRFVRFV25Wrapper is IRFChainlinkVRFV25Wrapper {
    uint256 public price = 0.02 ether;
    uint256 public nextUpstreamRequestId = 1000;

    address public lastRequester;
    uint256 public lastValue;
    uint32 public lastCallbackGasLimit;
    uint16 public lastConfirmations;
    uint32 public lastNumWords;
    bytes32 public lastExtraArgsHash;

    function setPrice(uint256 value) external { price = value; }

    function calculateRequestPriceNative(uint32, uint32) external view override returns (uint256) {
        return price;
    }

    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable override returns (uint256 requestId) {
        require(msg.value == price, "wrong wrapper payment");
        lastRequester = msg.sender;
        lastValue = msg.value;
        lastCallbackGasLimit = callbackGasLimit;
        lastConfirmations = requestConfirmations;
        lastNumWords = numWords;
        lastExtraArgsHash = keccak256(extraArgs);
        requestId = nextUpstreamRequestId++;
    }

    function fulfill(
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
        uint256 upstreamRequestId,
        uint256 word
    ) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        adapter.rawFulfillRandomWords(upstreamRequestId, words);
    }

    function fulfillWords(
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
        uint256 upstreamRequestId,
        uint256[] memory words
    ) external {
        adapter.rawFulfillRandomWords(upstreamRequestId, words);
    }

    function fulfillWithGas(
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
        uint256 upstreamRequestId,
        uint256 word,
        uint256 gasAmount
    ) external returns (bool ok) {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        (ok,) = address(adapter).call{gas: gasAmount}(
            abi.encodeCall(adapter.rawFulfillRandomWords, (upstreamRequestId, words))
        );
    }
}

contract RejectingVRFCreditReceiverV1 {
    receive() external payable { revert("reject credit"); }
}

contract ChainlinkDirectFundingSecurityTest is RelicForgeV1Fixture {
    uint32 internal constant VRF_CALLBACK_GAS = 350_000;
    uint16 internal constant VRF_CONFIRMATIONS = 3;
    uint256 internal constant MAX_REQUEST_PRICE = 0.20 ether;

    function _deployDirectStack(uint32 supply)
        internal
        returns (
            MockRFVRFV25Wrapper vrfWrapper,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 vrfFactory,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        )
    {
        vm.deal(address(this), 100 ether);
        vrfWrapper = new MockRFVRFV25Wrapper();
        adapter = new RelicChainlinkVRFV25DirectFundingAdapterV1(
            address(vrfWrapper), VRF_CALLBACK_GAS, VRF_CONFIRMATIONS, MAX_REQUEST_PRICE
        );

        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicRendererV1 vrfRenderer = new RelicRendererV1();
        vrfFactory = new RelicForgeFactoryV1(
            address(collectionImpl), address(dataImpl), address(vrfRenderer), address(adapter)
        );
        adapter.bindFactory(address(vrfFactory));

        (address cAddr, address dAddr) = vrfFactory.createCollection(
            "Direct VRF", "DVRF", "direct-funded VRF test", supply, 32, 32, 1, PAYOUT, ROYALTY, 500
        );
        c = RelicCollectionV1(cAddr);
        d = RelicProjectDataV1(dAddr);
        _configureAndSealData(d, supply);
    }

    function _armForgePhase(RelicCollectionV1 c) internal returns (uint32 phase) {
        c.setFutureRevealMode(c.REVEAL_FORGE());
        phase = c.createPhase(
            0, uint64(block.timestamp), 0, 0, 0, bytes32(0), c.ACCESS_PUBLIC(), 1, true
        );
        c.setMasterMintEnabled(true);
    }

    function testFactoryBindingBurnsBootstrapAuthority() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) =
            _deployDirectStack(4);
        w; f; c; d;

        assertTrue(adapter.factory() != address(0), "factory bound");
        assertEq(adapter.bootstrapAuthority(), address(0), "bootstrap authority burned");

        vm.expectRevert(RF_NotAuthorized.selector);
        adapter.bindFactory(address(f));
    }

    function testBindRejectsFactoryPointingAtAnotherProvider() public {
        vm.deal(address(this), 100 ether);
        MockRFVRFV25Wrapper w = new MockRFVRFV25Wrapper();
        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter =
            new RelicChainlinkVRFV25DirectFundingAdapterV1(
                address(w), VRF_CALLBACK_GAS, VRF_CONFIRMATIONS, MAX_REQUEST_PRICE
            );

        RelicCollectionV1 collectionImpl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicRendererV1 r = new RelicRendererV1();
        RelicRandomnessMockV1 other = new RelicRandomnessMockV1();
        RelicForgeFactoryV1 wrongFactory = new RelicForgeFactoryV1(
            address(collectionImpl), address(dataImpl), address(r), address(other)
        );

        vm.expectRevert(RF_BadProvider.selector);
        adapter.bindFactory(address(wrongFactory));
    }

    function testArbitraryAddressCannotCreateBillableVRFRequest() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) = _deployDirectStack(4);
        w; f; c; d;
        vm.expectRevert(RF_NotAuthorized.selector);
        vm.prank(BOB);
        adapter.requestRandomness(123);
    }

    function testUnknownAddressCannotReceiveCollectionCredit() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) = _deployDirectStack(4);
        w; f; c; d;
        vm.expectRevert(RF_NotAuthorized.selector);
        adapter.fundConsumer{value: 1 ether}(BOB);
    }

    function testInsufficientForgeCreditAtomicallyRevertsMint() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) =
            _deployDirectStack(8);
        w; f; d;
        uint32 phase = _armForgePhase(c);

        vm.expectRevert(RF_InsufficientRandomnessCredit.selector);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        assertEq(c.totalMinted(), 0, "mint rolled back");
        assertEq(adapter.nextRequestId(), 1, "provider request id rolled back");
        vm.expectRevert(RF_NotMinted.selector);
        c.ownerOf(1);
    }

    function testInsufficientEpochCreditAtomicallyRestoresEpochCursor() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) =
            _deployDirectStack(8);
        w; f; d; adapter;
        uint32 phase = c.createPhase(
            0, uint64(block.timestamp), 0, 0, 0, bytes32(0), c.ACCESS_PUBLIC(), 1, true
        );
        c.setMasterMintEnabled(true);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        assertEq(c.nextEpochStartToken(), 1, "initial epoch cursor");
        vm.expectRevert(RF_InsufficientRandomnessCredit.selector);
        c.requestRevealEpoch();
        assertEq(c.nextEpochStartToken(), 1, "failed request cannot advance epoch cursor");
        assertEq(c.deferredPendingCount(), 1, "deferred token preserved");
    }

    function testCanonicalCollectionSpendsOnlyItsOwnCredit() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c1,
            RelicProjectDataV1 d1
        ) = _deployDirectStack(8);
        d1;

        (address c2Addr, address d2Addr) = f.createCollection(
            "Second", "TWO", "second collection", 8, 32, 32, 1, PAYOUT, ROYALTY, 500
        );
        RelicCollectionV1 c2 = RelicCollectionV1(c2Addr);
        RelicProjectDataV1 d2 = RelicProjectDataV1(d2Addr);
        _configureAndSealData(d2, 8);

        uint256 price = w.price();
        adapter.fundConsumer{value: price * 3}(address(c1));
        adapter.fundConsumer{value: price * 5}(address(c2));

        uint32 phase = _armForgePhase(c1);
        vm.prank(BOB);
        c1.mint(phase, 1, 0, new bytes32[](0));

        assertEq(adapter.nativeCredit(address(c1)), price * 2, "collection 1 charged once");
        assertEq(adapter.nativeCredit(address(c2)), price * 5, "collection 2 untouched");
        assertEq(address(adapter).balance, price * 7, "adapter balance matches remaining accounted credits");
        assertEq(address(w).balance, price, "wrapper received exactly one request payment");
        assertEq(adapter.requestCost(1), price, "request cost recorded");
    }

    function testWrapperRequestUsesImmutableNativeParameters() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        uint256 price = w.price();
        adapter.fundConsumer{value: price}(address(c));
        uint32 phase = _armForgePhase(c);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        assertEq(w.lastRequester(), address(adapter), "adapter is wrapper consumer");
        assertEq(w.lastValue(), price, "native request paid exact quote");
        assertEq(uint256(w.lastCallbackGasLimit()), uint256(VRF_CALLBACK_GAS), "callback gas fixed");
        assertEq(uint256(w.lastConfirmations()), uint256(VRF_CONFIRMATIONS), "confirmations fixed");
        assertEq(uint256(w.lastNumWords()), 1, "one word only");
        assertEq(
            w.lastExtraArgsHash(),
            keccak256(RFChainlinkVRFV25ExtraArgs.nativePaymentArgs()),
            "native-payment extra args"
        );
    }

    function testWrapperFulfillmentCompletesForgeReveal() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: w.price()}(address(c));
        uint32 phase = _armForgePhase(c);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        uint256 upstreamId = adapter.localToUpstreamRequestId(1);
        assertTrue(upstreamId != 0, "upstream request linked");
        bool callbackOk = w.fulfillWithGas(adapter, upstreamId, 0xCAFE, VRF_CALLBACK_GAS);
        assertTrue(callbackOk, "configured callback gas must store and deliver word");
        c.processReveal(10);
        assertTrue(c.isRevealed(1), "Forge token revealed");
    }

    function testOnlyWrapperCanSubmitVerifiedWord() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: w.price()}(address(c));
        uint32 phase = _armForgePhase(c);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        uint256[] memory words = new uint256[](1);
        words[0] = 123;
        vm.expectRevert(RF_BadProvider.selector);
        adapter.rawFulfillRandomWords(adapter.localToUpstreamRequestId(1), words);
    }

    function testDuplicateWrapperFulfillmentCannotReroll() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: w.price()}(address(c));
        uint32 phase = _armForgePhase(c);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        uint256 upstreamId = adapter.localToUpstreamRequestId(1);
        w.fulfill(adapter, upstreamId, 111);
        vm.expectRevert(RF_AlreadyFulfilled.selector);
        w.fulfill(adapter, upstreamId, 222);
    }

    function testMalformedWrapperWordArrayRejected() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: w.price()}(address(c));
        uint32 phase = _armForgePhase(c);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        uint256[] memory words = new uint256[](0);
        vm.expectRevert(RF_BadRequest.selector);
        w.fulfillWords(adapter, adapter.localToUpstreamRequestId(1), words);
    }

    function testPayoutReceiverCanRecoverUnusedCredit() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        uint256 price = w.price();
        adapter.fundConsumer{value: price * 3}(address(c));
        uint256 beforeBalance = PAYOUT.balance;

        vm.prank(PAYOUT);
        adapter.withdrawConsumerCredit(address(c), price);

        assertEq(PAYOUT.balance, beforeBalance + price, "payout receives recovered credit");
        assertEq(adapter.nativeCredit(address(c)), price * 2, "credit reduced exactly");
    }

    function testRejectingPayoutCannotBurnRandomnessCredit() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        RejectingVRFCreditReceiverV1 rejecting = new RejectingVRFCreditReceiverV1();
        c.setPayoutReceiver(address(rejecting));
        uint256 price = w.price();
        adapter.fundConsumer{value: price}(address(c));

        vm.expectRevert(RF_CreditTransferFailed.selector);
        vm.prank(address(rejecting));
        adapter.withdrawConsumerCredit(address(c), price);

        assertEq(adapter.nativeCredit(address(c)), price, "failed transfer restores credit");
    }

    function testNonPayoutReceiverCannotWithdrawCredit() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: w.price()}(address(c));
        vm.expectRevert(RF_CreditWithdrawalUnauthorized.selector);
        vm.prank(BOB);
        adapter.withdrawConsumerCredit(address(c), w.price());
    }

    function testCreditRecoveryStillWorksAfterCollectionRenunciation() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        uint256 price = w.price();
        adapter.fundConsumer{value: price}(address(c));
        c.renounceControl();
        assertEq(c.controller(), address(0), "collection renounced");

        vm.prank(PAYOUT);
        adapter.withdrawConsumerCredit(address(c), price);
        assertEq(adapter.nativeCredit(address(c)), 0, "credit recoverable after renounce");
    }

    function testDirectNativeTransferWithoutConsumerAttributionRejected() public {
        (MockRFVRFV25Wrapper w, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter, RelicForgeFactoryV1 f, RelicCollectionV1 c, RelicProjectDataV1 d) = _deployDirectStack(4);
        w; f; c; d;
        (bool ok,) = payable(address(adapter)).call{value: 1 wei}("");
        assertFalse(ok, "unattributed native transfer must fail");
    }

    function testGasPriceDrivenQuoteCannotExceedImmutableSpendCeiling() public {
        (
            MockRFVRFV25Wrapper w,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter,
            RelicForgeFactoryV1 f,
            RelicCollectionV1 c,
            RelicProjectDataV1 d
        ) = _deployDirectStack(8);
        f; d;

        adapter.fundConsumer{value: MAX_REQUEST_PRICE}(address(c));
        w.setPrice(MAX_REQUEST_PRICE + 1);
        uint32 phase = _armForgePhase(c);

        vm.expectRevert(RF_RandomnessPriceTooHigh.selector);
        vm.prank(BOB);
        c.mint(phase, 1, 0, new bytes32[](0));

        assertEq(c.totalMinted(), 0, "high quote cannot mint");
        assertEq(adapter.nativeCredit(address(c)), MAX_REQUEST_PRICE, "credit untouched");
        assertEq(adapter.nextRequestId(), 1, "local request id rolled back");
    }

    function testZeroRequestPriceCeilingRejected() public {
        vm.deal(address(this), 100 ether);
        MockRFVRFV25Wrapper w = new MockRFVRFV25Wrapper();
        vm.expectRevert(RF_BadConfig.selector);
        new RelicChainlinkVRFV25DirectFundingAdapterV1(
            address(w), VRF_CALLBACK_GAS, VRF_CONFIRMATIONS, 0
        );
    }

    function testCallbackGasBelowSafetyFloorRejected() public {
        vm.deal(address(this), 100 ether);
        MockRFVRFV25Wrapper w = new MockRFVRFV25Wrapper();
        vm.expectRevert(RF_BadConfig.selector);
        new RelicChainlinkVRFV25DirectFundingAdapterV1(
            address(w), 250_000, VRF_CONFIRMATIONS, MAX_REQUEST_PRICE
        );
    }
}
