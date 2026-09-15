// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";

/// @notice R2 extension used by the immediate-ownership reveal architecture.
interface IRelicPricedRandomnessProviderV2R2Prod is IRelicPricedRandomnessProviderV2Prod {
    function requestPriceForLocalRequest(uint256 localRequestId) external view returns (uint256);
}

/// @notice R2 reserve extension. Refunds return unused prepared reveal subsidy and restore
///         the collection's lifetime subsidy headroom.
interface IRelicForgeReserveV2R2Prod is IRelicForgeReserveV2Prod {
    function refundRandomnessSubsidy(uint64 reserveKey) external payable;
}

/// @title RelicThinRandomnessAdapterBaseV2R2Prod
/// @notice Chainlink adapter base that attempts bounded consumer delivery in the verified
///         upstream callback while retaining replayFulfillment() as a fail-closed recovery path.
abstract contract RelicThinRandomnessAdapterBaseV2R2Prod is IRelicPricedRandomnessProviderV2R2Prod {
    uint32 public constant ADAPTER_CALLBACK_OVERHEAD_GAS = 250_000;
    uint32 public constant DELIVERY_GAS_RESERVE = 75_000;
    uint32 public constant MIN_CONSUMER_CALLBACK_GAS = 100_000;
    uint32 public constant MAX_CONSUMER_CALLBACK_GAS = 2_500_000;

    struct Delivery {
        address consumer;
        uint256 context;
        uint32 requestedConsumerCallbackGas;
        uint32 upstreamCallbackGas;
        uint256 upstreamRequestId;
        uint256 requestPrice;
        uint256 word;
        bool wordReady;
        bool delivered;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Delivery) public deliveries;
    mapping(uint256 => uint256) public upstreamRequestIdToLocalRequestId;

    event ThinRandomnessRequestedR2(
        uint256 indexed localRequestId,
        uint256 indexed upstreamRequestId,
        address indexed consumer,
        uint256 context,
        uint32 requestedConsumerCallbackGas,
        uint32 upstreamCallbackGas,
        uint256 requestPrice
    );
    event ThinRandomWordRecordedR2(
        uint256 indexed localRequestId, uint256 indexed upstreamRequestId, uint256 randomWord
    );
    event ThinRandomnessDeliveryR2(uint256 indexed localRequestId, bool delivered, bool automaticAttempt);
    event ThinRandomnessOverpaymentRefundedR2(uint256 indexed localRequestId, address indexed consumer, uint256 amount);

    function quoteRequestPrice(uint32 requestedConsumerCallbackGas) public view virtual returns (uint256) {
        _validateConsumerCallbackGas(requestedConsumerCallbackGas);
        return _quoteUpstreamRequest(_upstreamCallbackGas(requestedConsumerCallbackGas));
    }

    function requestRandomness(uint256 context, uint32 requestedConsumerCallbackGas)
        external
        payable
        virtual
        returns (uint256 localRequestId)
    {
        _requireAuthorizedConsumer(msg.sender);
        _validateConsumerCallbackGas(requestedConsumerCallbackGas);

        uint32 upstreamCallbackGas = _upstreamCallbackGas(requestedConsumerCallbackGas);
        uint256 requestPrice = _quoteUpstreamRequest(upstreamCallbackGas);
        if (msg.value < requestPrice) revert RF_WrongPrice();

        localRequestId = nextRequestId++;
        deliveries[localRequestId] = Delivery({
            consumer: msg.sender,
            context: context,
            requestedConsumerCallbackGas: requestedConsumerCallbackGas,
            upstreamCallbackGas: upstreamCallbackGas,
            upstreamRequestId: 0,
            requestPrice: requestPrice,
            word: 0,
            wordReady: false,
            delivered: false
        });

        uint256 upstreamRequestId = _requestUpstream(localRequestId, upstreamCallbackGas, requestPrice);
        if (upstreamRequestId == 0 || upstreamRequestIdToLocalRequestId[upstreamRequestId] != 0) {
            revert RF_BadRequest();
        }

        deliveries[localRequestId].upstreamRequestId = upstreamRequestId;
        upstreamRequestIdToLocalRequestId[upstreamRequestId] = localRequestId;

        emit ThinRandomnessRequestedR2(
            localRequestId,
            upstreamRequestId,
            msg.sender,
            context,
            requestedConsumerCallbackGas,
            upstreamCallbackGas,
            requestPrice
        );

        uint256 refund = msg.value - requestPrice;
        if (refund != 0) {
            (bool ok,) = payable(msg.sender).call{value: refund}("");
            if (!ok) revert RF_WithdrawFailed();
            emit ThinRandomnessOverpaymentRefundedR2(localRequestId, msg.sender, refund);
        }
    }

    function requestPriceForLocalRequest(uint256 localRequestId) external view returns (uint256) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0)) revert RF_BadRequest();
        return d.requestPrice;
    }

    function replayFulfillment(uint256 localRequestId) external returns (bool delivered) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0) || !d.wordReady) revert RF_BadRequest();
        if (d.delivered) return true;
        delivered = _deliver(localRequestId, d, false);
    }

    function _storeVerifiedWordAndAttemptDelivery(uint256 upstreamRequestId, uint256 randomWord)
        internal
        returns (uint256 localRequestId, bool delivered)
    {
        localRequestId = upstreamRequestIdToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();

        Delivery storage d = deliveries[localRequestId];
        if (d.wordReady) revert RF_AlreadyFulfilled();

        d.wordReady = true;
        d.word = randomWord;
        emit ThinRandomWordRecordedR2(localRequestId, upstreamRequestId, randomWord);

        delivered = _deliver(localRequestId, d, true);
    }

    function _deliver(uint256 localRequestId, Delivery storage d, bool automaticAttempt)
        internal
        returns (bool delivered)
    {
        uint256 requestedGas = uint256(d.requestedConsumerCallbackGas);
        if (gasleft() <= requestedGas + DELIVERY_GAS_RESERVE) {
            emit ThinRandomnessDeliveryR2(localRequestId, false, automaticAttempt);
            return false;
        }

        // Mark before the external call. A failed low-level call rolls the consumer's state back;
        // this adapter clears the marker so the exact verified word can be replayed later.
        d.delivered = true;
        (delivered,) = d.consumer.call{gas: d.requestedConsumerCallbackGas}(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (localRequestId, d.word))
        );
        if (!delivered) d.delivered = false;

        emit ThinRandomnessDeliveryR2(localRequestId, delivered, automaticAttempt);
    }

    function _upstreamCallbackGas(uint32 requestedConsumerCallbackGas) internal pure returns (uint32) {
        return requestedConsumerCallbackGas + ADAPTER_CALLBACK_OVERHEAD_GAS;
    }

    function _validateConsumerCallbackGas(uint32 requestedConsumerCallbackGas) internal pure {
        if (
            requestedConsumerCallbackGas < MIN_CONSUMER_CALLBACK_GAS
                || requestedConsumerCallbackGas > MAX_CONSUMER_CALLBACK_GAS
        ) revert RFV2_ConsumerCallbackGasOutOfRangeProd();
    }

    function _requireAuthorizedConsumer(address consumer) internal view virtual;
    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view virtual returns (uint256);
    function _requestUpstream(uint256 localRequestId, uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        virtual
        returns (uint256 upstreamRequestId);
}
