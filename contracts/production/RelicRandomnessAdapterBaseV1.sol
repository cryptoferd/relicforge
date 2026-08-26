// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";

/**
 * @title RelicRandomnessAdapterBaseV1
 * @notice Vendor-neutral replay-safe delivery base for RelicForge V1 randomness adapters.
 * @dev A chain/provider-specific adapter derives from this contract and implements `_requestUpstream`.
 *      The selected random word is stored before callback delivery. Failed delivery can only replay
 *      the exact same word; it can never request a replacement word for the same local request.
 */
abstract contract RelicRandomnessAdapterBaseV1 is IRelicRandomnessProviderV1 {
    struct Delivery {
        address consumer;
        uint256 context;
        uint256 word;
        bool wordReady;
        bool delivered;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Delivery) public deliveries;

    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint256 context);
    event RandomWordRecorded(uint256 indexed requestId, uint256 randomWord);
    event RandomnessDelivery(uint256 indexed requestId, bool delivered);

    function requestRandomness(uint256 context) external virtual returns (uint256 requestId) {
        requestId = nextRequestId++;
        deliveries[requestId] = Delivery({
            consumer: msg.sender,
            context: context,
            word: 0,
            wordReady: false,
            delivered: false
        });
        _requestUpstream(requestId, context);
        emit RandomnessRequested(requestId, msg.sender, context);
    }

    function _requestUpstream(uint256 localRequestId, uint256 context) internal virtual;

    function _recordWord(uint256 localRequestId, uint256 randomWord) internal {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0)) revert RF_BadRequest();
        if (d.wordReady) revert RF_AlreadyFulfilled();
        d.wordReady = true;
        d.word = randomWord;
        emit RandomWordRecorded(localRequestId, randomWord);
        _deliver(localRequestId, d);
    }

    function replayFulfillment(uint256 localRequestId) external returns (bool delivered) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0) || !d.wordReady) revert RF_BadRequest();
        delivered = _deliver(localRequestId, d);
    }

    function _deliver(uint256 localRequestId, Delivery storage d) internal returns (bool delivered) {
        (delivered,) = d.consumer.call(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (localRequestId, d.word))
        );
        if (delivered) d.delivered = true;
        emit RandomnessDelivery(localRequestId, delivered);
    }
}
