// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./SepoliaRC33Base.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

contract DeploySepoliaRC33V1 is SepoliaRC33Base {
    function run()
        external
        returns (
            RelicForgeFactoryV1 factory,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter
        )
    {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(deployer != address(0), "RC33: bad deployer");

        vm.startBroadcast(deployerKey);

        RelicCollectionV1 collectionImplementation = new RelicCollectionV1();
        RelicProjectDataV1 dataImplementation = new RelicProjectDataV1();
        RelicRendererV1 renderer = new RelicRendererV1();

        adapter = new RelicChainlinkVRFV25DirectFundingAdapterV1(
            SEPOLIA_VRF_WRAPPER,
            CALLBACK_GAS_LIMIT,
            REQUEST_CONFIRMATIONS,
            MAX_REQUEST_PRICE_WEI
        );

        factory = new RelicForgeFactoryV1(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            address(adapter)
        );

        adapter.bindFactory(address(factory));

        vm.stopBroadcast();

        require(adapter.factory() == address(factory), "RC33: adapter factory mismatch");
        require(adapter.bootstrapAuthority() == address(0), "RC33: bootstrap not burned");
        require(factory.randomnessProvider() == address(adapter), "RC33: provider mismatch");
        require(adapter.wrapper() == SEPOLIA_VRF_WRAPPER, "RC33: wrapper mismatch");
        require(adapter.callbackGasLimit() == CALLBACK_GAS_LIMIT, "RC33: callback gas mismatch");
        require(adapter.requestConfirmations() == REQUEST_CONFIRMATIONS, "RC33: confirmations mismatch");
        require(adapter.maxRequestPriceWei() == MAX_REQUEST_PRICE_WEI, "RC33: max price mismatch");

        uint256 quote = adapter.quoteRequestPrice();
        require(quote != 0, "RC33: zero Chainlink quote");
        require(quote <= MAX_REQUEST_PRICE_WEI, "RC33: live quote exceeds max price");

        vm.createDir(_manifestDir(), true);
        string memory objectKey = "rc33-deployment";

        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "deployer", deployer);
        vm.serializeAddress(objectKey, "collectionImplementation", address(collectionImplementation));
        vm.serializeAddress(objectKey, "dataImplementation", address(dataImplementation));
        vm.serializeAddress(objectKey, "renderer", address(renderer));
        vm.serializeAddress(objectKey, "adapter", address(adapter));
        vm.serializeAddress(objectKey, "factory", address(factory));
        vm.serializeAddress(objectKey, "chainlinkWrapper", SEPOLIA_VRF_WRAPPER);
        vm.serializeAddress(objectKey, "chainlinkCoordinator", SEPOLIA_VRF_COORDINATOR);
        vm.serializeAddress(objectKey, "linkToken", SEPOLIA_LINK);
        vm.serializeBytes32(objectKey, "keyHash", SEPOLIA_KEY_HASH);
        vm.serializeUint(objectKey, "callbackGasLimit", CALLBACK_GAS_LIMIT);
        vm.serializeUint(objectKey, "requestConfirmations", REQUEST_CONFIRMATIONS);
        vm.serializeUint(objectKey, "maxRequestPriceWei", MAX_REQUEST_PRICE_WEI);
        string memory json = vm.serializeUint(objectKey, "initialQuoteWei", quote);

        vm.writeJson(json, _deploymentPath());
    }
}
