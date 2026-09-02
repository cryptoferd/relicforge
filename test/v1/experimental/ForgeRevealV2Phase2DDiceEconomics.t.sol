// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicForgeReserveV2Harness.sol";
import "../../../contracts/production/experimental/RelicForgeBatchQueueV2Harness.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10Mock.sol";
import "../../../contracts/production/experimental/RelicDiceEntropyV10ThinAdapterV2Harness.sol";

contract RelicDiceEconomicsRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    mapping(address => bool) public canonical;

    function setCanonical(address who) external {
        canonical[who] = true;
    }

    function isCanonicalCollection(address who) external view returns (bool) {
        return canonical[who];
    }
}

contract RelicDiceEconomicsContributionSourceMockV2 is IRelicDiceContributionSourceV2 {
    uint256 public nonce;

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32)
    {
        ++nonce;
        return keccak256(abi.encode("RF_R6_DICE_ECON", consumer, context, localRequestId, nonce));
    }
}

contract ForgeRevealV2Phase2DDiceEconomicsTest is TestBase {
    event GasMeasured(bytes32 indexed label, uint256 gasUsed);
    event CostMeasured(bytes32 indexed label, uint256 costWei);

    address internal constant DICE_PROVIDER = address(0xD1CE);
    address internal constant CREATOR = address(0xC0FFEE);
    address internal constant TREASURY = address(0x7EA5);
    uint128 internal constant DICE_FEE = 0.000025 ether;

    function testDiceV10FeeIsExactFlatNativePayment() public {
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 200_000, 6);
        uint256 at100k = dice.getFeeV2(DICE_PROVIDER, 100_000);
        uint256 at300k = dice.getFeeV2(DICE_PROVIDER, 300_000);
        uint256 at500k = dice.getFeeV2(DICE_PROVIDER, 500_000);
        emit CostMeasured(bytes32("DICE_100K"), at100k);
        emit CostMeasured(bytes32("DICE_300K"), at300k);
        emit CostMeasured(bytes32("DICE_500K"), at500k);
        assertEq(at100k, DICE_FEE, "Dice v10 uses one flat protocol fee");
        assertEq(at300k, DICE_FEE, "thin callback gas does not alter provider fee");
        assertEq(at500k, DICE_FEE, "fee remains exact and predictable");
    }

    function testCollectionHopperAndReservePayExactDiceQuote() public {
        vm.deal(address(this), 10 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, DICE_FEE, 200_000, 6);
        RelicDiceEconomicsRegistryMockV2 registry = new RelicDiceEconomicsRegistryMockV2();
        RelicDiceEconomicsContributionSourceMockV2 source = new RelicDiceEconomicsContributionSourceMockV2();
        RelicDiceEntropyV10ThinAdapterV2Harness adapter = new RelicDiceEntropyV10ThinAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(source)
        );
        RelicForgeReserveV2Harness reserve = new RelicForgeReserveV2Harness{value: 1 ether}(
            address(this), payable(TREASURY), 0.05 ether, 0.001 ether, 20_000, 0.05 ether, 10 ether
        );
        uint256 hopperPerToken = 1 wei;
        RelicForgeBatchQueueV2Harness collection = new RelicForgeBatchQueueV2Harness(
            CREATOR, address(adapter), address(reserve), 2, 100, 3, 0, 0, hopperPerToken, 0, 0.01 ether
        );
        registry.setCanonical(address(collection));
        reserve.registerCollection(address(collection));

        for (uint256 i; i < 20; ++i) {
            address buyer = address(uint160(0xB100 + i));
            vm.deal(buyer, hopperPerToken);
            vm.prank(buyer);
            collection.requestForgeMint{value: hopperPerToken}(buyer, 1);
        }

        uint256 quote = adapter.quoteRequestPrice(collection.callbackGasForQuantity(20));
        assertEq(quote, DICE_FEE, "live thin Dice quote is exact flat fee");
        assertEq(collection.hopperBalance(), 20 wei, "batch accumulated minter-supported hopper funding");
        collection.requestRandomnessForBatch(1);
        assertEq(collection.totalRandomnessSpend(), quote, "collection books exact Dice request cost");
        assertEq(collection.totalReserveSubsidy(), quote - 20 wei, "reserve covers exact hopper shortfall only");
        assertEq(collection.hopperBalance(), 0, "hopper pays first");
        assertEq(dice.totalFeesCollected(), quote, "Dice receives exact native request payment");
    }

    function testGasDiceThinRequestWordAndSettlement20() public {
        vm.deal(address(this), 10 ether);
        RelicDiceEntropyV10Mock dice = new RelicDiceEntropyV10Mock(DICE_PROVIDER, 0, 200_000, 6);
        RelicDiceEconomicsRegistryMockV2 registry = new RelicDiceEconomicsRegistryMockV2();
        RelicDiceEconomicsContributionSourceMockV2 source = new RelicDiceEconomicsContributionSourceMockV2();
        RelicDiceEntropyV10ThinAdapterV2Harness adapter = new RelicDiceEntropyV10ThinAdapterV2Harness(
            address(dice), address(registry), DICE_PROVIDER, address(source)
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
            address buyer = address(uint160(0xB200 + i));
            vm.prank(buyer);
            collection.requestForgeMint(buyer, 1);
        }

        uint256 beforeRequest = gasleft();
        collection.requestRandomnessForBatch(1);
        uint256 requestGas = beforeRequest - gasleft();
        emit GasMeasured(bytes32("DICE_REQ_20"), requestGas);
        assertTrue(requestGas < 900_000, "Dice thin request dispatch budget");

        bytes32 contribution = adapter.userContributionByLocalRequestId(1);
        bytes32 providerReveal = keccak256("R6_DICE_GAS_PROVIDER_REVEAL");
        uint256 beforeWord = gasleft();
        bool callbackSucceeded = dice.revealWithCallback(DICE_PROVIDER, 1, contribution, providerReveal);
        uint256 wordGas = beforeWord - gasleft();
        emit GasMeasured(bytes32("DICE_WORD_20"), wordGas);
        assertTrue(callbackSucceeded, "Dice callback succeeds");
        assertEq(collection.totalMinted(), 0, "provider callback performs no NFT settlement");
        assertTrue(wordGas < 900_000, "thin provider callback budget");

        uint256 beforeSettle = gasleft();
        uint32 settled = collection.settleReady(20);
        uint256 settleGas = beforeSettle - gasleft();
        emit GasMeasured(bytes32("DICE_SETTLE_20"), settleGas);
        assertEq(settled, 20, "ordinary transaction settles twenty NFTs");
        assertTrue(settleGas < 2_800_000, "ordinary settlement remains bounded");
    }
}
