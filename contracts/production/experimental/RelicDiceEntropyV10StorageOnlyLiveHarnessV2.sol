// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicDiceEntropyV10StorageOnlyAdapterV2Harness.sol";

/// @notice Minimal one-collection canonical registry for the R8 live test only.
contract RelicR8LiveRegistryV2 is IRelicCanonicalCollectionRegistryV2 {
    address public immutable admin;
    mapping(address => bool) public canonical;

    constructor(address admin_) {
        if (admin_ == address(0)) revert RF_BadConfig();
        admin = admin_;
    }

    function setCanonical(address consumer, bool value) external {
        if (msg.sender != admin) revert RF_NotAuthorized();
        canonical[consumer] = value;
    }

    function isCanonicalCollection(address consumer) external view returns (bool) {
        return canonical[consumer];
    }
}

/// @notice One-shot fixed CSPRNG contribution source for the R8 live test only.
contract RelicR8FixedContributionSourceV2 is IRelicDiceContributionSourceV2 {
    bytes32 public immutable contribution;
    bool public used;

    constructor(bytes32 contribution_) {
        if (contribution_ == bytes32(0)) revert RF_BadConfig();
        contribution = contribution_;
    }

    function contributionForRequest(address, uint256, uint256) external returns (bytes32 userRandomNumber) {
        if (used) revert RF_BadRequest();
        used = true;
        return contribution;
    }
}

/// @notice Production-shaped downstream consumer for the R8 live test.
/// @dev It intentionally starts in reverting-delivery mode. The Dice callback must still succeed because the
///      R8 adapter does not call this consumer upstream. Later permissionless replay is first allowed to fail,
///      then retried with the exact stored word after the admin enables delivery.
contract RelicR8LiveConsumerV2 is IRelicRandomnessConsumerV1 {
    address public immutable admin;
    IRelicPricedRandomnessProviderV2 public immutable randomnessProvider;

    bool public revertDelivery = true;
    uint256 public lastRequestId;
    uint256 public lastWord;
    uint256 public deliveryCount;

    constructor(address admin_, address randomnessProvider_) {
        if (admin_ == address(0) || randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0) {
            revert RF_BadConfig();
        }
        admin = admin_;
        randomnessProvider = IRelicPricedRandomnessProviderV2(randomnessProvider_);
    }

    function setRevertDelivery(bool value) external {
        if (msg.sender != admin) revert RF_NotAuthorized();
        revertDelivery = value;
    }

    function request(uint256 context, uint32 requestedConsumerCallbackGas)
        external
        payable
        returns (uint256 localRequestId)
    {
        localRequestId = randomnessProvider.requestRandomness{value: msg.value}(context, requestedConsumerCallbackGas);
        lastRequestId = localRequestId;
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external {
        if (msg.sender != address(randomnessProvider)) revert RF_NotRandomnessProvider();
        if (revertDelivery) revert RF_BadRequest();
        if (deliveryCount != 0) revert RF_AlreadyFulfilled();
        lastRequestId = requestId;
        lastWord = randomWord;
        deliveryCount = 1;
    }
}
