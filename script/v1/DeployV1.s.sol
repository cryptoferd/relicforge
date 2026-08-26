// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";

interface VmDeployV1 {
    function envUint(string calldata name) external returns (uint256);
    function envAddress(string calldata name) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployRelicForgeV1 {
    VmDeployV1 internal constant vm = VmDeployV1(address(uint160(uint256(keccak256("hevm cheat code")))));

    event V1Infrastructure(
        address collectionImplementation,
        address dataImplementation,
        address renderer,
        address randomnessAdapter,
        address factory
    );

    function run() external returns (RelicForgeFactoryV1 factory) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address randomnessAdapter = vm.envAddress("RF_RANDOMNESS_ADAPTER");
        require(randomnessAdapter.code.length != 0, "RF_RANDOMNESS_ADAPTER must be deployed code");

        vm.startBroadcast(deployerKey);
        RelicCollectionV1 collectionImplementation = new RelicCollectionV1();
        RelicProjectDataV1 dataImplementation = new RelicProjectDataV1();
        RelicRendererV1 renderer = new RelicRendererV1();
        factory = new RelicForgeFactoryV1(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            randomnessAdapter
        );
        vm.stopBroadcast();

        emit V1Infrastructure(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            randomnessAdapter,
            address(factory)
        );
    }
}
