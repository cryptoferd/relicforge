// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface VmRC33 {
    function envUint(string calldata name) external returns (uint256 value);
    function txGasPrice(uint256 newGasPrice) external;
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;

    function projectRoot() external view returns (string memory path);
    function createDir(string calldata path, bool recursive) external;
    function readFile(string calldata path) external view returns (string memory data);
    function writeJson(string calldata json, string calldata path) external;

    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address value);
    function parseJsonUint(string calldata json, string calldata key) external pure returns (uint256 value);

    function serializeAddress(string calldata objectKey, string calldata valueKey, address value)
        external returns (string memory json);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value)
        external returns (string memory json);
    function serializeBytes32(string calldata objectKey, string calldata valueKey, bytes32 value)
        external returns (string memory json);
}

abstract contract SepoliaRC33Base {
    VmRC33 internal constant vm =
        VmRC33(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

    // Chainlink VRF v2.5 Ethereum Sepolia configuration, checked against current official docs for RC3.3.
    address internal constant SEPOLIA_VRF_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;
    address internal constant SEPOLIA_VRF_COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    address internal constant SEPOLIA_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes32 internal constant SEPOLIA_KEY_HASH =
        0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae;

    uint32 internal constant CALLBACK_GAS_LIMIT = 500_000;
    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint256 internal constant MAX_REQUEST_PRICE_WEI = 0.01 ether;

    function _assertSepolia() internal view {
        require(block.chainid == ETHEREUM_SEPOLIA_CHAIN_ID, "RC33: Ethereum Sepolia only");
        require(SEPOLIA_VRF_WRAPPER.code.length != 0, "RC33: Chainlink wrapper missing");
        require(SEPOLIA_VRF_COORDINATOR.code.length != 0, "RC33: Chainlink coordinator missing");
        require(SEPOLIA_LINK.code.length != 0, "RC33: LINK token missing");
    }

    function _manifestDir() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/rc3.3");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-deployment.json");
    }

    function _smokePath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-smoke.json");
    }

    function _finalPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-final.json");
    }

    function _deploymentAddress(string memory key) internal view returns (address) {
        string memory json = vm.readFile(_deploymentPath());
        return vm.parseJsonAddress(json, string.concat(".", key));
    }

    function _smokeAddress(string memory key) internal view returns (address) {
        string memory json = vm.readFile(_smokePath());
        return vm.parseJsonAddress(json, string.concat(".", key));
    }

    function _smokeUint(string memory key) internal view returns (uint256) {
        string memory json = vm.readFile(_smokePath());
        return vm.parseJsonUint(json, string.concat(".", key));
    }
}
