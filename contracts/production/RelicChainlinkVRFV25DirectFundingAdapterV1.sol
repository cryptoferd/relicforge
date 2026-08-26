// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";
import "./RelicRandomnessAdapterBaseV1.sol";

error RF_InsufficientRandomnessCredit();
error RF_CreditWithdrawalUnauthorized();
error RF_CreditTransferFailed();
error RF_RandomnessPriceTooHigh();

/**
 * @dev Minimal interface for Chainlink's current VRF v2.5 wrapper native-payment path.
 *      The ABI matches IVRFV2PlusWrapper / VRFV2PlusWrapperConsumerBase.
 */
interface IRFChainlinkVRFV25Wrapper {
    function calculateRequestPriceNative(uint32 callbackGasLimit, uint32 numWords)
        external view returns (uint256 requestPrice);

    function requestRandomWordsInNative(
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords,
        bytes calldata extraArgs
    ) external payable returns (uint256 requestId);
}

interface IRFRelicForgeFactoryRegistryV1 {
    function isRelicForgeCollection(address collection) external view returns (bool);
    function randomnessProvider() external view returns (address);
}

interface IRFCollectionPayoutViewV1 {
    function payoutReceiver() external view returns (address);
}

library RFChainlinkVRFV25ExtraArgs {
    bytes4 internal constant EXTRA_ARGS_V1_TAG = bytes4(keccak256("VRF ExtraArgsV1"));

    struct ExtraArgsV1 {
        bool nativePayment;
    }

    function nativePaymentArgs() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(EXTRA_ARGS_V1_TAG, ExtraArgsV1({nativePayment: true}));
    }
}

/**
 * @title RelicChainlinkVRFV25DirectFundingAdapterV1
 * @notice Chainlink VRF v2.5 wrapper adapter with isolated per-collection native randomness credit.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 *
 * Why direct funding instead of one shared RelicForge subscription:
 * - Any canonical creator can deploy a collection, so a shared subscription would become a common
 *   economic resource that a malicious collection creator could intentionally exhaust.
 * - Here each collection can spend only `nativeCredit[collection]`.
 * - If credit is insufficient, the upstream request reverts and the collection mint/reveal request
 *   reverts atomically as part of the same transaction.
 *
 * Deployment ceremony:
 * 1. Deploy adapter with the official chain-specific VRF v2.5 wrapper address.
 * 2. Deploy immutable RelicForgeFactoryV1 pointing to this adapter.
 * 3. Call bindFactory(factory) exactly once. This burns bootstrapAuthority forever.
 */
