// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../../contracts/production/experimental/RelicDiceEntropyV10LiveProbeV2.sol";

interface VmR7DiceLive {
    function envUint(string calldata name) external returns (uint256);
    function envBytes32(string calldata name) external returns (bytes32);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IRelicDiceEntropyV10R7Live is IRelicDiceEntropyV10 {
    function getDefaultProvider() external view returns (address provider);
}

/// @title RobinhoodDiceV10LiveRequest
/// @notice Phase 2D R7 one-shot Robinhood Chain testnet Dice v10 live certification request.
/// @dev Requires R7_PRIVATE_KEY and R7_USER_RANDOM in the environment. Never use a production wallet key.
contract RobinhoodDiceV10LiveRequest {
    VmR7DiceLive internal constant vm = VmR7DiceLive(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    address internal constant DICE_TESTNET = 0xE4F1cc334a3d5FFf8b588573921CA9e2FFE22E5c;
    address internal constant DICE_PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;
    uint32 internal constant CALLBACK_GAS = 300_000;
    uint32 internal constant MAX_ACCEPTABLE_PROVIDER_DEFAULT_GAS = 500_000;
    uint256 internal constant MAX_LIVE_TEST_FEE_WEI = 0.001 ether;

    function run()
        external
        returns (RelicDiceEntropyV10LiveProbeV2 probe, uint64 sequenceNumber, uint256 requestFeeWei)
    {
        require(block.chainid == ROBINHOOD_TESTNET_CHAIN_ID, "R7: wrong chain");
        require(DICE_TESTNET.code.length != 0, "R7: Dice testnet code missing");

        IRelicDiceEntropyV10R7Live dice = IRelicDiceEntropyV10R7Live(DICE_TESTNET);
        require(dice.getDefaultProvider() == DICE_PROVIDER, "R7: default provider drift");

        IRelicDiceEntropyV10.ProviderInfo memory info = dice.getProviderInfoV2(DICE_PROVIDER);
        require(info.sequenceNumber != 0, "R7: provider unregistered");
        require(info.sequenceNumber < info.endSequenceNumber, "R7: provider exhausted");
        require(info.currentCommitment != bytes32(0), "R7: provider commitment missing");
        // A zero provider default selects Dice's remaining-gas callback branch in the reviewed
        // v10 source. R7-v5 permits that mode ONLY for this fixed one-shot liveness probe.
        // The Relic production-advancement adapter remains fail-closed on zero default gas.
        if (info.defaultGasLimit != 0) {
            require(info.defaultGasLimit <= MAX_ACCEPTABLE_PROVIDER_DEFAULT_GAS, "R7: provider gas drift");
        }

        requestFeeWei = uint256(dice.getFeeV2(DICE_PROVIDER, CALLBACK_GAS));
        require(requestFeeWei != 0, "R7: zero Dice fee");
        require(requestFeeWei <= MAX_LIVE_TEST_FEE_WEI, "R7: live fee above test cap");

        uint256 deployerPrivateKey = vm.envUint("R7_PRIVATE_KEY");
        bytes32 userRandomNumber = vm.envBytes32("R7_USER_RANDOM");
        require(deployerPrivateKey != 0, "R7: zero private key");
        require(userRandomNumber != bytes32(0), "R7: zero user contribution");

        vm.startBroadcast(deployerPrivateKey);
        probe = new RelicDiceEntropyV10LiveProbeV2(DICE_TESTNET, DICE_PROVIDER);
        sequenceNumber = probe.request{value: requestFeeWei}(userRandomNumber, CALLBACK_GAS);
        vm.stopBroadcast();
    }
}
