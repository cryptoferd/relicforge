// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicSupraDVRFV3ThinAdapterV2Harness.sol";

error RFV2_OnlySupraMockRouter();

/// @title RelicSupraDVRFV3DepositMockV2
/// @notice ABI-shaped funding/config mock for Supra dVRF V3 Phase 2D R4 tests.
/// @dev EXPERIMENTAL ONLY. Models an EOA/client-owned prepaid subscription, per-contract gas settings,
///      minimum-balance gating and shared-balance callback charges.
contract RelicSupraDVRFV3DepositMockV2 is IRelicSupraDVRFV3Deposit {
    struct Client {
        uint128 fund;
        uint128 minBalance;
        uint128 maxGasPrice;
        uint128 maxGasLimit;
        bool whitelisted;
    }

    struct ContractConfig {
        address client;
        uint128 callbackGasPrice;
        uint128 callbackGasLimit;
        bool whitelisted;
    }

    mapping(address => Client) public clients;
    mapping(address => ContractConfig) public contractConfigs;
    mapping(address => address[]) internal _contractsByClient;
    address public router;

    event ClientConfigured(address indexed client, uint128 minBalance, uint128 maxGasPrice, uint128 maxGasLimit);
    event ContractConfigured(
        address indexed client,
        address indexed requester,
        uint128 callbackGasPrice,
        uint128 callbackGasLimit,
        bool whitelisted
    );
    event ClientFundDeposited(address indexed client, uint256 amount);
    event ClientCharged(address indexed client, uint256 amount);

    function setRouter(address router_) external {
        if (router_ == address(0) || router_.code.length == 0) revert RF_BadConfig();
        if (router != address(0)) revert RF_BadConfig();
        router = router_;
    }

    function configureClient(address client, uint128 minBalance, uint128 maxGasPrice, uint128 maxGasLimit) external {
        if (client == address(0) || maxGasPrice == 0 || maxGasLimit == 0) revert RF_BadConfig();
        Client storage c = clients[client];
        c.minBalance = minBalance;
        c.maxGasPrice = maxGasPrice;
        c.maxGasLimit = maxGasLimit;
        c.whitelisted = true;
        emit ClientConfigured(client, minBalance, maxGasPrice, maxGasLimit);
    }

    /// @notice Mirrors the documented client-self-funding shape: there is no arbitrary client parameter.
    function depositFundClient() external payable {
        Client storage c = clients[msg.sender];
        if (!c.whitelisted || msg.value == 0) revert RF_BadRequest();
        uint256 updated = uint256(c.fund) + msg.value;
        if (updated > type(uint128).max) revert RF_BadConfig();
        c.fund = uint128(updated);
        emit ClientFundDeposited(msg.sender, msg.value);
    }

    function configureContract(
        address client,
        address requester,
        uint128 callbackGasPrice,
        uint128 callbackGasLimit,
        bool whitelisted
    ) external {
        Client memory c = clients[client];
        if (!c.whitelisted || requester == address(0)) revert RF_BadConfig();
        if (whitelisted) {
            if (
                callbackGasPrice == 0 || callbackGasLimit == 0 || callbackGasPrice > c.maxGasPrice
                    || callbackGasLimit > c.maxGasLimit
            ) revert RF_BadConfig();
            if (!contractConfigs[requester].whitelisted) _contractsByClient[client].push(requester);
        }
        contractConfigs[requester] = ContractConfig(client, callbackGasPrice, callbackGasLimit, whitelisted);
        emit ContractConfigured(client, requester, callbackGasPrice, callbackGasLimit, whitelisted);
    }

    function setClientFundForTest(address client, uint128 amount) external {
        if (!clients[client].whitelisted) revert RF_BadRequest();
        clients[client].fund = amount;
    }

    function chargeClient(address client, uint128 amount) external {
        if (msg.sender != router) revert RFV2_OnlySupraMockRouter();
        Client storage c = clients[client];
        if (!c.whitelisted || amount > c.fund) revert RF_BadRequest();
        c.fund -= amount;
        emit ClientCharged(client, amount);
    }

    function checkClientFund(address clientAddress) external view returns (uint128) {
        return clients[clientAddress].fund;
    }

    function checkMinBalanceClient(address clientAddress) external view returns (uint128) {
        return clients[clientAddress].minBalance;
    }

    function isMinimumBalanceReached(address clientAddress) external view returns (bool) {
        Client memory c = clients[clientAddress];
        return !c.whitelisted || c.fund <= c.minBalance;
    }

    function getContractDetails(address contractAddress)
        external
        view
        returns (uint128 callbackGasPrice, uint128 callbackGasLimit)
    {
        ContractConfig memory cfg = contractConfigs[contractAddress];
        if (!cfg.whitelisted) return (0, 0);
        return (cfg.callbackGasPrice, cfg.callbackGasLimit);
    }

    function listAllWhitelistedContractByClient(address client) external view returns (address[] memory) {
        return _contractsByClient[client];
    }
}