contract RelicChainlinkVRFV25DirectFundingAdapterV1 is RelicRandomnessAdapterBaseV1 {
    uint32 public constant NUM_WORDS = 1;
    uint32 public constant MIN_CALLBACK_GAS = 300_000;

    address public immutable wrapper;
    uint32 public immutable callbackGasLimit;
    uint16 public immutable requestConfirmations;
    uint256 public immutable maxRequestPriceWei;

    address public bootstrapAuthority;
    address public factory;

    mapping(address => uint256) public nativeCredit;
    mapping(uint256 => uint256) public upstreamToLocalRequestId;
    mapping(uint256 => uint256) public localToUpstreamRequestId;
    mapping(uint256 => uint256) public requestCost;

    event FactoryBound(address indexed factory);
    event RandomnessCreditFunded(address indexed consumer, address indexed funder, uint256 amount, uint256 newBalance);
    event RandomnessCreditWithdrawn(address indexed consumer, address indexed receiver, uint256 amount, uint256 newBalance);
    event ChainlinkRequestLinked(
        uint256 indexed localRequestId,
        uint256 indexed upstreamRequestId,
        address indexed consumer,
        uint256 cost
    );

    constructor(
        address wrapper_,
        uint32 callbackGasLimit_,
        uint16 requestConfirmations_,
        uint256 maxRequestPriceWei_
    ) {
        if (wrapper_ == address(0) || wrapper_.code.length == 0) revert RF_BadProvider();
        if (callbackGasLimit_ < MIN_CALLBACK_GAS) revert RF_BadConfig();
        if (requestConfirmations_ == 0 || requestConfirmations_ > 200) revert RF_BadConfig();
        if (maxRequestPriceWei_ == 0) revert RF_BadConfig();

        wrapper = wrapper_;
        callbackGasLimit = callbackGasLimit_;
        requestConfirmations = requestConfirmations_;
        maxRequestPriceWei = maxRequestPriceWei_;
        bootstrapAuthority = msg.sender;
    }

    /**
     * @notice Irreversibly bind to the canonical immutable V1 factory.
     * @dev Binding verifies the candidate factory points back to this adapter, then burns authority.
     */
    function bindFactory(address factory_) external {
        if (msg.sender != bootstrapAuthority || bootstrapAuthority == address(0)) revert RF_NotAuthorized();
        if (factory != address(0)) revert RF_AlreadyInitialized();
        if (factory_ == address(0) || factory_.code.length == 0) revert RF_BadImpl();
        if (IRFRelicForgeFactoryRegistryV1(factory_).randomnessProvider() != address(this)) revert RF_BadProvider();

        factory = factory_;
        bootstrapAuthority = address(0);
        emit FactoryBound(factory_);
    }

    /**
     * @notice Add native VRF credit to a canonical RelicForge collection.
     * @dev Sponsorship is intentionally permissionless. Credit belongs to the collection budget,
     *      not to the individual sponsor, and may only be withdrawn to the collection payout receiver.
     */
    function fundConsumer(address consumer) external payable {
        if (msg.value == 0) revert RF_ZeroQuantity();
        _requireAuthorizedConsumer(consumer);
        uint256 newBalance = nativeCredit[consumer] + msg.value;
        nativeCredit[consumer] = newBalance;
        emit RandomnessCreditFunded(consumer, msg.sender, msg.value, newBalance);
    }

    function quoteRequestPrice() public view returns (uint256) {
        return IRFChainlinkVRFV25Wrapper(wrapper).calculateRequestPriceNative(callbackGasLimit, NUM_WORDS);
    }

    /**
     * @notice Withdraw unused credit only to the collection's current payoutReceiver.
     * @dev This remains usable after collection control renunciation because payoutReceiver persists.
     */
    function withdrawConsumerCredit(address consumer, uint256 amount) external {
        if (amount == 0) revert RF_ZeroQuantity();
        _requireAuthorizedConsumer(consumer);

        address receiver = IRFCollectionPayoutViewV1(consumer).payoutReceiver();
        if (msg.sender != receiver) revert RF_CreditWithdrawalUnauthorized();

        uint256 credit = nativeCredit[consumer];
        if (amount > credit) revert RF_InsufficientRandomnessCredit();

        nativeCredit[consumer] = credit - amount;
        (bool ok,) = payable(receiver).call{value: amount}("");
        if (!ok) revert RF_CreditTransferFailed();
        emit RandomnessCreditWithdrawn(consumer, receiver, amount, credit - amount);
    }

    function _requireAuthorizedConsumer(address consumer) internal view override {
        address f = factory;
        if (f == address(0)) revert RF_NotAuthorized();
        if (!IRFRelicForgeFactoryRegistryV1(f).isRelicForgeCollection(consumer)) revert RF_NotAuthorized();
    }

    function _requestUpstream(uint256 localRequestId, uint256) internal override {
        Delivery storage d = deliveries[localRequestId];
        address consumer = d.consumer;

        uint256 cost = quoteRequestPrice();
        if (cost > maxRequestPriceWei) revert RF_RandomnessPriceTooHigh();
        uint256 credit = nativeCredit[consumer];
        if (cost == 0 || credit < cost) revert RF_InsufficientRandomnessCredit();

        // Effects before interaction. If the wrapper reverts, the entire request transaction reverts,
        // including this debit and the collection mint/reveal state that initiated it.
        nativeCredit[consumer] = credit - cost;

        uint256 upstreamRequestId = IRFChainlinkVRFV25Wrapper(wrapper).requestRandomWordsInNative{value: cost}(
            callbackGasLimit,
            requestConfirmations,
            NUM_WORDS,
            RFChainlinkVRFV25ExtraArgs.nativePaymentArgs()
        );

        if (
            upstreamRequestId == 0 ||
            upstreamToLocalRequestId[upstreamRequestId] != 0 ||
            localToUpstreamRequestId[localRequestId] != 0
        ) revert RF_BadRequest();

        upstreamToLocalRequestId[upstreamRequestId] = localRequestId;
        localToUpstreamRequestId[localRequestId] = upstreamRequestId;
        requestCost[localRequestId] = cost;
        emit ChainlinkRequestLinked(localRequestId, upstreamRequestId, consumer, cost);
    }

    /**
     * @notice Chainlink VRF v2.5 wrapper callback entrypoint.
     * @dev Function selector matches VRFV2PlusWrapperConsumerBase.rawFulfillRandomWords.
     */
    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external {
        if (msg.sender != wrapper) revert RF_BadProvider();
        if (randomWords.length != 1) revert RF_BadRequest();

        uint256 localRequestId = upstreamToLocalRequestId[upstreamRequestId];
        if (localRequestId == 0) revert RF_BadRequest();
        _recordWord(localRequestId, randomWords[0]);
    }

    // Prevent accidental direct transfers that would not be attributed to a collection credit bucket.
    receive() external payable { revert RF_BadRequest(); }
}
