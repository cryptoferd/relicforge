// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness.sol";

interface IRelicChainlinkVRFV25SubscriptionConsumerV2 {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract RelicChainlinkVRFV25SubscriptionCoordinatorMockV2 is IRelicChainlinkVRFV25SubscriptionCoordinatorV2 {
    struct Subscription {
        uint96 linkBalance;
        uint96 nativeBalance;
        uint64 reqCount;
        address owner;
        address[] consumers;
    }

    struct StoredRequest {
        address consumer;
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        uint256 word;
        bool wordReady;
        bool callbackAttempted;
        bool callbackSucceeded;
        uint256 chargedPayment;
    }

    uint256 public nextRequestId = 1;
    uint256 public actualPaymentWei;
    mapping(uint256 => Subscription) internal subscriptions;
    mapping(uint256 => mapping(address => bool)) public isConsumer;
    mapping(uint256 => StoredRequest) public requests;

    event RandomWordsFulfilled(
        uint256 indexed requestId,
        uint256 outputSeed,
        uint256 indexed subId,
        uint256 payment,
        bool nativePayment,
        bool success,
        bool onlyPremium
    );

    function createSubscription(uint256 subId, address owner_) external {
        if (subId == 0 || owner_ == address(0) || subscriptions[subId].owner != address(0)) revert RF_BadConfig();
        subscriptions[subId].owner = owner_;
    }

    function addConsumer(uint256 subId, address consumer) external {
        Subscription storage s = subscriptions[subId];
        if (msg.sender != s.owner || consumer == address(0) || isConsumer[subId][consumer]) revert RF_NotAuthorized();
        isConsumer[subId][consumer] = true;
        s.consumers.push(consumer);
    }

    function setActualPayment(uint256 paymentWei) external {
        actualPaymentWei = paymentWei;
    }

    function fundSubscriptionWithNative(uint256 subId) external payable {
        Subscription storage s = subscriptions[subId];
        if (s.owner == address(0)) revert RF_BadRequest();
        uint256 updated = uint256(s.nativeBalance) + msg.value;
        if (updated > type(uint96).max) revert RF_BadConfig();
        s.nativeBalance = uint96(updated);
    }

    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
    {
        Subscription storage s = subscriptions[subId];
        return (s.linkBalance, s.nativeBalance, s.reqCount, s.owner, s.consumers);
    }

    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256 requestId) {
        Subscription storage s = subscriptions[req.subId];
        if (
            !isConsumer[req.subId][msg.sender] || req.callbackGasLimit == 0 || req.numWords != 1
                || req.requestConfirmations == 0
        ) revert RF_NotAuthorized();
        requestId = nextRequestId++;
        ++s.reqCount;
        requests[requestId] = StoredRequest(
            msg.sender,
            req.keyHash,
            req.subId,
            req.requestConfirmations,
            req.callbackGasLimit,
            req.numWords,
            0,
            false,
            false,
            false,
            0
        );
    }

    function fulfill(uint256 requestId, uint256 word) external returns (bool success) {
        StoredRequest storage r = requests[requestId];
        if (r.consumer == address(0) || r.callbackAttempted) revert RF_BadRequest();
        Subscription storage s = subscriptions[r.subId];
        if (uint256(s.nativeBalance) < actualPaymentWei) revert RF_BadRequest();

        // Intentionally mirrors the critical R2 ordering: callback occurs before exact payment is charged/emitted.
        r.word = word;
        r.wordReady = true;
        r.callbackAttempted = true;
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        (success,) = r.consumer.call{gas: r.callbackGasLimit}(
            abi.encodeCall(IRelicChainlinkVRFV25SubscriptionConsumerV2.rawFulfillRandomWords, (requestId, words))
        );
        r.callbackSucceeded = success;

        s.nativeBalance = uint96(uint256(s.nativeBalance) - actualPaymentWei);
        r.chargedPayment = actualPaymentWei;
        emit RandomWordsFulfilled(requestId, word, r.subId, actualPaymentWei, true, success, false);
    }

    function forceDuplicateCallback(uint256 requestId, uint256 word) external {
        StoredRequest storage r = requests[requestId];
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        IRelicChainlinkVRFV25SubscriptionConsumerV2(r.consumer).rawFulfillRandomWords(requestId, words);
    }

    receive() external payable {}
}
