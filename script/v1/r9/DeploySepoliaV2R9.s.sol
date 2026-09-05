// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./R9SepoliaV2Base.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicRendererV1.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";

/// @notice One-time R9 Ethereum Sepolia deployment of the V2 infrastructure canary stack.
/// @dev Reads DEPLOYER_PRIVATE_KEY from the process environment. Never writes the key to disk.
contract DeploySepoliaV2R9 is R9SepoliaV2Base {
    function run() external returns (RelicForgeFactoryV2 factory) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(deployer != address(0), "R9: bad deployer");
        require(deployer.balance > RESERVE_SEED_WEI, "R9: deployer needs Sepolia ETH");

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

        require(factory.infrastructureReady(), "R9: factory not ready");
        require(factory.collectionImplementation() == address(collectionImplementation), "R9: collection impl");
        require(factory.dataImplementation() == address(dataImplementation), "R9: data impl");
        require(factory.mintPhasesImplementation() == address(mintPhasesImplementation), "R9: phases impl");
        require(factory.renderer() == address(renderer), "R9: renderer");
        require(factory.randomnessProvider() == address(adapter), "R9: adapter");
        require(factory.canonicalRegistry() == address(registry), "R9: registry");
        require(factory.reserve() == address(reserve), "R9: reserve");
        require(factory.feePolicy() == address(feePolicy), "R9: fee policy");

        require(registry.factory() == address(factory), "R9: registry factory");
        require(registry.bootstrapAuthority() == address(0), "R9: registry bootstrap alive");
        require(reserve.factory() == address(factory), "R9: reserve factory");
        require(reserve.bootstrapAuthority() == address(0), "R9: reserve bootstrap alive");
        require(address(reserve).balance == RESERVE_SEED_WEI, "R9: reserve seed mismatch");

        require(adapter.targetChainId() == ETHEREUM_SEPOLIA_CHAIN_ID, "R9: adapter chain");
        require(address(adapter.chainlinkWrapper()) == SEPOLIA_VRF_WRAPPER, "R9: wrapper");
        require(address(adapter.canonicalCollectionRegistry()) == address(registry), "R9: adapter registry");
        require(adapter.requestConfirmations() == REQUEST_CONFIRMATIONS, "R9: confirmations");
        require(adapter.upstreamCallbackIsStorageOnly(), "R9: callback policy");

        uint256 initialVrfQuote = adapter.quoteRequestPrice(400_000);
        require(initialVrfQuote != 0 && initialVrfQuote <= COLLECTION_MAX_RANDOMNESS_COST_WEI, "R9: VRF quote");

        (uint32 minterCents,, bool oracleHealthy, bool feeActive) =
            factory.quoteCollectionFeeTerms(CANARY_SUPPLY, factory.FEE_MODE_MINTER_SUPPORTED());
        require(minterCents == feePolicy.minterFeeCents(), "R9: fee cents");
        require(oracleHealthy && feeActive, "R9: fee oracle");

        vm.createDir(_manifestDir(), true);
        string memory key = "r9-sepolia-infrastructure";

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
