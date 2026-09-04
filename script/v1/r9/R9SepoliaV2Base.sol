// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface VmR9V2 {
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

interface IR9EthUsdFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

abstract contract R9SepoliaV2Base {
    VmR9V2 internal constant vm = VmR9V2(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;

    // Existing Relic Forge Sepolia certification constants.
    address internal constant SEPOLIA_VRF_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;
    address internal constant SEPOLIA_VRF_COORDINATOR = 0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B;
    address internal constant SEPOLIA_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address internal constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    uint16 internal constant REQUEST_CONFIRMATIONS = 3;
    uint64 internal constant FEE_ORACLE_MAX_AGE = 1 days;

    // Canary-only Reserve parameters. Mainnet activation remains closed.
    uint256 internal constant RESERVE_SEED_WEI = 0.01 ether;
    uint256 internal constant RESERVE_MINIMUM_WEI = 0;
    uint256 internal constant RESERVE_ACTIVE_BATCH_BUFFER_WEI = 0.001 ether;
    uint32 internal constant RESERVE_EXPOSURE_SAFETY_BPS = 20_000;
    uint256 internal constant RESERVE_MAX_SUBSIDY_PER_REQUEST_WEI = 0.02 ether;
    uint256 internal constant RESERVE_MAX_SUBSIDY_PER_COLLECTION_WEI = 0.05 ether;

    uint256 internal constant COLLECTION_MAX_RANDOMNESS_COST_WEI = 0.02 ether;
    uint64 internal constant COLLECTION_BATCH_WINDOW_SECONDS = 180;

    uint32 internal constant CANARY_SUPPLY = 4;

    function _assertSepolia() internal view {
        require(block.chainid == ETHEREUM_SEPOLIA_CHAIN_ID, "R9: Ethereum Sepolia only");
        require(SEPOLIA_VRF_WRAPPER.code.length != 0, "R9: Chainlink wrapper missing");
        require(SEPOLIA_VRF_COORDINATOR.code.length != 0, "R9: Chainlink coordinator missing");
        require(SEPOLIA_LINK.code.length != 0, "R9: LINK missing");
        require(SEPOLIA_ETH_USD_FEED.code.length != 0, "R9: ETH/USD feed missing");

        IR9EthUsdFeed feed = IR9EthUsdFeed(SEPOLIA_ETH_USD_FEED);
        require(feed.decimals() <= 18, "R9: feed decimals");
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        require(answer > 0, "R9: bad feed answer");
        require(updatedAt != 0 && updatedAt <= block.timestamp, "R9: bad feed timestamp");
        require(block.timestamp - updatedAt <= FEE_ORACLE_MAX_AGE, "R9: stale feed");
        require(answeredInRound >= roundId, "R9: incomplete feed round");
    }

    function _manifestDir() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/r12-v2-r9");
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-infrastructure.json");
    }

    function _canaryStage1Path() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-canary-stage1.json");
    }

    function _canaryStage2Path() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-canary-stage2.json");
    }

    function _canaryFinalPath() internal view returns (string memory) {
        return string.concat(_manifestDir(), "/sepolia-canary-final.json");
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

    function _stage1Address(string memory key) internal view returns (address) {
        return _readAddress(_canaryStage1Path(), key);
    }

    function _stage1Uint(string memory key) internal view returns (uint256) {
        return _readUint(_canaryStage1Path(), key);
    }

    function _stage2Uint(string memory key) internal view returns (uint256) {
        return _readUint(_canaryStage2Path(), key);
    }

    function _assertMinimalProxy(address proxy, address expectedImplementation) internal view {
        bytes memory expectedRuntime = abi.encodePacked(
            hex"363d3d373d3d3d363d73", bytes20(expectedImplementation), hex"5af43d82803e903d91602b57fd5bf3"
        );

        require(proxy.code.length == 45, "R9: clone runtime length");
        require(keccak256(proxy.code) == keccak256(expectedRuntime), "R9: clone implementation mismatch");
    }
}
