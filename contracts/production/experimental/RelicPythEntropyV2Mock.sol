// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicPythEntropyV2ThinAdapterV2Harness.sol";

interface IRelicPythEntropyConsumerV2 {
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber) external;
}

/// @title RelicPythEntropyV2Mock
/// @notice ABI-shaped Pyth Entropy V2 mock for Phase 2D R3 certification tests.
/// @dev EXPERIMENTAL ONLY. Models live getFeeV2 pricing, provider callback gas floor/rounding,
///      full custom user contribution, callback failure state, same-result retry, and duplicate probes.
contract RelicPythEntropyV2Mock is IRelicPythEntropyV2 {
    uint32 internal constant TEN_THOUSAND = 10_000;

    struct Request {
        address requester;
        address provider;
        bytes32 userRandomNumber;
        uint32 requestedGasLimit;
        uint32 effectiveGasLimit;
        uint256 paid;
        bytes32 providerRevelation;
        bytes32 randomNumber;
        uint8 callbackStatus; // 0 not started, 1 failed, 2 succeeded
        bool exists;
    }

    address public immutable configuredProvider;
    uint128 public pythFeeInWei;
    uint256 public totalFeesCollected;
    IRelicPythEntropyV2.ProviderInfo internal _providerInfo;
    mapping(uint64 => Request) public requests;

    event PythPricingChanged(uint128 providerFee, uint128 pythFee, uint32 defaultGasLimit);
    event PythRequested(
        uint64 indexed sequenceNumber,
        address indexed requester,
        address indexed provider,
        bytes32 userRandomNumber,
        uint32 requestedGasLimit,
        uint32 effectiveGasLimit,
        uint256 paid
    );
    event PythCallbackAttempted(uint64 indexed sequenceNumber, bytes32 randomNumber, bool succeeded);

    constructor(address provider_, uint128 providerFee_, uint128 pythFee_, uint32 defaultGasLimit_) {
        if (provider_ == address(0) || defaultGasLimit_ == 0) revert RF_BadConfig();
        configuredProvider = provider_;
        pythFeeInWei = pythFee_;
        _providerInfo.feeInWei = providerFee_;
        _providerInfo.originalCommitment = keccak256("RF_PYTH_R3_ORIGINAL");
        _providerInfo.originalCommitmentSequenceNumber = 0;
        _providerInfo.commitmentMetadata = bytes("r3");
        _providerInfo.uri = bytes("mock://pyth-r3");
        _providerInfo.endSequenceNumber = 1_000_000;
        _providerInfo.sequenceNumber = 1;
        _providerInfo.currentCommitment = keccak256("RF_PYTH_R3_CURRENT");
        _providerInfo.currentCommitmentSequenceNumber = 0;
        _providerInfo.maxNumHashes = 0;
        _providerInfo.defaultGasLimit = defaultGasLimit_;
    }

    function setPricing(uint128 providerFee_, uint128 pythFee_) external {
        _providerInfo.feeInWei = providerFee_;
        pythFeeInWei = pythFee_;
        emit PythPricingChanged(providerFee_, pythFee_, _providerInfo.defaultGasLimit);
    }

    function setDefaultGasLimit(uint32 defaultGasLimit_) external {
        _providerInfo.defaultGasLimit = defaultGasLimit_;
        emit PythPricingChanged(_providerInfo.feeInWei, pythFeeInWei, defaultGasLimit_);
    }

    function setProviderCommitment(bytes32 commitment) external {
        _providerInfo.currentCommitment = commitment;
    }

    function setProviderRange(uint64 sequenceNumber, uint64 endSequenceNumber) external {
        _providerInfo.sequenceNumber = sequenceNumber;
        _providerInfo.endSequenceNumber = endSequenceNumber;
    }

    function getProviderInfoV2(address provider) external view returns (ProviderInfo memory info) {
        if (provider != configuredProvider) return info;
        info = _providerInfo;
    }

    function getFeeV2(address provider, uint32 gasLimit) public view returns (uint128 feeAmount) {
        if (provider != configuredProvider) revert RF_BadRequest();
        uint128 providerFee = _providerFee(gasLimit);
        uint256 total = uint256(providerFee) + pythFeeInWei;
        if (total > type(uint128).max) revert RF_BadConfig();
        feeAmount = uint128(total);
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

        uint256 fee = getFeeV2(provider, gasLimit);
        if (msg.value < fee) revert RFV2_WrongRandomnessPayment();

        assignedSequenceNumber = _providerInfo.sequenceNumber++;
        uint32 rounded = _roundTo10k(gasLimit);
        uint32 effective = rounded < _providerInfo.defaultGasLimit ? _providerInfo.defaultGasLimit : rounded;
        requests[assignedSequenceNumber] = Request({
            requester: msg.sender,
            provider: provider,
            userRandomNumber: userRandomNumber,
            requestedGasLimit: gasLimit,
            effectiveGasLimit: effective,
            paid: msg.value,
            providerRevelation: bytes32(0),
            randomNumber: bytes32(0),
            callbackStatus: 0,
            exists: true
        });
        totalFeesCollected += msg.value;
        emit PythRequested(
            assignedSequenceNumber, msg.sender, provider, userRandomNumber, gasLimit, effective, msg.value
        );
    }

    /// @notice Models revealWithCallback's retryable V2 callback state using one immutable provider revelation.
    function revealWithCallback(uint64 sequenceNumber, bytes32 providerRevelation) public returns (bool succeeded) {
        Request storage req = requests[sequenceNumber];
        if (!req.exists || req.callbackStatus == 2 || providerRevelation == bytes32(0)) revert RF_BadRequest();
        if (req.providerRevelation == bytes32(0)) {
            req.providerRevelation = providerRevelation;
        } else if (req.providerRevelation != providerRevelation) {
            revert RF_BadRequest();
        }

        bytes32 randomNumber = keccak256(abi.encodePacked(req.userRandomNumber, providerRevelation, bytes32(0)));
        if (req.randomNumber == bytes32(0)) {
            req.randomNumber = randomNumber;
        } else if (req.randomNumber != randomNumber) {
            revert RF_BadRequest();
        }

        (succeeded,) = req.requester.call{gas: req.effectiveGasLimit}(
            abi.encodeCall(IRelicPythEntropyConsumerV2._entropyCallback, (sequenceNumber, req.provider, randomNumber))
        );
        req.callbackStatus = succeeded ? 2 : 1;
        emit PythCallbackAttempted(sequenceNumber, randomNumber, succeeded);
    }

    function forceDuplicateCallback(uint64 sequenceNumber, bytes32 randomNumber) external {
        Request storage req = requests[sequenceNumber];
        if (!req.exists) revert RF_BadRequest();
        IRelicPythEntropyConsumerV2(req.requester)._entropyCallback(sequenceNumber, req.provider, randomNumber);
    }

    function forceCallbackWithProvider(uint64 sequenceNumber, address callbackProvider, bytes32 randomNumber) external {
        Request storage req = requests[sequenceNumber];
        if (!req.exists) revert RF_BadRequest();
        IRelicPythEntropyConsumerV2(req.requester)._entropyCallback(sequenceNumber, callbackProvider, randomNumber);
    }

    function _providerFee(uint32 gasLimit) internal view returns (uint128) {
        uint32 roundedGasLimit = _roundTo10k(gasLimit);
        uint32 defaultGasLimit = _providerInfo.defaultGasLimit;
        uint128 baseFee = _providerInfo.feeInWei;
        if (defaultGasLimit != 0 && roundedGasLimit > defaultGasLimit) {
            uint256 additional = uint256(roundedGasLimit - defaultGasLimit) * baseFee / defaultGasLimit;
            uint256 scaled = uint256(baseFee) + additional;
            if (scaled > type(uint128).max) revert RF_BadConfig();
            return uint128(scaled);
        }
        return baseFee;
    }

    function _roundTo10k(uint32 gasLimit) internal pure returns (uint32) {
        if (gasLimit == 0) return 0;
        uint256 rounded = (uint256(gasLimit) + TEN_THOUSAND - 1) / TEN_THOUSAND * TEN_THOUSAND;
        if (rounded > type(uint32).max) revert RF_BadConfig();
        return uint32(rounded);
    }
}
