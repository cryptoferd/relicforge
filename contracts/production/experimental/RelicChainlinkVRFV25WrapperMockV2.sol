// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";

interface IRelicChainlinkVRFV25WrapperConsumerV2 {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/// @title RelicChainlinkVRFV25WrapperMockV2
/// @notice ABI-shaped Chainlink VRF v2.5 native direct-funding wrapper mock.
/// @dev EXPERIMENTAL ONLY. It models live quote changes, full callback-limit billing, one upstream
///      callback attempt, and the current requestRandomWordsInNative/calculateRequestPriceNative ABI.
contract RelicChainlinkVRFV25WrapperMockV2 {
    struct Request {
        address consumer;
        uint32 callbackGasLimit;
        uint16 requestConfirmations;
        uint32 numWords;
        uint256 paid;
        uint256 word;
        bool wordReady;
        bool callbackAttempted;
        bool callbackSucceeded;
    }

    uint256 public baseFeeWei;
    uint256 public callbackGasPriceWei;
    uint256 public nextRequestId = 1;
    uint256 public totalFeesPaid;

    mapping(uint256 => Request) public requests;

    event WrapperPricingChanged(uint256 baseFeeWei, uint256 callbackGasPriceWei);
    event WrapperRandomnessRequested(
        uint256 indexed requestId,
        address indexed consumer,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        uint256 price
    );
    event WrapperWordRecorded(uint256 indexed requestId, uint256 word);
    event WrapperCallbackAttempted(uint256 indexed requestId, bool succeeded, uint32 gasLimit);

    constructor(uint256 baseFeeWei_, uint256 callbackGasPriceWei_) {
        baseFeeWei = baseFeeWei_;
        callbackGasPriceWei = callbackGasPriceWei_;
    }

    function setPricing(uint256 baseFeeWei_, uint256 callbackGasPriceWei_) external {
        baseFeeWei = baseFeeWei_;
        callbackGasPriceWei = callbackGasPriceWei_;
        emit WrapperPricingChanged(baseFeeWei_, callbackGasPriceWei_);
    }

    function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords) public view returns (uint256) {
        if (numWords == 0) revert RF_BadConfig();
        return baseFeeWei + uint256(callbackGasLimit) * callbackGasPriceWei;
    }

    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId) {
        if (callbackGasLimit == 0 || requestConfirmations == 0 || numWords != 1) revert RF_BadConfig();
        if (extraArgs.length != 36 || extraArgs[35] != bytes1(0x01)) revert RF_BadConfig();

        uint256 price = calculateRequestPriceNative(callbackGasLimit, numWords);
        if (msg.value != price) revert RFV2_WrongRandomnessPayment();

        requestId = nextRequestId++;
        requests[requestId] = Request({
            consumer: msg.sender,
            callbackGasLimit: callbackGasLimit,
            requestConfirmations: requestConfirmations,
            numWords: numWords,
            paid: price,
            word: 0,
            wordReady: false,
            callbackAttempted: false,
            callbackSucceeded: false
        });
        totalFeesPaid += price;

        emit WrapperRandomnessRequested(requestId, msg.sender, callbackGasLimit, requestConfirmations, numWords, price);
    }

    function recordWord(uint256 requestId, uint256 word) public {
        Request storage req = requests[requestId];
        if (req.consumer == address(0)) revert RF_BadRequest();
        if (req.wordReady) revert RF_AlreadyFulfilled();

        req.wordReady = true;
        req.word = word;
        emit WrapperWordRecorded(requestId, word);
    }

    function deliver(uint256 requestId) public returns (bool succeeded) {
        Request storage req = requests[requestId];
        if (req.consumer == address(0) || !req.wordReady || req.callbackAttempted) {
            revert RF_BadRequest();
        }

        req.callbackAttempted = true;
        uint256[] memory words = new uint256[](1);
        words[0] = req.word;

        (succeeded,) = req.consumer.call{gas: req.callbackGasLimit}(
            abi.encodeCall(IRelicChainlinkVRFV25WrapperConsumerV2.rawFulfillRandomWords, (requestId, words))
        );
        req.callbackSucceeded = succeeded;
        emit WrapperCallbackAttempted(requestId, succeeded, req.callbackGasLimit);
    }

    function fulfill(uint256 requestId, uint256 word) external returns (bool succeeded) {
        recordWord(requestId, word);
        succeeded = deliver(requestId);
    }

    /// @notice Test-only duplicate callback probe used to prove that a recorded word cannot be replaced.
    function forceDuplicateCallback(uint256 requestId, uint256 differentWord) external {
        Request storage req = requests[requestId];
        if (req.consumer == address(0)) revert RF_BadRequest();

        uint256[] memory words = new uint256[](1);
        words[0] = differentWord;
        IRelicChainlinkVRFV25WrapperConsumerV2(req.consumer).rawFulfillRandomWords(requestId, words);
    }
}
