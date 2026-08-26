// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function deal(address, uint256) external;
    function warp(uint256) external;
    function chainId(uint256) external;
    function assume(bool) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function targetContract(address) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value, string memory message) internal pure {
        require(value, message);
    }

    function assertFalse(bool value, string memory message) internal pure {
        require(!value, message);
    }

    function assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(address a, address b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(bytes32 a, bytes32 b, string memory message) internal pure {
        require(a == b, message);
    }

    function assertEq(string memory a, string memory b, string memory message) internal pure {
        require(keccak256(bytes(a)) == keccak256(bytes(b)), message);
    }

    function assertNotEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a != b, message);
    }

    function assertGt(uint256 a, uint256 b, string memory message) internal pure {
        require(a > b, message);
    }

    function _bound(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        require(min <= max, "bad bound");
        if (min == max) return min;
        return min + (value % (max - min + 1));
    }
}
