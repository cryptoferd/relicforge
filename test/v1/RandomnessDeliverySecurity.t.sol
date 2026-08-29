// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./TestBase.sol";
import "../../contracts/production/RFCoreV1.sol";
import "../../contracts/production/RelicRandomnessAdapterBaseV1.sol";

contract OpenReplaySafeAdapterV1 is RelicRandomnessAdapterBaseV1 {
    function _requireAuthorizedConsumer(address) internal pure override {}
    function _requestUpstream(uint256, uint256) internal pure override {}
    function fulfill(uint256 requestId, uint256 word) external { _recordWord(requestId, word); }
}

contract GasBombRandomnessConsumerV1 is IRelicRandomnessConsumerV1 {
    OpenReplaySafeAdapterV1 public immutable adapter;
    bool public burnGas = true;
    uint256 public callbacks;
    uint256 public receivedWord;

    constructor(OpenReplaySafeAdapterV1 adapter_) { adapter = adapter_; }

    function request() external returns (uint256) { return adapter.requestRandomness(123); }
    function setBurnGas(bool value) external { burnGas = value; }

    function fulfillRandomness(uint256, uint256 randomWord) external {
        require(msg.sender == address(adapter), "adapter only");
        if (burnGas) {
            // Consume the capped call allowance, then fail. The provider must survive with the word stored.
            while (gasleft() > 1_000) {}
            revert("gas bomb");
        }
        ++callbacks;
        receivedWord = randomWord;
    }
}

contract ReentrantReplayConsumerV1 is IRelicRandomnessConsumerV1 {
    OpenReplaySafeAdapterV1 public immutable adapter;
    uint256 public callbacks;
    bool public nestedReplayResult;

    constructor(OpenReplaySafeAdapterV1 adapter_) { adapter = adapter_; }

    function request() external returns (uint256) { return adapter.requestRandomness(456); }

    function fulfillRandomness(uint256 requestId, uint256) external {
        require(msg.sender == address(adapter), "adapter only");
        ++callbacks;
        nestedReplayResult = adapter.replayFulfillment(requestId);
    }
}

contract RandomnessDeliverySecurityTest is TestBase {
    function testGasBombCannotEraseRecordedRandomWord() public {
        OpenReplaySafeAdapterV1 adapter = new OpenReplaySafeAdapterV1();
        GasBombRandomnessConsumerV1 consumer = new GasBombRandomnessConsumerV1(adapter);

        uint256 requestId = consumer.request();
        adapter.fulfill(requestId, 0xBEEF);

        (address recordedConsumer,, uint256 word, bool ready, bool delivered) = adapter.deliveries(requestId);
        assertEq(recordedConsumer, address(consumer), "consumer retained");
        assertEq(word, 0xBEEF, "verified word retained");
        assertTrue(ready, "word remains recorded");
        assertFalse(delivered, "gas bomb cannot count as delivered");

        consumer.setBurnGas(false);
        bool replayed = adapter.replayFulfillment(requestId);
        assertTrue(replayed, "same word replays");
        assertEq(consumer.receivedWord(), 0xBEEF, "replay cannot reroll");
        assertEq(consumer.callbacks(), 1, "one successful callback");
    }

    function testAlreadyDeliveredReplayIsIdempotent() public {
        OpenReplaySafeAdapterV1 adapter = new OpenReplaySafeAdapterV1();
        GasBombRandomnessConsumerV1 consumer = new GasBombRandomnessConsumerV1(adapter);
        consumer.setBurnGas(false);

        uint256 requestId = consumer.request();
        adapter.fulfill(requestId, 777);
        assertEq(consumer.callbacks(), 1, "initial delivery");

        assertTrue(adapter.replayFulfillment(requestId), "idempotent replay reports success");
        assertEq(consumer.callbacks(), 1, "consumer not called twice");
    }

    function testReentrantReplayCannotRecursivelyRedeliver() public {
        OpenReplaySafeAdapterV1 adapter = new OpenReplaySafeAdapterV1();
        ReentrantReplayConsumerV1 consumer = new ReentrantReplayConsumerV1(adapter);

        uint256 requestId = consumer.request();
        adapter.fulfill(requestId, 0x1234);

        assertEq(consumer.callbacks(), 1, "consumer called exactly once");
        assertTrue(consumer.nestedReplayResult(), "nested replay sees pre-lock as delivered");
        (,,,, bool delivered) = adapter.deliveries(requestId);
        assertTrue(delivered, "delivery remains finalized");
    }

    function testUnknownReplayRejected() public {
        OpenReplaySafeAdapterV1 adapter = new OpenReplaySafeAdapterV1();
        vm.expectRevert(RF_BadRequest.selector);
        adapter.replayFulfillment(999);
    }
}
