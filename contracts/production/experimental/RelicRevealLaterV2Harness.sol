// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "./RFRevealPermutationV2.sol";

/// @title RelicRevealLaterV2Harness
/// @notice Phase 1 prototype for traditional one-shot reveal with O(1) onchain state.
/// @dev EXPERIMENTAL ONLY. A single verified random word establishes a bijective token->recipe mapping.
///      No per-token reveal writes and no processReveal loop are required.
contract RelicRevealLaterV2Harness is IRelicRandomnessConsumerV1 {
    address public immutable controller;
    address public immutable randomnessProvider;
    uint32 public immutable maxSupply;

    uint32 public totalMinted;
    bool public revealRequested;
    bool public revealed;
    uint256 public revealRequestId;
    uint256 public revealSeed;
    uint256 public revealMultiplier;
    uint256 public revealOffset;

    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event RevealRequestedV2(uint256 indexed requestId, uint32 mintedSupply);
    event RevealCompletedV2(
        uint256 indexed requestId,
        uint256 seed,
        uint256 multiplier,
        uint256 offset
    );
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);

    constructor(address randomnessProvider_, uint32 maxSupply_) {
        if (randomnessProvider_ == address(0) || randomnessProvider_.code.length == 0) revert RF_BadProvider();
        if (maxSupply_ == 0) revert RF_BadConfig();
        controller = msg.sender;
        randomnessProvider = randomnessProvider_;
        maxSupply = maxSupply_;
    }

    /// @notice Prototype hidden sequential mint. Once reveal is requested, minting is frozen so
    ///         the public reveal seed cannot be used to snipe future token assignments.
    function mintHidden(address recipient, uint32 quantity) external {
        if (msg.sender != controller) revert RF_NotController();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (revealRequested || revealed) revert RF_EpochPending();
        if (uint256(totalMinted) + quantity > maxSupply) revert RF_SoldOut();

        uint32 start = totalMinted + 1;
        balanceOf[recipient] += quantity;

        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = uint256(start) + i;
            ownerOf[tokenId] = recipient;
            emit Transfer(address(0), recipient, tokenId);
        }

        totalMinted += quantity;
    }

    function requestReveal() external returns (uint256 requestId) {
        if (msg.sender != controller) revert RF_NotController();
        if (revealRequested || revealed) revert RF_EpochPending();
        if (totalMinted == 0) revert RF_NoDeferredTokens();

        revealRequested = true;
        requestId = IRelicRandomnessProviderV1(randomnessProvider).requestRandomness(totalMinted);
        if (requestId == 0) revert RF_BadRequest();
        revealRequestId = requestId;

        emit RevealRequestedV2(requestId, totalMinted);
    }

    /// @notice One callback stores all reveal state for the whole collection.
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (msg.sender != randomnessProvider) revert RF_NotRandomnessProvider();
        if (!revealRequested || revealed || requestId != revealRequestId) revert RF_BadRequest();

        (uint256 multiplier, uint256 offset) =
            RFRevealPermutationV2.derive(randomWord, maxSupply);

        revealSeed = randomWord;
        revealMultiplier = multiplier;
        revealOffset = offset;
        revealed = true;

        emit RevealCompletedV2(requestId, randomWord, multiplier, offset);
        emit BatchMetadataUpdate(1, totalMinted);
    }

    function recipeForToken(uint256 tokenId) public view returns (uint256) {
        if (ownerOf[tokenId] == address(0)) revert RF_NotMinted();
        if (!revealed) revert RF_NotRevealed();

        return RFRevealPermutationV2.permute(
            tokenId - 1,
            maxSupply,
            revealMultiplier,
            revealOffset
        );
    }

    function isRevealed(uint256 tokenId) external view returns (bool) {
        return revealed && ownerOf[tokenId] != address(0);
    }
}
