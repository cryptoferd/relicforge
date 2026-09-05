// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";

contract ForgeRevealV2R11R4ERC7572CompatibilityTest is TestBase {
    bytes4 internal constant ERC165 = 0x01ffc9a7;
    bytes4 internal constant ERC721 = 0x80ac58cd;
    bytes4 internal constant ERC721_METADATA = 0x5b5e139f;
    bytes4 internal constant ERC2981 = 0x2a55205a;
    bytes4 internal constant ERC4906 = 0x49064906;
    bytes4 internal constant ERC173 = 0x7f5828d0;
    bytes4 internal constant ERC7572 = 0xe8a3d485;
    bytes4 internal constant ERC721_ENUMERABLE = 0x780e9d63;

    function _clone(address implementation) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(implementation),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly ("memory-safe") {
            instance := create(0, add(code, 0x20), mload(code))
        }
        require(instance != address(0), "clone failed");
    }

    function _expected(bytes4 interfaceId) internal pure returns (bool) {
        return interfaceId == ERC165 || interfaceId == ERC721 || interfaceId == ERC721_METADATA
            || interfaceId == ERC2981 || interfaceId == ERC4906 || interfaceId == ERC173 || interfaceId == ERC7572;
    }

    function testR3ImplementationAndEIP1167CloneAdvertiseExactCertifiedInterfaces() public {
        RelicCollectionV2 implementation = new RelicCollectionV2();
        RelicCollectionV2 clone = RelicCollectionV2(payable(_clone(address(implementation))));

        bytes4[7] memory supported;
        supported[0] = ERC165;
        supported[1] = ERC721;
        supported[2] = ERC721_METADATA;
        supported[3] = ERC2981;
        supported[4] = ERC4906;
        supported[5] = ERC173;
        supported[6] = ERC7572;

        for (uint256 i; i < supported.length; ++i) {
            assertTrue(implementation.supportsInterface(supported[i]), "implementation missing supported interface");
            assertTrue(clone.supportsInterface(supported[i]), "EIP1167 clone missing supported interface");
        }

        assertFalse(implementation.supportsInterface(ERC721_ENUMERABLE), "must not claim ERC721Enumerable");
        assertFalse(clone.supportsInterface(ERC721_ENUMERABLE), "clone must not claim ERC721Enumerable");
        assertFalse(implementation.supportsInterface(0xffffffff), "must reject ERC165 invalid interface");
        assertFalse(clone.supportsInterface(0xffffffff), "clone must reject ERC165 invalid interface");
    }

    function testR3ExactFriendReportedERC7572QueryNowReturnsTrueThroughClone() public {
        RelicCollectionV2 implementation = new RelicCollectionV2();
        RelicCollectionV2 clone = RelicCollectionV2(payable(_clone(address(implementation))));

        assertTrue(clone.supportsInterface(0xe8a3d485), "ERC7572 contractURI interface must report true");
    }

    function testFuzzR3NoFalsePositiveOrFalseNegativeInterfaceClaims(bytes4 interfaceId) public {
        RelicCollectionV2 implementation = new RelicCollectionV2();
        RelicCollectionV2 clone = RelicCollectionV2(payable(_clone(address(implementation))));

        bool expected = _expected(interfaceId);
        assertTrue(implementation.supportsInterface(interfaceId) == expected, "implementation interface mismatch");
        assertTrue(clone.supportsInterface(interfaceId) == expected, "clone interface mismatch");
    }
}
