// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface VmRC43 {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function txGasPrice(uint256 newGasPrice) external;
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function projectRoot() external view returns (string memory path);
    function createDir(string calldata path, bool recursive) external;
    function writeJson(string calldata json, string calldata path) external;
    function serializeAddress(string calldata objectKey, string calldata valueKey, address value) external returns (string memory json);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value) external returns (string memory json);
}

interface IRCSepoliaEthUsdFeedV1 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

abstract contract SepoliaRC43Base {
    VmRC43 internal constant vm = VmRC43(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;
    address internal constant SEPOLIA_VRF_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;
    address internal constant SEPOLIA_VRF_COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    address internal constant SEPOLIA_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    uint32 internal constant CALLBACK_GAS_LIMIT = 500_000;
    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint256 internal constant MAX_REQUEST_PRICE_WEI = 0.01 ether;
    uint64 internal constant FEE_ORACLE_MAX_AGE = 1 days;

    function _assertSepoliaAndDependencies() internal view {
        require(block.chainid == ETHEREUM_SEPOLIA_CHAIN_ID, "RC43: Ethereum Sepolia only");
        require(SEPOLIA_VRF_WRAPPER.code.length != 0, "RC43: Chainlink wrapper missing");
        require(SEPOLIA_VRF_COORDINATOR.code.length != 0, "RC43: Chainlink coordinator missing");
        require(SEPOLIA_LINK.code.length != 0, "RC43: LINK token missing");
        require(SEPOLIA_ETH_USD_FEED.code.length != 0, "RC43: ETH/USD feed missing");

        IRCSepoliaEthUsdFeedV1 feed = IRCSepoliaEthUsdFeedV1(SEPOLIA_ETH_USD_FEED);
        require(feed.decimals() <= 18, "RC43: feed decimals");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "RC43: feed answer");
        require(updatedAt != 0 && updatedAt <= block.timestamp, "RC43: feed timestamp");
        require(block.timestamp - updatedAt <= FEE_ORACLE_MAX_AGE, "RC43: stale ETH/USD feed");
        require(answeredInRound >= roundId, "RC43: incomplete feed round");
    }

    function _manifestDir() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/rc4.3");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-v1.json");
    }
}
