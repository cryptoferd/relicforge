// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

error RFV2_WrongRandomnessPayment();

interface IRelicPricedRandomnessProviderV2 {
    function quoteRequestPrice(uint32 callbackGasLimit) external view returns (uint256);
    function requestRandomness(uint256 context, uint32 callbackGasLimit)
        external
        payable
        returns (uint256 requestId);
}

/// @title RelicPricedRandomnessQueueMockV2
/// @notice Phase 2C deterministic-priced provider mock with exact-word replay semantics.
/// @dev EXPERIMENTAL ONLY. Pricing is baseFee + callbackGasLimit * gasPrice.
contract RelicPricedRandomnessQueueMockV2 is IRelicPricedRandomnessProviderV2 {
    struct Request {
        address consumer;
        uint256 context;
        uint32 callbackGasLimit;
        uint256 paid;
        uint256 word;
        bool wordReady;
        bool delivered;
    }

    uint256 public immutable baseFeeWei;
    uint256 public immutable gasPriceWei;
    uint256 public nextRequestId = 1;
    uint256 public totalFeesPaid;

    mapping(uint256 => Request) public requests;

    event RandomnessRequested(
        uint256 indexed requestId,
        address indexed consumer,
        uint256 indexed context,
        uint32 callbackGasLimit,
        uint256 price
    );
    event RandomWordRecorded(uint256 indexed requestId, uint256 word);
    event RandomnessDelivery(uint256 indexed requestId, bool delivered, uint32 gasLimit);

    constructor(uint256 baseFeeWei_, uint256 gasPriceWei_) {
        baseFeeWei = baseFeeWei_;
        gasPriceWei = gasPriceWei_;
    }

    function quoteRequestPrice(uint32 callbackGasLimit) public view returns (uint256) {
        return baseFeeWei + uint256(callbackGasLimit) * gasPriceWei;
    }

    function requestRandomness(uint256 context, uint32 callbackGasLimit)
        external
        payable
        returns (uint256 requestId)
    {
        if (callbackGasLimit < 100_000) revert RF_BadConfig();

        uint256 price = quoteRequestPrice(callbackGasLimit);
        if (msg.value != price) revert RFV2_WrongRandomnessPayment();

        requestId = nextRequestId++;
        requests[requestId] = Request({
            consumer: msg.sender,
            context: context,
            callbackGasLimit: callbackGasLimit,
            paid: price,
            word: 0,
            wordReady: false,
            delivered: false
        });
        totalFeesPaid += price;

        emit RandomnessRequested(requestId, msg.sender, context, callbackGasLimit, price);
    }

    /// @notice Simulates the upstream network recording/proving the word before consumer delivery.
    function recordWord(uint256 requestId, uint256 word) public {
        Request storage req = requests[requestId];
        if (req.consumer == address(0)) revert RF_BadRequest();
        if (req.wordReady) revert RF_AlreadyFulfilled();

        req.wordReady = true;
        req.word = word;
        emit RandomWordRecorded(requestId, word);
    }

    function deliver(uint256 requestId) public returns (bool delivered) {
        Request storage req = requests[requestId];
        delivered = _deliver(req, requestId, req.callbackGasLimit);
    }

    /// @notice Test-only low-gas delivery. The same already-recorded word remains replayable afterward.
    function deliverWithGas(uint256 requestId, uint32 gasLimit) public returns (bool delivered) {
        Request storage req = requests[requestId];
        delivered = _deliver(req, requestId, gasLimit);
    }

    function _deliver(Request storage req, uint256 requestId, uint32 gasLimit)
        internal
        returns (bool delivered)
    {
        if (req.consumer == address(0) || !req.wordReady) revert RF_BadRequest();
        if (req.delivered) return true;

        req.delivered = true;
        (delivered,) = req.consumer.call{gas: gasLimit}(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (requestId, req.word))
        );
        if (!delivered) req.delivered = false;

        emit RandomnessDelivery(requestId, delivered, gasLimit);
    }

    function fulfill(uint256 requestId, uint256 word) external returns (bool delivered) {
        recordWord(requestId, word);
        delivered = deliver(requestId);
    }

    function replay(uint256 requestId) external returns (bool delivered) {
        delivered = deliver(requestId);
    }
}
