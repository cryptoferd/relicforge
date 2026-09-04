// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";
import "./RFRevealPermutationV2.sol";
import "./RelicMintPhasesV2.sol";

/// @title RelicCollectionV2
/// @notice Relic Forge V2 ERC-721 collection implementation for Factory minimal-proxy clones.
/// @dev R12 SEPOLIA PRODUCTION CANDIDATE. NOT AUDITED. NOT MAINNET-ACTIVATED.
///
/// Reveal policy:
/// - Deferred mode mints ordinary hidden sequential ERC-721s.
/// - One delayed-reveal VRF word fixes a collection-wide O(1)-state bijection.
/// - If delayed reveal occurs before sellout, all future mints irreversibly become Forge Reveal.
/// - Future Forge assignments draw only from the complement of the delayed permutation domain,
///   so recipes already consumed by delayed reveal can never be drawn again.
///
/// Forge policy:
/// - Collector transactions never call the randomness provider.
/// - Reservations lock into <=20 NFT batches.
/// - A later permissionless executor requests VRF.
/// - The provider adapter stores the exact word upstream and later replays it.
/// - This collection callback stores only the delivered word.
/// - A later permissionless settleReady() transaction mints/assigns the NFTs in batch order.
contract RelicCollectionV2 is IRelicRandomnessConsumerV1, IRelicForgeReserveCollectionV2Prod {
    using RFStringsV1 for uint256;

    uint32 public constant MAX_MINT_BATCH = 50;
    uint32 public constant MAX_FORGE_BATCH_NFTS = 20;
    uint32 public constant HOPPER_RUNWAY_BATCHES = 10;
    uint32 public constant WORD_DELIVERY_ENVELOPE_GAS = 400_000;

    uint8 public constant REVEAL_DEFERRED = 0;
    uint8 public constant REVEAL_FORGE = 1;
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    struct Reservation {
        address payer;
        address recipient;
        uint32 quantity;
        uint256 creatorValue;
        bool creatorTeamMint;
        bool settled;
    }

    struct ForgeBatch {
        uint64 firstReservationId;
        uint64 lastReservationId;
        uint64 openedAt;
        uint64 lockedAt;
        uint32 reservationCount;
        uint32 totalQuantity;
        uint256 randomnessCost;
        uint256 requestId;
        uint256 randomWord;
        bool locked;
        bool wordReady;
        bool settled;
    }

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event ContractURIUpdated();

    event FutureRevealModeSet(uint8 mode);
    event DelayedRevealRequested(uint256 indexed requestId, uint32 revealedSupply, uint256 randomnessCost);
    event DelayedRevealCompleted(
        uint256 indexed requestId,
        uint32 revealedSupply,
        uint256 seed,
        uint256 multiplier,
        uint256 offset,
        bool futureMintsSwitchedToForge
    );
    event ForgeReservationCreated(
        uint64 indexed reservationId,
        uint64 indexed batchId,
        address indexed payer,
        address recipient,
        uint32 quantity,
        uint256 creatorValue,
        bool creatorTeamMint
    );
    event ForgeBatchLocked(uint64 indexed batchId, uint32 reservationCount, uint32 totalQuantity, bool full);
    event ForgeRandomnessRequested(
        uint64 indexed batchId,
        uint256 indexed requestId,
        uint256 randomnessCost,
        uint256 hopperPaid,
        uint256 reservePaid
    );
    event ForgeBatchRandomnessReady(uint64 indexed batchId, uint256 indexed requestId);
    event ForgeBatchSettled(
        uint64 indexed batchId, uint256 indexed requestId, uint32 reservationCount, uint32 totalQuantity
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
    uint256 public creatorEscrow;
    uint256 public accruedCreatorProceeds;
    uint256 public totalRandomnessSpend;
    uint256 public totalReserveSubsidy;
    uint256 public totalSweptToReserve;

    bool public delayedRevealRequested;
    bool public delayedRevealed;
    uint32 public delayedRevealSupply;
    uint256 public delayedRevealRequestId;
    uint256 public delayedRevealSeed;
    uint256 public delayedRevealMultiplier;
    uint256 public delayedRevealOffset;
    bool public hybridForgeActive;

    uint64 public nextReservationId;
    uint64 public openBatchId;
    uint64 public nextSettleBatchId;
    uint32 public unrequestedLockedBatches;
    uint32 public lockedUnsettledBatches;
    bool public completed;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    mapping(uint256 => uint256) public assignedRecipePlusOne;
    mapping(uint256 => uint256) private _forgePoolSwapPlusOne;

    mapping(uint64 => Reservation) public reservations;
    mapping(uint64 => ForgeBatch) public batches;
    mapping(uint256 => uint64) public requestIdToBatchId;

    mapping(uint256 => uint8) private _tokenRenderMode;
    mapping(uint256 => bool) private _tokenRenderModeSet;

    bool private _initialized;
    uint256 private _entered;

    modifier onlyController() {
        if (controller == address(0)) revert RF_Renounced();
        if (msg.sender != controller) revert RF_NotController();
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
        if (init_.batchWindowSeconds == 0 || init_.maxRandomnessCostPerBatchWei == 0) revert RF_BadConfig();
        if (init_.feeMode == FEE_MODE_MINTER_SUPPORTED && msg.value != 0) revert RF_WrongPrice();

        _initialized = true;
        factory = msg.sender;

        // EIP-1167 clones start with zeroed storage. Implementation constructors and
        // inline storage initializers do NOT initialize clone storage.
        nextReservationId = 1;
        openBatchId = 1;
        nextSettleBatchId = 1;

        name = init_.name;
        symbol = init_.symbol;
        description = init_.description;
        creator = init_.creator;
        controller = init_.creator;
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
        batchWindowSeconds = init_.batchWindowSeconds;
        maxRandomnessCostPerBatchWei = init_.maxRandomnessCostPerBatchWei;

        if (init_.feeMode == FEE_MODE_SPONSORED) {
            sponsoredPrepaidWei = msg.value;
            hopperBalance = msg.value;
        }

        emit PlatformFeeTermsConfigured(init_.feePolicy, init_.feeMode, init_.lockedFeeCents);
        emit MintPhasesBound(init_.mintPhases);
    }

    // -------------------------------------------------------------------------
    // ERC-721
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f
            || interfaceId == 0x2a55205a || interfaceId == 0x49064906;
    }

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert RF_ZeroAddress();
        return _balanceOf[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _ownerOf[tokenId];
        if (holder == address(0)) revert RF_NotMinted();
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && !isApprovedForAll[holder][msg.sender]) revert RF_NotAuthorized();
        getApproved[tokenId] = to;
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
        if (msg.sender != holder && msg.sender != getApproved[tokenId] && !isApprovedForAll[holder][msg.sender]) {
            revert RF_NotAuthorized();
        }

        delete getApproved[tokenId];
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

    /// @notice Reveal mode can be chosen while the collection is empty.
    ///         After the first accepted mint it is locked, except for the automatic Deferred -> Forge transition.
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

    function renounceControl() external onlyController {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_RenounceUnsafe();
        if (delayedRevealRequested && !delayedRevealed) revert RF_RenounceUnsafe();
        if (futureRevealMode == REVEAL_DEFERRED && totalMinted != 0 && !delayedRevealed) revert RF_RenounceUnsafe();
        if (
            RelicMintPhasesV2(mintPhases).masterMintEnabled() && totalCommitted < maxSupply
                && futureRevealMode != REVEAL_FORGE
        ) revert RF_RenounceUnsafe();

        RelicMintPhasesV2(mintPhases).renounceController();
        controller = address(0);
        emit ControllerRenounced(creator);
    }

    // -------------------------------------------------------------------------
    // Fee quotes / minting
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
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        (uint256 creatorPrice, uint256 platformFeeWei, bool oracleHealthy, bool feeActive) =
            RelicMintPhasesV2(mintPhases).consumeMint(msg.sender, phaseId, quantity, allowance, proof);

        uint256 required = creatorPrice;
        if (feeActive && oracleHealthy) required += platformFeeWei;
        if (msg.value < required) revert RF_WrongPrice();

        uint256 excessCreatorValue = msg.value - required;
        if (feeActive && oracleHealthy && platformFeeWei != 0) hopperBalance += platformFeeWei;

        if (futureRevealMode == REVEAL_DEFERRED) {
            startTokenId = _mintDeferred(msg.sender, quantity);
            accruedCreatorProceeds += creatorPrice + excessCreatorValue;
        } else {
            _queueForgeReservation(msg.sender, msg.sender, quantity, creatorPrice + excessCreatorValue, false);
        }
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
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        (uint256 teamFeeWei, bool oracleHealthy, bool feeActive) =
            RelicMintPhasesV2(mintPhases).creatorTeamFeeQuote(quantity);
        uint256 required = feeActive && oracleHealthy ? teamFeeWei : 0;
        if (msg.value != required) revert RF_WrongPrice();
        if (required != 0) hopperBalance += required;

        if (futureRevealMode == REVEAL_DEFERRED) {
            startTokenId = _mintDeferred(to, quantity);
        } else {
            _queueForgeReservation(msg.sender, to, quantity, 0, true);
        }
    }

    function _mintDeferred(address to, uint32 quantity) internal returns (uint256 startTokenId) {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint32 start32 = totalMinted + 1;
        startTokenId = start32;
        _balanceOf[to] += quantity;

        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = uint256(start32) + i;
            _ownerOf[tokenId] = to;
            emit Transfer(address(0), to, tokenId);
        }

        totalCommitted += quantity;
        totalMinted += quantity;
    }

    // -------------------------------------------------------------------------
    // Cheap delayed reveal
    // -------------------------------------------------------------------------

    function requestDelayedReveal() external onlyController nonReentrant returns (uint256 requestId) {
        if (futureRevealMode != REVEAL_DEFERRED || delayedRevealRequested || delayedRevealed) {
            revert RFV2_DelayedRevealUnavailableProd();
        }
        if (totalMinted == 0 || totalCommitted != totalMinted) revert RFV2_DelayedRevealUnavailableProd();
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();

        uint256 cost = _quoteRandomnessCost();
        (uint256 hopperPaid, uint256 reservePaid) = _fundRandomness(0, cost);

        delayedRevealRequested = true;
        delayedRevealSupply = totalMinted;

        requestId = IRelicPricedRandomnessProviderV2Prod(randomnessProvider).requestRandomness{value: cost}(
            0, WORD_DELIVERY_ENVELOPE_GAS
        );
        if (requestId == 0) revert RF_BadRequest();

        delayedRevealRequestId = requestId;
        totalRandomnessSpend += cost;
        emit DelayedRevealRequested(requestId, delayedRevealSupply, cost);

        hopperPaid;
        reservePaid;
    }

    // -------------------------------------------------------------------------
    // Forge queue
    // -------------------------------------------------------------------------

    function _queueForgeReservation(
        address payer,
        address recipient,
        uint32 quantity,
        uint256 totalCreatorValue,
        bool teamMint
    ) internal {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();

        uint32 remaining = quantity;
        uint256 remainingCreatorValue = totalCreatorValue;

        while (remaining != 0) {
            ForgeBatch storage batch = batches[openBatchId];
            uint32 capacity = MAX_FORGE_BATCH_NFTS - batch.totalQuantity;
            uint32 take = remaining < capacity ? remaining : capacity;

            uint64 reservationId = nextReservationId++;
            if (batch.firstReservationId == 0) {
                batch.firstReservationId = reservationId;
                batch.openedAt = uint64(block.timestamp);
            }
            batch.lastReservationId = reservationId;
            ++batch.reservationCount;
            batch.totalQuantity += take;

            uint256 creatorValue;
            if (remaining == take) {
                creatorValue = remainingCreatorValue;
            } else if (remainingCreatorValue != 0) {
                creatorValue = (totalCreatorValue * take) / quantity;
                if (creatorValue > remainingCreatorValue) creatorValue = remainingCreatorValue;
            }
            remainingCreatorValue -= creatorValue;

            reservations[reservationId] = Reservation({
                payer: payer,
                recipient: recipient,
                quantity: take,
                creatorValue: creatorValue,
                creatorTeamMint: teamMint,
                settled: false
            });

            totalCommitted += take;
            creatorEscrow += creatorValue;

            emit ForgeReservationCreated(reservationId, openBatchId, payer, recipient, take, creatorValue, teamMint);

            remaining -= take;
            if (batch.totalQuantity == MAX_FORGE_BATCH_NFTS) _lockOpenBatch(true);
        }

        if (totalCommitted == maxSupply) {
            ForgeBatch storage finalOpen = batches[openBatchId];
            if (finalOpen.totalQuantity != 0 && !finalOpen.locked) _lockOpenBatch(false);
        }
    }

    function lockTimedOutBatch() external returns (uint64 batchId) {
        batchId = openBatchId;
        ForgeBatch storage batch = batches[batchId];
        if (batch.totalQuantity == 0 || batch.locked) revert RF_BadRequest();
        if (block.timestamp < uint256(batch.openedAt) + batchWindowSeconds) revert RF_PhaseNotStarted();
        _lockOpenBatch(false);
    }

    function _lockOpenBatch(bool full) internal {
        uint64 batchId = openBatchId;
        ForgeBatch storage batch = batches[batchId];
        if (batch.totalQuantity == 0 || batch.locked) revert RF_BadRequest();

        batch.locked = true;
        batch.lockedAt = uint64(block.timestamp);
        ++unrequestedLockedBatches;
        ++lockedUnsettledBatches;

        emit ForgeBatchLocked(batchId, batch.reservationCount, batch.totalQuantity, full);
        unchecked {
            ++openBatchId;
        }
    }

    function requestRandomnessForBatch(uint64 batchId) external nonReentrant returns (uint256 requestId) {
        ForgeBatch storage batch = batches[batchId];
        if (!batch.locked) revert RFV2_BatchNotLockedProd();
        if (batch.requestId != 0) revert RFV2_BatchAlreadyRequestedProd();
        if (batch.settled) revert RF_BadRequest();

        uint256 cost = _quoteRandomnessCost();
        (uint256 hopperPaid, uint256 reservePaid) = _fundRandomness(batchId, cost);

        requestId = IRelicPricedRandomnessProviderV2Prod(randomnessProvider).requestRandomness{value: cost}(
            batchId, WORD_DELIVERY_ENVELOPE_GAS
        );
        if (requestId == 0 || requestIdToBatchId[requestId] != 0) revert RF_BadRequest();

        batch.randomnessCost = cost;
        batch.requestId = requestId;
        requestIdToBatchId[requestId] = batchId;
        --unrequestedLockedBatches;
        totalRandomnessSpend += cost;

        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}

        emit ForgeRandomnessRequested(batchId, requestId, cost, hopperPaid, reservePaid);
    }

    function _quoteRandomnessCost() internal view returns (uint256 cost) {
        cost = IRelicPricedRandomnessProviderV2Prod(randomnessProvider).quoteRequestPrice(WORD_DELIVERY_ENVELOPE_GAS);
        if (cost > maxRandomnessCostPerBatchWei) revert RFV2_RandomnessQuoteTooHighProd();
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
    // Exact-word delivery / settlement
    // -------------------------------------------------------------------------

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();

        if (delayedRevealRequested && !delayedRevealed && requestId == delayedRevealRequestId) {
            (uint256 multiplier, uint256 offset) = RFRevealPermutationV2.derive(randomWord, maxSupply);

            delayedRevealSeed = randomWord;
            delayedRevealMultiplier = multiplier;
            delayedRevealOffset = offset;
            delayedRevealed = true;
            totalAssignedRecipes = delayedRevealSupply;

            bool switchToForge = totalCommitted < maxSupply;
            if (switchToForge) {
                futureRevealMode = REVEAL_FORGE;
                hybridForgeActive = true;
                emit FutureRevealModeSet(REVEAL_FORGE);
            }

            emit DelayedRevealCompleted(requestId, delayedRevealSupply, randomWord, multiplier, offset, switchToForge);
            emit BatchMetadataUpdate(1, delayedRevealSupply);
            _markCompletedIfReady();
            return;
        }

        uint64 batchId = requestIdToBatchId[requestId];
        if (batchId == 0) revert RF_BadRequest();

        ForgeBatch storage batch = batches[batchId];
        if (!batch.locked || batch.requestId == 0 || batch.settled) revert RF_BadRequest();
        if (batch.wordReady) revert RF_AlreadyFulfilled();

        batch.wordReady = true;
        batch.randomWord = randomWord;
        emit ForgeBatchRandomnessReady(batchId, requestId);
    }

    function settleReady(uint32 maxTokens) external returns (uint32 tokensSettled) {
        if (maxTokens == 0) revert RF_ZeroQuantity();

        uint64 batchId = nextSettleBatchId;
        while (batchId < openBatchId) {
            ForgeBatch storage batch = batches[batchId];

            if (batch.settled) {
                unchecked {
                    ++batchId;
                }
                nextSettleBatchId = batchId;
                continue;
            }

            if (!batch.wordReady) break;
            if (uint256(tokensSettled) + batch.totalQuantity > maxTokens) break;

            _settleBatch(batchId, batch);
            tokensSettled += batch.totalQuantity;

            unchecked {
                ++batchId;
            }
            nextSettleBatchId = batchId;
        }

        _markCompletedIfReady();
        try IRelicForgeReserveV2Prod(forgeReserve).syncCollection(address(this)) {} catch {}
    }

    function _settleBatch(uint64 batchId, ForgeBatch storage batch) internal {
        batch.settled = true;
        --lockedUnsettledBatches;

        uint32 mintedThisBatch;

        for (
            uint64 reservationId = batch.firstReservationId; reservationId <= batch.lastReservationId; ++reservationId) {
            Reservation storage reservation = reservations[reservationId];
            if (reservation.settled) revert RF_BadRequest();
            reservation.settled = true;

            if (reservation.creatorValue != 0) {
                creatorEscrow -= reservation.creatorValue;
                accruedCreatorProceeds += reservation.creatorValue;
            }

            _balanceOf[reservation.recipient] += reservation.quantity;

            for (uint32 i; i < reservation.quantity; ++i) {
                uint256 entropy = uint256(
                    keccak256(
                        abi.encode(batch.randomWord, address(this), batchId, reservationId, i, reservation.recipient)
                    )
                );

                uint256 tokenId = uint256(totalMinted) + mintedThisBatch + 1;
                uint256 recipe = _drawForgeRecipe(entropy);

                _ownerOf[tokenId] = reservation.recipient;
                assignedRecipePlusOne[tokenId] = recipe + 1;
                ++totalAssignedRecipes;
                ++mintedThisBatch;

                emit Transfer(address(0), reservation.recipient, tokenId);
                emit MetadataUpdate(tokenId);
            }

            if (reservationId == batch.lastReservationId) break;
        }

        totalMinted += mintedThisBatch;
        emit ForgeBatchSettled(batchId, batch.requestId, batch.reservationCount, batch.totalQuantity);
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
    // Reserve / hopper
    // -------------------------------------------------------------------------

    /// @dev batchId 0 is the delayed-reveal obligation.
    function randomnessShortfallFor(uint64 batchId) public view override returns (uint256) {
        if (batchId == 0) {
            if (futureRevealMode != REVEAL_DEFERRED || delayedRevealRequested || delayedRevealed || totalMinted == 0) {
                return 0;
            }
        } else {
            ForgeBatch storage batch = batches[batchId];
            if (!batch.locked || batch.requestId != 0 || batch.settled) return 0;
        }

        uint256 cost =
            IRelicPricedRandomnessProviderV2Prod(randomnessProvider).quoteRequestPrice(WORD_DELIVERY_ENVELOPE_GAS);
        if (cost > maxRandomnessCostPerBatchWei) return 0;
        return cost > hopperBalance ? cost - hopperBalance : 0;
    }

    function reserveExposureWei() public view override returns (uint256) {
        uint256 obligationCount = unrequestedLockedBatches;

        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++obligationCount;

        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealRequested && !delayedRevealed && totalMinted != 0) {
            ++obligationCount;
        }

        uint256 gross = obligationCount * maxRandomnessCostPerBatchWei;
        return gross > hopperBalance ? gross - hopperBalance : 0;
    }

    function restrictedSponsoredLiabilityWei() public view override returns (uint256) {
        if (platformFeeMode != FEE_MODE_SPONSORED || completed || sponsoredPrepaidWei == 0) return 0;

        uint256 currentOperationalTarget = _currentOperationalObligationCount() * maxRandomnessCostPerBatchWei;
        uint256 hopperAfterCurrent =
            hopperBalance > currentOperationalTarget ? hopperBalance - currentOperationalTarget : 0;

        uint256 uncommitted = uint256(maxSupply) - totalCommitted;
        uint256 futurePrepaid = (sponsoredPrepaidWei * uncommitted) / maxSupply;

        return futurePrepaid > hopperAfterCurrent ? futurePrepaid - hopperAfterCurrent : 0;
    }

    function activeForgeBatchCount() public view override returns (uint256 count) {
        count = lockedUnsettledBatches;

        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++count;

        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealed && (totalMinted != 0 || delayedRevealRequested)) {
            ++count;
        }
    }

    function protectedHopperWei() public view returns (uint256) {
        if (completed) return 0;

        uint256 protectedCount = _currentOperationalObligationCount();

        if (futureRevealMode == REVEAL_FORGE) {
            uint256 remainingUncommitted = uint256(maxSupply) - totalCommitted;
            uint256 futureBatches = (remainingUncommitted + MAX_FORGE_BATCH_NFTS - 1) / MAX_FORGE_BATCH_NFTS;
            if (futureBatches > HOPPER_RUNWAY_BATCHES) futureBatches = HOPPER_RUNWAY_BATCHES;
            protectedCount += futureBatches;
        }

        uint256 target = protectedCount * maxRandomnessCostPerBatchWei;
        uint256 restricted = restrictedSponsoredLiabilityWei();
        if (type(uint256).max - target < restricted) return hopperBalance;
        target += restricted;

        return target < hopperBalance ? target : hopperBalance;
    }

    function _currentOperationalObligationCount() internal view returns (uint256 count) {
        count = unrequestedLockedBatches;

        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++count;

        if (futureRevealMode == REVEAL_DEFERRED && !delayedRevealRequested && !delayedRevealed && totalMinted != 0) {
            ++count;
        }
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
    // Metadata / payouts
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

    string public flattenedRenderBaseURI;
    bool public holderRenderModeEnabled;
    uint8 public defaultRenderMode;

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

    function pendingSupply() external view returns (uint32) {
        return totalCommitted - totalMinted;
    }

    function availableSupply() external view returns (uint32) {
        return maxSupply - totalCommitted;
    }

    function _markCompletedIfReady() internal {
        if (completed) return;

        bool revealComplete = delayedRevealSupply == 0 || delayedRevealed || hybridForgeActive;
        if (
            totalCommitted == maxSupply && totalMinted == maxSupply && totalAssignedRecipes == maxSupply
                && lockedUnsettledBatches == 0 && batches[openBatchId].totalQuantity == 0 && revealComplete
        ) {
            completed = true;
            emit CollectionCompleted(totalMinted, hopperBalance);
        }
    }

    receive() external payable {
        if (msg.sender != forgeReserve) revert RF_BadRequest();
    }
}
