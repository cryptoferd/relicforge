// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RelicPricedRandomnessQueueMockV2.sol";
import "./RelicForgeReserveV2Harness.sol";

error RFV2_RandomnessQuoteTooHigh();
error RFV2_BatchNotLocked();
error RFV2_BatchAlreadyRequested();
error RFV2_BatchNotRequested();
error RFV2_HopperSweepUnauthorized();

/// @title RelicForgeBatchQueueV2Harness
/// @notice Phase 2C prototype for burst-safe Forge Reveal with 20-NFT max RNG batches.
/// @dev EXPERIMENTAL ONLY. Public/team minting only locks immutable batches; RNG provider calls happen later.
contract RelicForgeBatchQueueV2Harness is IRelicRandomnessConsumerV1, IRelicForgeReserveCollectionV2 {
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;
    uint32 public constant MAX_BATCH_NFTS = 20;
    uint32 public constant HOPPER_RUNWAY_BATCHES = 10;
    uint32 public constant MAX_PROVIDER_CALLBACK_GAS = 2_500_000;

    // Conservative callback sizing derived from Phase 2B's pessimistic ~95k gas/NFT settlement trend.
    uint256 public constant ESTIMATED_SETTLE_FIXED_GAS = 250_000;
    uint256 public constant ESTIMATED_SETTLE_PER_NFT_GAS = 95_000;
    uint256 public constant CALLBACK_OVERHEAD_AND_RETURN_GAS = 300_000;
    uint256 public constant CALLBACK_SELF_CALL_RETURN_RESERVE_GAS = 100_000;

    struct Reservation {
        address payer;
        address recipient;
        uint32 quantity;
        uint256 creatorValue;
        uint256 platformFeeValue;
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
        uint32 callbackGasLimit;
        uint256 randomnessCost;
        uint256 requestId;
        uint256 randomWord;
        bool locked;
        bool wordReady;
        bool settled;
    }

    address public immutable creator;
    IRelicPricedRandomnessProviderV2 public immutable randomnessProvider;
    RelicForgeReserveV2Harness public immutable forgeReserve;

    uint8 public immutable feeMode;
    uint32 public immutable maxSupply;
    uint64 public immutable batchWindowSeconds;
    uint256 public immutable mintPriceWei;
    uint256 public immutable sponsoredFeePerTokenWei;
    uint256 public immutable minterFeePerTokenWei;
    uint256 public immutable creatorMintFeePerTokenWei;
    uint256 public immutable maxRandomnessCostPerBatchWei;

    bool public forgePaused;
    bool public completed;
    bool private _entered;

    uint32 public totalCommitted;
    uint32 public totalMinted;
    uint32 public unrequestedLockedBatches;
    uint32 public lockedUnsettledBatches;

    uint64 public nextReservationId = 1;
    uint64 public openBatchId = 1;
    uint64 public nextSettleBatchId = 1;

    uint256 public hopperBalance;
    uint256 public creatorEscrow;
    uint256 public accruedCreatorProceeds;
    uint256 public totalRandomnessSpend;
    uint256 public totalReserveSubsidy;
    uint256 public totalSweptToReserve;

    mapping(uint64 => Reservation) public reservations;
    mapping(uint64 => ForgeBatch) public batches;
    mapping(uint256 => uint64) public requestIdToBatchId;

    mapping(uint256 => uint256) private _poolSwapPlusOne;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event ForgePauseChanged(bool paused);
    event ForgeReservationCreated(
        uint64 indexed reservationId,
        uint64 indexed batchId,
        address indexed payer,
        address recipient,
        uint32 quantity,
        uint256 creatorValue,
        uint256 platformFeeValue,
        bool creatorTeamMint
    );
    event ForgeBatchLocked(
        uint64 indexed batchId,
        uint32 reservationCount,
        uint32 totalQuantity,
        bool full
    );
    event ForgeRandomnessRequested(
        uint64 indexed batchId,
        uint256 indexed requestId,
        uint32 callbackGasLimit,
        uint256 randomnessCost,
        uint256 hopperPaid,
        uint256 reservePaid
    );
    event ForgeBatchRandomnessReady(uint64 indexed batchId, uint256 indexed requestId);
    event ForgeAutoSettlement(
        uint64 indexed batchId,
        bool attempted,
        bool settled,
        uint256 gasAvailable,
        uint256 estimatedSettlementGas
    );
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event ForgeBatchSettled(
        uint64 indexed batchId,
        uint256 indexed requestId,
        uint32 reservationCount,
        uint32 totalQuantity
    );
    event HopperSweptToReserve(uint256 amount, uint256 remainingHopper);
    event CollectionCompleted(uint32 totalMinted, uint256 hopperRemaining);
    event CreatorProceedsWithdrawn(address indexed receiver, uint256 amount);

    modifier onlyCreator() {
        if (msg.sender != creator) revert RF_NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert RF_Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        address creator_,
        address randomnessProvider_,
        address forgeReserve_,
        uint8 feeMode_,
        uint32 maxSupply_,
        uint64 batchWindowSeconds_,
        uint256 mintPriceWei_,
        uint256 sponsoredFeePerTokenWei_,
        uint256 minterFeePerTokenWei_,
        uint256 creatorMintFeePerTokenWei_,
        uint256 maxRandomnessCostPerBatchWei_
    ) payable {
        if (
            creator_ == address(0) ||
            randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0 ||
            forgeReserve_ == address(0) || forgeReserve_.code.length == 0
        ) revert RF_BadConfig();
        if (feeMode_ != FEE_MODE_SPONSORED && feeMode_ != FEE_MODE_MINTER_SUPPORTED) revert RF_BadFeeMode();
        if (maxSupply_ == 0 || batchWindowSeconds_ == 0 || maxRandomnessCostPerBatchWei_ == 0) revert RF_BadConfig();
        if (creatorMintFeePerTokenWei_ > minterFeePerTokenWei_) revert RF_BadConfig();

        creator = creator_;
        randomnessProvider = IRelicPricedRandomnessProviderV2(randomnessProvider_);
        forgeReserve = RelicForgeReserveV2Harness(payable(forgeReserve_));
        feeMode = feeMode_;
        maxSupply = maxSupply_;
        batchWindowSeconds = batchWindowSeconds_;
        mintPriceWei = mintPriceWei_;
        sponsoredFeePerTokenWei = sponsoredFeePerTokenWei_;
        minterFeePerTokenWei = minterFeePerTokenWei_;
        creatorMintFeePerTokenWei = creatorMintFeePerTokenWei_;
        maxRandomnessCostPerBatchWei = maxRandomnessCostPerBatchWei_;

        if (feeMode_ == FEE_MODE_SPONSORED) {
            uint256 expected = sponsoredFeePerTokenWei_ * maxSupply_;
            if (msg.value != expected) revert RF_WrongPrice();
            hopperBalance = expected;
        } else if (msg.value != 0) {
            revert RF_WrongPrice();
        }
    }

    function setForgePaused(bool paused) external onlyCreator {
        forgePaused = paused;
        emit ForgePauseChanged(paused);
    }

    /// @notice Public collector path: reserve payment/supply and lock batches only. No RNG provider call occurs here.
    function requestForgeMint(address recipient, uint32 quantity)
        external
        payable
        nonReentrant
        returns (uint64 firstReservationId, uint64 lastReservationId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_BATCH_NFTS) revert RF_BatchLimit();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint256 platformFeePerToken = feeMode == FEE_MODE_MINTER_SUPPORTED ? minterFeePerTokenWei : 0;
        uint256 required = (mintPriceWei + platformFeePerToken) * quantity;
        if (msg.value != required) revert RF_WrongPrice();

        (firstReservationId, lastReservationId) = _queueReservation(
            msg.sender,
            recipient,
            quantity,
            mintPriceWei,
            platformFeePerToken,
            false
        );
    }

    /// @notice Creator/team treasury allocation. May span many 20-NFT batches in one transaction.
    /// @dev Sponsored collections already paid $0.25-equivalent for max supply; minter-supported creator mints
    ///      pay the creator-mint fee per NFT so large team allocations cannot drain the hopper.
    function creatorMint(address recipient, uint32 quantity)
        external
        payable
        onlyCreator
        nonReentrant
        returns (uint64 firstReservationId, uint64 lastReservationId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint256 teamFeePerToken = feeMode == FEE_MODE_MINTER_SUPPORTED ? creatorMintFeePerTokenWei : 0;
        if (msg.value != teamFeePerToken * quantity) revert RF_WrongPrice();

        (firstReservationId, lastReservationId) = _queueReservation(
            msg.sender,
            recipient,
            quantity,
            0,
            teamFeePerToken,
            true
        );
    }

    function _queueReservation(
        address payer,
        address recipient,
        uint32 quantity,
        uint256 creatorValuePerToken,
        uint256 platformFeePerToken,
        bool teamMint
    ) internal returns (uint64 firstReservationId, uint64 lastReservationId) {
        uint32 remaining = quantity;

        while (remaining != 0) {
            ForgeBatch storage batch = batches[openBatchId];
            uint32 capacity = MAX_BATCH_NFTS - batch.totalQuantity;
            uint32 take = remaining < capacity ? remaining : capacity;

            uint64 reservationId = nextReservationId++;
            if (firstReservationId == 0) firstReservationId = reservationId;
            lastReservationId = reservationId;

            if (batch.firstReservationId == 0) {
                batch.firstReservationId = reservationId;
                batch.openedAt = uint64(block.timestamp);
            }
            batch.lastReservationId = reservationId;
            ++batch.reservationCount;
            batch.totalQuantity += take;

            uint256 creatorValue = creatorValuePerToken * take;
            uint256 platformValue = platformFeePerToken * take;

            reservations[reservationId] = Reservation({
                payer: payer,
                recipient: recipient,
                quantity: take,
                creatorValue: creatorValue,
                platformFeeValue: platformValue,
                creatorTeamMint: teamMint,
                settled: false
            });

            totalCommitted += take;
            creatorEscrow += creatorValue;
            hopperBalance += platformValue;

            emit ForgeReservationCreated(
                reservationId,
                openBatchId,
                payer,
                recipient,
                take,
                creatorValue,
                platformValue,
                teamMint
            );

            remaining -= take;

            if (batch.totalQuantity == MAX_BATCH_NFTS) {
                _lockOpenBatch(true);
            }
        }

        // Mint-out must never wait on the timeout for a final partial batch.
        if (totalCommitted == maxSupply) {
            ForgeBatch storage finalOpen = batches[openBatchId];
            if (finalOpen.totalQuantity != 0 && !finalOpen.locked) _lockOpenBatch(false);
        }
    }

    /// @notice Permissionless short-window close. A one-person batch never waits for nineteen more buyers.
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
        unchecked { ++openBatchId; }
    }

    function callbackGasForQuantity(uint32 quantity) public pure returns (uint32) {
        if (quantity == 0 || quantity > MAX_BATCH_NFTS) revert RF_BadConfig();
        uint256 gasLimit =
            ESTIMATED_SETTLE_FIXED_GAS +
            uint256(quantity) * ESTIMATED_SETTLE_PER_NFT_GAS +
            CALLBACK_OVERHEAD_AND_RETURN_GAS;

        if (gasLimit > MAX_PROVIDER_CALLBACK_GAS) revert RF_BadConfig();
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint32(gasLimit);
    }

    function estimatedSettlementGas(uint32 quantity) public pure returns (uint256) {
        if (quantity == 0 || quantity > MAX_BATCH_NFTS) revert RF_BadConfig();
        return ESTIMATED_SETTLE_FIXED_GAS + uint256(quantity) * ESTIMATED_SETTLE_PER_NFT_GAS;
    }

    /// @notice Permissionless executor path. Multiple RF workers can request different locked batches in parallel.
    function requestRandomnessForBatch(uint64 batchId)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        ForgeBatch storage batch = batches[batchId];
        if (!batch.locked) revert RFV2_BatchNotLocked();
        if (batch.requestId != 0) revert RFV2_BatchAlreadyRequested();
        if (batch.settled) revert RF_BadRequest();

        uint32 callbackGasLimit = callbackGasForQuantity(batch.totalQuantity);
        uint256 cost = randomnessProvider.quoteRequestPrice(callbackGasLimit);
        if (cost > maxRandomnessCostPerBatchWei) revert RFV2_RandomnessQuoteTooHigh();

        uint256 hopperPaid = hopperBalance < cost ? hopperBalance : cost;
        uint256 reservePaid = cost - hopperPaid;

        // Hopper first. Reserve may only cover the exact remaining shortfall.
        if (reservePaid != 0) {
            forgeReserve.fundRandomnessShortfall(batchId, reservePaid);
            totalReserveSubsidy += reservePaid;
        }

        hopperBalance -= hopperPaid;
        totalRandomnessSpend += cost;

        requestId = randomnessProvider.requestRandomness{value: cost}(batchId, callbackGasLimit);
        if (requestId == 0 || requestIdToBatchId[requestId] != 0) revert RF_BadRequest();

        batch.callbackGasLimit = callbackGasLimit;
        batch.randomnessCost = cost;
        batch.requestId = requestId;
        requestIdToBatchId[requestId] = batchId;
        --unrequestedLockedBatches;

        // Executor path, not collector path: safe place to refresh reserve telemetry.
        forgeReserve.syncCollection(address(this));

        emit ForgeRandomnessRequested(
            batchId,
            requestId,
            callbackGasLimit,
            cost,
            hopperPaid,
            reservePaid
        );
    }

    /// @notice Verified provider callback stores the word before a best-effort isolated auto-settlement.
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != address(randomnessProvider)) revert RF_NotRandomnessProvider();

        uint64 batchId = requestIdToBatchId[requestId];
        if (batchId == 0) revert RF_BadRequest();

        ForgeBatch storage batch = batches[batchId];
        if (!batch.locked || batch.requestId == 0 || batch.settled) revert RF_BadRequest();
        if (batch.wordReady) revert RF_AlreadyFulfilled();

        batch.wordReady = true;
        batch.randomWord = randomWord;
        emit ForgeBatchRandomnessReady(batchId, requestId);

        uint256 available = gasleft();
        uint256 estimate = estimatedSettlementGas(batch.totalQuantity);

        if (
            batchId != nextSettleBatchId ||
            available <= CALLBACK_SELF_CALL_RETURN_RESERVE_GAS ||
            available - CALLBACK_SELF_CALL_RETURN_RESERVE_GAS < estimate
        ) {
            emit ForgeAutoSettlement(batchId, false, false, available, estimate);
            return;
        }

        uint256 settleGas = available - CALLBACK_SELF_CALL_RETURN_RESERVE_GAS;
        (bool ok,) = address(this).call{gas: settleGas}(
            abi.encodeCall(this.callbackSettleBatch, (batchId))
        );

        emit ForgeAutoSettlement(batchId, true, ok, available, estimate);
    }

    /// @dev Isolated self-call prevents an unexpectedly expensive settlement from erasing the verified word.
    function callbackSettleBatch(uint64 batchId) external {
        if (msg.sender != address(this)) revert RF_NotAuthorized();
        if (batchId != nextSettleBatchId) revert RF_BadRequest();

        ForgeBatch storage batch = batches[batchId];
        if (!batch.wordReady || batch.settled) revert RF_BadRequest();
        _settleBatch(batchId, batch);
        _advanceSettleCursor();
    }

    /// @notice Permissionless recovery/drain path for low-gas or out-of-order callbacks.
    function settleReady(uint32 maxTokens) external returns (uint32 tokensSettled) {
        if (maxTokens == 0) revert RF_ZeroQuantity();

        uint64 batchId = nextSettleBatchId;
        while (batchId < openBatchId) {
            ForgeBatch storage batch = batches[batchId];

            if (batch.settled) {
                unchecked { ++batchId; }
                nextSettleBatchId = batchId;
                continue;
            }

            if (!batch.wordReady) break;
            if (uint256(tokensSettled) + batch.totalQuantity > maxTokens) break;

            _settleBatch(batchId, batch);
            tokensSettled += batch.totalQuantity;

            unchecked { ++batchId; }
            nextSettleBatchId = batchId;
        }

        _markCompletedIfReady();
    }

    function _advanceSettleCursor() internal {
        unchecked { ++nextSettleBatchId; }
        _markCompletedIfReady();
    }

    function _settleBatch(uint64 batchId, ForgeBatch storage batch) internal {
        batch.settled = true;
        --lockedUnsettledBatches;

        uint32 remainingDeck = maxSupply - totalMinted;
        uint32 mintedThisBatch;

        for (
            uint64 reservationId = batch.firstReservationId;
            reservationId <= batch.lastReservationId;
            ++reservationId
        ) {
            Reservation storage reservation = reservations[reservationId];
            if (reservation.settled) revert RF_BadRequest();
            reservation.settled = true;

            if (reservation.creatorValue != 0) {
                creatorEscrow -= reservation.creatorValue;
                accruedCreatorProceeds += reservation.creatorValue;
            }

            balanceOf[reservation.recipient] += reservation.quantity;

            for (uint32 i; i < reservation.quantity; ++i) {
                uint256 entropy = uint256(
                    keccak256(
                        abi.encode(
                            batch.randomWord,
                            address(this),
                            batchId,
                            reservationId,
                            i,
                            reservation.recipient
                        )
                    )
                );

                uint256 tokenId = _drawUnusedToken(entropy, remainingDeck);
                unchecked {
                    --remainingDeck;
                    ++mintedThisBatch;
                }

                if (ownerOf[tokenId] != address(0)) revert RF_AlreadyRevealed();
                ownerOf[tokenId] = reservation.recipient;
                emit Transfer(address(0), reservation.recipient, tokenId);
            }

            if (reservationId == batch.lastReservationId) break;
        }

        totalMinted += mintedThisBatch;
        emit ForgeBatchSettled(batchId, batch.requestId, batch.reservationCount, batch.totalQuantity);
    }

    function _markCompletedIfReady() internal {
        if (
            !completed &&
            totalCommitted == maxSupply &&
            totalMinted == maxSupply &&
            lockedUnsettledBatches == 0 &&
            batches[openBatchId].totalQuantity == 0
        ) {
            completed = true;
            emit CollectionCompleted(totalMinted, hopperBalance);
        }
    }

    /// @notice Current exact reserve shortfall for a batch. Reserve contract verifies this before funding.
    function randomnessShortfallFor(uint64 batchId) public view override returns (uint256) {
        ForgeBatch storage batch = batches[batchId];
        if (!batch.locked || batch.requestId != 0 || batch.settled) return 0;

        uint32 callbackGasLimit = callbackGasForQuantity(batch.totalQuantity);
        uint256 cost = randomnessProvider.quoteRequestPrice(callbackGasLimit);
        if (cost > maxRandomnessCostPerBatchWei) return 0;
        return cost > hopperBalance ? cost - hopperBalance : 0;
    }

    /// @notice Current uncovered active RNG exposure used by the chain-local reserve.
    function reserveExposureWei() public view override returns (uint256) {
        uint256 obligationBatches = unrequestedLockedBatches;
        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++obligationBatches;

        uint256 gross = obligationBatches * maxRandomnessCostPerBatchWei;
        return gross > hopperBalance ? gross - hopperBalance : 0;
    }

    /// @notice Sponsored fees for uncommitted supply remain operationally restricted even after
    ///         excess is consolidated into the global reserve. As supply commits, this liability falls.
    /// @dev This prevents a slow sponsored collection from having its prepaid Forge capacity swept
    ///      to platform revenue before the service obligation has actually been consumed.
    function restrictedSponsoredLiabilityWei() public view override returns (uint256) {
        if (feeMode != FEE_MODE_SPONSORED || completed) return 0;

        uint256 obligationBatches = unrequestedLockedBatches;
        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++obligationBatches;

        uint256 currentOperationalTarget = obligationBatches * maxRandomnessCostPerBatchWei;
        uint256 hopperAfterCurrent =
            hopperBalance > currentOperationalTarget ? hopperBalance - currentOperationalTarget : 0;

        uint256 futurePrepaid =
            uint256(maxSupply - totalCommitted) * sponsoredFeePerTokenWei;
        return futurePrepaid > hopperAfterCurrent ? futurePrepaid - hopperAfterCurrent : 0;
    }

    function activeForgeBatchCount() public view override returns (uint256) {
        uint256 count = lockedUnsettledBatches;
        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++count;
        return count;
    }

    /// @notice Hopper runway protects all currently unrequested batches plus up to ten future batches.
    function protectedHopperWei() public view returns (uint256) {
        if (completed) return 0;

        uint256 protectedBatches = unrequestedLockedBatches;
        ForgeBatch storage open = batches[openBatchId];
        if (open.totalQuantity != 0 && !open.locked) ++protectedBatches;

        uint256 remainingUncommitted = uint256(maxSupply) - totalCommitted;
        uint256 futureBatches = (remainingUncommitted + MAX_BATCH_NFTS - 1) / MAX_BATCH_NFTS;
        if (futureBatches > HOPPER_RUNWAY_BATCHES) futureBatches = HOPPER_RUNWAY_BATCHES;
        protectedBatches += futureBatches;

        uint256 target = protectedBatches * maxRandomnessCostPerBatchWei;
        return target < hopperBalance ? target : hopperBalance;
    }

    function sweepableHopperWei() public view returns (uint256) {
        uint256 protected = protectedHopperWei();
        return hopperBalance > protected ? hopperBalance - protected : 0;
    }

    /// @notice Only the canonical Forge Reserve can pull, and amount is mathematically limited to excess.
    function sweepExcessToReserve() external override nonReentrant returns (uint256 amount) {
        if (msg.sender != address(forgeReserve)) revert RFV2_HopperSweepUnauthorized();
        amount = sweepableHopperWei();
        if (amount == 0) return 0;

        hopperBalance -= amount;
        totalSweptToReserve += amount;
        forgeReserve.depositFromCollection{value: amount}();
        emit HopperSweptToReserve(amount, hopperBalance);
    }

    function withdrawCreatorProceeds() external onlyCreator nonReentrant {
        uint256 amount = accruedCreatorProceeds;
        if (amount == 0) return;
        accruedCreatorProceeds = 0;
        (bool ok,) = payable(creator).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();
        emit CreatorProceedsWithdrawn(creator, amount);
    }

    function pendingSupply() external view returns (uint32) {
        return totalCommitted - totalMinted;
    }

    function availableSupply() external view returns (uint32) {
        return maxSupply - totalCommitted;
    }

    function isRevealed(uint256 tokenId) external view returns (bool) {
        return ownerOf[tokenId] != address(0);
    }

    function recipeForToken(uint256 tokenId) external view returns (uint256) {
        if (ownerOf[tokenId] == address(0)) revert RF_NotMinted();
        return tokenId - 1;
    }

    function _drawUnusedToken(uint256 entropy, uint32 remaining)
        internal
        returns (uint256 tokenId)
    {
        if (remaining == 0) revert RF_SoldOut();

        uint256 pick = entropy % remaining;
        uint256 selected = _poolValue(pick);
        uint256 lastIndex = uint256(remaining) - 1;

        if (pick != lastIndex) {
            uint256 last = _poolValue(lastIndex);
            _poolSwapPlusOne[pick] = last + 1;
        }

        tokenId = selected + 1;
    }

    function _poolValue(uint256 index) internal view returns (uint256) {
        uint256 stored = _poolSwapPlusOne[index];
        return stored == 0 ? index : stored - 1;
    }

    receive() external payable {}
}
