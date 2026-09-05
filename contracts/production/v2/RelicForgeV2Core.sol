// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

error RFV2_ConsumerCallbackGasOutOfRangeProd();
error RFV2_CollectionNotRegisteredProd();
error RFV2_CollectionAlreadyRegisteredProd();
error RFV2_BadReserveDrawProd();
error RFV2_ReserveSubsidyCapProd();
error RFV2_NoRevenueAvailableProd();
error RFV2_BatchNotLockedProd();
error RFV2_BatchAlreadyRequestedProd();
error RFV2_HopperSweepUnauthorizedProd();
error RFV2_RandomnessQuoteTooHighProd();
error RFV2_DelayedRevealPendingProd();
error RFV2_DelayedRevealUnavailableProd();

interface IRelicPricedRandomnessProviderV2Prod {
    function quoteRequestPrice(uint32 requestedConsumerCallbackGas) external view returns (uint256);
    function requestRandomness(uint256 context, uint32 requestedConsumerCallbackGas)
        external
        payable
        returns (uint256 requestId);
}

interface IRelicCanonicalCollectionRegistryV2Prod {
    function isCanonicalCollection(address collection) external view returns (bool);
}

interface IRelicForgeReserveCollectionV2Prod {
    function reserveExposureWei() external view returns (uint256);
    function restrictedSponsoredLiabilityWei() external view returns (uint256);
    function activeForgeBatchCount() external view returns (uint256);
    function randomnessShortfallFor(uint64 batchId) external view returns (uint256);
    function sweepExcessToReserve() external returns (uint256 amount);
}

interface IRelicForgeReserveV2Prod {
    function factory() external view returns (address);
    function canonicalCollection(address collection) external view returns (bool);
    function registerCollection(address collection) external;
    function syncCollection(address collection) external;
    function fundRandomnessShortfall(uint64 batchId, uint256 amount) external;
    function depositFromCollection() external payable;
}

struct RelicCollectionInitV2 {
    string name;
    string symbol;
    string description;
    address creator;
    address dataContract;
    address renderer;
    address randomnessProvider;
    address forgeReserve;
    address feePolicy;
    address mintPhases;
    uint32 maxSupply;
    address payoutReceiver;
    address royaltyReceiver;
    uint96 royaltyBps;
    uint8 feeMode;
    uint32 lockedFeeCents;
    uint8 initialRevealMode;
    uint64 batchWindowSeconds;
    uint256 maxRandomnessCostPerBatchWei;
}

interface IRelicForgeFactoryV2View {
    function randomnessProvider() external view returns (address);
    function canonicalRegistry() external view returns (address);
    function reserve() external view returns (address);
    function isRelicForgeCollection(address collection) external view returns (bool);
}

/// @notice Production V2 thin randomness base.
/// @dev Upstream provider adapters may store a verified word without calling the consumer.
///      Consumer delivery is a later permissionless replay transaction with a bounded gas stipend.
abstract contract RelicThinRandomnessAdapterBaseV2Prod is IRelicPricedRandomnessProviderV2Prod {
    uint32 public constant UPSTREAM_CALLBACK_GAS = 300_000;
    uint32 public constant CONSUMER_WORD_DELIVERY_GAS = 400_000;
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
        if (msg.value != requestPrice) revert RF_WrongPrice();

        localRequestId = nextRequestId++;
        deliveries[localRequestId] =
            Delivery(msg.sender, context, requestedConsumerCallbackGas, 0, requestPrice, 0, false, false);

        uint256 upstreamRequestId = _requestUpstream(localRequestId, UPSTREAM_CALLBACK_GAS, requestPrice);
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

    function replayFulfillment(uint256 localRequestId) external returns (bool delivered) {
        Delivery storage d = deliveries[localRequestId];
        if (d.consumer == address(0) || !d.wordReady) revert RF_BadRequest();
        if (d.delivered) return true;
        delivered = _deliver(localRequestId, d);
    }

    function _storeVerifiedWordOnly(uint256 upstreamRequestId, uint256 randomWord)
        internal
        returns (uint256 localRequestId)
    {
        localRequestId = upstreamRequestIdToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();

        Delivery storage d = deliveries[localRequestId];
        if (d.wordReady) revert RF_AlreadyFulfilled();

        d.wordReady = true;
        d.word = randomWord;
        emit ThinRandomWordRecorded(localRequestId, upstreamRequestId, randomWord);
    }

    function _deliver(uint256 localRequestId, Delivery storage d) internal returns (bool delivered) {
        if (gasleft() <= uint256(CONSUMER_WORD_DELIVERY_GAS) + DELIVERY_GAS_RESERVE) {
            emit ThinRandomnessDelivery(localRequestId, false);
            return false;
        }

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
        ) revert RFV2_ConsumerCallbackGasOutOfRangeProd();
    }

    function _requireAuthorizedConsumer(address consumer) internal view virtual;
    function _quoteUpstreamRequest(uint32 upstreamCallbackGas) internal view virtual returns (uint256);
    function _requestUpstream(uint256 localRequestId, uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        virtual
        returns (uint256 upstreamRequestId);
}
