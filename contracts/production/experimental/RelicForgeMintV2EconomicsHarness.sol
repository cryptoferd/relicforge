// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

interface IRelicRandomnessFailureViewForForgeV2 {
    function requestFailed(uint256 requestId) external view returns (bool);
}

/// @title RelicForgeMintV2EconomicsHarness
/// @notice Phase 2 prototype adding money accounting and failure recovery to Forge Reveal V2.
/// @dev EXPERIMENTAL ONLY. This is not the production ERC-721.
contract RelicForgeMintV2EconomicsHarness is IRelicRandomnessConsumerV1 {
    uint32 public constant MAX_FORGE_BATCH = 50;
    uint32 public constant AUTO_SETTLE_TOKEN_BUDGET = 50;

    struct Reservation {
        address payer;
        address recipient;
        uint32 quantity;
        uint256 requestId;
        uint256 randomWord;
        uint256 escrowValue;
        uint256 creatorValue;
        uint256 platformValue;
        bool wordReady;
        bool settled;
        bool refunded;
    }

    address public immutable controller;
    address public immutable randomnessProvider;
    address payable public immutable payoutReceiver;
    address payable public immutable platformTreasury;
    uint32 public immutable maxSupply;
    uint256 public immutable mintPriceWei;
    uint256 public immutable platformFeePerTokenWei;

    bool public forgePaused;
    bool private _entered;

    uint32 public totalCommitted;
    uint32 public totalMinted;
    uint64 public nextReservationSequence = 1;
    uint64 public nextSettleSequence = 1;

    uint256 public escrowedValue;
    uint256 public accruedCreatorProceeds;
    uint256 public accruedPlatformFees;

    mapping(address => uint256) public refundCredit;
    mapping(uint64 => Reservation) public reservations;
    mapping(uint256 => uint64) public requestIdToSequence;

    mapping(uint256 => uint256) private _poolSwapPlusOne;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event ForgePauseChanged(bool paused);
    event ForgeReserved(
        uint64 indexed sequence,
        uint256 indexed requestId,
        address indexed payer,
        address recipient,
        uint32 quantity,
        uint256 escrowValue
    );
    event ForgeRandomnessReady(uint64 indexed sequence, uint256 indexed requestId);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event ForgeSettled(
        uint64 indexed sequence,
        uint256 indexed requestId,
        uint32 quantity,
        uint256 creatorValue,
        uint256 platformValue
    );
    event ForgeRefunded(
        uint64 indexed sequence,
        uint256 indexed requestId,
        address indexed payer,
        uint256 amount
    );
    event RefundClaimed(address indexed payer, uint256 amount);
    event CreatorProceedsWithdrawn(address indexed receiver, uint256 amount);
    event PlatformFeesWithdrawn(address indexed receiver, uint256 amount);

    modifier nonReentrant() {
        if (_entered) revert RF_Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert RF_NotController();
        _;
    }

    constructor(
        address randomnessProvider_,
        uint32 maxSupply_,
        uint256 mintPriceWei_,
        uint256 platformFeePerTokenWei_,
        address payable payoutReceiver_,
        address payable platformTreasury_
    ) {
        if (randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0) revert RF_BadProvider();
        if (maxSupply_ == 0) revert RF_BadConfig();
        if (payoutReceiver_ == address(0) || platformTreasury_ == address(0)) revert RF_ZeroAddress();

        controller = msg.sender;
        randomnessProvider = randomnessProvider_;
        maxSupply = maxSupply_;
        mintPriceWei = mintPriceWei_;
        platformFeePerTokenWei = platformFeePerTokenWei_;
        payoutReceiver = payoutReceiver_;
        platformTreasury = platformTreasury_;
    }

    function setForgePaused(bool paused) external onlyController {
        forgePaused = paused;
        emit ForgePauseChanged(paused);
    }

    /// @notice Collector signs exactly once. Funds remain escrowed until the random mint succeeds.
    function requestForgeMint(address recipient, uint32 quantity)
        external
        payable
        nonReentrant
        returns (uint64 sequence, uint256 requestId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_FORGE_BATCH) revert RF_BatchLimit();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint256 creatorValue = mintPriceWei * quantity;
        uint256 platformValue = platformFeePerTokenWei * quantity;
        uint256 requiredValue = creatorValue + platformValue;
        if (msg.value != requiredValue) revert RF_WrongPrice();

        sequence = nextReservationSequence++;
        totalCommitted += quantity;
        escrowedValue += requiredValue;

        requestId = IRelicRandomnessProviderV1(randomnessProvider).requestRandomness(sequence);
        if (requestId == 0 || requestIdToSequence[requestId] != 0) revert RF_BadRequest();

        reservations[sequence] = Reservation({
            payer: msg.sender,
            recipient: recipient,
            quantity: quantity,
            requestId: requestId,
            randomWord: 0,
            escrowValue: requiredValue,
            creatorValue: creatorValue,
            platformValue: platformValue,
            wordReady: false,
            settled: false,
            refunded: false
        });
        requestIdToSequence[requestId] = sequence;

        emit ForgeReserved(sequence, requestId, msg.sender, recipient, quantity, requiredValue);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();

        uint64 sequence = requestIdToSequence[requestId];
        if (sequence == 0) revert RF_BadRequest();

        Reservation storage reservation = reservations[sequence];
        if (reservation.refunded) revert RF_BadRequest();
        if (reservation.wordReady) revert RF_AlreadyFulfilled();

        reservation.wordReady = true;
        reservation.randomWord = randomWord;
        emit ForgeRandomnessReady(sequence, requestId);

        _settleReady(AUTO_SETTLE_TOKEN_BUDGET);
    }

    /// @notice Permissionless; no second collector/creator signature is required.
    function settleReady(uint32 maxTokens) external returns (uint32 tokensSettled) {
        if (maxTokens == 0) revert RF_ZeroQuantity();
        tokensSettled = _settleReady(maxTokens);
    }

    /// @notice Refund only after the configured adapter reports an irreversible terminal failure.
    /// @dev A timeout alone is intentionally NOT sufficient: allowing cancellation while a valid
    ///      random word might still arrive could create selective-abort / rarity-sniping behavior.
    function refundFailedReservation(uint64 sequence) external nonReentrant {
        Reservation storage reservation = reservations[sequence];
        if (
            reservation.payer == address(0) ||
            reservation.settled ||
            reservation.refunded ||
            reservation.wordReady
        ) revert RF_BadRequest();

        bool failed =
            IRelicRandomnessFailureViewForForgeV2(randomnessProvider).requestFailed(reservation.requestId);
        if (!failed) revert RF_BadRequest();

        reservation.refunded = true;
        escrowedValue -= reservation.escrowValue;
        refundCredit[reservation.payer] += reservation.escrowValue;
        totalCommitted -= reservation.quantity;

        emit ForgeRefunded(
            sequence,
            reservation.requestId,
            reservation.payer,
            reservation.escrowValue
        );

        // If this closed the next sequence gap, later ready reservations may now settle.
        _settleReady(AUTO_SETTLE_TOKEN_BUDGET);
    }

    function claimRefund() external nonReentrant {
        uint256 amount = refundCredit[msg.sender];
        if (amount == 0) return;

        refundCredit[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit RefundClaimed(msg.sender, amount);
    }

    /// @notice Anyone may trigger payment, but proceeds can only go to the immutable payout receiver.
    function withdrawCreatorProceeds() external nonReentrant {
        uint256 amount = accruedCreatorProceeds;
        if (amount == 0) return;

        accruedCreatorProceeds = 0;
        (bool ok,) = payoutReceiver.call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit CreatorProceedsWithdrawn(payoutReceiver, amount);
    }

    /// @notice Anyone may trigger payment, but fees can only go to the immutable platform treasury.
    function withdrawPlatformFees() external nonReentrant {
        uint256 amount = accruedPlatformFees;
        if (amount == 0) return;

        accruedPlatformFees = 0;
        (bool ok,) = platformTreasury.call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit PlatformFeesWithdrawn(platformTreasury, amount);
    }

    function pendingSupply() external view returns (uint32) {
        return totalCommitted - totalMinted;
    }

    function availableSupply() external view returns (uint32) {
        return maxSupply - totalCommitted;
    }

    function _settleReady(uint32 maxTokens) internal returns (uint32 tokensSettled) {
        uint64 sequence = nextSettleSequence;

        while (sequence < nextReservationSequence) {
            Reservation storage reservation = reservations[sequence];

            if (reservation.refunded) {
                unchecked { ++sequence; }
                nextSettleSequence = sequence;
                continue;
            }

            if (!reservation.wordReady || reservation.settled) break;

            uint32 quantity = reservation.quantity;
            if (uint256(tokensSettled) + quantity > maxTokens) break;

            // Effects first.
            reservation.settled = true;
            escrowedValue -= reservation.escrowValue;
            accruedCreatorProceeds += reservation.creatorValue;
            accruedPlatformFees += reservation.platformValue;

            address recipient = reservation.recipient;
            balanceOf[recipient] += quantity;

            uint32 mintedBefore = totalMinted;
            uint32 remaining = maxSupply - mintedBefore;

            for (uint32 i; i < quantity; ++i) {
                uint256 entropy = uint256(
                    keccak256(
                        abi.encode(
                            reservation.randomWord,
                            address(this),
                            sequence,
                            i,
                            recipient
                        )
                    )
                );

                uint256 tokenId = _drawUnusedToken(entropy, remaining);
                unchecked { --remaining; }

                if (ownerOf[tokenId] != address(0)) revert RF_AlreadyRevealed();
                ownerOf[tokenId] = recipient;
                emit Transfer(address(0), recipient, tokenId);
            }

            totalMinted = mintedBefore + quantity;
            tokensSettled += quantity;

            emit ForgeSettled(
                sequence,
                reservation.requestId,
                quantity,
                reservation.creatorValue,
                reservation.platformValue
            );

            unchecked { ++sequence; }
            nextSettleSequence = sequence;
        }
    }

    function _drawUnusedToken(uint256 entropy, uint32 remaining) internal returns (uint256 tokenId) {
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
