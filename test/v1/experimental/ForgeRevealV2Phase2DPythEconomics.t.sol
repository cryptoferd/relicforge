// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicPythEntropyV2Mock.sol";
import "../../../contracts/production/experimental/RelicPythEntropyV2ThinAdapterV2Harness.sol";

contract RelicPythEconomicsRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who) external {
        canonical[who] = true;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicPythEconomicsContributionSourceMockV2 is IRelicPythContributionSourceV2 {
    uint256 public nonce;

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32)
    {
        ++nonce;
        return keccak256(abi.encode("RF_R3_ECON", consumer, context, localRequestId, nonce));
    }
}

contract ForgeRevealV2Phase2DPythEconomicsTest is TestBase {
    event GasMeasured(bytes32 indexed label, uint256 gasUsed);
    event CostMeasured(bytes32 indexed label, uint256 costWei);

    address internal constant PYTH_PROVIDER = address(0x52DEAA1);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);

    function testPythFeeModelUsesLiveProviderFloorAndProportionalGasScaling() public {
        RelicPythEntropyV2Mock entropy = new RelicPythEntropyV2Mock(PYTH_PROVIDER, 0.001 ether, 0.0001 ether, 150_000);
        uint256 atDefault = entropy.getFeeV2(PYTH_PROVIDER, 150_000);
        uint256 atThin = entropy.getFeeV2(PYTH_PROVIDER, 300_000);
        uint256 rounded = entropy.getFeeV2(PYTH_PROVIDER, 291_001);
        emit CostMeasured(bytes32("PYTH_DEFAULT"), atDefault);
        emit CostMeasured(bytes32("PYTH_THIN"), atThin);
        emit CostMeasured(bytes32("PYTH_ROUND"), rounded);
        assertEq(atDefault, 0.0011 ether, "provider fee plus Pyth protocol fee");
        assertEq(atThin, 0.0021 ether, "300k doubles 150k provider component then adds protocol fee");
        assertEq(rounded, 0.0021 ether, "callback gas rounds up to 10k units");
    }

    function testCollectionHopperAndReservePayExactLivePythQuote() public {
        vm.deal(address(this), 10 ether);
        RelicPythEntropyV2Mock entropy = new RelicPythEntropyV2Mock(PYTH_PROVIDER, 0.001 ether, 0.0001 ether, 150_000);
        RelicPythEconomicsRegistryMockV2 registry = new RelicPythEconomicsRegistryMockV2();
        RelicPythEconomicsContributionSourceMockV2 source = new RelicPythEconomicsContributionSourceMockV2();
        RelicPythEntropyV2ThinAdapterV2Harness adapter = new RelicPythEntropyV2ThinAdapterV2Harness(
            address(entropy), address(registry), PYTH_PROVIDER, address(source)
        );
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        uint256 hopperPerToken = 0.00005 ether;
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, hopperPerToken, hopperPerToken / 2, 0.01 ether
        );
        registry.setCanonical(address(collection));
        reserve.registerCollection(address(collection));

        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x8100 + i));
            vm.deal(buyer, hopperPerToken);
            vm.prank(buyer);
            collection.requestForgeMint{value: hopperPerToken}(buyer, 1);
        }

        uint256 quote = adapter.quoteRequestPrice(collection.callbackGasForQuantity(20));
        assertEq(quote, 0.0021 ether, "live thin Pyth quote");
        assertEq(collection.hopperBalance(), 0.001 ether, "batch accumulated collection hopper funding");
        collection.requestRandomnessForBatch(1);
        assertEq(collection.totalRandomnessSpend(), quote, "collection books exact request cost");
        assertEq(collection.totalReserveSubsidy(), 0.0011 ether, "reserve covers exact shortfall only");
        assertEq(collection.hopperBalance(), 0, "hopper pays first");
        assertEq(entropy.totalFeesCollected(), quote, "Pyth receives exact request payment");
    }

    function testGasPythThinRequestWordAndSettlement20() public {
        vm.deal(address(this), 10 ether);
        RelicPythEntropyV2Mock entropy = new RelicPythEntropyV2Mock(PYTH_PROVIDER, 0, 0, 150_000);
        RelicPythEconomicsRegistryMockV2 registry = new RelicPythEconomicsRegistryMockV2();
        RelicPythEconomicsContributionSourceMockV2 source = new RelicPythEconomicsContributionSourceMockV2();
        RelicPythEntropyV2ThinAdapterV2Harness adapter = new RelicPythEntropyV2ThinAdapterV2Harness(
            address(entropy), address(registry), PYTH_PROVIDER, address(source)
        );
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.01 ether, 0, 10_000, 1 ether, 100 ether
        );
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, 0, 0, 0.01 ether
        );
        registry.setCanonical(address(collection));
        reserve.registerCollection(address(collection));
        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0x8200 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 1);
        }

        uint256 beforeRequest = gasleft();
        collection.requestRandomnessForBatch(1);
        uint256 requestGas = beforeRequest - gasleft();
        emit GasMeasured(bytes32("PYTH_REQ_20"), requestGas);
        assertTrue(requestGas < 900_000, "Pyth thin request dispatch budget");

        uint256 beforeWord = gasleft();
        bool callbackSucceeded = entropy.revealWithCallback(1, keccak256("R3_GAS_PROVIDER_REVELATION"));
        uint256 wordGas = beforeWord - gasleft();
        emit GasMeasured(bytes32("PYTH_WORD_20"), wordGas);
        assertTrue(callbackSucceeded, "Pyth callback succeeds");
        assertEq(collection.totalMinted(), 0, "provider callback performs no NFT settlement");
        assertTrue(wordGas < 900_000, "thin provider callback budget");

        uint256 beforeSettle = gasleft();
        uint32 settled = collection.settleReady(20);
        uint256 settleGas = beforeSettle - gasleft();
        emit GasMeasured(bytes32("PYTH_SETTLE_20"), settleGas);
        assertEq(settled, 20, "ordinary transaction settles twenty NFTs");
        assertTrue(settleGas < 2_800_000, "ordinary settlement remains bounded");
    }
}
