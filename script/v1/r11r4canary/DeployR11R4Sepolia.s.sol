// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R11R4SepoliaBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicRendererV1.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";

contract DeployR11R4Sepolia is R11R4SepoliaBase {
    function run() external returns (RelicForgeFactoryV2 factory) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(deployer != address(0), "R11R4C: bad deployer");
        require(deployer.balance > RESERVE_SEED_WEI, "R11R4C: needs Sepolia ETH");

        vm.startBroadcast(deployerKey);

        RelicCollectionV2 collectionImplementation = new RelicCollectionV2();
        RelicProjectDataV1 dataImplementation = new RelicProjectDataV1();
        RelicMintPhasesV2 mintPhasesImplementation = new RelicMintPhasesV2();
        RelicRendererV1 renderer = new RelicRendererV1();
        RelicForgeCanonicalRegistryV2 registry = new RelicForgeCanonicalRegistryV2();

        RelicForgeReserveV2 reserve = new RelicForgeReserveV2{value: RESERVE_SEED_WEI}(
            deployer,
            payable(deployer),
            RESERVE_MINIMUM_WEI,
            RESERVE_ACTIVE_BATCH_BUFFER_WEI,
            RESERVE_EXPOSURE_SAFETY_BPS,
            RESERVE_MAX_SUBSIDY_PER_REQUEST_WEI,
            RESERVE_MAX_SUBSIDY_PER_COLLECTION_WEI
        );

        RelicChainlinkVRFV25DirectAdapterV2 adapter = new RelicChainlinkVRFV25DirectAdapterV2(
            ETHEREUM_SEPOLIA_CHAIN_ID, SEPOLIA_VRF_WRAPPER, address(registry), REQUEST_CONFIRMATIONS
        );

        RelicForgeFeePolicyV1 feePolicy =
            new RelicForgeFeePolicyV1(deployer, deployer, SEPOLIA_ETH_USD_FEED, FEE_ORACLE_MAX_AGE);

        factory = new RelicForgeFactoryV2(
            address(collectionImplementation),
            address(dataImplementation),
            address(mintPhasesImplementation),
            address(renderer),
            address(adapter),
            address(registry),
            address(reserve),
            address(feePolicy)
        );

        registry.bindFactory(address(factory));
        reserve.bindFactory(address(factory));

        vm.stopBroadcast();

        require(factory.infrastructureReady(), "R11R4C: factory not ready");
        require(factory.collectionImplementation() == address(collectionImplementation), "R11R4C: collection impl");
        require(factory.mintPhasesImplementation() == address(mintPhasesImplementation), "R11R4C: phases impl");
        require(adapter.upstreamCallbackIsStorageOnly(), "R11R4C: callback policy");

        require(collectionImplementation.supportsInterface(0x01ffc9a7), "R11R4C: impl ERC165");
        require(collectionImplementation.supportsInterface(0x80ac58cd), "R11R4C: impl ERC721");
        require(collectionImplementation.supportsInterface(0x5b5e139f), "R11R4C: impl metadata");
        require(collectionImplementation.supportsInterface(0x2a55205a), "R11R4C: impl ERC2981");
        require(collectionImplementation.supportsInterface(0x49064906), "R11R4C: impl ERC4906");
        require(collectionImplementation.supportsInterface(0x7f5828d0), "R11R4C: impl ERC173");
        require(collectionImplementation.supportsInterface(0xe8a3d485), "R11R4C: impl ERC7572");
        require(!collectionImplementation.supportsInterface(0x780e9d63), "R11R4C: impl enumerable");

        require(feePolicy.pendingTreasury() == address(0), "R11R4C: pending fee treasury");
        require(feePolicy.pendingPlatformAdmin() == address(0), "R11R4C: pending fee admin");
        require(reserve.pendingRevenueTreasury() == address(0), "R11R4C: pending reserve treasury");
        require(reserve.pendingFounder() == address(0), "R11R4C: pending reserve founder");

        uint256 initialVrfQuote = adapter.quoteRequestPrice(400_000);
        require(initialVrfQuote != 0 && initialVrfQuote <= COLLECTION_MAX_RANDOMNESS_COST_WEI, "R11R4C: VRF quote");

        vm.createDir(_manifestDir(), true);
        string memory key = "r11-r4-sepolia-infrastructure";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "platformAdmin", deployer);
        vm.serializeAddress(key, "feeTreasury", deployer);
        vm.serializeAddress(key, "reserveFounder", deployer);
        vm.serializeAddress(key, "reserveRevenueTreasury", deployer);
        vm.serializeAddress(key, "collectionImplementation", address(collectionImplementation));
        vm.serializeAddress(key, "dataImplementation", address(dataImplementation));
        vm.serializeAddress(key, "mintPhasesImplementation", address(mintPhasesImplementation));
        vm.serializeAddress(key, "renderer", address(renderer));
        vm.serializeAddress(key, "canonicalRegistry", address(registry));
        vm.serializeAddress(key, "reserve", address(reserve));
        vm.serializeAddress(key, "randomnessAdapter", address(adapter));
        vm.serializeAddress(key, "feePolicy", address(feePolicy));
        vm.serializeAddress(key, "factory", address(factory));
        vm.serializeAddress(key, "chainlinkVrfWrapper", SEPOLIA_VRF_WRAPPER);
        vm.serializeAddress(key, "chainlinkVrfCoordinator", SEPOLIA_VRF_COORDINATOR);
        vm.serializeAddress(key, "linkToken", SEPOLIA_LINK);
        vm.serializeAddress(key, "ethUsdPriceFeed", SEPOLIA_ETH_USD_FEED);
        vm.serializeUint(key, "requestConfirmations", REQUEST_CONFIRMATIONS);
        vm.serializeUint(key, "feeOracleMaxAgeSeconds", FEE_ORACLE_MAX_AGE);
        vm.serializeUint(key, "reserveSeedWei", RESERVE_SEED_WEI);
        vm.serializeUint(key, "reserveMinimumWei", RESERVE_MINIMUM_WEI);
        vm.serializeUint(key, "reserveActiveBatchBufferWei", RESERVE_ACTIVE_BATCH_BUFFER_WEI);
        vm.serializeUint(key, "reserveExposureSafetyBps", RESERVE_EXPOSURE_SAFETY_BPS);
        vm.serializeUint(key, "reserveMaxSubsidyPerRequestWei", RESERVE_MAX_SUBSIDY_PER_REQUEST_WEI);
        vm.serializeUint(key, "reserveMaxSubsidyPerCollectionWei", RESERVE_MAX_SUBSIDY_PER_COLLECTION_WEI);
        vm.serializeUint(key, "collectionMaxRandomnessCostWei", COLLECTION_MAX_RANDOMNESS_COST_WEI);
        string memory json = vm.serializeUint(key, "initialVrfQuoteWei", initialVrfQuote);
        vm.writeJson(json, _deploymentPath());
    }
}
