// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

interface IRelicBatchRandomnessFailureViewV2 {
    function requestFailed(uint256 requestId) external view returns (bool);
}

/// @title RelicForgeBatchMintV2Harness
/// @notice Phase 2B prototype: many collector reservations share ONE verified randomness request.
/// @dev EXPERIMENTAL ONLY. The provider callback only stores the verified word. Permissionless
///      settlement later mints all NFTs in strict batch order, already revealed.
contract RelicForgeBatchMintV2Harness is IRelicRandomnessConsumerV1 {
    struct Reservation {
        address payer;
        address recipient;
        uint32 quantity;
        uint256 escrowValue;
        uint256 creatorValue;
        uint256 platformValue;
        bool settled;
        bool refunded;
    }

    struct ForgeBatch {
        uint64 firstReservationId;
        uint64 lastReservationId;
        uint64 openedAt;
        uint32 reservationCount;
        uint32 totalQuantity;
        uint256 requestId;
        uint256 randomWord;
        bool closed;
        bool wordReady;
        bool settled;
        bool refunded;
    }

    address public immutable controller;
    address public immutable randomnessProvider;
    address payable public immutable payoutReceiver;
    address payable public immutable platformTreasury;
    uint32 public immutable maxSupply;
    uint32 public immutable maxBatchNfts;
    uint64 public immutable batchWindowSeconds;
    uint256 public immutable mintPriceWei;
    uint256 public immutable platformFeePerTokenWei;

    bool public forgePaused;
    bool private _entered;
    uint32 public totalCommitted;
    uint32 public totalMinted;
    uint64 public nextReservationId = 1;
    uint64 public openBatchId = 1;
    uint64 public nextSettleBatchId = 1;

    uint256 public escrowedValue;
    uint256 public accruedCreatorProceeds;
    uint256 public accruedPlatformFees;

    mapping(uint64 => Reservation) public reservations;
    mapping(uint64 => ForgeBatch) public batches;
    mapping(uint256 => uint64) public requestIdToBatchId;
    mapping(address => uint256) public refundCredit;

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
        uint256 escrowValue
    );
    event ForgeBatchClosed(
        uint64 indexed batchId,
        uint256 indexed requestId,
        uint32 reservationCount,
        uint32 totalQuantity
    );
    event ForgeBatchRandomnessReady(uint64 indexed batchId, uint256 indexed requestId);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event ForgeBatchSettled(
        uint64 indexed batchId,
        uint256 indexed requestId,
        uint32 reservationCount,
        uint32 totalQuantity
    );
    event ForgeBatchRefunded(uint64 indexed batchId, uint256 indexed requestId, uint32 totalQuantity);
    event RefundClaimed(address indexed payer, uint256 amount);

    modifier onlyController() {
        if (msg.sender != controller) revert RF_NotController();
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert RF_Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(
        address randomnessProvider_,
        uint32 maxSupply_,
        uint32 maxBatchNfts_,
        uint64 batchWindowSeconds_,
        uint256 mintPriceWei_,
        uint256 platformFeePerTokenWei_,
        address payable payoutReceiver_,
        address payable platformTreasury_
    ) {
        if (randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0) revert RF_BadProvider();
        if (maxSupply_ == 0 || maxBatchNfts_ == 0 || maxBatchNfts_ > maxSupply_) revert RF_BadConfig();
        if (batchWindowSeconds_ == 0) revert RF_BadConfig();
        if (payoutReceiver_ == address(0) || platformTreasury_ == address(0)) revert RF_ZeroAddress();

        controller = msg.sender;
        randomnessProvider = randomnessProvider_;
        maxSupply = maxSupply_;
        maxBatchNfts = maxBatchNfts_;
        batchWindowSeconds = batchWindowSeconds_;
        mintPriceWei = mintPriceWei_;
        platformFeePerTokenWei = platformFeePerTokenWei_;
        payoutReceiver = payoutReceiver_;
        platformTreasury = platformTreasury_;
    }

    function setForgePaused(bool paused) external onlyController {
        forgePaused = paused;
        emit ForgePauseChanged(paused);
    }

    function requestForgeMint(address recipient, uint32 quantity)
        external
        payable
        nonReentrant
        returns (uint64 reservationId, uint64 batchId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > maxBatchNfts) revert RF_BatchLimit();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        ForgeBatch storage current = batches[openBatchId];
        if (current.totalQuantity != 0 && uint256(current.totalQuantity) + quantity > maxBatchNfts) {
            _closeOpenBatch();
        }

        batchId = openBatchId;
        ForgeBatch storage batch = batches[batchId];

        uint256 creatorValue = mintPriceWei * quantity;
        uint256 platformValue = platformFeePerTokenWei * quantity;
        uint256 requiredValue = creatorValue + platformValue;
        if (msg.value != requiredValue) revert RF_WrongPrice();

        reservationId = nextReservationId++;
        if (batch.firstReservationId == 0) {
            batch.firstReservationId = reservationId;
            batch.openedAt = uint64(block.timestamp);
        }
        batch.lastReservationId = reservationId;
        ++batch.reservationCount;
        batch.totalQuantity += quantity;

        reservations[reservationId] = Reservation({
            payer: msg.sender,
            recipient: recipient,
            quantity: quantity,
            escrowValue: requiredValue,
            creatorValue: creatorValue,
            platformValue: platformValue,
            settled: false,
            refunded: false
        });

        totalCommitted += quantity;
        escrowedValue += requiredValue;

        emit ForgeReservationCreated(
            reservationId, batchId, msg.sender, recipient, quantity, requiredValue
        );

        if (batch.totalQuantity == maxBatchNfts) {
            _closeOpenBatch();
        }
    }

    function closeOpenBatch() external nonReentrant returns (uint64 batchId, uint256 requestId) {
        batchId = openBatchId;
        ForgeBatch storage batch = batches[batchId];
        if (batch.totalQuantity == 0 || batch.closed) revert RF_BadRequest();

        uint256 closesAt = uint256(batch.openedAt) + batchWindowSeconds;
        if (block.timestamp < closesAt && batch.totalQuantity < maxBatchNfts) revert RF_PhaseNotStarted();

        requestId = _closeOpenBatch();
    }

    function batchCanClose() external view returns (bool) {
        ForgeBatch storage batch = batches[openBatchId];
        if (batch.totalQuantity == 0 || batch.closed) return false;
        return batch.totalQuantity >= maxBatchNfts ||
            block.timestamp >= uint256(batch.openedAt) + batchWindowSeconds;
    }

    function _closeOpenBatch() internal returns (uint256 requestId) {
        uint64 batchId = openBatchId;
        ForgeBatch storage batch = batches[batchId];
        if (batch.totalQuantity == 0 || batch.closed) revert RF_BadRequest();

        batch.closed = true;
        requestId = IRelicRandomnessProviderV1(randomnessProvider).requestRandomness(batchId);
        if (requestId == 0 || requestIdToBatchId[requestId] != 0) revert RF_BadRequest();

        batch.requestId = requestId;
        requestIdToBatchId[requestId] = batchId;

        emit ForgeBatchClosed(batchId, requestId, batch.reservationCount, batch.totalQuantity);
        unchecked { ++openBatchId; }
    }

    /// @notice Provider callback intentionally stores only the verified word.
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();

        uint64 batchId = requestIdToBatchId[requestId];
        if (batchId == 0) revert RF_BadRequest();

        ForgeBatch storage batch = batches[batchId];
        if (!batch.closed || batch.refunded || batch.settled) revert RF_BadRequest();
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

            if (batch.refunded || batch.settled) {
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
    }

    function _settleBatch(uint64 batchId, ForgeBatch storage batch) internal {
        batch.settled = true;
        uint32 remaining = maxSupply - totalMinted;
        uint32 mintedThisBatch;

        for (uint64 reservationId = batch.firstReservationId;
            reservationId <= batch.lastReservationId;
            ++reservationId
        ) {
            Reservation storage reservation = reservations[reservationId];
            if (reservation.settled || reservation.refunded) revert RF_BadRequest();

            reservation.settled = true;
            escrowedValue -= reservation.escrowValue;
            accruedCreatorProceeds += reservation.creatorValue;
            accruedPlatformFees += reservation.platformValue;
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

                uint256 tokenId = _drawUnusedToken(entropy, remaining);
                unchecked {
                    --remaining;
                    ++mintedThisBatch;
                }

                if (ownerOf[tokenId] != address(0)) revert RF_AlreadyRevealed();
                ownerOf[tokenId] = reservation.recipient;
                emit Transfer(address(0), reservation.recipient, tokenId);
            }

            if (reservationId == batch.lastReservationId) break;
        }

        totalMinted += mintedThisBatch;
        emit ForgeBatchSettled(
            batchId, batch.requestId, batch.reservationCount, batch.totalQuantity
        );
    }

    function refundFailedBatch(uint64 batchId) external nonReentrant {
        ForgeBatch storage batch = batches[batchId];
        if (!batch.closed || batch.wordReady || batch.settled || batch.refunded || batch.requestId == 0) {
            revert RF_BadRequest();
        }

        bool failed =
            IRelicBatchRandomnessFailureViewV2(randomnessProvider).requestFailed(batch.requestId);
        if (!failed) revert RF_BadRequest();

        batch.refunded = true;
        uint256 batchEscrow;

        for (uint64 reservationId = batch.firstReservationId;
            reservationId <= batch.lastReservationId;
            ++reservationId
        ) {
            Reservation storage reservation = reservations[reservationId];
            if (reservation.settled || reservation.refunded) revert RF_BadRequest();

            reservation.refunded = true;
            refundCredit[reservation.payer] += reservation.escrowValue;
            batchEscrow += reservation.escrowValue;

            if (reservationId == batch.lastReservationId) break;
        }

        escrowedValue -= batchEscrow;
        totalCommitted -= batch.totalQuantity;
        emit ForgeBatchRefunded(batchId, batch.requestId, batch.totalQuantity);
    }

    function claimRefund() external nonReentrant {
        uint256 amount = refundCredit[msg.sender];
        if (amount == 0) return;

        refundCredit[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();
        emit RefundClaimed(msg.sender, amount);
    }

    function pendingSupply() external view returns (uint32) {
        return totalCommitted - totalMinted;
    }

    function availableSupply() external view returns (uint32) {
        return maxSupply - totalCommitted;
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

    function recipeForToken(uint256 tokenId) external view returns (uint256) {
        if (ownerOf[tokenId] == address(0)) revert RF_NotMinted();
        return tokenId - 1;
    }

    function isRevealed(uint256 tokenId) external view returns (bool) {
        return ownerOf[tokenId] != address(0);
    }

    receive() external payable {}
}
