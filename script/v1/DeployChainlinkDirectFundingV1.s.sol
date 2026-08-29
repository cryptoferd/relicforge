// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

interface VmDeployChainlinkDirectV1 {
    function envUint(string calldata name) external returns (uint256);
    function envAddress(string calldata name) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployRelicForgeChainlinkDirectFundingV1 {
    VmDeployChainlinkDirectV1 internal constant vm =
        VmDeployChainlinkDirectV1(address(uint160(uint256(keccak256("hevm cheat code")))));

    event ChainlinkDirectFundingV1Infrastructure(
        address collectionImplementation,
        address dataImplementation,
        address renderer,
        address randomnessAdapter,
        address factory,
        address vrfWrapper,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint256 maxRequestPriceWei
    );

    function run()
        external
        returns (RelicForgeFactoryV1 factory, RelicChainlinkVRFV25DirectFundingAdapterV1 adapter)
    {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address vrfWrapper = vm.envAddress("RF_VRF_V25_WRAPPER");
        uint256 callbackGasRaw = vm.envUint("RF_VRF_CALLBACK_GAS_LIMIT");
        uint256 confirmationsRaw = vm.envUint("RF_VRF_REQUEST_CONFIRMATIONS");
        uint256 maxRequestPriceWei = vm.envUint("RF_VRF_MAX_REQUEST_PRICE_WEI");
        require(callbackGasRaw <= type(uint32).max, "callback gas uint32 overflow");
        require(confirmationsRaw <= type(uint16).max, "confirmations uint16 overflow");
        // Bounds checked immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 callbackGasLimit = uint32(callbackGasRaw);
        // Bounds checked immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 requestConfirmations = uint16(confirmationsRaw);

        vm.startBroadcast(deployerKey);

        RelicCollectionV1 collectionImplementation = new RelicCollectionV1();
        RelicProjectDataV1 dataImplementation = new RelicProjectDataV1();
        RelicRendererV1 renderer = new RelicRendererV1();
        adapter = new RelicChainlinkVRFV25DirectFundingAdapterV1(
            vrfWrapper,
            callbackGasLimit,
            requestConfirmations,
            maxRequestPriceWei
        );
        factory = new RelicForgeFactoryV1(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            address(adapter)
        );

        // Irreversible one-time handshake. After this call bootstrapAuthority == address(0).
        adapter.bindFactory(address(factory));

        vm.stopBroadcast();

        emit ChainlinkDirectFundingV1Infrastructure(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            address(adapter),
            address(factory),
            vrfWrapper,
            callbackGasLimit,
            requestConfirmations,
            maxRequestPriceWei
        );
    }
}
