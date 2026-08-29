// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";

/**
 * @title RelicCollectionV1
 * @notice RelicForge ERC-721 collection engine with creator-controlled mint phases and hybrid reveal.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */
contract RelicCollectionV1 is IRelicRandomnessConsumerV1 {
    using RFStringsV1 for uint256;

    uint32 public constant MAX_MINT_BATCH = 50;
    uint8 public constant ACCESS_PUBLIC = 0;
    uint8 public constant ACCESS_MERKLE = 1;
    uint8 public constant REVEAL_DEFERRED = 0;
    uint8 public constant REVEAL_FORGE = 1;
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    enum RequestKind { None, ForgeBatch, EpochRange }

    struct MintPhase {
        uint96 price;
        uint64 startTime;
        uint64 endTime; // 0 = no automatic end
        uint32 phaseSupply; // 0 = no phase-specific cap
        uint32 minted;
        uint32 maxPerWallet; // 0 = unlimited within phase/allowance
        bytes32 merkleRoot;
        uint8 accessType;
        uint16 priority;
        bool enabled;
    }

    struct RevealRequest {
        RequestKind kind;
        uint64 startTokenId;
        uint64 endTokenId;
        uint64 cursor;
        uint32 assignmentNonce;
        bool fulfilled;
        uint256 seed;
    }

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event ContractURIUpdated();

    event MasterMintSet(bool enabled);
    event PhaseCreated(uint32 indexed phaseId, uint8 accessType, uint96 price, uint16 priority);
    event PhaseUpdated(uint32 indexed phaseId);
    event PhaseEnabled(uint32 indexed phaseId, bool enabled);
    event FutureRevealModeSet(uint8 mode);
    event RevealRequested(uint64 indexed sequence, uint256 indexed requestId, RequestKind kind, uint64 startTokenId, uint64 endTokenId);
    event RevealRandomnessStored(uint64 indexed sequence, uint256 indexed requestId);
    event RevealRequestProcessed(uint64 indexed sequence);
    event ControllerRenounced(address indexed creator);
    event PayoutReceiverSet(address indexed receiver);
    event RoyaltySet(address indexed receiver, uint96 bps);
    event RenderConfigUpdated(string flattenedRenderBaseURI, bool holderRenderModeEnabled, uint8 defaultRenderMode);
    event RenderModeUpdated(uint256 indexed tokenId, uint8 mode);
    event PlatformFeeTermsConfigured(address indexed feePolicy, uint8 indexed feeMode, uint32 lockedFeeCents);
    event PlatformFeeAccrued(address indexed payer, uint32 quantity, uint256 amount);
    event PlatformFeesForwarded(address indexed feePolicy, uint256 amount);

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

    address public factory;
    address public feePolicy;

    uint32 public maxSupply;
    uint32 public totalMinted;
    uint32 public totalAssignedRecipes;
    uint32 public deferredPendingCount;

    bool public masterMintEnabled;
    uint8 public futureRevealMode;
    uint32 public phaseCount;

    bool public platformFeeConfigured;
    uint8 public platformFeeMode;
    uint32 public lockedPlatformFeeCents;
    uint256 public accruedPlatformFees;

    string public flattenedRenderBaseURI;
    bool public holderRenderModeEnabled;
    uint8 public defaultRenderMode;

    mapping(uint32 => MintPhase) public phases;
    mapping(uint32 => mapping(address => uint32)) public phaseWalletMinted;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    mapping(uint256 => uint256) public assignedRecipePlusOne;
    mapping(uint256 => bool) public pendingDeferred;
    mapping(uint256 => uint256) private _poolSwapPlusOne;

    mapping(uint256 => uint64) public requestIdToSequence;
    mapping(uint64 => RevealRequest) public revealRequests;
    uint64 public nextRequestSequence;
    uint64 public nextProcessSequence;
    uint64 public nextEpochStartToken;

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

    constructor() { _initialized = true; }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        address creator_,
        address dataContract_,
        address renderer_,
        address randomnessProvider_,
        uint32 maxSupply_,
        address payoutReceiver_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) external {
        if (_initialized) revert RF_AlreadyInitialized();
        if (creator_ == address(0) || dataContract_ == address(0) || renderer_ == address(0) || randomnessProvider_ == address(0)) {
            revert RF_ZeroAddress();
        }
        if (renderer_.code.length == 0 || randomnessProvider_.code.length == 0 || dataContract_.code.length == 0) revert RF_BadConfig();
        if (royaltyBps_ > 10_000) revert RF_BadRoyalty();
        if (maxSupply_ == 0 || IRelicProjectDataV1(dataContract_).maxSupply() != maxSupply_) revert RF_BadConfig();
        if (IRelicProjectDataV1(dataContract_).creator() != creator_) revert RF_BadConfig();

        _initialized = true;
        factory = msg.sender;
        name = name_;
        symbol = symbol_;
        description = description_;
        creator = creator_;
        controller = creator_;
        dataContract = dataContract_;
        renderer = renderer_;
        randomnessProvider = randomnessProvider_;
        maxSupply = maxSupply_;
        payoutReceiver = payoutReceiver_ == address(0) ? creator_ : payoutReceiver_;
        royaltyReceiver = royaltyReceiver_ == address(0) ? creator_ : royaltyReceiver_;
        royaltyBps = royaltyBps_;
        futureRevealMode = REVEAL_DEFERRED;
        masterMintEnabled = false;
        nextRequestSequence = 1;
        nextProcessSequence = 1;
        nextEpochStartToken = 1;
    }

    /// @notice Factory-only one-time fee configuration. Creator/platform cannot change locked terms later.
    function configurePlatformFees(address feePolicy_, uint8 feeMode_, uint32 lockedFeeCents_) external {
        if (msg.sender != factory || factory == address(0)) revert RF_NotAuthorized();
        if (platformFeeConfigured) revert RF_AlreadyConfigured();
        if (feePolicy_.code.length == 0) revert RF_BadConfig();
        if (feeMode_ != FEE_MODE_SPONSORED && feeMode_ != FEE_MODE_MINTER_SUPPORTED) revert RF_BadFeeMode();
        if (lockedFeeCents_ > 10_000) revert RF_FeeLimit();

        feePolicy = feePolicy_;
        platformFeeMode = feeMode_;
        lockedPlatformFeeCents = lockedFeeCents_;
        platformFeeConfigured = true;

        emit PlatformFeeTermsConfigured(feePolicy_, feeMode_, lockedFeeCents_);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x80ac58cd // ERC721
            || interfaceId == 0x5b5e139f // ERC721Metadata
            || interfaceId == 0x2a55205a // ERC2981
            || interfaceId == 0x49064906; // ERC4906
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
        unchecked { --_balanceOf[from]; ++_balanceOf[to]; }
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

    // ---------------------------- Creator sale control ----------------------------

    function setMasterMintEnabled(bool enabled) external onlyController {
        masterMintEnabled = enabled;
        emit MasterMintSet(enabled);
    }

    function createPhase(
        uint96 price,
        uint64 startTime,
        uint64 endTime,
        uint32 phaseSupply,
        uint32 maxPerWallet,
        bytes32 merkleRoot,
        uint8 accessType,
        uint16 priority,
        bool enabled
    ) external onlyController returns (uint32 phaseId) {
        if (accessType > ACCESS_MERKLE) revert RF_BadAccessType();
        if (accessType == ACCESS_MERKLE && merkleRoot == bytes32(0)) revert RF_BadProof();
        if (endTime != 0 && endTime <= startTime) revert RF_BadTimeRange();
        phaseId = ++phaseCount;
        phases[phaseId] = MintPhase(price, startTime, endTime, phaseSupply, 0, maxPerWallet, merkleRoot, accessType, priority, enabled);
        emit PhaseCreated(phaseId, accessType, price, priority);
    }

    function updatePhase(
        uint32 phaseId,
        uint96 price,
        uint64 startTime,
        uint64 endTime,
        uint32 phaseSupply,
        uint32 maxPerWallet,
        bytes32 merkleRoot,
        uint8 accessType,
        uint16 priority
    ) external onlyController {
        MintPhase storage phase = phases[phaseId];
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();
        if (accessType > ACCESS_MERKLE) revert RF_BadAccessType();
        if (accessType == ACCESS_MERKLE && merkleRoot == bytes32(0)) revert RF_BadProof();
        if (endTime != 0 && endTime <= startTime) revert RF_BadTimeRange();
        if (phaseSupply != 0 && phaseSupply < phase.minted) revert RF_PhaseSoldOut();
        phase.price = price;
        phase.startTime = startTime;
        phase.endTime = endTime;
        phase.phaseSupply = phaseSupply;
        phase.maxPerWallet = maxPerWallet;
        phase.merkleRoot = merkleRoot;
        phase.accessType = accessType;
        phase.priority = priority;
        emit PhaseUpdated(phaseId);
    }

    function setPhaseEnabled(uint32 phaseId, bool enabled) external onlyController {
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();
        phases[phaseId].enabled = enabled;
        emit PhaseEnabled(phaseId, enabled);
    }

    function setFutureRevealMode(uint8 mode) external onlyController {
        if (mode > REVEAL_FORGE) revert RF_BadConfig();
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
        // Render policy is part of immutable collection content, not a sale control.
        if (IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentSealed();
        if (defaultMode > 1) revert RF_BadRenderMode();
        flattenedRenderBaseURI = baseURI;
        holderRenderModeEnabled = holderEnabled;
        defaultRenderMode = defaultMode;
        emit RenderConfigUpdated(baseURI, holderEnabled, defaultMode);
        emit BatchMetadataUpdate(1, totalMinted);
    }

    function renounceControl() external onlyController {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_RenounceUnsafe();
        if (deferredPendingCount != 0) revert RF_RenounceUnsafe();
        if (masterMintEnabled && totalMinted < maxSupply && futureRevealMode != REVEAL_FORGE) revert RF_RenounceUnsafe();
        controller = address(0);
        emit ControllerRenounced(creator);
    }

    // ---------------------------- Minting ----------------------------

    function platformMintFeeQuote(uint32 quantity)
        public view returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        if (
            !platformFeeConfigured ||
            platformFeeMode != FEE_MODE_MINTER_SUPPORTED ||
            quantity == 0
        ) {
            return (0, true, false);
        }

        return IRelicForgeFeePolicyV1(feePolicy).quoteMintFee(
            address(this),
            lockedPlatformFeeCents,
            quantity
        );
    }

    /// @notice UI-friendly quote. minimumValue is the value required at the current oracle state.
    function quoteMint(uint32 phaseId, uint32 quantity)
        external view
        returns (
            uint256 creatorPrice,
            uint256 platformFeeWei,
            uint256 minimumValue,
            bool oracleHealthy,
            bool feeActive
        )
    {
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();
        creatorPrice = uint256(phases[phaseId].price) * quantity;
        (platformFeeWei, oracleHealthy, feeActive) = platformMintFeeQuote(quantity);
        minimumValue = creatorPrice;
        if (feeActive && oracleHealthy) minimumValue += platformFeeWei;
    }

    function phaseIsOpen(uint32 phaseId) public view returns (bool) {
        if (!masterMintEnabled) return false;
        MintPhase storage phase = phases[phaseId];
        if (!phase.enabled) return false;
        if (block.timestamp < phase.startTime) return false;
        if (phase.endTime != 0 && block.timestamp >= phase.endTime) return false;
        if (phase.phaseSupply != 0 && phase.minted >= phase.phaseSupply) return false;
        if (totalMinted >= maxSupply) return false;
        return true;
    }

    function mint(uint32 phaseId, uint32 quantity, uint32 allowance, bytes32[] calldata proof)
        external payable nonReentrant returns (uint256 startTokenId)
    {
        if (!masterMintEnabled) revert RF_PublicSalePaused();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_MINT_BATCH) revert RF_BatchLimit();
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();

        MintPhase storage phase = phases[phaseId];
        if (!phase.enabled) revert RF_PhaseDisabled();
        if (block.timestamp < phase.startTime) revert RF_PhaseNotStarted();
        if (phase.endTime != 0 && block.timestamp >= phase.endTime) revert RF_PhaseClosed();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();
        if (phase.phaseSupply != 0 && uint256(phase.minted) + quantity > phase.phaseSupply) revert RF_PhaseSoldOut();

        uint256 creatorPrice = uint256(phase.price) * quantity;
        (uint256 platformFeeWei, bool oracleHealthy, bool feeActive) = platformMintFeeQuote(quantity);
        uint256 requiredValue = creatorPrice;
        if (feeActive && oracleHealthy) requiredValue += platformFeeWei;

        // Dynamic USD conversion can move between an eth_call quote and inclusion. Never accept
        // underpayment; harmless overpayment remains creator proceeds rather than platform revenue.
        if (msg.value < requiredValue) revert RF_WrongPrice();

        uint32 walletMinted = phaseWalletMinted[phaseId][msg.sender];
        if (phase.maxPerWallet != 0 && uint256(walletMinted) + quantity > phase.maxPerWallet) revert RF_WalletLimit();

        if (phase.accessType == ACCESS_MERKLE) {
            bytes32 leaf = keccak256(abi.encode(block.chainid, address(this), phaseId, msg.sender, allowance));
            if (!RFMerkleProofV1.verify(proof, phase.merkleRoot, leaf)) revert RF_BadProof();
            if (uint256(walletMinted) + quantity > allowance) revert RF_InsufficientAllowance();
        }

        phaseWalletMinted[phaseId][msg.sender] = walletMinted + quantity;
        phase.minted += quantity;

        if (feeActive && oracleHealthy && platformFeeWei != 0) {
            accruedPlatformFees += platformFeeWei;
            emit PlatformFeeAccrued(msg.sender, quantity, platformFeeWei);
        }

        startTokenId = _mintBatch(msg.sender, quantity);
    }

    function creatorMint(address to, uint32 quantity) external onlyController nonReentrant returns (uint256 startTokenId) {
        if (to == address(0)) revert RF_ZeroAddress();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_MINT_BATCH) revert RF_BatchLimit();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();
        startTokenId = _mintBatch(to, quantity);
    }

    function _mintBatch(address to, uint32 quantity) internal returns (uint256 startTokenId) {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();

        uint32 startTokenId32 = totalMinted + 1;
        startTokenId = startTokenId32;
        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = uint256(startTokenId32) + i;
            _ownerOf[tokenId] = to;
            ++_balanceOf[to];
            emit Transfer(address(0), to, tokenId);
        }
        totalMinted += quantity;

        if (futureRevealMode == REVEAL_FORGE) {
            _requestReveal(RequestKind.ForgeBatch, startTokenId32, totalMinted);
        } else {
            for (uint32 i; i < quantity; ++i) pendingDeferred[uint256(startTokenId32) + i] = true;
            deferredPendingCount += quantity;
        }
    }

    // ---------------------------- Hybrid reveal ----------------------------

    function requestRevealEpoch() external onlyController returns (uint64 sequence, uint256 requestId) {
        if (deferredPendingCount == 0) revert RF_NoDeferredTokens();
        uint64 endToken = totalMinted;
        uint64 startToken = nextEpochStartToken;
        if (startToken > endToken) revert RF_NoDeferredTokens();
        nextEpochStartToken = endToken + 1;
        (sequence, requestId) = _requestReveal(RequestKind.EpochRange, startToken, endToken);
    }

    function _requestReveal(RequestKind kind, uint64 startTokenId, uint64 endTokenId)
        internal returns (uint64 sequence, uint256 requestId)
    {
        if (!IRelicProjectDataV1(dataContract).contentSealed()) revert RF_ContentNotSealed();
        sequence = nextRequestSequence++;
        requestId = IRelicRandomnessProviderV1(randomnessProvider).requestRandomness(sequence);
        if (requestId == 0 || requestIdToSequence[requestId] != 0) revert RF_BadRequest();
        requestIdToSequence[requestId] = sequence;
        revealRequests[sequence] = RevealRequest({
            kind: kind,
            startTokenId: startTokenId,
            endTokenId: endTokenId,
            cursor: startTokenId,
            assignmentNonce: 0,
            fulfilled: false,
            seed: 0
        });
        emit RevealRequested(sequence, requestId, kind, startTokenId, endTokenId);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();
        uint64 sequence = requestIdToSequence[requestId];
        if (sequence == 0) revert RF_BadRequest();
        RevealRequest storage req = revealRequests[sequence];
        if (req.fulfilled) revert RF_AlreadyFulfilled();
        req.fulfilled = true;
        req.seed = randomWord;
        emit RevealRandomnessStored(sequence, requestId);
    }

    /// @notice Permissionless bounded processing. Each scanned token consumes one step.
    function processReveal(uint32 maxSteps) external {
        if (maxSteps == 0) revert RF_ZeroQuantity();
        uint32 remainingSteps = maxSteps;

        while (remainingSteps != 0 && nextProcessSequence < nextRequestSequence) {
            RevealRequest storage req = revealRequests[nextProcessSequence];
            if (!req.fulfilled) break;

            while (remainingSteps != 0 && req.cursor <= req.endTokenId) {
                uint256 tokenId = req.cursor;
                ++req.cursor;
                --remainingSteps;

                if (req.kind == RequestKind.ForgeBatch) {
                    if (assignedRecipePlusOne[tokenId] == 0) _assignRecipe(tokenId, req.seed, nextProcessSequence, req.assignmentNonce++);
                } else if (req.kind == RequestKind.EpochRange) {
                    if (pendingDeferred[tokenId]) {
                        pendingDeferred[tokenId] = false;
                        --deferredPendingCount;
                        _assignRecipe(tokenId, req.seed, nextProcessSequence, req.assignmentNonce++);
                    }
                }
            }

            if (req.cursor > req.endTokenId) {
                uint64 completed = nextProcessSequence++;
                emit RevealRequestProcessed(completed);
                emit BatchMetadataUpdate(req.startTokenId, req.endTokenId);
            } else {
                break;
            }
        }
    }

    function _poolValue(uint256 index) internal view returns (uint256) {
        uint256 stored = _poolSwapPlusOne[index];
        return stored == 0 ? index : stored - 1;
    }

    function _assignRecipe(uint256 tokenId, uint256 seed, uint64 sequence, uint32 nonce) internal {
        if (assignedRecipePlusOne[tokenId] != 0) revert RF_AlreadyRevealed();
        uint256 recipeCount = maxSupply;
        uint256 remaining = recipeCount - totalAssignedRecipes;
        if (remaining == 0) revert RF_NoRecipes();
        uint256 word = uint256(keccak256(abi.encode(seed, address(this), sequence, nonce, tokenId)));
        uint256 pick = word % remaining;
        uint256 selected = _poolValue(pick);
        uint256 last = _poolValue(remaining - 1);
        _poolSwapPlusOne[pick] = last + 1;
        ++totalAssignedRecipes;
        assignedRecipePlusOne[tokenId] = selected + 1;
        emit MetadataUpdate(tokenId);
    }

    function recipeForToken(uint256 tokenId) public view returns (uint256) {
        ownerOf(tokenId);
        uint256 p = assignedRecipePlusOne[tokenId];
        if (p == 0) revert RF_NotRevealed();
        return p - 1;
    }

    function isRevealed(uint256 tokenId) public view returns (bool) {
        return _ownerOf[tokenId] != address(0) && assignedRecipePlusOne[tokenId] != 0;
    }

    // ---------------------------- Metadata/rendering ----------------------------

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
        if (!holderRenderModeEnabled) revert RF_BadRenderMode();
        if (mode > 1) revert RF_BadRenderMode();
        if (ownerOf(tokenId) != msg.sender) revert RF_NotTokenOwner();
        _tokenRenderMode[tokenId] = mode;
        _tokenRenderModeSet[tokenId] = true;
        emit RenderModeUpdated(tokenId, mode);
        emit MetadataUpdate(tokenId);
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        receiver = royaltyReceiver;
        // Overflow-safe equivalent of salePrice * royaltyBps / 10_000 for the full uint256 domain.
        uint256 quotient = salePrice / 10_000;
        uint256 remainder = salePrice % 10_000;
        royaltyAmount = quotient * royaltyBps + (remainder * royaltyBps) / 10_000;
    }

    /// @notice Anyone may forward reserved minter-supported platform fees to the immutable collection fee policy.
    function withdrawPlatformFees() external nonReentrant {
        uint256 amount = accruedPlatformFees;
        if (amount == 0) return;
        if (feePolicy == address(0)) revert RF_BadConfig();

        accruedPlatformFees = 0;
        IRelicForgeFeePolicyV1(feePolicy).depositMintFees{value: amount}(address(this));
        emit PlatformFeesForwarded(feePolicy, amount);
    }

    /// @notice Anyone may trigger payout, but only creator proceeds can reach payoutReceiver.
    function withdraw() external nonReentrant {
        address receiver = payoutReceiver;
        if (receiver == address(0)) revert RF_InvalidRecipient();

        uint256 balance = address(this).balance;
        uint256 reserved = accruedPlatformFees;
        if (reserved > balance) revert RF_BadConfig();

        uint256 creatorAmount = balance - reserved;
        if (creatorAmount == 0) return;

        (bool ok,) = payable(receiver).call{value: creatorAmount}("");
        if (!ok) revert RF_WithdrawFailed();
    }
}
