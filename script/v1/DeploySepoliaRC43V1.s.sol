// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./SepoliaRC43Base.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicRendererV1.sol";
import "../../contracts/production/RelicForgeFactoryV1.sol";
import "../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

/**
 * @notice One-time founder deployment of the canonical RC4.2 V1 stack on Ethereum Sepolia.
 *         Creators never deploy these infrastructure contracts themselves.
 */
contract DeploySepoliaRC43V1 is SepoliaRC43Base {
    function run()
        external
        returns (
            RelicForgeFactoryV1 factory,
            RelicForgeFeePolicyV1 feePolicy,
            RelicChainlinkVRFV25DirectFundingAdapterV1 adapter
        )
    {
        _assertSepoliaAndDependencies();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address platformAdmin = vm.envAddress("PLATFORM_ADMIN");
        address feeTreasury = vm.envAddress("FEE_TREASURY");
        uint256 simulatedGasPrice = vm.envUint("RC43_SIM_GAS_PRICE_WEI");

        require(deployer != address(0), "RC43: bad deployer");
        require(platformAdmin != address(0), "RC43: bad platform admin");
        require(feeTreasury != address(0), "RC43: bad fee treasury");
        require(simulatedGasPrice != 0, "RC43: zero gas price");

        vm.txGasPrice(simulatedGasPrice);
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

        feePolicy = new RelicForgeFeePolicyV1(
            platformAdmin,
            feeTreasury,
            SEPOLIA_ETH_USD_FEED,
            FEE_ORACLE_MAX_AGE
        );

        factory = new RelicForgeFactoryV1(
            address(collectionImplementation),
            address(dataImplementation),
            address(renderer),
            address(adapter)
        );

        factory.bindFeePolicy(address(feePolicy));
        adapter.bindFactory(address(factory));

        vm.stopBroadcast();

        require(factory.collectionImplementation() == address(collectionImplementation), "RC43: collection impl mismatch");
        require(factory.dataImplementation() == address(dataImplementation), "RC43: data impl mismatch");
        require(factory.renderer() == address(renderer), "RC43: renderer mismatch");
        require(factory.randomnessProvider() == address(adapter), "RC43: randomness mismatch");
        require(factory.feePolicy() == address(feePolicy), "RC43: fee policy mismatch");
        require(factory.feePolicyBootstrapAuthority() == address(0), "RC43: factory bootstrap not burned");

        require(adapter.factory() == address(factory), "RC43: adapter factory mismatch");
        require(adapter.bootstrapAuthority() == address(0), "RC43: adapter bootstrap not burned");
        require(adapter.wrapper() == SEPOLIA_VRF_WRAPPER, "RC43: wrapper mismatch");

        require(feePolicy.platformAdmin() == platformAdmin, "RC43: platform admin mismatch");
        require(feePolicy.treasury() == feeTreasury, "RC43: treasury mismatch");
        require(feePolicy.priceFeed() == SEPOLIA_ETH_USD_FEED, "RC43: price feed mismatch");
        require(feePolicy.sponsoredFeeCents() == 25, "RC43: sponsored default mismatch");
        require(feePolicy.minterFeeCents() == 50, "RC43: minter default mismatch");
        require(feePolicy.MAX_COLLECTION_FEE_CENTS() == 500, "RC43: fee cap mismatch");

        uint256 vrfQuote = adapter.quoteRequestPrice();
        require(vrfQuote != 0 && vrfQuote <= MAX_REQUEST_PRICE_WEI, "RC43: bad VRF quote");

        (uint32 sponsoredCents, uint256 sponsoredFeeWei, bool sponsoredOracleHealthy, bool sponsoredActive) =
            factory.quoteCollectionFeeTerms(100, factory.FEE_MODE_SPONSORED());
        require(sponsoredCents == 25, "RC43: sponsored cents");
        require(sponsoredOracleHealthy && sponsoredActive && sponsoredFeeWei != 0, "RC43: sponsored quote");

        (uint32 minterCents,, bool minterOracleHealthy, bool minterActive) =
            factory.quoteCollectionFeeTerms(100, factory.FEE_MODE_MINTER_SUPPORTED());
        require(minterCents == 50, "RC43: minter cents");
        require(minterOracleHealthy && minterActive, "RC43: minter quote");

        vm.createDir(_manifestDir(), true);
        string memory key = "rc43-sepolia-v1";

        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "platformAdmin", platformAdmin);
        vm.serializeAddress(key, "feeTreasury", feeTreasury);
        vm.serializeAddress(key, "collectionImplementation", address(collectionImplementation));
        vm.serializeAddress(key, "dataImplementation", address(dataImplementation));
        vm.serializeAddress(key, "renderer", address(renderer));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeAddress(key, "feePolicy", address(feePolicy));
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "chainlinkVrfWrapper", SEPOLIA_VRF_WRAPPER);
        vm.serializeAddress(key, "chainlinkVrfCoordinator", SEPOLIA_VRF_COORDINATOR);
        vm.serializeAddress(key, "linkToken", SEPOLIA_LINK);
        vm.serializeAddress(key, "ethUsdPriceFeed", SEPOLIA_ETH_USD_FEED);
        vm.serializeUint(key, "feeOracleMaxAgeSeconds", FEE_ORACLE_MAX_AGE);
        vm.serializeUint(key, "sponsoredFeeCents", sponsoredCents);
        vm.serializeUint(key, "minterFeeCents", minterCents);
        vm.serializeUint(key, "maxCollectionFeeCents", feePolicy.MAX_COLLECTION_FEE_CENTS());
        vm.serializeUint(key, "callbackGasLimit", CALLBACK_GAS_LIMIT);
        vm.serializeUint(key, "requestConfirmations", REQUEST_CONFIRMATIONS);
        vm.serializeUint(key, "maxRequestPriceWei", MAX_REQUEST_PRICE_WEI);
        vm.serializeUint(key, "initialVrfQuoteWei", vrfQuote);
        string memory json = vm.serializeUint(key, "sample100SponsoredFeeWei", sponsoredFeeWei);

        vm.writeJson(json, _deploymentPath());
    }
}
