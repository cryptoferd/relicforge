// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicDiceEntropyV10ThinAdapterV2Harness.sol";

error RFV2_LiveProbeAlreadyRequested();

/// @title RelicDiceEntropyV10LiveProbeV2
/// @notice One-shot Robinhood testnet consumer used only for Phase 2D R7 live Dice v10 certification.
/// @dev EXPERIMENTAL ONLY. This contract is not a production collection or production randomness adapter.
///      It deliberately has no refund/reroll surface. A successful Dice callback is recorded exactly once.
contract RelicDiceEntropyV10LiveProbeV2 {
    IRelicDiceEntropyV10 public immutable dice;
    address public immutable diceProvider;

    uint64 public lastSequenceNumber;
    uint32 public requestedCallbackGas;
    uint256 public requestFeeWei;
    uint32 public providerDefaultGasLimitAtRequest;
    bool public providerRemainingGasModeAtRequest;
    uint256 public requestedAtBlock;
    uint256 public fulfilledAtBlock;
    bytes32 public userContribution;
    bytes32 public randomNumber;
    bool public fulfilled;
    uint256 public callbackCount;

    event R7LiveProbeRequested(
        uint64 indexed sequenceNumber,
        address indexed dice,
        address indexed provider,
        bytes32 userContribution,
        uint32 callbackGas,
        uint256 requestFeeWei
    );
    event R7LiveProbeFulfilled(uint64 indexed sequenceNumber, bytes32 randomNumber);

    constructor(address dice_, address provider_) {
        if (dice_ == address(0) || dice_.code.length == 0 || provider_ == address(0)) revert RF_BadConfig();
        dice = IRelicDiceEntropyV10(dice_);
        diceProvider = provider_;
    }

    /// @notice Create the probe's single Dice request using the exact live quote.
    function request(bytes32 userRandomNumber, uint32 callbackGasLimit)
        external
        payable
        returns (uint64 sequenceNumber)
    {
        if (lastSequenceNumber != 0) revert RFV2_LiveProbeAlreadyRequested();
        if (userRandomNumber == bytes32(0) || callbackGasLimit == 0) revert RF_BadConfig();

        uint256 fee = uint256(dice.getFeeV2(diceProvider, callbackGasLimit));
        if (msg.value != fee) revert RFV2_WrongRandomnessPayment();

        IRelicDiceEntropyV10.ProviderInfo memory info = dice.getProviderInfoV2(diceProvider);
        providerDefaultGasLimitAtRequest = info.defaultGasLimit;
        providerRemainingGasModeAtRequest = info.defaultGasLimit == 0;

        requestedCallbackGas = callbackGasLimit;
        requestFeeWei = fee;
        requestedAtBlock = block.number;
        userContribution = userRandomNumber;

        sequenceNumber = dice.requestV2{value: fee}(diceProvider, userRandomNumber, callbackGasLimit);
        if (sequenceNumber == 0) revert RF_BadRequest();
        lastSequenceNumber = sequenceNumber;

        emit R7LiveProbeRequested(sequenceNumber, address(dice), diceProvider, userRandomNumber, callbackGasLimit, fee);
    }

    /// @notice Dice-compatible callback. Only the pinned Dice contract/provider and exact sequence are accepted.
    function _entropyCallback(uint64 sequenceNumber, address provider, bytes32 randomNumber_) external {
        if (msg.sender != address(dice)) revert RFV2_OnlyDiceEntropy();
        if (provider != diceProvider) revert RFV2_WrongDiceProvider();
        if (sequenceNumber == 0 || sequenceNumber != lastSequenceNumber) revert RF_BadRequest();
        if (fulfilled) revert RF_AlreadyFulfilled();

        fulfilled = true;
        fulfilledAtBlock = block.number;
        randomNumber = randomNumber_;
        callbackCount = 1;
        emit R7LiveProbeFulfilled(sequenceNumber, randomNumber_);
    }
}
