// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

/// @title RelicForgeMintV2Harness
/// @notice Phase 1 prototype for "Forge Reveal": reserve first, then mint a random unused NFT
///         only after verified randomness arrives. The ERC-721 never exists in an unrevealed state.
/// @dev EXPERIMENTAL ONLY. Not a production ERC-721 and not intended for deployment.
contract RelicForgeMintV2Harness is IRelicRandomnessConsumerV1 {
    uint32 public constant MAX_FORGE_BATCH = 50;
    uint32 public constant AUTO_SETTLE_TOKEN_BUDGET = 50;

    struct Reservation {
        address recipient;
        uint32 quantity;
        uint256 requestId;
        uint256 randomWord;
        bool wordReady;
        bool settled;
    }

    address public immutable randomnessProvider;
    uint32 public immutable maxSupply;

    uint32 public totalCommitted;
    uint32 public totalMinted;
    uint64 public nextReservationSequence = 1;
    uint64 public nextSettleSequence = 1;

    mapping(uint64 => Reservation) public reservations;
    mapping(uint256 => uint64) public requestIdToSequence;

    // Sparse Fisher-Yates deck. Default value at index i is i.
    // Only swapped positions require storage.
    mapping(uint256 => uint256) private _poolSwapPlusOne;

    // Prototype ownership state. Random token ID == recipe ID + 1.
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event ForgeReserved(
        uint64 indexed sequence,
        uint256 indexed requestId,
        address indexed recipient,
        uint32 quantity
    );
    event ForgeRandomnessReady(uint64 indexed sequence, uint256 indexed requestId);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event ForgeSettled(uint64 indexed sequence, uint256 indexed requestId, uint32 quantity);

    constructor(address randomnessProvider_, uint32 maxSupply_) {
        if (randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0) revert RF_BadProvider();
        if (maxSupply_ == 0) revert RF_BadConfig();
        randomnessProvider = randomnessProvider_;
        maxSupply = maxSupply_;
    }

    /// @notice Collector signs once. This reserves supply but does NOT mint a placeholder NFT.
    function requestForgeMint(address recipient, uint32 quantity)
        external
        returns (uint64 sequence, uint256 requestId)
    {
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_FORGE_BATCH) revert RF_BatchLimit();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        sequence = nextReservationSequence++;
        totalCommitted += quantity;

        requestId = IRelicRandomnessProviderV1(randomnessProvider).requestRandomness(sequence);
        if (requestId == 0 || requestIdToSequence[requestId] != 0) revert RF_BadRequest();

        reservations[sequence] = Reservation({
            recipient: recipient,
            quantity: quantity,
            requestId: requestId,
            randomWord: 0,
            wordReady: false,
            settled: false
        });
        requestIdToSequence[requestId] = sequence;

        emit ForgeReserved(sequence, requestId, recipient, quantity);
    }

    /// @notice Provider callback stores the verified word and attempts bounded in-order settlement.
    /// @dev Strict reservation order prevents a provider/sequencer from biasing draws by choosing
    ///      which already-known random callback gets settled against the remaining deck first.
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();

        uint64 sequence = requestIdToSequence[requestId];
        if (sequence == 0) revert RF_BadRequest();

        Reservation storage reservation = reservations[sequence];
        if (reservation.wordReady) revert RF_AlreadyFulfilled();

        reservation.wordReady = true;
        reservation.randomWord = randomWord;
        emit ForgeRandomnessReady(sequence, requestId);

        _settleReady(AUTO_SETTLE_TOKEN_BUDGET);
    }

    /// @notice Permissionless recovery/continuation if callbacks arrived out of order or callback
    ///         gas was not enough to drain a ready backlog. No collector or creator signature is required.
    function settleReady(uint32 maxTokens) external returns (uint32 tokensSettled) {
        if (maxTokens == 0) revert RF_ZeroQuantity();
        tokensSettled = _settleReady(maxTokens);
    }

    function _settleReady(uint32 maxTokens) internal returns (uint32 tokensSettled) {
        uint64 sequence = nextSettleSequence;

        while (sequence < nextReservationSequence) {
            Reservation storage reservation = reservations[sequence];
            if (!reservation.wordReady || reservation.settled) break;

            uint32 quantity = reservation.quantity;
            if (uint256(tokensSettled) + quantity > maxTokens) break;

            // Lock before minting.
            reservation.settled = true;

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

            emit ForgeSettled(sequence, reservation.requestId, quantity);

            unchecked { ++sequence; }
            nextSettleSequence = sequence;
        }
    }

    /// @dev Draw a random unused token ID from [1,maxSupply] with one sparse swap write at most.
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

    /// @notice In Forge Reveal, the random token ID itself selects the compiled recipe.
    function recipeForToken(uint256 tokenId) external view returns (uint256) {
        if (ownerOf[tokenId] == address(0)) revert RF_NotMinted();
        return tokenId - 1;
    }

    function isRevealed(uint256 tokenId) external view returns (bool) {
        return ownerOf[tokenId] != address(0);
    }
}
