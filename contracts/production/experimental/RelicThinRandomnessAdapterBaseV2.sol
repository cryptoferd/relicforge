// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicPricedRandomnessQueueMockV2.sol";

error RFV2_ConsumerCallbackGasOutOfRange();

/// @title RelicThinRandomnessAdapterBaseV2
/// @notice Replay-safe priced adapter base that keeps verified-provider callbacks intentionally thin.
/// @dev EXPERIMENTAL ONLY. The consumer's settlement envelope is never forwarded upstream. A provider
///      callback stores one exact word, forwards only enough gas for the collection to store that word,
///      and leaves NFT settlement to the collection's permissionless settleReady() transaction.
abstract contract RelicThinRandomnessAdapterBaseV2 is IRelicPricedRandomnessProviderV2 {
    uint32 public constant UPSTREAM_CALLBACK_GAS = 300_000;
    uint32 public constant CONSUMER_WORD_DELIVERY_GAS = 150_000;
    uint32 public constant DELIVERY_GAS_RESERVE = 50_000;
    uint32 public constant MIN_CONSUMER_CALLBACK_GAS = 100_000;
    uint32 public constant MAX_CONSUMER_CALLBACK_GAS = 2_500_000;

    struct Delivery {
        address consumer;
        uint256 context;
        uint32 requestedConsumerCallbackGas;
        uint256 upstreamRequestId;
        uint256 requestPrice;
        uint256 word;
        bool wordReady;
        bool delivered;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Delivery) public deliveries;
    mapping(uint256 => uint256) public upstreamRequestIdToLocalRequestId;

    event ThinRandomnessRequested(
        uint256 indexed localRequestId,
        uint256 indexed upstreamRequestId,
        address indexed consumer,
        uint256 context,
        uint32 requestedConsumerCallbackGas,
        uint32 upstreamCallbackGas,
        uint256 requestPrice
    );
    event ThinRandomWordRecorded(uint256 indexed localRequestId, uint256 indexed upstreamRequestId, uint256 randomWord);
    event ThinRandomnessDelivery(uint256 indexed localRequestId, bool delivered);

    function quoteRequestPrice(uint32 requestedConsumerCallbackGas) public view virtual returns (uint256) {
        _validateConsumerCallbackGas(requestedConsumerCallbackGas);
        return _quoteUpstreamRequest(UPSTREAM_CALLBACK_GAS);
    }

    function requestRandomness(uint256 context, uint32 requestedConsumerCallbackGas)
        external
        payable
        virtual
        returns (uint256 localRequestId)
    {
        _requireAuthorizedConsumer(msg.sender);
        _validateConsumerCallbackGas(requestedConsumerCallbackGas);

        uint256 requestPrice = _quoteUpstreamRequest(UPSTREAM_CALLBACK_GAS);
        if (msg.value != requestPrice) revert RFV2_WrongRandomnessPayment();

        localRequestId = nextRequestId++;
        deliveries[localRequestId] = Delivery({
            consumer: msg.sender,
            context: context,
            requestedConsumerCallbackGas: requestedConsumerCallbackGas,
            upstreamRequestId: 0,
            requestPrice: requestPrice,
            word: 0,
            wordReady: false,
            delivered: false
        });

        uint256 upstreamRequestId = _requestUpstream(UPSTREAM_CALLBACK_GAS, requestPrice);
        if (upstreamRequestId == 0 || upstreamRequestIdToLocalRequestId[upstreamRequestId] != 0) {
            revert RF_BadRequest();
        }

        deliveries[localRequestId].upstreamRequestId = upstreamRequestId;
        upstreamRequestIdToLocalRequestId[upstreamRequestId] = localRequestId;

        emit ThinRandomnessRequested(
            localRequestId,
            upstreamRequestId,
            msg.sender,
            context,
            requestedConsumerCallbackGas,
            UPSTREAM_CALLBACK_GAS,
            requestPrice
        );
    }

    /// @notice Permissionless recovery after collection delivery failed or was skipped for low gas.
    /// @dev This can only replay the exact word already committed by the verified provider callback.
    function replayFulfillment(uint256 localRequestId) external returns (bool delivered) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0) || !d.wordReady) revert RF_BadRequest();
        if (d.delivered) return true;
        delivered = _deliver(localRequestId, d);
    }

    function _recordVerifiedWord(uint256 upstreamRequestId, uint256 randomWord) internal {
        uint256 localRequestId = upstreamRequestIdToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();

        Delivery storage d = deliveries[localRequestId];
        if (d.wordReady) revert RF_AlreadyFulfilled();

        // Critical invariant: commit the verified word before any untrusted collection call.
        d.wordReady = true;
        d.word = randomWord;
        emit ThinRandomWordRecorded(localRequestId, upstreamRequestId, randomWord);

        _deliver(localRequestId, d);
    }

    function _deliver(uint256 localRequestId, Delivery storage d) internal returns (bool delivered) {
        if (gasleft() <= uint256(CONSUMER_WORD_DELIVERY_GAS) + DELIVERY_GAS_RESERVE) {
            emit ThinRandomnessDelivery(localRequestId, false);
            return false;
        }

        // Reentrancy pre-lock. Failure restores replayability without changing the stored word.
        d.delivered = true;
        (delivered,) = d.consumer.call{gas: CONSUMER_WORD_DELIVERY_GAS}(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (localRequestId, d.word))
        );
        if (!delivered) d.delivered = false;

        emit ThinRandomnessDelivery(localRequestId, delivered);
    }

    function _validateConsumerCallbackGas(uint32 requestedConsumerCallbackGas) internal pure {
        if (
            requestedConsumerCallbackGas < MIN_CONSUMER_CALLBACK_GAS
                || requestedConsumerCallbackGas > MAX_CONSUMER_CALLBACK_GAS
        ) revert RFV2_ConsumerCallbackGasOutOfRange();
    }

    /// @dev Production adapters MUST fail closed for non-canonical collections.
    function _requireAuthorizedConsumer(address consumer) internal view virtual;

    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view virtual returns (uint256);

    function _requestUpstream(uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        virtual
        returns (uint256 upstreamRequestId);
}
