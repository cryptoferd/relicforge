// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../../contracts/production/experimental/RelicDiceEntropyV10StorageOnlyLiveHarnessV2.sol";

interface VmR8DiceRecover {
    function envUint(string calldata name) external returns (uint256);
    function envAddress(string calldata name) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @title RobinhoodDiceV10StorageOnlyLiveRecover
/// @notice Proves that a failed downstream delivery cannot erase/replace the word stored by the real Dice callback.
contract RobinhoodDiceV10StorageOnlyLiveRecover {
    VmR8DiceRecover internal constant vm = VmR8DiceRecover(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    uint256 internal constant REPLAY_CALL_GAS = 500_000;
    uint256 internal constant TOGGLE_CALL_GAS = 200_000;

    function run() external returns (uint256 storedWord, uint256 consumerWord) {
        require(block.chainid == ROBINHOOD_TESTNET_CHAIN_ID, "R8: wrong chain");

        uint256 privateKey = vm.envUint("R8_PRIVATE_KEY");
        address adapterAddress = vm.envAddress("R8_ADAPTER");
        address consumerAddress = vm.envAddress("R8_CONSUMER");
        uint256 localRequestId = vm.envUint("R8_LOCAL_REQUEST_ID");
        require(privateKey != 0 && adapterAddress.code.length != 0 && consumerAddress.code.length != 0, "R8: bad env");
        require(localRequestId != 0, "R8: zero request");

        RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter =
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness(adapterAddress);
        RelicR8LiveConsumerV2 consumer = RelicR8LiveConsumerV2(consumerAddress);

        require(adapter.wordReadyForLocalRequest(localRequestId), "R8: word not ready");
        require(!adapter.deliveredForLocalRequest(localRequestId), "R8: unexpected prior delivery");
        storedWord = adapter.storedWordForLocalRequest(localRequestId);
        require(consumer.revertDelivery(), "R8: consumer must start reverting");

        vm.startBroadcast(privateKey);
        bool firstDelivered = adapter.replayFulfillment{gas: REPLAY_CALL_GAS}(localRequestId);
        require(!firstDelivered, "R8: first delivery should be intentionally rejected");
        require(adapter.storedWordForLocalRequest(localRequestId) == storedWord, "R8: word changed after failed replay");
        consumer.setRevertDelivery{gas: TOGGLE_CALL_GAS}(false);
        bool secondDelivered = adapter.replayFulfillment{gas: REPLAY_CALL_GAS}(localRequestId);
        require(secondDelivered, "R8: second delivery failed");
        vm.stopBroadcast();

        consumerWord = consumer.lastWord();
        require(consumerWord == storedWord, "R8: downstream word mismatch");
        require(consumer.deliveryCount() == 1, "R8: wrong delivery count");
        require(adapter.deliveredForLocalRequest(localRequestId), "R8: adapter not delivered");
    }
}
