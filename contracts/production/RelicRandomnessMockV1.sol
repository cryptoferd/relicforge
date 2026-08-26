// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicRandomnessAdapterBaseV1.sol";

/**
 * @title RelicRandomnessMockV1
 * @notice Manual local/Sepolia test adapter. NEVER deploy as a production randomness source.
 */
contract RelicRandomnessMockV1 is RelicRandomnessAdapterBaseV1 {
    event MockUpstreamRequested(uint256 indexed localRequestId, uint256 context);

    function _requestUpstream(uint256 localRequestId, uint256 context) internal override {
        emit MockUpstreamRequested(localRequestId, context);
    }

    function fulfill(uint256 localRequestId, uint256 randomWord) external {
        _recordWord(localRequestId, randomWord);
    }
}
