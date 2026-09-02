// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../../contracts/production/experimental/RelicDiceEntropyV10StorageOnlyLiveHarnessV2.sol";

interface VmR8DiceLive {
    function envUint(string calldata name) external returns (uint256);
    function envBytes32(string calldata name) external returns (bytes32);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IRelicDiceEntropyV10R8Live is IRelicDiceEntropyV10 {
    function getDefaultProvider() external view returns (address provider);
}

/// @title RobinhoodDiceV10StorageOnlyLiveRequest
/// @notice Deploys the R8 production-shaped storage-only Dice path and creates exactly one live testnet request.
contract RobinhoodDiceV10StorageOnlyLiveRequest {
    VmR8DiceLive internal constant vm = VmR8DiceLive(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
    address internal constant DICE_TESTNET = 0xE4F1cc334a3d5FFf8b588573921CA9e2FFE22E5c;
    address internal constant DICE_PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;
    uint32 internal constant CONSUMER_ENVELOPE = 2_450_000;
    uint32 internal constant DICE_CALLBACK_GAS = 300_000;
    uint32 internal constant MAX_ACCEPTABLE_PROVIDER_DEFAULT_GAS = 500_000;
    uint256 internal constant MAX_LIVE_TEST_FEE_WEI = 0.001 ether;

    function run()
        external
        returns (
            RelicR8LiveRegistryV2 registry,
            RelicR8FixedContributionSourceV2 source,
            RelicDiceEntropyV10StorageOnlyAdapterV2Harness adapter,
            RelicR8LiveConsumerV2 consumer,
            uint256 localRequestId,
            uint256 requestFeeWei
        )
    {
        require(block.chainid == ROBINHOOD_TESTNET_CHAIN_ID, "R8: wrong chain");
        require(DICE_TESTNET.code.length != 0, "R8: Dice code missing");

        IRelicDiceEntropyV10R8Live dice = IRelicDiceEntropyV10R8Live(DICE_TESTNET);
        require(dice.getDefaultProvider() == DICE_PROVIDER, "R8: provider drift");
        IRelicDiceEntropyV10.ProviderInfo memory info = dice.getProviderInfoV2(DICE_PROVIDER);
        require(info.sequenceNumber != 0, "R8: provider unregistered");
        require(info.sequenceNumber < info.endSequenceNumber, "R8: provider exhausted");
        require(info.currentCommitment != bytes32(0), "R8: provider commitment missing");
        if (info.defaultGasLimit != 0) {
            require(info.defaultGasLimit <= MAX_ACCEPTABLE_PROVIDER_DEFAULT_GAS, "R8: provider gas drift");
        }

        requestFeeWei = uint256(dice.getFeeV2(DICE_PROVIDER, DICE_CALLBACK_GAS));
        require(requestFeeWei != 0 && requestFeeWei <= MAX_LIVE_TEST_FEE_WEI, "R8: bad live fee");

        uint256 deployerPrivateKey = vm.envUint("R8_PRIVATE_KEY");
        bytes32 userRandomNumber = vm.envBytes32("R8_USER_RANDOM");
        require(deployerPrivateKey != 0, "R8: zero private key");
        require(userRandomNumber != bytes32(0), "R8: zero contribution");

        address admin = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);
        registry = new RelicR8LiveRegistryV2(admin);
        source = new RelicR8FixedContributionSourceV2(userRandomNumber);
        adapter = new RelicDiceEntropyV10StorageOnlyAdapterV2Harness(
            DICE_TESTNET, address(registry), DICE_PROVIDER, address(source)
        );
        consumer = new RelicR8LiveConsumerV2(admin, address(adapter));
        registry.setCanonical(address(consumer), true);
        requestFeeWei = adapter.quoteRequestPrice(CONSUMER_ENVELOPE);
        localRequestId = consumer.request{value: requestFeeWei}(1, CONSUMER_ENVELOPE);
        vm.stopBroadcast();
    }
}
