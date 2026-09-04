// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";

interface IRelicCollectionSaleStateV2 {
    function totalCommitted() external view returns (uint32);
    function maxSupply() external view returns (uint32);
    function delayedRevealRequested() external view returns (bool);
    function delayedRevealed() external view returns (bool);
}

/// @title RelicMintPhasesV2
/// @notice Per-collection EIP-1167 sale-policy clone for Relic Collection V2.
/// @dev Splitting sale bookkeeping from the ERC-721 implementation preserves the full
///      phase/allowlist/wallet-limit feature set while keeping RelicCollectionV2 safely
///      below Ethereum's EIP-170 deployed-code limit.
///
///      Creator configuration is performed directly against this clone. Only its bound
///      collection may consume a mint allowance, so no third party can mutate counters.
contract RelicMintPhasesV2 {
    uint8 public constant ACCESS_PUBLIC = 0;
    uint8 public constant ACCESS_MERKLE = 1;
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    struct MintPhase {
        uint96 price;
        uint64 startTime;
        uint64 endTime;
        uint32 phaseSupply;
        uint32 minted;
        uint32 maxPerWallet;
        bytes32 merkleRoot;
        uint8 accessType;
        uint16 priority;
        bool enabled;
    }

    address public collection;
    address public controller;
    address public feePolicy;
    uint8 public platformFeeMode;
    uint32 public lockedPlatformFeeCents;

    bool public masterMintEnabled;
    uint32 public phaseCount;

    mapping(uint32 => MintPhase) public phases;
    mapping(uint32 => mapping(address => uint32)) public phaseWalletMinted;

    bool private _initialized;

    event MasterMintSet(bool enabled);
    event PhaseCreated(uint32 indexed phaseId, uint8 accessType, uint96 price, uint16 priority);
    event PhaseUpdated(uint32 indexed phaseId);
    event PhaseEnabled(uint32 indexed phaseId, bool enabled);
    event ControllerRenounced(address indexed oldController);

    modifier onlyController() {
        if (controller == address(0)) revert RF_Renounced();
        if (msg.sender != controller) revert RF_NotController();
        _;
    }

    modifier onlyCollection() {
        if (msg.sender != collection) revert RF_NotAuthorized();
        _;
    }

    constructor() {
        _initialized = true;
    }

    function initialize(
        address collection_,
        address controller_,
        address feePolicy_,
        uint8 feeMode_,
        uint32 lockedFeeCents_
    ) external {
        if (_initialized) revert RF_AlreadyInitialized();
        if (
            collection_ == address(0) || controller_ == address(0) || feePolicy_ == address(0)
                || feePolicy_.code.length == 0
        ) revert RF_BadConfig();
        if (feeMode_ != FEE_MODE_SPONSORED && feeMode_ != FEE_MODE_MINTER_SUPPORTED) revert RF_BadFeeMode();
        if (lockedFeeCents_ > 500) revert RF_FeeLimit();

        _initialized = true;
        collection = collection_;
        controller = controller_;
        feePolicy = feePolicy_;
        platformFeeMode = feeMode_;
        lockedPlatformFeeCents = lockedFeeCents_;
    }

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
        phases[phaseId] = MintPhase(
            price, startTime, endTime, phaseSupply, 0, maxPerWallet, merkleRoot, accessType, priority, enabled
        );
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
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();
        if (accessType > ACCESS_MERKLE) revert RF_BadAccessType();
        if (accessType == ACCESS_MERKLE && merkleRoot == bytes32(0)) revert RF_BadProof();
        if (endTime != 0 && endTime <= startTime) revert RF_BadTimeRange();

        MintPhase storage phase = phases[phaseId];
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

    function platformMintFeeQuote(uint32 quantity)
        public
        view
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        if (platformFeeMode != FEE_MODE_MINTER_SUPPORTED || quantity == 0) return (0, true, false);
        return IRelicForgeFeePolicyV1(feePolicy).quoteMintFee(collection, lockedPlatformFeeCents, quantity);
    }

    function creatorTeamFeeQuote(uint32 quantity)
        public
        view
        returns (uint256 feeWei, bool oracleHealthy, bool feeActive)
    {
        if (platformFeeMode != FEE_MODE_MINTER_SUPPORTED || quantity == 0) return (0, true, false);

        IRelicForgeFeePolicyV1 policy = IRelicForgeFeePolicyV1(feePolicy);
        if (!policy.collectionFeesEnabled(collection)) return (0, true, false);

        uint32 currentCents = policy.currentCollectionFeeCents(collection, lockedPlatformFeeCents);
        if (currentCents == 0) return (0, true, false);

        uint256 teamCents = (uint256(currentCents) + 1) / 2;
        (feeWei, oracleHealthy) = policy.quoteUsdCents(teamCents * quantity);
        feeActive = true;
    }

    function quoteMint(uint32 phaseId, uint32 quantity)
        external
        view
        returns (uint256 creatorPrice, uint256 platformFeeWei, uint256 minimumValue, bool oracleHealthy, bool feeActive)
    {
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();

        creatorPrice = uint256(phases[phaseId].price) * quantity;
        (platformFeeWei, oracleHealthy, feeActive) = platformMintFeeQuote(quantity);
        minimumValue = creatorPrice;
        if (feeActive && oracleHealthy) minimumValue += platformFeeWei;
    }

    function phaseIsOpen(uint32 phaseId) external view returns (bool) {
        if (!masterMintEnabled || phaseId == 0 || phaseId > phaseCount) return false;

        MintPhase storage phase = phases[phaseId];
        if (!phase.enabled) return false;
        if (block.timestamp < phase.startTime) return false;
        if (phase.endTime != 0 && block.timestamp >= phase.endTime) return false;
        if (phase.phaseSupply != 0 && phase.minted >= phase.phaseSupply) return false;

        IRelicCollectionSaleStateV2 c = IRelicCollectionSaleStateV2(collection);
        if (c.delayedRevealRequested() && !c.delayedRevealed()) return false;
        return c.totalCommitted() < c.maxSupply();
    }

    /// @notice Consumes phase + wallet allowance and quotes the platform fee.
    /// @dev Only the bound collection may call. If the collection later rejects payment/supply,
    ///      the entire transaction reverts and these counters revert with it.
    function consumeMint(address payer, uint32 phaseId, uint32 quantity, uint32 allowance, bytes32[] calldata proof)
        external
        onlyCollection
        returns (uint256 creatorPrice, uint256 platformFeeWei, bool oracleHealthy, bool feeActive)
    {
        if (!masterMintEnabled) revert RF_PublicSalePaused();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (phaseId == 0 || phaseId > phaseCount) revert RF_BadPhase();

        MintPhase storage phase = phases[phaseId];
        if (!phase.enabled) revert RF_PhaseDisabled();
        if (block.timestamp < phase.startTime) revert RF_PhaseNotStarted();
        if (phase.endTime != 0 && block.timestamp >= phase.endTime) revert RF_PhaseClosed();
        if (phase.phaseSupply != 0 && uint256(phase.minted) + quantity > phase.phaseSupply) {
            revert RF_PhaseSoldOut();
        }

        uint32 walletMinted = phaseWalletMinted[phaseId][payer];
        if (phase.maxPerWallet != 0 && uint256(walletMinted) + quantity > phase.maxPerWallet) {
            revert RF_WalletLimit();
        }

        if (phase.accessType == ACCESS_MERKLE) {
            bytes32 leaf = keccak256(abi.encode(block.chainid, collection, phaseId, payer, allowance));
            if (!RFMerkleProofV1.verify(proof, phase.merkleRoot, leaf)) revert RF_BadProof();
            if (uint256(walletMinted) + quantity > allowance) revert RF_InsufficientAllowance();
        }

        phaseWalletMinted[phaseId][payer] = walletMinted + quantity;
        phase.minted += quantity;

        creatorPrice = uint256(phase.price) * quantity;
        (platformFeeWei, oracleHealthy, feeActive) = platformMintFeeQuote(quantity);
    }

    function renounceController() external onlyCollection {
        address old = controller;
        controller = address(0);
        emit ControllerRenounced(old);
    }
}
