// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicThinRandomnessAdapterBaseV2.sol";
import "./RelicChainlinkVRFV25DirectThinAdapterV2Harness.sol";

error RFV2_OnlySupraRouter();
error RFV2_SupraSubscriptionNotReady();
error RFV2_SupraPendingRequestLimit();

interface IRelicSupraDVRFV3Router {
    function generateRequest(
        string memory functionSig,
        uint8 rngCount,
        uint256 numConfirmations,
        uint256 clientSeed,
        address clientWalletAddress
    ) external returns (uint256 nonce);
}

interface IRelicSupraDVRFV3Deposit {
    function checkClientFund(address clientAddress) external view returns (uint128);
    function checkMinBalanceClient(address clientAddress) external view returns (uint128);
    function isMinimumBalanceReached(address clientAddress) external view returns (bool);
    function getContractDetails(address contractAddress)
        external
        view
        returns (uint128 callbackGasPrice, uint128 callbackGasLimit);
}

/// @title RelicSupraDVRFV3ThinAdapterV2Harness
/// @notice Phase 2D R4 Supra dVRF V3 thin-callback subscription adapter candidate.
/// @dev EXPERIMENTAL ONLY. The documented V3 subscription is owned/funded by a client wallet while
///      the requester contract is separately whitelisted. Relic Forge therefore treats the collection
///      payment as a conservative reservation escrow only; it is NOT claimed to be an exact provider charge.
contract RelicSupraDVRFV3ThinAdapterV2Harness is RelicThinRandomnessAdapterBaseV2 {
    string public constant CALLBACK_SIGNATURE = "supraCallback(uint256,uint256[])";
    uint8 public constant RNG_COUNT = 1;

    IRelicSupraDVRFV3Router public immutable router;
    IRelicSupraDVRFV3Deposit public immutable deposit;
    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    address public immutable clientWallet;
    uint256 public immutable requestConfirmations;
    uint256 public immutable reservationPerRequestWei;
    uint128 public immutable maxCallbackGasPriceWei;
    uint32 public immutable maxPendingRequestsPerConsumer;

    mapping(address => uint32) public pendingRequestsByConsumer;
    mapping(address => uint256) public totalReservationEscrowByConsumer;
    mapping(uint256 => uint256) public reservationByLocalRequestId;
    mapping(uint256 => uint256) public clientSeedByLocalRequestId;

    event SupraReservationEscrowed(uint256 indexed localRequestId, address indexed consumer, uint256 amount);

    constructor(
        address router_,
        address deposit_,
        address registry_,
        address clientWallet_,
        uint256 confirmations_,
        uint256 reservationPerRequestWei_,
        uint128 maxCallbackGasPriceWei_,
        uint32 maxPending_
    ) {
        if (
            router_ == address(0) || router_.code.length == 0 || deposit_ == address(0) || deposit_.code.length == 0
                || registry_ == address(0) || registry_.code.length == 0 || clientWallet_ == address(0)
                || confirmations_ == 0 || confirmations_ > 20 || reservationPerRequestWei_ == 0
                || maxCallbackGasPriceWei_ == 0 || maxPending_ == 0
        ) revert RF_BadConfig();

        router = IRelicSupraDVRFV3Router(router_);
        deposit = IRelicSupraDVRFV3Deposit(deposit_);
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(registry_);
        clientWallet = clientWallet_;
        requestConfirmations = confirmations_;
        reservationPerRequestWei = reservationPerRequestWei_;
        maxCallbackGasPriceWei = maxCallbackGasPriceWei_;
        maxPendingRequestsPerConsumer = maxPending_;
    }

    function providerReady() public view returns (bool) {
        (uint128 callbackGasPrice, uint128 callbackGasLimit) = deposit.getContractDetails(address(this));
        if (
            callbackGasPrice == 0 || callbackGasPrice > maxCallbackGasPriceWei
                || callbackGasLimit != uint128(UPSTREAM_CALLBACK_GAS)
        ) return false;
        if (deposit.isMinimumBalanceReached(clientWallet)) return false;
        uint128 clientFund = deposit.checkClientFund(clientWallet);
        uint128 minBalance = deposit.checkMinBalanceClient(clientWallet);
        return clientFund > minBalance;
    }

    function supraCallback(uint256 nonce, uint256[] calldata rngList) external {
        if (msg.sender != address(router)) revert RFV2_OnlySupraRouter();
        if (rngList.length != RNG_COUNT) revert RF_BadRequest();
        uint256 localRequestId = upstreamRequestIdToLocalRequestId[nonce];
        if (localRequestId == 0) revert RF_BadRequest();
        address consumer = deliveries[localRequestId].consumer;
        _recordVerifiedWord(nonce, rngList[0]);
        unchecked {
            --pendingRequestsByConsumer[consumer];
        }
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
        if (!providerReady()) revert RFV2_SupraSubscriptionNotReady();
        if (pendingRequestsByConsumer[consumer] >= maxPendingRequestsPerConsumer) {
            revert RFV2_SupraPendingRequestLimit();
        }
    }

    function _quoteUpstreamRequest(uint32) internal view override returns (uint256) {
        if (!providerReady()) revert RFV2_SupraSubscriptionNotReady();
        return reservationPerRequestWei;
    }

    function _requestUpstream(uint256 localRequestId, uint32, uint256 requestPrice)
        internal
        override
        returns (uint256 upstreamRequestId)
    {
        if (!providerReady()) revert RFV2_SupraSubscriptionNotReady();
        Delivery storage d = deliveries[localRequestId];
        uint256 clientSeed = uint256(keccak256(abi.encode(address(this), d.consumer, d.context, localRequestId)));
        if (clientSeed == 0) revert RF_BadRequest();

        reservationByLocalRequestId[localRequestId] = requestPrice;
        clientSeedByLocalRequestId[localRequestId] = clientSeed;
        totalReservationEscrowByConsumer[d.consumer] += requestPrice;
        ++pendingRequestsByConsumer[d.consumer];
        emit SupraReservationEscrowed(localRequestId, d.consumer, requestPrice);

        // Intentionally no depositFundClient() call here. Supra's documented V3 deposit function
        // funds the caller's client subscription and does not accept an arbitrary client address.
        // The collection's reservation therefore remains isolated in this harness until a safe
        // reconciliation/replenishment mechanism is designed and certified.
        upstreamRequestId =
            router.generateRequest(CALLBACK_SIGNATURE, RNG_COUNT, requestConfirmations, clientSeed, clientWallet);
    }
}
