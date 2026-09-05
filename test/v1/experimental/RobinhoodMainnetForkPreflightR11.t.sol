// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/experimental/RelicRobinhoodRandomnessBindingV2Candidate.sol";

contract R11ForkRegistryMockV2 is IRelicCanonicalCollectionRegistryV2 {
    function isCanonicalCollection(address) external pure returns (bool) {
        return true;
    }
}

contract R11ForkContributionMockV2 is IRelicDiceContributionSourceV2 {
    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        pure
        returns (bytes32 userRandomNumber)
    {
        return keccak256(abi.encode("R11_FORK_ONLY", consumer, context, localRequestId));
    }
}

/// @notice Read-only Robinhood mainnet fork preflight. In ordinary local regression these tests return early.
///         The R11 installer separately runs this file with --fork-url against Robinhood mainnet, where all
///         assertions execute against the live Dice v10 deployment without sending a transaction.
contract RobinhoodMainnetForkPreflightR11Test is TestBase {
    address internal constant MAINNET_DICE = 0xd8A0680e7699526B57140ED4EAfdCc7219Dc0A0c;
    address internal constant MAINNET_PROVIDER = 0x8741b8a825644D9Ef18Faf2DAB5e9b47B900F2b6;
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    uint128 internal constant EXPECTED_FEE = 25_000_000_000_000;
    uint32 internal constant EXPECTED_DEFAULT_GAS_LIMIT = 200_000;
    uint64 internal constant EXPECTED_REFUND_DELAY = 6;

    function _onRobinhoodMainnetFork() internal view returns (bool) {
        return block.chainid == MAINNET_CHAIN_ID;
    }

    function testR11MainnetForkChainAndOracleRuntimeCodePresent() public view {
        if (!_onRobinhoodMainnetFork()) return;
        assertEq(block.chainid, MAINNET_CHAIN_ID, "wrong Robinhood chain id");
        assertGt(MAINNET_DICE.code.length, 0, "Dice v10 runtime bytecode missing");
    }

    function testR11MainnetForkProviderStateIsLiveAndBounded() public view {
        if (!_onRobinhoodMainnetFork()) return;
        IRelicDiceEntropyV10.ProviderInfo memory info =
            IRelicDiceEntropyV10(MAINNET_DICE).getProviderInfoV2(MAINNET_PROVIDER);
        assertGt(info.sequenceNumber, 0, "provider sequence missing");
        assertGt(info.endSequenceNumber, info.sequenceNumber, "provider chain exhausted");
        assertTrue(info.currentCommitment != bytes32(0), "provider commitment missing");
        assertEq(info.defaultGasLimit, EXPECTED_DEFAULT_GAS_LIMIT, "mainnet default gas snapshot changed");
    }

    function testR11MainnetForkExactFeeAndRefundDelayMatchLiveSnapshot() public view {
        if (!_onRobinhoodMainnetFork()) return;
        uint128 fee = IRelicDiceEntropyV10(MAINNET_DICE).getFeeV2(MAINNET_PROVIDER, 300_000);
        assertEq(fee, EXPECTED_FEE, "mainnet exact Dice fee changed");
        uint64 refundDelay = IRelicDiceEntropyV10(MAINNET_DICE).getRefundDelayBlocks();
        assertEq(refundDelay, EXPECTED_REFUND_DELAY, "mainnet refund delay changed");
    }

    function testR11MainnetForkFrozenAdapterReportsReady() public {
        if (!_onRobinhoodMainnetFork()) return;
        R11ForkRegistryMockV2 registry = new R11ForkRegistryMockV2();
        R11ForkContributionMockV2 source = new R11ForkContributionMockV2();
        RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate adapter = new RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate(
            MAINNET_DICE, address(registry), MAINNET_PROVIDER, address(source)
        );

        assertTrue(adapter.bindingValidForCurrentChain(), "R10 chain binding should accept Robinhood mainnet");
        assertTrue(adapter.providerReady(), "live provider should satisfy frozen readiness checks");
        assertTrue(adapter.upstreamCallbackIsStorageOnly(), "callback policy drifted");
        assertFalse(adapter.automaticProviderRefundEnabled(), "refund policy drifted");
    }

    function testR11MainnetForkFrozenAdapterQuoteMatchesExactLiveFee() public {
        if (!_onRobinhoodMainnetFork()) return;
        R11ForkRegistryMockV2 registry = new R11ForkRegistryMockV2();
        R11ForkContributionMockV2 source = new R11ForkContributionMockV2();
        RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate adapter = new RelicDiceEntropyV10RobinhoodAdapterV2FrozenCandidate(
            MAINNET_DICE, address(registry), MAINNET_PROVIDER, address(source)
        );
        assertEq(adapter.quoteRequestPrice(2_450_000), EXPECTED_FEE, "frozen adapter quote != live exact fee");
    }
}
