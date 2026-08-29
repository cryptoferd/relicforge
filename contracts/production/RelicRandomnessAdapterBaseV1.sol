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
    // Collection.fulfillRandomness() is intentionally tiny; capping the forwarded gas prevents a
    // malicious or broken consumer from exhausting the provider callback and erasing a verified word.
    uint256 public constant CONSUMER_DELIVERY_GAS = 150_000;
    uint256 public constant DELIVERY_GAS_RESERVE = 50_000;

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
        _requireAuthorizedConsumer(msg.sender);
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

    /// @dev Production adapters MUST fail closed here. This prevents arbitrary callers from consuming
    ///      provider funds or creating billable requests outside canonical RelicForge collections.
    function _requireAuthorizedConsumer(address consumer) internal view virtual;

    function _requestUpstream(uint256 localRequestId, uint256 context) internal virtual;

    function _recordWord(uint256 localRequestId, uint256 randomWord) internal {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0)) revert RF_BadRequest();
        if (d.wordReady) revert RF_AlreadyFulfilled();

        // Critical ordering: commit the verified word before any untrusted consumer callback.
        d.wordReady = true;
        d.word = randomWord;
        emit RandomWordRecorded(localRequestId, randomWord);

        _deliver(localRequestId, d);
    }

    /// @notice Permissionless recovery for a failed callback. It can only replay the stored word.
    function replayFulfillment(uint256 localRequestId) external returns (bool delivered) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0) || !d.wordReady) revert RF_BadRequest();
        if (d.delivered) return true;
        delivered = _deliver(localRequestId, d);
    }

    function _deliver(uint256 localRequestId, Delivery storage d) internal returns (bool delivered) {
        // If the provider callback arrives with too little gas to safely attempt collection delivery,
        // keep the word recorded and let anyone replay later with a fresh transaction.
        if (gasleft() <= CONSUMER_DELIVERY_GAS + DELIVERY_GAS_RESERVE) {
            emit RandomnessDelivery(localRequestId, false);
            return false;
        }

        // Reentrancy pre-lock: replayFulfillment() must not recursively call the consumer while
        // this delivery is in progress. If the call fails, restore replayability for the same word.
        d.delivered = true;
        (delivered,) = d.consumer.call{gas: CONSUMER_DELIVERY_GAS}(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (localRequestId, d.word))
        );
        if (!delivered) d.delivered = false;
        emit RandomnessDelivery(localRequestId, delivered);
    }
}
