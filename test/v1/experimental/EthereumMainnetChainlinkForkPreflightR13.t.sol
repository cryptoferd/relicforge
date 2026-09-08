// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicRendererV1.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicForgeFactoryV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";
import "../../../contracts/production/v2/RelicForgeCanonicalRegistryV2.sol";
import "../../../contracts/production/v2/RelicForgeReserveV2.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

interface IR13MainnetFeed {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Read-only Ethereum mainnet fork gate for Relic Forge R12-v2 production infrastructure.
/// @dev No mainnet transaction is sent. All deployments in the full-stack dry-run exist only
///      inside Foundry's forked local EVM.
contract EthereumMainnetChainlinkForkPreflightR13Test is TestBase {
    uint256 internal constant MAINNET_CHAIN_ID = 1;
    address internal constant MAINNET_LINK = 0x514910771AF9Ca656af840dff83E8264EcF986CA;
    address internal constant MAINNET_VRF_COORDINATOR = 0xD7f86b4b8Cae7D942340FF628F82735b7a20893a;
    address internal constant MAINNET_VRF_WRAPPER = 0x02aae1A04f9828517b3007f83f6181900CaD910c;
    address internal constant MAINNET_ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;

    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint256 internal constant REFERENCE_GAS_PRICE = 20 gwei;
    uint64 internal constant FEE_ORACLE_MAX_AGE = 1 days;
    uint256 internal constant DEFAULT_RANDOMNESS_CEILING = 0.02 ether;

    address internal constant CREATOR = address(0xA11CE);
    address internal constant TREASURY = address(0x7EA5);

    function _onMainnetFork() internal view returns (bool) {
        return block.chainid == MAINNET_CHAIN_ID;
    }

    function testR13MainnetOfficialRuntimeCodePresent() public view {
        if (!_onMainnetFork()) return;
        assertEq(block.chainid, MAINNET_CHAIN_ID, "wrong Ethereum mainnet chain");
        assertGt(MAINNET_VRF_WRAPPER.code.length, 0, "official VRF wrapper runtime missing");
        assertGt(MAINNET_VRF_COORDINATOR.code.length, 0, "official VRF coordinator runtime missing");
        assertGt(MAINNET_LINK.code.length, 0, "mainnet LINK runtime missing");
        assertGt(MAINNET_ETH_USD_FEED.code.length, 0, "ETH/USD feed runtime missing");
    }

    function testR13MainnetWrapperReportsOfficialLinkToken() public view {
        if (!_onMainnetFork()) return;
        address liveLink = IRelicChainlinkVRFV25WrapperR12(MAINNET_VRF_WRAPPER).link();
        assertEq(liveLink, MAINNET_LINK, "wrapper LINK binding changed");
    }

    function testR13MainnetEthUsdFeedIsHealthy() public view {
        if (!_onMainnetFork()) return;
        IR13MainnetFeed feed = IR13MainnetFeed(MAINNET_ETH_USD_FEED);
        assertEq(uint256(feed.decimals()), 8, "ETH/USD decimals changed");
        assertEq(keccak256(bytes(feed.description())), keccak256(bytes("ETH / USD")), "ETH/USD feed identity changed");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        assertTrue(answer > 0, "ETH/USD answer must be positive");
        assertTrue(updatedAt != 0 && updatedAt <= block.timestamp, "ETH/USD timestamp invalid");
        assertTrue(block.timestamp - updatedAt <= FEE_ORACLE_MAX_AGE, "ETH/USD feed stale beyond Relic Forge policy");
        assertTrue(answeredInRound >= roundId, "ETH/USD round incomplete");
    }

    function testR13MainnetNativeVrfEstimateFitsDefaultCeilingAtReferenceGas() public view {
        if (!_onMainnetFork()) return;
        uint256 estimate = IRelicChainlinkVRFV25WrapperR12(MAINNET_VRF_WRAPPER)
            .estimateRequestPriceNative(300_000, 1, REFERENCE_GAS_PRICE);
        assertGt(estimate, 0, "native VRF estimate must be nonzero");
        assertTrue(estimate <= DEFAULT_RANDOMNESS_CEILING, "VRF estimate exceeds default Relic Forge ceiling");
    }

    function testR13MainnetProductionAdapterBindsAndMatchesOfficialWrapperQuote() public {
        if (!_onMainnetFork()) return;
        RelicForgeCanonicalRegistryV2 registry = new RelicForgeCanonicalRegistryV2();
        RelicChainlinkVRFV25DirectAdapterV2 adapter = new RelicChainlinkVRFV25DirectAdapterV2(
            MAINNET_CHAIN_ID, MAINNET_VRF_WRAPPER, address(registry), REQUEST_CONFIRMATIONS
        );
        assertTrue(adapter.bindingValidForCurrentChain(), "mainnet adapter binding must be valid");
        assertTrue(adapter.upstreamCallbackIsStorageOnly(), "upstream callback policy drifted");
        assertFalse(adapter.automaticProviderRefundEnabled(), "automatic replacement/refund path must remain disabled");
        uint256 estimated = adapter.estimateRequestPriceAtGasPrice(REFERENCE_GAS_PRICE);
        uint256 direct = IRelicChainlinkVRFV25WrapperR12(MAINNET_VRF_WRAPPER)
            .estimateRequestPriceNative(adapter.UPSTREAM_CALLBACK_GAS(), 1, REFERENCE_GAS_PRICE);
        assertEq(estimated, direct, "adapter estimate must match official wrapper exactly");
        assertGt(estimated, 0, "adapter estimate must be nonzero");
        assertTrue(estimated <= DEFAULT_RANDOMNESS_CEILING, "adapter estimate exceeds default Relic Forge ceiling");
    }

    function testR13MainnetFullProductionInfrastructureDryRun() public {
        if (!_onMainnetFork()) return;

        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();
        RelicMintPhasesV2 mintPhasesImpl = new RelicMintPhasesV2();
        RelicRendererV1 renderer = new RelicRendererV1();
        RelicForgeFeePolicyV1 feePolicy = new RelicForgeFeePolicyV1(
            address(this), TREASURY, MAINNET_ETH_USD_FEED, FEE_ORACLE_MAX_AGE
        );
        RelicForgeCanonicalRegistryV2 registry = new RelicForgeCanonicalRegistryV2();
        RelicForgeReserveV2 reserve =
            new RelicForgeReserveV2(address(this), payable(TREASURY), 0, 0, 20_000, 0.01 ether, 10 ether);
        RelicChainlinkVRFV25DirectAdapterV2 adapter = new RelicChainlinkVRFV25DirectAdapterV2(
            MAINNET_CHAIN_ID, MAINNET_VRF_WRAPPER, address(registry), REQUEST_CONFIRMATIONS
        );

        RelicForgeFactoryV2 factory = new RelicForgeFactoryV2(
            address(collectionImpl),
            address(dataImpl),
            address(mintPhasesImpl),
            address(renderer),
            address(adapter),
            address(registry),
            address(reserve),
            address(feePolicy)
        );

        registry.bindFactory(address(factory));
        reserve.bindFactory(address(factory));

        assertTrue(factory.infrastructureReady(), "factory infrastructure did not bind");
        assertEq(registry.factory(), address(factory), "registry factory mismatch");
        assertEq(registry.bootstrapAuthority(), address(0), "registry bootstrap authority not burned");
        assertEq(reserve.factory(), address(factory), "reserve factory mismatch");
        assertEq(reserve.bootstrapAuthority(), address(0), "reserve bootstrap authority not burned");

        (uint32 minterCents,, bool minterOracleHealthy, bool minterActive) =
            factory.quoteCollectionFeeTerms(100, factory.FEE_MODE_MINTER_SUPPORTED());
        assertEq(uint256(minterCents), 50, "minter default drifted");
        assertTrue(minterOracleHealthy && minterActive, "minter fee quote not healthy");

        (uint32 sponsoredCents, uint256 sponsoredFeeWei, bool sponsoredOracleHealthy, bool sponsoredActive) =
            factory.quoteCollectionFeeTerms(100, factory.FEE_MODE_SPONSORED());
        assertEq(uint256(sponsoredCents), 25, "sponsored default drifted");
        assertTrue(sponsoredOracleHealthy && sponsoredActive && sponsoredFeeWei > 0, "sponsored fee quote not healthy");

        RelicForgeFactoryV2.LaunchConfig memory launch = RelicForgeFactoryV2.LaunchConfig({
            name: "Relic Forge Mainnet Dry Run",
            symbol: "RFDRY",
            description: "Fork-only infrastructure certification collection.",
            maxSupply: 10,
            canvasWidth: 32,
            canvasHeight: 32,
            layerCount: 2,
            payoutReceiver: CREATOR,
            royaltyReceiver: CREATOR,
            royaltyBps: 500,
            feeMode: factory.FEE_MODE_MINTER_SUPPORTED(),
            initialRevealMode: factory.REVEAL_DEFERRED(),
            batchWindowSeconds: factory.DEFAULT_BATCH_WINDOW_SECONDS(),
            maxRandomnessCostPerBatchWei: factory.DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI()
        });

        vm.prank(CREATOR);
        (address collection, address projectData) = factory.createCollectionV2(launch);
        address phases = factory.mintPhasesForCollection(collection);

        assertTrue(factory.isRelicForgeCollection(collection), "factory did not register dry-run collection");
        assertTrue(registry.isCanonicalCollection(collection), "registry did not register dry-run collection");
        assertTrue(reserve.canonicalCollection(collection), "reserve did not register dry-run collection");
        assertEq(collection.code.length, 45, "collection is not an EIP-1167 clone");
        assertEq(projectData.code.length, 45, "ProjectData is not an EIP-1167 clone");
        assertEq(phases.code.length, 45, "MintPhases is not an EIP-1167 clone");
        assertEq(RelicCollectionV2(payable(collection)).creator(), CREATOR, "creator binding mismatch");
        assertEq(RelicMintPhasesV2(phases).controller(), CREATOR, "MintPhases controller mismatch");
        assertEq(factory.creatorCollectionCount(CREATOR), 1, "creator index did not record dry-run collection");
    }
}
