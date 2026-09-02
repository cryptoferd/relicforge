// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicDiceEntropyV10ThinAdapterV2Harness.sol";

interface IRelicDiceEntropyConsumerV2 {
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external;
}

/// @title RelicDiceEntropyV10Mock
/// @notice ABI-shaped Dice Protocol v10 mock for Phase 2D R6 Robinhood certification tests.
/// @dev EXPERIMENTAL ONLY. Models exact flat fee, full custom user contribution, provider readiness,
///      retryable callback failure, optional requester-only refund after a delay, and late reveal if no refund occurs.
contract RelicDiceEntropyV10Mock is IRelicDiceEntropyV10 {
    uint32 internal constant TEN_THOUSAND = 10_000;

    struct Request {
        address requester;
        address provider;
        bytes32 userRandomNumber;
        uint32 requestedGasLimit;
        uint32 effectiveGasLimit;
        uint128 feePaid;
        uint64 requestBlock;
        bytes32 providerRevelation;
        bytes32 randomNumber;
        uint8 callbackStatus; // 0 not started, 1 failed, 2 succeeded
        bool exists;
        bool refunded;
    }

    address public immutable configuredProvider;
    uint128 public protocolFeeInWei;
    uint64 public refundDelayBlocks;
    uint64 public simulatedBlockNumber = 100;
    uint256 public totalFeesCollected;
    IRelicDiceEntropyV10.ProviderInfo internal _providerInfo;
    mapping(uint64 => Request) public requests;

    event DiceRequested(
        uint64 indexed sequenceNumber,
        address indexed requester,
        address indexed provider,
        bytes32 userRandomNumber,
        uint32 requestedGasLimit,
        uint32 effectiveGasLimit,
        uint128 feePaid
    );
    event DiceCallbackAttempted(uint64 indexed sequenceNumber, bytes32 randomNumber, bool succeeded);
    event DiceRequestRefunded(uint64 indexed sequenceNumber, address indexed requester, uint128 amount);

    constructor(address provider_, uint128 fee_, uint32 defaultGasLimit_, uint64 refundDelayBlocks_) {
        if (provider_ == address(0) || defaultGasLimit_ == 0 || refundDelayBlocks_ == 0) revert RF_BadConfig();
        configuredProvider = provider_;
        protocolFeeInWei = fee_;
        refundDelayBlocks = refundDelayBlocks_;
        _providerInfo.originalCommitment = keccak256("RF_DICE_R6_ORIGINAL");
        _providerInfo.originalCommitmentSequenceNumber = 0;
        _providerInfo.commitmentMetadata = bytes("r6");
        _providerInfo.uri = bytes("mock://dice-r6");
        _providerInfo.endSequenceNumber = 1_000_000;
        _providerInfo.sequenceNumber = 1;
        _providerInfo.currentCommitment = keccak256("RF_DICE_R6_CURRENT");
        _providerInfo.currentCommitmentSequenceNumber = 0;
        _providerInfo.maxNumHashes = 0;
        _providerInfo.defaultGasLimit = defaultGasLimit_;
    }

    receive() external payable {}

    function setFee(uint128 fee_) external {
        protocolFeeInWei = fee_;
    }

    function setDefaultGasLimit(uint32 gasLimit_) external {
        _providerInfo.defaultGasLimit = gasLimit_;
    }

    function setProviderCommitment(bytes32 commitment_) external {
        _providerInfo.currentCommitment = commitment_;
    }

    function setProviderRange(uint64 sequenceNumber_, uint64 endSequenceNumber_) external {
        _providerInfo.sequenceNumber = sequenceNumber_;
        _providerInfo.endSequenceNumber = endSequenceNumber_;
    }

    function setRefundDelayBlocks(uint64 delay_) external {
        refundDelayBlocks = delay_;
    }

    function advanceSimulatedBlocks(uint64 blocks_) external {
        simulatedBlockNumber += blocks_;
    }

    function getProviderInfoV2(address provider) external view returns (ProviderInfo memory info) {
        if (provider != configuredProvider) return info;
        info = _providerInfo;
    }

    function getRefundDelayBlocks() external view returns (uint64 delayBlocks) {
        delayBlocks = refundDelayBlocks;
    }

    function getFeeV2(address provider, uint32) public view returns (uint128 feeAmount) {
        if (provider != configuredProvider) revert RF_BadRequest();
        return protocolFeeInWei;
    }

    function requestV2(address provider, bytes32 userRandomNumber, uint32 gasLimit)
        external
        payable
        returns (uint64 assignedSequenceNumber)
    {
        if (provider != configuredProvider || userRandomNumber == bytes32(0)) revert RF_BadRequest();
        if (
            _providerInfo.sequenceNumber == 0 || _providerInfo.sequenceNumber >= _providerInfo.endSequenceNumber
                || _providerInfo.currentCommitment == bytes32(0)
        ) revert RF_BadRequest();

        uint128 fee = getFeeV2(provider, gasLimit);
        if (msg.value != fee) revert RFV2_WrongRandomnessPayment();

        assignedSequenceNumber = _providerInfo.sequenceNumber++;
        uint32 rounded = _roundTo10k(gasLimit);
        uint32 effective = rounded < _providerInfo.defaultGasLimit ? _providerInfo.defaultGasLimit : rounded;
        requests[assignedSequenceNumber] = Request({
            requester: msg.sender,
            provider: provider,
            userRandomNumber: userRandomNumber,
            requestedGasLimit: gasLimit,
            effectiveGasLimit: effective,
            feePaid: fee,
            requestBlock: simulatedBlockNumber,
            providerRevelation: bytes32(0),
            randomNumber: bytes32(0),
            callbackStatus: 0,
            exists: true,
            refunded: false
        });
        totalFeesCollected += fee;
        emit DiceRequested(assignedSequenceNumber, msg.sender, provider, userRandomNumber, gasLimit, effective, fee);
    }

    /// @notice Models Dice revealWithCallback with an immutable user/provider pair and retryable first callback failure.
    function revealWithCallback(
        address provider,
        uint64 sequenceNumber,
        bytes32 userContribution,
        bytes32 providerRevelation
    ) public returns (bool succeeded) {
        Request storage req = requests[sequenceNumber];
        if (
            !req.exists || req.refunded || req.callbackStatus == 2 || provider != req.provider
                || userContribution != req.userRandomNumber || providerRevelation == bytes32(0)
        ) revert RF_BadRequest();

        if (req.providerRevelation == bytes32(0)) {
            req.providerRevelation = providerRevelation;
        } else if (req.providerRevelation != providerRevelation) {
            revert RF_BadRequest();
        }

        bytes32 randomNumber = keccak256(abi.encodePacked(userContribution, providerRevelation, bytes32(0)));
        if (req.randomNumber == bytes32(0)) {
            req.randomNumber = randomNumber;
        } else if (req.randomNumber != randomNumber) {
            revert RF_BadRequest();
        }

        (succeeded,) = req.requester.call{gas: req.effectiveGasLimit}(
            abi.encodeCall(IRelicDiceEntropyConsumerV2._entropyCallback, (sequenceNumber, provider, randomNumber))
        );
        req.callbackStatus = succeeded ? 2 : 1;
        emit DiceCallbackAttempted(sequenceNumber, randomNumber, succeeded);
    }

    /// @notice Models v10 requester-only optional refund. If nobody calls it, a late reveal remains possible.
    function refundRequest(address provider, uint64 sequenceNumber) external {
        Request storage req = requests[sequenceNumber];
        if (!req.exists || req.refunded || provider != req.provider) revert RF_BadRequest();
        if (req.requester != msg.sender) revert RF_NotAuthorized();
        if (simulatedBlockNumber < req.requestBlock + refundDelayBlocks) revert RF_PhaseNotStarted();

        uint128 amount = req.feePaid;
        req.refunded = true;
        req.exists = false;
        totalFeesCollected -= amount;
        (bool sent,) = msg.sender.call{value: amount}("");
        if (!sent) revert RF_BadRequest();
        emit DiceRequestRefunded(sequenceNumber, msg.sender, amount);
    }

    function forceDuplicateCallback(uint64 sequenceNumber, bytes32 randomNumber) external {
        Request storage req = requests[sequenceNumber];
        if (req.requester == address(0)) revert RF_BadRequest();
        IRelicDiceEntropyConsumerV2(req.requester)._entropyCallback(sequenceNumber, req.provider, randomNumber);
    }

    function forceCallbackWithProvider(uint64 sequenceNumber, address callbackProvider, bytes32 randomNumber) external {
        Request storage req = requests[sequenceNumber];
        if (req.requester == address(0)) revert RF_BadRequest();
        IRelicDiceEntropyConsumerV2(req.requester)._entropyCallback(sequenceNumber, callbackProvider, randomNumber);
    }

    function _roundTo10k(uint32 gasLimit) internal pure returns (uint32) {
        if (gasLimit == 0) return 0;
        uint256 rounded = (uint256(gasLimit) + TEN_THOUSAND - 1) / TEN_THOUSAND * TEN_THOUSAND;
        if (rounded > type(uint32).max) revert RF_BadConfig();
        return uint32(rounded);
    }
}
