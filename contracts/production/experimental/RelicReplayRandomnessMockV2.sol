// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

interface IRelicRandomnessFailureViewV2 {
    function requestFailed(uint256 requestId) external view returns (bool);
}

/// @notice Phase 2 replay/failure-capable async randomness mock.
/// @dev Models the property Relic Forge needs from production adapters:
///      once a random word is recorded it can only be replayed, never rerolled.
contract RelicReplayRandomnessMockV2 is IRelicRandomnessProviderV1, IRelicRandomnessFailureViewV2 {
    struct Request {
        address consumer;
        uint256 context;
        uint256 word;
        bool wordReady;
        bool delivered;
        bool failed;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;

    event Requested(uint256 indexed requestId, address indexed consumer, uint256 context);
    event WordRecorded(uint256 indexed requestId, uint256 word);
    event DeliveryAttempt(uint256 indexed requestId, bool delivered);
    event TerminalFailure(uint256 indexed requestId);

    function requestRandomness(uint256 context) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request({
            consumer: msg.sender,
            context: context,
            word: 0,
            wordReady: false,
            delivered: false,
            failed: false
        });
        emit Requested(requestId, msg.sender, context);
    }

    function recordWord(uint256 requestId, uint256 word) public {
        Request storage req = requests[requestId];
        if (req.consumer == address(0) || req.failed) revert RF_BadRequest();
        if (req.wordReady) revert RF_AlreadyFulfilled();

        req.wordReady = true;
        req.word = word;
        emit WordRecorded(requestId, word);
    }

    function deliver(uint256 requestId, uint256 gasLimit) public returns (bool delivered) {
        Request storage req = requests[requestId];
        if (req.consumer == address(0) || !req.wordReady || req.failed) revert RF_BadRequest();
        if (req.delivered) return true;

        // Pre-lock. A failed consumer call restores replayability of this exact word.
        req.delivered = true;
        (delivered,) = req.consumer.call{gas: gasLimit}(
            abi.encodeCall(IRelicRandomnessConsumerV1.fulfillRandomness, (requestId, req.word))
        );
        if (!delivered) req.delivered = false;

        emit DeliveryAttempt(requestId, delivered);
    }

    function replay(uint256 requestId) external returns (bool delivered) {
        uint256 available = gasleft();
        uint256 gasLimit = available > 75_000 ? available - 75_000 : available / 2;
        delivered = deliver(requestId, gasLimit);
    }

    function fulfill(uint256 requestId, uint256 word) external returns (bool delivered) {
        recordWord(requestId, word);
        uint256 available = gasleft();
        uint256 gasLimit = available > 75_000 ? available - 75_000 : available / 2;
        delivered = deliver(requestId, gasLimit);
    }

    /// @notice Test stand-in for an adapter proving that an upstream request can never fulfill.
    /// @dev A real provider adapter must define provider-specific terminal-failure rules.
    function markTerminalFailure(uint256 requestId) external {
        Request storage req = requests[requestId];
        if (req.consumer == address(0) || req.wordReady || req.delivered || req.failed) revert RF_BadRequest();
        req.failed = true;
        emit TerminalFailure(requestId);
    }

    function requestFailed(uint256 requestId) external view returns (bool) {
        return requests[requestId].failed;
    }
}
