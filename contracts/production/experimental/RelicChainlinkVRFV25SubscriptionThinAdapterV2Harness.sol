// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";
import "./RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

error RFV2_OnlyChainlinkCoordinator();
error RFV2_SubscriptionConsumerNotAdmitted();
error RFV2_PendingRequestLimit();

interface IRelicChainlinkVRFV25SubscriptionCoordinatorV2 {
    struct RandomWordsRequest {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }
    function requestRandomWords(RandomWordsRequest calldata req) external returns (uint256 requestId);
    function fundSubscriptionWithNative(uint256 subId) external payable;
    function getSubscription(uint256 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers);
}

contract RelicChainlinkVRFV25SubscriptionThinAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));
    uint32 public constant NUM_WORDS = 1;
    IRelicChainlinkVRFV25SubscriptionCoordinatorV2 public immutable coordinator;
    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint16 public immutable requestConfirmations;
    uint256 public immutable reservationPerRequestWei;
    uint32 public immutable maxPendingRequestsPerConsumer;

    mapping(address => uint32) public pendingRequestsByConsumer;
    mapping(address => uint256) public totalReservationFundingByConsumer;
    mapping(uint256 => uint256) public reservationByLocalRequestId;

    constructor(
        address coordinator_,
        address registry_,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 confirmations_,
        uint256 reservationPerRequestWei_,
        uint32 maxPending_
    ) {
        if (
            coordinator_ == address(0) || coordinator_.code.length == 0 || registry_ == address(0)
                || registry_.code.length == 0 || subscriptionId_ == 0 || keyHash_ == bytes32(0) || confirmations_ == 0
                || reservationPerRequestWei_ == 0 || maxPending_ == 0
        ) revert RF_BadConfig();
        coordinator = IRelicChainlinkVRFV25SubscriptionCoordinatorV2(coordinator_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(registry_);
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        requestConfirmations = confirmations_;
        reservationPerRequestWei = reservationPerRequestWei_;
        maxPendingRequestsPerConsumer = maxPending_;
    }

    function nativePaymentExtraArgs() public pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, true);
    }

    function isAdmittedSubscriptionConsumer() public view returns (bool) {
        (,,,, address[] memory consumers) = coordinator.getSubscription(subscriptionId);
        for (uint256 i; i < consumers.length; ++i) {
            if (consumers[i] == address(this)) return true;
        }
        return false;
    }

    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(coordinator)) revert RFV2_OnlyChainlinkCoordinator();
        if (randomWords.length != NUM_WORDS) revert RF_BadRequest();
        uint256 localRequestId = upstreamRequestIdToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();
        address consumer = deliveries[localRequestId].consumer;
        _recordVerifiedWord(upstreamRequestId, randomWords[0]);
        unchecked {
            --pendingRequestsByConsumer[consumer];
        }
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
        if (!isAdmittedSubscriptionConsumer()) revert RFV2_SubscriptionConsumerNotAdmitted();
        if (pendingRequestsByConsumer[consumer] >= maxPendingRequestsPerConsumer) revert RFV2_PendingRequestLimit();
    }

    function _quoteUpstreamRequest(uint32) internal view override returns (uint256) {
        return reservationPerRequestWei;
    }

    function _requestUpstream(uint256 localRequestId, uint32 upstreamCallbackGas, uint256 requestPrice)
        internal
        override
        returns (uint256 upstreamRequestId)
    {
        address consumer = deliveries[localRequestId].consumer;
        reservationByLocalRequestId[localRequestId] = requestPrice;
        totalReservationFundingByConsumer[consumer] += requestPrice;
        ++pendingRequestsByConsumer[consumer];
        coordinator.fundSubscriptionWithNative{value: requestPrice}(subscriptionId);
        IRelicChainlinkVRFV25SubscriptionCoordinatorV2.RandomWordsRequest memory req =
            IRelicChainlinkVRFV25SubscriptionCoordinatorV2.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: upstreamCallbackGas,
                numWords: NUM_WORDS,
                extraArgs: nativePaymentExtraArgs()
            });
        upstreamRequestId = coordinator.requestRandomWords(req);
    }
}
