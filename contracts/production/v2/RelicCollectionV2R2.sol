// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";
import "./RelicForgeV2R2Core.sol";
import "./RFRevealPermutationV2.sol";
import "./RelicMintPhasesV2.sol";

interface IRelicForgeReserveFounderViewR2Prod {
    function founder() external view returns (address);
}

/// @title RelicCollectionV2R2
/// @notice Relic Forge R2 collection implementation: ownership is minted immediately and reveal is asynchronous.
/// @dev Designed for EIP-1167 clones created by the existing RelicForgeFactoryV2 ABI.
///
/// Product invariants:
/// - Every successful mint emits ERC-721 Transfer events immediately.
/// - Deferred reveal freezes only NFTs that already exist when the creator prepares reveal.
/// - Forge/automatic reveal requests fresh VRF only after ownership is committed.
/// - Future mints after delayed reveal use fresh automatic-reveal VRF and cannot precompute future recipes.
/// - One collection hopper funds every reveal mode and only excess can be swept to the canonical Reserve.
contract RelicCollectionV2R2 is IRelicRandomnessConsumerV1, IRelicForgeReserveCollectionV2Prod {
    uint32 public constant MAX_MINT_BATCH = 50;
    uint32 public constant MAX_AUTO_REVEAL_GROUP_NFTS = 20;
    uint32 public constant DELAYED_REVEAL_CALLBACK_GAS = 500_000;

    uint64 public constant PLATFORM_DEFAULT_BATCH_WINDOW_SECONDS = 30;
    uint256 public constant PLATFORM_DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI = 0.005 ether;

    uint32 public constant AUTO_REVEAL_CALLBACK_GAS_1 = 400_000;
    uint32 public constant AUTO_REVEAL_CALLBACK_GAS_2_TO_4 = 550_000;
    uint32 public constant AUTO_REVEAL_CALLBACK_GAS_5_TO_10 = 900_000;
    uint32 public constant AUTO_REVEAL_CALLBACK_GAS_11_TO_15 = 1_150_000;
    uint32 public constant AUTO_REVEAL_CALLBACK_GAS_16_TO_20 = 1_400_000;

    uint8 public constant REVEAL_DEFERRED = 0;
    uint8 public constant REVEAL_FORGE = 1;
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    struct AutoRevealGroup {
        uint32 firstTokenId;
        uint32 quantity;
        uint256 randomnessCost;
        uint256 requestId;
        uint256 hopperPaid;
        uint256 reservePaid;
        bool revealed;
    }

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event ContractURIUpdated();
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event FutureRevealModeSet(uint8 mode);
    event DelayedRevealPreparedR2(
        uint32 frozenSupply, uint256 preparedBudgetWei, uint256 hopperPreparedWei, uint256 reservePreparedWei
    );
    event DelayedRevealPreparationCancelledR2(
        uint32 frozenSupply, uint256 hopperRestoredWei, uint256 reserveRefundedWei
    );
    event DelayedRevealRequested(uint256 indexed requestId, uint32 revealedSupply, uint256 randomnessCost);
    event DelayedRevealCompleted(
        uint256 indexed requestId,
        uint32 revealedSupply,
        uint256 seed,
        uint256 multiplier,
        uint256 offset,
        bool futureMintsSwitchedToForge
    );
    event AutoRevealRequestedR2(
        uint64 indexed groupId,
        uint256 indexed requestId,
        uint32 firstTokenId,
        uint32 quantity,
        uint256 randomnessCost,
        uint256 hopperPaid,
        uint256 reservePaid
    );
    event AutoRevealCompletedR2(
        uint64 indexed groupId, uint256 indexed requestId, uint32 firstTokenId, uint32 quantity
    );
    event HopperSweptToReserve(uint256 amount, uint256 remainingHopper);
    event CollectionCompleted(uint32 totalMinted, uint256 hopperRemaining);
    event CreatorProceedsWithdrawn(address indexed receiver, uint256 amount);
    event ControllerRenounced(address indexed creator);
    event PayoutReceiverSet(address indexed receiver);
    event RoyaltySet(address indexed receiver, uint96 bps);
    event RenderConfigUpdated(string flattenedRenderBaseURI, bool holderRenderModeEnabled, uint8 defaultRenderMode);
    event RenderModeUpdated(uint256 indexed tokenId, uint8 mode);
    event PlatformFeeTermsConfigured(address indexed feePolicy, uint8 indexed feeMode, uint32 lockedFeeCents);
    event MintPhasesBound(address indexed mintPhases);
    event ForgeBatchWindowSecondsSetR2(uint64 previousWindowSeconds, uint64 newWindowSeconds);
    event MaxRandomnessCostPerBatchWeiSetR2(uint256 previousCeilingWei, uint256 newCeilingWei);

    string public name;
    string public symbol;
    string public description;

    address public creator;
    address public controller;
    address public payoutReceiver;
    address public royaltyReceiver;
    uint96 public royaltyBps;

    address public dataContract;
    address public renderer;
    address public randomnessProvider;
    address public forgeReserve;
    address public factory;
    address public feePolicy;
    address public mintPhases;

    uint32 public maxSupply;
    uint32 public totalCommitted;
    uint32 public totalMinted;
    uint32 public totalAssignedRecipes;

    uint8 public futureRevealMode;
    uint8 public platformFeeMode;
    uint32 public lockedPlatformFeeCents;
    uint64 public batchWindowSeconds;
    uint256 public maxRandomnessCostPerBatchWei;

    uint256 public sponsoredPrepaidWei;
    uint256 public hopperBalance;
    uint256 public creatorEscrow; // retained for ABI/accounting continuity; R2 does not defer creator proceeds.
    uint256 public accruedCreatorProceeds;
    uint256 public totalRandomnessSpend;
    uint256 public totalReserveSubsidy;
    uint256 public totalSweptToReserve;

    bool public delayedRevealRequested;
    bool public delayedRevealPrepared;
    bool public delayedRevealed;
    uint32 public delayedRevealSupply;
    uint256 public delayedRevealRequestId;
    uint256 public delayedRevealSeed;
    uint256 public delayedRevealMultiplier;
    uint256 public delayedRevealOffset;
    bool public hybridForgeActive;

    uint256 public preparedDelayedBudgetWei;
    uint256 public preparedDelayedHopperWei;
    uint256 public preparedDelayedReserveWei;
    uint256 public pendingDelayedReserveRefundWei;

    uint64 public nextAutoRevealGroupId;
    uint32 public activeAutoRevealRequests;
    uint32 public pendingAutoRevealTokens;
    bool public completed;

    mapping(uint64 => AutoRevealGroup) public autoRevealGroups;
    mapping(uint256 => uint64) public requestIdToAutoRevealGroupId;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    mapping(uint256 => uint256) public assignedRecipePlusOne;
    mapping(uint256 => uint256) private _forgePoolSwapPlusOne;

    mapping(uint256 => uint8) private _tokenRenderMode;
    mapping(uint256 => bool) private _tokenRenderModeSet;
    string public flattenedRenderBaseURI;
    bool public holderRenderModeEnabled;
    uint8 public defaultRenderMode;

    bool private _initialized;
    uint256 private _entered;

    modifier onlyController() {
        if (controller == address(0)) revert RF_Renounced();
        if (msg.sender != controller) revert RF_NotController();
        _;
    }

    modifier onlyPlatformFounder() {
        if (msg.sender != IRelicForgeReserveFounderViewR2Prod(forgeReserve).founder()) revert RF_NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered != 0) revert RF_Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor() {
        _initialized = true;
    }

    function initialize(RelicCollectionInitV2 calldata init_) external payable {
        if (_initialized) revert RF_AlreadyInitialized();
        if (
            init_.creator == address(0) || init_.dataContract == address(0) || init_.renderer == address(0)
                || init_.randomnessProvider == address(0) || init_.forgeReserve == address(0)
                || init_.feePolicy == address(0) || init_.mintPhases == address(0)
        ) revert RF_ZeroAddress();
        if (
            init_.dataContract.code.length == 0 || init_.renderer.code.length == 0
                || init_.randomnessProvider.code.length == 0 || init_.forgeReserve.code.length == 0
                || init_.feePolicy.code.length == 0 || init_.mintPhases.code.length == 0
        ) revert RF_BadConfig();
        if (init_.royaltyBps > 10_000) revert RF_BadRoyalty();
        if (init_.maxSupply == 0 || IRelicProjectDataV1(init_.dataContract).maxSupply() != init_.maxSupply) {
            revert RF_BadConfig();
        }
        if (IRelicProjectDataV1(init_.dataContract).creator() != init_.creator) revert RF_BadConfig();
        if (init_.feeMode != FEE_MODE_SPONSORED && init_.feeMode != FEE_MODE_MINTER_SUPPORTED) {
            revert RF_BadFeeMode();
        }
        if (init_.lockedFeeCents > 500) revert RF_FeeLimit();
        if (init_.initialRevealMode > REVEAL_FORGE) revert RF_BadConfig();
        if (init_.feeMode == FEE_MODE_MINTER_SUPPORTED && msg.value != 0) revert RF_WrongPrice();

        _initialized = true;
        factory = msg.sender;
        nextAutoRevealGroupId = 1;

        name = init_.name;
        symbol = init_.symbol;
        description = init_.description;
        creator = init_.creator;
        controller = init_.creator;
        emit OwnershipTransferred(address(0), init_.creator);

        dataContract = init_.dataContract;
        renderer = init_.renderer;
        randomnessProvider = init_.randomnessProvider;
        forgeReserve = init_.forgeReserve;
        feePolicy = init_.feePolicy;
        mintPhases = init_.mintPhases;
        if (RelicMintPhasesV2(init_.mintPhases).collection() != address(this)) revert RF_BadConfig();

        maxSupply = init_.maxSupply;
        payoutReceiver = init_.payoutReceiver == address(0) ? init_.creator : init_.payoutReceiver;
        royaltyReceiver = init_.royaltyReceiver == address(0) ? init_.creator : init_.royaltyReceiver;
        royaltyBps = init_.royaltyBps;
        platformFeeMode = init_.feeMode;
        lockedPlatformFeeCents = init_.lockedFeeCents;
        futureRevealMode = init_.initialRevealMode;
        batchWindowSeconds = PLATFORM_DEFAULT_BATCH_WINDOW_SECONDS;
        maxRandomnessCostPerBatchWei = PLATFORM_DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI;

        if (init_.feeMode == FEE_MODE_SPONSORED) {
            sponsoredPrepaidWei = msg.value;
            hopperBalance = msg.value;
        }

        emit PlatformFeeTermsConfigured(init_.feePolicy, init_.feeMode, init_.lockedFeeCents);
        emit MintPhasesBound(init_.mintPhases);
    }

    /// @notice Returns the canonical consumer callback gas for one bounded Forge reveal group.
    /// @dev Quantity must be 1..20. The same value is used for both quote and request.
    function autoRevealCallbackGasForQuantity(uint32 quantity) public pure returns (uint32) {
        if (quantity == 0 || quantity > MAX_AUTO_REVEAL_GROUP_NFTS) revert RF_BadRequest();
        if (quantity == 1) return AUTO_REVEAL_CALLBACK_GAS_1;
        if (quantity <= 4) return AUTO_REVEAL_CALLBACK_GAS_2_TO_4;
        if (quantity <= 10) return AUTO_REVEAL_CALLBACK_GAS_5_TO_10;
        if (quantity <= 15) return AUTO_REVEAL_CALLBACK_GAS_11_TO_15;
        return AUTO_REVEAL_CALLBACK_GAS_16_TO_20;
    }

    /// @notice Founder-only platform emergency tuning for already-live collections.
    function setForgeBatchWindowSeconds(uint64 newWindowSeconds) external onlyPlatformFounder {
        if (newWindowSeconds == 0 || newWindowSeconds > 86_400) revert RF_BadConfig();
        uint64 previous = batchWindowSeconds;
        batchWindowSeconds = newWindowSeconds;
        emit ForgeBatchWindowSecondsSetR2(previous, newWindowSeconds);
    }

    /// @notice Founder-only platform emergency tuning for already-live collections.
    function setMaxRandomnessCostPerBatchWei(uint256 newCeilingWei) external onlyPlatformFounder {
        if (newCeilingWei == 0) revert RF_BadConfig();
        uint256 previous = maxRandomnessCostPerBatchWei;
        maxRandomnessCostPerBatchWei = newCeilingWei;
        emit MaxRandomnessCostPerBatchWeiSetR2(previous, newCeilingWei);
    }

    // -------------------------------------------------------------------------
    // ERC-721
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        uint256 x = uint32(interfaceId);
        unchecked {
            return (x ^ 0x01ffc9a7) * (x ^ 0x80ac58cd) * (x ^ 0x5b5e139f) * (x ^ 0x2a55205a) * (x ^ 0x49064906)
                    * (x ^ 0x7f5828d0) * (x ^ 0xe8a3d485) == 0;
        }
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert RF_ZeroAddress();
        return _balanceOf[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _ownerOf[tokenId];
        if (holder == address(0)) revert RF_NotMinted();
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _getApproved[tokenId];
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert RF_NotAuthorized();
        _getApproved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert RF_ZeroAddress();
        address holder = ownerOf(tokenId);
        if (holder != from) revert RF_WrongFrom();
        if (msg.sender != holder && msg.sender != _getApproved[tokenId] && !isApprovedForAll[holder][msg.sender]) {
            revert RF_NotAuthorized();
        }

        delete _getApproved[tokenId];
        unchecked {
            --_balanceOf[from];
            ++_balanceOf[to];
        }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            bytes4 response = IERC721ReceiverRFV1(to).onERC721Received(msg.sender, from, tokenId, data);
            if (response != IERC721ReceiverRFV1.onERC721Received.selector) revert RF_UnsafeRecipient();
        }
    }

    // -------------------------------------------------------------------------
    // Creator controls
    // -------------------------------------------------------------------------

    function setFutureRevealMode(uint8 mode) external onlyController {
        if (mode > REVEAL_FORGE || totalCommitted != 0 || delayedRevealRequested || delayedRevealed) {
            revert RF_BadConfig();
        }
        futureRevealMode = mode;
        emit FutureRevealModeSet(mode);
    }

    function setPayoutReceiver(address receiver) external onlyController {
        if (receiver == address(0)) revert RF_ZeroAddress();
        payoutReceiver = receiver;
        emit PayoutReceiverSet(receiver);
    }

    function setRoyalty(address receiver, uint96 bps) external onlyController {
        if (receiver == address(0)) revert RF_ZeroAddress();
        if (bps > 10_000) revert RF_BadRoyalty();
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltySet(receiver, bps);
        emit ContractURIUpdated();
    }

    function setRenderConfig(string calldata baseURI, bool holderEnabled, uint8 defaultMode) external onlyController {
        if (IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentSealed();
        if (defaultMode > 1) revert RF_BadRenderMode();

        flattenedRenderBaseURI = baseURI;
        holderRenderModeEnabled = holderEnabled;
        defaultRenderMode = defaultMode;
        emit RenderConfigUpdated(baseURI, holderEnabled, defaultMode);
        if (totalMinted != 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    function owner() external view returns (address) {
        return controller;
    }

    function transferOwnership(address newOwner) external onlyController {
        if (newOwner == address(0)) {
            _renounceControl();
            return;
        }

        address oldOwner = controller;
        RelicMintPhasesV2(mintPhases).transferController(newOwner);
        controller = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function renounceControl() external onlyController {
        _renounceControl();
    }

    function _renounceControl() internal {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_RenounceUnsafe();
        if (delayedRevealRequested && !delayedRevealed) revert RF_RenounceUnsafe();
        if (futureRevealMode == REVEAL_DEFERRED && totalMinted != 0 && !delayedRevealed) revert RF_RenounceUnsafe();
        if (
            RelicMintPhasesV2(mintPhases).masterMintEnabled() && totalCommitted < maxSupply
                && futureRevealMode != REVEAL_FORGE
        ) revert RF_RenounceUnsafe();

        address oldOwner = controller;
        RelicMintPhasesV2(mintPhases).renounceController();
        controller = address(0);
        emit ControllerRenounced(oldOwner);
        emit OwnershipTransferred(oldOwner, address(0));
    }

    // -------------------------------------------------------------------------
    // Minting: ownership always materializes in the mint transaction.
    // -------------------------------------------------------------------------

    function mint(uint32 phaseId, uint32 quantity, uint32 allowance, bytes32[] calldata proof)
        external
        payable
        nonReentrant
        returns (uint256 startTokenId)
    {
        if (delayedRevealRequested && !delayedRevealed) revert RFV2_DelayedRevealPendingProd();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_MINT_BATCH) revert RF_BatchLimit();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();

        (uint256 creatorPrice, uint256 platformFeeWei, bool oracleHealthy, bool feeActive) =
            RelicMintPhasesV2(mintPhases).consumeMint(msg.sender, phaseId, quantity, allowance, proof);

        uint256 required = creatorPrice;
        if (feeActive && oracleHealthy) required += platformFeeWei;
        if (msg.value < required) revert RF_WrongPrice();

        uint256 excessCreatorValue = msg.value - required;
        if (feeActive && oracleHealthy && platformFeeWei != 0) hopperBalance += platformFeeWei;
        accruedCreatorProceeds += creatorPrice + excessCreatorValue;

        startTokenId = _mintOwnership(msg.sender, quantity);
        if (futureRevealMode == REVEAL_FORGE) {
            _requestAutoRevealGroups(startTokenId, quantity);
        }

        IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this));
    }

    function creatorMint(address to, uint32 quantity)
        external
        payable
        onlyController
        nonReentrant
        returns (uint256 startTokenId)
    {
        if (to == address(0)) revert RF_ZeroAddress();
        if (delayedRevealRequested && !delayedRevealed) revert RFV2_DelayedRevealPendingProd();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_MINT_BATCH) revert RF_BatchLimit();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();

        (uint256 teamFeeWei, bool oracleHealthy, bool feeActive) =
            RelicMintPhasesV2(mintPhases).creatorTeamFeeQuote(quantity);
        uint256 required = feeActive && oracleHealthy ? teamFeeWei : 0;
        if (msg.value != required) revert RF_WrongPrice();
        if (required != 0) hopperBalance += required;

        startTokenId = _mintOwnership(to, quantity);
        if (futureRevealMode == REVEAL_FORGE) {
            _requestAutoRevealGroups(startTokenId, quantity);
        }

        IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this));
    }

    function _mintOwnership(address to, uint32 quantity) internal returns (uint256 startTokenId) {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();

        uint32 start32 = totalMinted + 1;
        startTokenId = start32;
        _balanceOf[to] += quantity;

        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = uint256(start32) + i;
            _ownerOf[tokenId] = to;
            emit Transfer(address(0), to, tokenId);
        }

        totalMinted += quantity;
        totalCommitted = totalMinted;
    }

    // -------------------------------------------------------------------------
    // Forge / automatic reveal. Each bounded group is already owned before VRF is requested.
    // -------------------------------------------------------------------------

    function _requestAutoRevealGroups(uint256 firstTokenId, uint32 quantity) internal {
        uint32 offset;
        while (offset < quantity) {
            uint32 remaining = quantity - offset;
            uint32 take = remaining > MAX_AUTO_REVEAL_GROUP_NFTS ? MAX_AUTO_REVEAL_GROUP_NFTS : remaining;
            _requestAutoRevealGroup(uint32(firstTokenId) + offset, take);
            offset += take;
        }
    }

    function _requestAutoRevealGroup(uint32 firstTokenId, uint32 quantity) internal {
        uint32 callbackGas = autoRevealCallbackGasForQuantity(quantity);
        uint256 cost = _quoteRandomnessCost(callbackGas);
        uint64 groupId = nextAutoRevealGroupId++;

        AutoRevealGroup storage group = autoRevealGroups[groupId];
        group.firstTokenId = firstTokenId;
        group.quantity = quantity;
        group.randomnessCost = cost;

        (uint256 hopperPaid, uint256 reservePaid) = _fundRandomness(groupId, cost);

        uint256 requestId = IRelicPricedRandomnessProviderV2R2Prod(randomnessProvider).requestRandomness{value: cost}(
            groupId, callbackGas
        );
        if (requestId == 0 || requestIdToAutoRevealGroupId[requestId] != 0) revert RF_BadRequest();

        group.requestId = requestId;
        group.hopperPaid = hopperPaid;
        group.reservePaid = reservePaid;
        requestIdToAutoRevealGroupId[requestId] = groupId;
        ++activeAutoRevealRequests;
        pendingAutoRevealTokens += quantity;
        totalRandomnessSpend += cost;

        emit AutoRevealRequestedR2(groupId, requestId, firstTokenId, quantity, cost, hopperPaid, reservePaid);
    }

    // -------------------------------------------------------------------------
    // Delayed reveal: exactly two normal creator transactions.
    // TX #1 prepares/funds/freeze; TX #2 performs only the bounded provider request + reconciliation.
    // -------------------------------------------------------------------------

    function prepareDelayedReveal()
        external
        onlyController
        nonReentrant
        returns (uint32 frozenSupply, uint256 preparedBudgetWei)
    {
        if (futureRevealMode != REVEAL_DEFERRED || delayedRevealRequested || delayedRevealed) {
            revert RFV2_DelayedRevealUnavailableProd();
        }
        if (totalMinted == 0 || totalCommitted != totalMinted) revert RFV2_DelayedRevealUnavailableProd();
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();

        frozenSupply = totalMinted;
        preparedBudgetWei = maxRandomnessCostPerBatchWei;

        uint256 hopperPrepared = hopperBalance < preparedBudgetWei ? hopperBalance : preparedBudgetWei;
        uint256 reservePrepared = preparedBudgetWei - hopperPrepared;

        delayedRevealSupply = frozenSupply;
        delayedRevealRequested = true;
        delayedRevealPrepared = true;
        preparedDelayedBudgetWei = preparedBudgetWei;
        preparedDelayedHopperWei = hopperPrepared;
        preparedDelayedReserveWei = reservePrepared;

        // State above is intentionally visible to Reserve.randomnessShortfallFor(0), allowing
        // the reserve to verify the exact preparation shortfall before sending any ETH.
        if (reservePrepared != 0) {
            IRelicForgeReserveV2Prod(forgeReserve).fundRandomnessShortfall(0, reservePrepared);
        }
        hopperBalance -= hopperPrepared;

        IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this));
        emit DelayedRevealPreparedR2(frozenSupply, preparedBudgetWei, hopperPrepared, reservePrepared);
    }

    function requestDelayedReveal() external onlyController nonReentrant returns (uint256 requestId) {
        if (
            futureRevealMode != REVEAL_DEFERRED || !delayedRevealRequested || !delayedRevealPrepared || delayedRevealed
                || delayedRevealRequestId != 0 || preparedDelayedBudgetWei == 0
        ) revert RFV2_DelayedRevealUnavailableProd();

        uint256 preparedBudget = preparedDelayedBudgetWei;
        requestId = IRelicPricedRandomnessProviderV2R2Prod(randomnessProvider).requestRandomness{value: preparedBudget}(
            0, DELAYED_REVEAL_CALLBACK_GAS
        );
        if (requestId == 0) revert RF_BadRequest();

        uint256 actualCost =
            IRelicPricedRandomnessProviderV2R2Prod(randomnessProvider).requestPriceForLocalRequest(requestId);
        if (actualCost == 0 || actualCost > preparedBudget) revert RF_BadRequest();

        uint256 hopperPrepared = preparedDelayedHopperWei;
        uint256 reservePrepared = preparedDelayedReserveWei;
        uint256 actualHopper = actualCost < hopperPrepared ? actualCost : hopperPrepared;
        uint256 actualReserve = actualCost - actualHopper;
        if (actualReserve > reservePrepared) revert RF_BadRequest();

        uint256 hopperRefund = hopperPrepared - actualHopper;
        uint256 reserveRefund = reservePrepared - actualReserve;

        delayedRevealPrepared = false;
        delayedRevealRequestId = requestId;
        preparedDelayedBudgetWei = 0;
        preparedDelayedHopperWei = 0;
        preparedDelayedReserveWei = 0;

        if (hopperRefund != 0) hopperBalance += hopperRefund;
        // Keep TX #2 small for delegated/smart-account wallets. Any unused prepared Reserve
        // subsidy is held separately and returned automatically from the reveal callback.
        pendingDelayedReserveRefundWei = reserveRefund;

        totalRandomnessSpend += actualCost;
        totalReserveSubsidy += actualReserve;

        // Preparation was conservative. Reconciliation only decreases or finalizes liabilities.
        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}
        emit DelayedRevealRequested(requestId, delayedRevealSupply, actualCost);
    }

    /// @notice Advanced recovery only: cancel a prepared delayed reveal before TX #2.
    function cancelPreparedDelayedReveal() external onlyController nonReentrant {
        if (!delayedRevealPrepared || delayedRevealRequestId != 0 || delayedRevealed) revert RF_BadRequest();

        uint32 frozenSupply = delayedRevealSupply;
        uint256 hopperRestore = preparedDelayedHopperWei;
        uint256 reserveRefund = preparedDelayedReserveWei;

        delayedRevealRequested = false;
        delayedRevealPrepared = false;
        delayedRevealSupply = 0;
        preparedDelayedBudgetWei = 0;
        preparedDelayedHopperWei = 0;
        preparedDelayedReserveWei = 0;

        if (hopperRestore != 0) hopperBalance += hopperRestore;
        if (reserveRefund != 0) {
            IRelicForgeReserveV2R2Prod(forgeReserve).refundRandomnessSubsidy{value: reserveRefund}(0);
        }

        IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this));
        emit DelayedRevealPreparationCancelledR2(frozenSupply, hopperRestore, reserveRefund);
    }

    function _quoteRandomnessCost(uint32 consumerCallbackGas) internal view returns (uint256 cost) {
        cost = IRelicPricedRandomnessProviderV2R2Prod(randomnessProvider).quoteRequestPrice(consumerCallbackGas);
        if (cost == 0 || cost > maxRandomnessCostPerBatchWei) revert RFV2_RandomnessQuoteTooHighProd();
    }

    function _fundRandomness(uint64 reserveKey, uint256 cost)
        internal
        returns (uint256 hopperPaid, uint256 reservePaid)
    {
        hopperPaid = hopperBalance < cost ? hopperBalance : cost;
        reservePaid = cost - hopperPaid;

        if (reservePaid != 0) {
            IRelicForgeReserveV2Prod(forgeReserve).fundRandomnessShortfall(reserveKey, reservePaid);
            totalReserveSubsidy += reservePaid;
        }

        hopperBalance -= hopperPaid;
    }

    // -------------------------------------------------------------------------
    // Verified randomness delivery. Ownership already exists; callback assigns metadata only.
    // -------------------------------------------------------------------------

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();

        if (delayedRevealRequested && !delayedRevealed && requestId == delayedRevealRequestId) {
            _completeDelayedReveal(requestId, randomWord);
            return;
        }

        uint64 groupId = requestIdToAutoRevealGroupId[requestId];
        if (groupId == 0) revert RF_BadRequest();

        AutoRevealGroup storage group = autoRevealGroups[groupId];
        if (group.requestId != requestId || group.revealed) revert RF_BadRequest();
        group.revealed = true;

        uint32 quantity = group.quantity;
        uint32 firstTokenId = group.firstTokenId;
        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = uint256(firstTokenId) + i;
            if (_ownerOf[tokenId] == address(0) || assignedRecipePlusOne[tokenId] != 0) revert RF_BadRequest();

            uint256 entropy = uint256(keccak256(abi.encode(randomWord, address(this), groupId, tokenId)));
            uint256 recipe = _drawForgeRecipe(entropy);
            assignedRecipePlusOne[tokenId] = recipe + 1;
            ++totalAssignedRecipes;
            emit MetadataUpdate(tokenId);
        }

        --activeAutoRevealRequests;
        pendingAutoRevealTokens -= quantity;
        emit AutoRevealCompletedR2(groupId, requestId, firstTokenId, quantity);

        _markCompletedIfReady();
        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}
    }

    function _completeDelayedReveal(uint256 requestId, uint256 randomWord) internal {
        if (delayedRevealPrepared || delayedRevealRequestId == 0 || delayedRevealSupply == 0) revert RF_BadRequest();

        (uint256 multiplier, uint256 offset) = RFRevealPermutationV2.derive(randomWord, maxSupply);
        delayedRevealSeed = randomWord;
        delayedRevealMultiplier = multiplier;
        delayedRevealOffset = offset;
        delayedRevealed = true;
        totalAssignedRecipes = delayedRevealSupply;

        bool switchToForge = totalMinted < maxSupply;
        if (switchToForge) {
            futureRevealMode = REVEAL_FORGE;
            hybridForgeActive = true;
            emit FutureRevealModeSet(REVEAL_FORGE);
        }

        emit DelayedRevealCompleted(requestId, delayedRevealSupply, randomWord, multiplier, offset, switchToForge);
        emit BatchMetadataUpdate(1, delayedRevealSupply);
        _markCompletedIfReady();
        _attemptPendingReserveRefund();
        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}
    }

    /// @notice Advanced recovery: permissionlessly retry returning any unused delayed-reveal Reserve preparation.
    function flushPendingReserveRefund() external nonReentrant returns (bool refunded) {
        refunded = _attemptPendingReserveRefund();
        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}
    }

    function _attemptPendingReserveRefund() internal returns (bool refunded) {
        uint256 amount = pendingDelayedReserveRefundWei;
        if (amount == 0) return true;

        pendingDelayedReserveRefundWei = 0;
        try IRelicForgeReserveV2R2Prod(forgeReserve).refundRandomnessSubsidy{value: amount}(0) {
            return true;
        } catch {
            pendingDelayedReserveRefundWei = amount;
            return false;
        }
    }

    function _drawForgeRecipe(uint256 entropy) internal returns (uint256 recipe) {
        uint256 forgeBase = hybridForgeActive ? delayedRevealSupply : 0;
        uint256 forgeDomain = uint256(maxSupply) - forgeBase;
        uint256 alreadyForgeAssigned = uint256(totalAssignedRecipes) - forgeBase;
        uint256 remaining = forgeDomain - alreadyForgeAssigned;
        if (remaining == 0) revert RF_NoRecipes();

        uint256 pick = entropy % remaining;
        uint256 selected = _forgePoolValue(pick);
        uint256 lastIndex = remaining - 1;

        if (pick != lastIndex) {
            uint256 last = _forgePoolValue(lastIndex);
            _forgePoolSwapPlusOne[pick] = last + 1;
        }

        if (hybridForgeActive) {
            uint256 permutationIndex = uint256(delayedRevealSupply) + selected;
            recipe = RFRevealPermutationV2.permute(
                permutationIndex, maxSupply, delayedRevealMultiplier, delayedRevealOffset
            );
        } else {
            recipe = selected;
        }
    }

    function _forgePoolValue(uint256 index) internal view returns (uint256) {
        uint256 stored = _forgePoolSwapPlusOne[index];
        return stored == 0 ? index : stored - 1;
    }

    // -------------------------------------------------------------------------
    // One collection hopper / canonical Reserve accounting.
    // -------------------------------------------------------------------------

    /// @dev reserveKey 0 is delayed reveal preparation; positive keys are automatic reveal groups.
    function randomnessShortfallFor(uint64 reserveKey) public view override returns (uint256) {
        if (reserveKey == 0) {
            if (delayedRevealPrepared && delayedRevealRequestId == 0) return preparedDelayedReserveWei;
            if (futureRevealMode != REVEAL_DEFERRED || delayedRevealRequested || delayedRevealed || totalMinted == 0) {
                return 0;
            }

            uint256 obligation = maxRandomnessCostPerBatchWei;
            return obligation > hopperBalance ? obligation - hopperBalance : 0;
        }

        AutoRevealGroup storage group = autoRevealGroups[reserveKey];
        if (group.quantity == 0 || group.requestId != 0 || group.revealed || group.randomnessCost == 0) return 0;
        return group.randomnessCost > hopperBalance ? group.randomnessCost - hopperBalance : 0;
    }

    function reserveExposureWei() public view override returns (uint256) {
        // Automatic groups are fully funded atomically in the mint transaction. Only an existing
        // deferred/unrevealed collection creates a future unpaid reveal obligation.
        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealRequested && !delayedRevealed && totalMinted != 0) {
            return maxRandomnessCostPerBatchWei > hopperBalance ? maxRandomnessCostPerBatchWei - hopperBalance : 0;
        }
        return 0;
    }

    function restrictedSponsoredLiabilityWei() public pure override returns (uint256) {
        // R2 intentionally does not trap hopper funds for hypothetical future mints.
        // Only concrete outstanding reveal obligations are protected below.
        return 0;
    }

    function activeForgeBatchCount() public view override returns (uint256 count) {
        count = activeAutoRevealRequests;
        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealed && totalMinted != 0) ++count;
    }

    function protectedHopperWei() public view returns (uint256) {
        if (completed) return 0;
        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealRequested && !delayedRevealed && totalMinted != 0) {
            return hopperBalance < maxRandomnessCostPerBatchWei ? hopperBalance : maxRandomnessCostPerBatchWei;
        }
        return 0;
    }

    function sweepableHopperWei() public view returns (uint256) {
        uint256 protected = protectedHopperWei();
        return hopperBalance > protected ? hopperBalance - protected : 0;
    }

    function sweepExcessToReserve() external override nonReentrant returns (uint256 amount) {
        if (msg.sender != forgeReserve) revert RFV2_HopperSweepUnauthorizedProd();

        amount = sweepableHopperWei();
        if (amount == 0) return 0;

        hopperBalance -= amount;
        totalSweptToReserve += amount;
        IRelicForgeReserveV2Prod(forgeReserve).depositFromCollection{value: amount}();
        emit HopperSweptToReserve(amount, hopperBalance);
    }

    // -------------------------------------------------------------------------
    // Metadata / rendering / payouts
    // -------------------------------------------------------------------------

    function recipeForToken(uint256 tokenId) public view returns (uint256 recipe) {
        ownerOf(tokenId);

        if (delayedRevealed && tokenId <= delayedRevealSupply) {
            return RFRevealPermutationV2.permute(tokenId - 1, maxSupply, delayedRevealMultiplier, delayedRevealOffset);
        }

        uint256 p = assignedRecipePlusOne[tokenId];
        if (p == 0) revert RF_NotRevealed();
        return p - 1;
    }

    function isRevealed(uint256 tokenId) public view returns (bool) {
        if (_ownerOf[tokenId] == address(0)) return false;
        if (delayedRevealed && tokenId <= delayedRevealSupply) return true;
        return assignedRecipePlusOne[tokenId] != 0;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return IRelicRendererV1(renderer).tokenURI(address(this), tokenId);
    }

    function contractURI() external view returns (string memory) {
        return IRelicRendererV1(renderer).contractURI(address(this));
    }

    function renderToken(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return IRelicRendererV1(renderer).renderToken(address(this), tokenId);
    }

    function renderMode(uint256 tokenId) public view returns (uint8) {
        return _tokenRenderModeSet[tokenId] ? _tokenRenderMode[tokenId] : defaultRenderMode;
    }

    function setTokenRenderMode(uint256 tokenId, uint8 mode) external {
        if (!holderRenderModeEnabled || mode > 1) revert RF_BadRenderMode();
        if (ownerOf(tokenId) != msg.sender) revert RF_NotTokenOwner();

        _tokenRenderMode[tokenId] = mode;
        _tokenRenderModeSet[tokenId] = true;
        emit RenderModeUpdated(tokenId, mode);
        emit MetadataUpdate(tokenId);
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        receiver = royaltyReceiver;
        uint256 quotient = salePrice / 10_000;
        uint256 remainder = salePrice % 10_000;
        royaltyAmount = quotient * royaltyBps + (remainder * royaltyBps) / 10_000;
    }

    function withdraw() external nonReentrant {
        uint256 amount = accruedCreatorProceeds;
        if (amount == 0) return;

        address receiver = payoutReceiver;
        if (receiver == address(0)) revert RF_InvalidRecipient();

        accruedCreatorProceeds = 0;
        (bool ok,) = payable(receiver).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();
        emit CreatorProceedsWithdrawn(receiver, amount);
    }

    function pendingSupply() external pure returns (uint32) {
        // R2 never has reserved-but-not-owned supply.
        return 0;
    }

    function availableSupply() external view returns (uint32) {
        return maxSupply - totalMinted;
    }

    function _markCompletedIfReady() internal {
        if (completed) return;
        if (
            totalMinted == maxSupply && totalAssignedRecipes == maxSupply && activeAutoRevealRequests == 0
                && pendingAutoRevealTokens == 0 && (!delayedRevealRequested || delayedRevealed)
        ) {
            completed = true;
            emit CollectionCompleted(totalMinted, hopperBalance);
        }
    }

    receive() external payable {
        if (msg.sender != forgeReserve && msg.sender != randomnessProvider) revert RF_BadRequest();
    }
}
