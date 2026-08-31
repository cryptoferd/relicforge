// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

/// @notice Test-only asynchronous randomness provider for the Forge Reveal V2 prototype.
/// @dev It deliberately uses the existing vendor-neutral V1 provider/consumer interface so Phase 1
///      can prove that Relic Forge's provider abstraction does not need to be thrown away.
contract RelicRandomnessMockV2 is IRelicRandomnessProviderV1 {
    struct Request {
        address consumer;
        uint256 context;
        bool fulfilled;
    }

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;

    event Requested(uint256 indexed requestId, address indexed consumer, uint256 context);
    event Fulfilled(uint256 indexed requestId, uint256 randomWord);

    function requestRandomness(uint256 context) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request({
            consumer: msg.sender,
            context: context,
            fulfilled: false
        });
        emit Requested(requestId, msg.sender, context);
    }

    function fulfill(uint256 requestId, uint256 randomWord) external {
        Request storage req = requests[requestId];
        if (req.consumer == address(0)) revert RF_BadRequest();
        if (req.fulfilled) revert RF_AlreadyFulfilled();

        // Effects first. If the consumer call reverts, this transaction reverts too,
        // restoring replayability of the same request.
        req.fulfilled = true;
        IRelicRandomnessConsumerV1(req.consumer).fulfillRandomness(requestId, randomWord);
        emit Fulfilled(requestId, randomWord);
    }
}
