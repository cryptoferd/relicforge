// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicChainlinkVRFV25DirectAdapterV2.sol";

contract R12SepoliaForkRegistry is IRelicCanonicalCollectionRegistryR12 {
    function isCanonicalCollection(address) external pure returns (bool) {
        return true;
    }
}

/// @notice Read-only Ethereum Sepolia Chainlink VRF v2.5 preflight.
/// @dev In ordinary local regression these tests return early. The R12 installer
///      separately runs this file with --fork-url against Ethereum Sepolia.
contract EthereumSepoliaChainlinkForkPreflightR12Test is TestBase {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    address internal constant SEPOLIA_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address internal constant SEPOLIA_VRF_COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    address internal constant SEPOLIA_VRF_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;

    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint256 internal constant REFERENCE_GAS_PRICE = 1 gwei;

    function _onSepoliaFork() internal view returns (bool) {
        return block.chainid == SEPOLIA_CHAIN_ID;
    }

    function testR12SepoliaForkOfficialRuntimeCodePresent() public view {
        if (!_onSepoliaFork()) return;

        assertEq(block.chainid, SEPOLIA_CHAIN_ID, "wrong Ethereum Sepolia chain");
        assertGt(SEPOLIA_VRF_WRAPPER.code.length, 0, "official VRF wrapper runtime missing");
        assertGt(SEPOLIA_VRF_COORDINATOR.code.length, 0, "official VRF coordinator runtime missing");
        assertGt(SEPOLIA_LINK.code.length, 0, "Sepolia LINK runtime missing");
    }

    function testR12SepoliaForkWrapperReportsOfficialLinkToken() public view {
        if (!_onSepoliaFork()) return;

        address liveLink = IRelicChainlinkVRFV25WrapperR12(SEPOLIA_VRF_WRAPPER).link();
        assertEq(liveLink, SEPOLIA_LINK, "wrapper LINK binding changed");
    }

    function testR12SepoliaForkNativeEstimateIsNonzeroAndBounded() public view {
        if (!_onSepoliaFork()) return;

        uint256 estimate = IRelicChainlinkVRFV25WrapperR12(SEPOLIA_VRF_WRAPPER)
            .estimateRequestPriceNative(300_000, 1, REFERENCE_GAS_PRICE);

        assertGt(estimate, 0, "native VRF estimate must be nonzero");
        assertTrue(estimate < 0.02 ether, "1 gwei / 300k callback estimate exceeds R12 safety envelope");
    }

    function testR12SepoliaForkProductionAdapterBindsAndQuotesOfficialWrapper() public {
        if (!_onSepoliaFork()) return;

        R12SepoliaForkRegistry registry = new R12SepoliaForkRegistry();
        RelicChainlinkVRFV25DirectAdapterV2 adapter = new RelicChainlinkVRFV25DirectAdapterV2(
            SEPOLIA_CHAIN_ID, SEPOLIA_VRF_WRAPPER, address(registry), REQUEST_CONFIRMATIONS
        );

        assertTrue(adapter.bindingValidForCurrentChain(), "Sepolia binding must be valid");
        assertTrue(adapter.upstreamCallbackIsStorageOnly(), "upstream callback policy drifted");
        assertFalse(adapter.automaticProviderRefundEnabled(), "replacement/refund path must remain disabled");

        uint256 estimated = adapter.estimateRequestPriceAtGasPrice(REFERENCE_GAS_PRICE);
        uint256 direct = IRelicChainlinkVRFV25WrapperR12(SEPOLIA_VRF_WRAPPER)
            .estimateRequestPriceNative(adapter.UPSTREAM_CALLBACK_GAS(), 1, REFERENCE_GAS_PRICE);
        assertEq(estimated, direct, "adapter estimate must match official wrapper exactly");
    }
}
