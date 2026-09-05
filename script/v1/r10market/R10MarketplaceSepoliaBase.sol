// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface VmR10Market {
    function envUint(string calldata name) external returns (uint256 value);
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
        external
        returns (string memory json);
    function serializeUint(string calldata objectKey, string calldata valueKey, uint256 value)
        external
        returns (string memory json);
    function serializeBytes32(string calldata objectKey, string calldata valueKey, bytes32 value)
        external
        returns (string memory json);
}

interface IR10MarketEthUsdFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

abstract contract R10MarketplaceSepoliaBase {
    VmR10Market internal constant vm = VmR10Market(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

    address internal constant SEPOLIA_VRF_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;
    address internal constant SEPOLIA_VRF_COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    address internal constant SEPOLIA_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint64 internal constant FEE_ORACLE_MAX_AGE = 1 days;

    uint256 internal constant RESERVE_SEED_WEI = 0.01 ether;
    uint256 internal constant RESERVE_MINIMUM_WEI = 0;
    uint256 internal constant RESERVE_ACTIVE_BATCH_BUFFER_WEI = 0.001 ether;
    uint32 internal constant RESERVE_EXPOSURE_SAFETY_BPS = 20_000;
    uint256 internal constant RESERVE_MAX_SUBSIDY_PER_REQUEST_WEI = 0.02 ether;
    uint256 internal constant RESERVE_MAX_SUBSIDY_PER_COLLECTION_WEI = 0.05 ether;

    uint256 internal constant COLLECTION_MAX_RANDOMNESS_COST_WEI = 0.02 ether;
    uint64 internal constant COLLECTION_BATCH_WINDOW_SECONDS = 180;
    uint32 internal constant CANARY_SUPPLY = 2;

    function _assertSepolia() internal view {
        require(block.chainid == ETHEREUM_SEPOLIA_CHAIN_ID, "R10M: Ethereum Sepolia only");
        require(SEPOLIA_VRF_WRAPPER.code.length != 0, "R10M: Chainlink wrapper missing");
        require(SEPOLIA_VRF_COORDINATOR.code.length != 0, "R10M: Chainlink coordinator missing");
        require(SEPOLIA_LINK.code.length != 0, "R10M: LINK missing");
        require(SEPOLIA_ETH_USD_FEED.code.length != 0, "R10M: ETH/USD feed missing");

        IR10MarketEthUsdFeed feed = IR10MarketEthUsdFeed(SEPOLIA_ETH_USD_FEED);
        require(feed.decimals() <= 18, "R10M: feed decimals");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "R10M: bad feed answer");
        require(updatedAt != 0 && updatedAt <= block.timestamp, "R10M: bad feed timestamp");
        require(block.timestamp - updatedAt <= FEE_ORACLE_MAX_AGE, "R10M: stale feed");
        require(answeredInRound >= roundId, "R10M: incomplete feed round");
    }

    function _manifestDir() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/r12-v2-r10-marketplace");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-infrastructure.json");
    }

    function _canaryPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-marketplace-canary.json");
    }

    function _requestPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-marketplace-request.json");
    }

    function _readAddress(string memory path, string memory key) internal view returns (address) {
        string memory json = vm.readFile(path);
        return vm.parseJsonAddress(json, string.concat(".", key));
    }

    function _readUint(string memory path, string memory key) internal view returns (uint256) {
        string memory json = vm.readFile(path);
        return vm.parseJsonUint(json, string.concat(".", key));
    }

    function _deploymentAddress(string memory key) internal view returns (address) {
        return _readAddress(_deploymentPath(), key);
    }

    function _canaryAddress(string memory key) internal view returns (address) {
        return _readAddress(_canaryPath(), key);
    }

    function _canaryUint(string memory key) internal view returns (uint256) {
        return _readUint(_canaryPath(), key);
    }

    function _requestUint(string memory key) internal view returns (uint256) {
        return _readUint(_requestPath(), key);
    }

    function _assertMinimalProxy(address proxy, address expectedImplementation) internal view {
        bytes memory expectedRuntime = abi.encodePacked(
            hex"363d3d373d3d3d363d73", bytes20(expectedImplementation), hex"5af43d82803e903d91602b57fd5bf3"
        );

        require(proxy.code.length == 45, "R10M: clone runtime length");
        require(keccak256(proxy.code) == keccak256(expectedRuntime), "R10M: clone implementation mismatch");
    }
}
