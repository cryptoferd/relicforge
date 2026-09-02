// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeBatchQueueV2Harness.sol";
import "./RelicRobinhoodRandomnessBindingV2Candidate.sol";

error RFV2_ContributionRequired();
error RFV2_BadContribution();
error RFV2_ContributionNotReady();

/// @notice Minimal collection-side seam consumed by the R11 Dice contribution source.
interface IRelicFrozenBatchContributionV2 {
    function randomnessProvider() external view returns (address);
    function frozenRandomnessContribution(uint256 context) external view returns (bytes32 contribution, bool ready);
}

/// @title RelicCollectorBatchContributionSourceV2Candidate
/// @notice R11 production-advancement candidate for Dice's independent user contribution.
/// @dev The permissionless RNG executor cannot select the contribution. The contribution is derived from
///      collector/team entropy that was accepted with reservations before the Forge batch was locked.
///      The source only serves canonical collections, and only the randomness adapter already bound to that
///      collection may consume its frozen contribution.
contract RelicCollectorBatchContributionSourceV2Candidate is IRelicDiceContributionSourceV2 {
    bytes32 public constant CONTRIBUTION_POLICY_FINGERPRINT = keccak256(
        "RELIC_FORGE_DICE_CONTRIBUTION_V2|COLLECTOR_ENTROPY|FROZEN_BEFORE_REQUEST|EXECUTOR_INDEPENDENT|CANONICAL_ONLY"
    );

    IRelicCanonicalCollectionRegistryV2 public immutable canonicalCollectionRegistry;
    mapping(bytes32 => bool) public usedContribution;

    event CollectorBatchContributionConsumed(
        address indexed consumer, uint256 indexed context, uint256 indexed localRequestId, bytes32 contribution
    );

    constructor(address canonicalCollectionRegistry_) {
        if (canonicalCollectionRegistry_ == address(0) || canonicalCollectionRegistry_.code.length == 0) {
            revert RF_BadConfig();
        }
        canonicalCollectionRegistry = IRelicCanonicalCollectionRegistryV2(canonicalCollectionRegistry_);
    }

    function previewContribution(address consumer, uint256 context) public view returns (bytes32 contribution) {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
        (bytes32 frozenContribution, bool ready) =
            IRelicFrozenBatchContributionV2(consumer).frozenRandomnessContribution(context);
        if (!ready || frozenContribution == bytes32(0)) revert RFV2_ContributionNotReady();

        contribution = keccak256(
            abi.encode(
                "RELIC_FORGE_DICE_CONTRIBUTION_V2", block.chainid, address(this), consumer, context, frozenContribution
            )
        );
        if (contribution == bytes32(0)) revert RFV2_BadContribution();
    }

    function contributionForRequest(address consumer, uint256 context, uint256 localRequestId)
        external
        returns (bytes32 userRandomNumber)
    {
        if (!canonicalCollectionRegistry.isCanonicalCollection(consumer)) revert RF_NotAuthorized();
        if (IRelicFrozenBatchContributionV2(consumer).randomnessProvider() != msg.sender) revert RF_NotAuthorized();

        userRandomNumber = previewContribution(consumer, context);
        if (usedContribution[userRandomNumber]) revert RFV2_BadContribution();
        usedContribution[userRandomNumber] = true;

        emit CollectorBatchContributionConsumed(consumer, context, localRequestId, userRandomNumber);
    }
}

/// @title RelicForgeContributionQueueV2Harness
/// @notice R11 Phase 2C queue extension that requires collector/team supplied entropy for Forge batches.
/// @dev EXPERIMENTAL ONLY. The existing two-argument mint entrypoints are intentionally disabled here.
///      Frontends generate a fresh bytes32 off-chain and pass it with the mint. The queue hashes that entropy
///      into the reservation/batch accumulator before the transaction completes. A locked batch therefore has
///      one deterministic frozen contribution before any permissionless RNG executor can request Dice.
contract RelicForgeContributionQueueV2Harness is RelicForgeBatchQueueV2Harness {
    mapping(uint64 => bytes32) public batchContributionAccumulator;

    event ForgeReservationEntropyAccepted(
        uint64 indexed reservationId, uint64 indexed batchId, address indexed payer, bytes32 entropyDigest
    );

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
    )
        payable
        RelicForgeBatchQueueV2Harness(
            creator_,
            randomnessProvider_,
            forgeReserve_,
            feeMode_,
            maxSupply_,
            batchWindowSeconds_,
            mintPriceWei_,
            sponsoredFeePerTokenWei_,
            minterFeePerTokenWei_,
            creatorMintFeePerTokenWei_,
            maxRandomnessCostPerBatchWei_
        )
    {}

    /// @notice R11 production-advancement queue requires explicit collector entropy.
    function requestForgeMint(address, uint32) external payable override returns (uint64, uint64) {
        revert RFV2_ContributionRequired();
    }

    /// @notice Entropy-aware collector path. Entropy is generated off-chain by the collector UI/wallet client.
    function requestForgeMint(address recipient, uint32 quantity, bytes32 collectorEntropy)
        external
        payable
        nonReentrant
        returns (uint64 firstReservationId, uint64 lastReservationId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (quantity > MAX_BATCH_NFTS) revert RF_BatchLimit();
        if (collectorEntropy == bytes32(0)) revert RFV2_BadContribution();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint256 platformFeePerToken = feeMode == FEE_MODE_MINTER_SUPPORTED ? minterFeePerTokenWei : 0;
        uint256 required = (mintPriceWei + platformFeePerToken) * quantity;
        if (msg.value != required) revert RF_WrongPrice();

        uint64 startingBatchId = openBatchId;
        (firstReservationId, lastReservationId) =
            _queueReservation(msg.sender, recipient, quantity, mintPriceWei, platformFeePerToken, false);
        _accumulateCallEntropy(startingBatchId, firstReservationId, lastReservationId, collectorEntropy);
    }

    /// @notice R11 production-advancement queue requires explicit creator/team entropy too.
    function creatorMint(address, uint32) external payable override returns (uint64, uint64) {
        revert RFV2_ContributionRequired();
    }

    /// @notice Entropy-aware creator/team allocation. A single call may span multiple 20-NFT Forge batches.
    function creatorMint(address recipient, uint32 quantity, bytes32 creatorEntropy)
        external
        payable
        onlyCreator
        nonReentrant
        returns (uint64 firstReservationId, uint64 lastReservationId)
    {
        if (forgePaused) revert RF_PublicSalePaused();
        if (recipient == address(0)) revert RF_InvalidRecipient();
        if (quantity == 0) revert RF_ZeroQuantity();
        if (creatorEntropy == bytes32(0)) revert RFV2_BadContribution();
        if (uint256(totalCommitted) + quantity > maxSupply) revert RF_SoldOut();

        uint256 teamFeePerToken = feeMode == FEE_MODE_MINTER_SUPPORTED ? creatorMintFeePerTokenWei : 0;
        if (msg.value != teamFeePerToken * quantity) revert RF_WrongPrice();

        uint64 startingBatchId = openBatchId;
        (firstReservationId, lastReservationId) =
            _queueReservation(msg.sender, recipient, quantity, 0, teamFeePerToken, true);
        _accumulateCallEntropy(startingBatchId, firstReservationId, lastReservationId, creatorEntropy);
    }

    function _accumulateCallEntropy(
        uint64 startingBatchId,
        uint64 firstReservationId,
        uint64 lastReservationId,
        bytes32 suppliedEntropy
    ) internal {
        bytes32 entropyDigest = keccak256(abi.encode(msg.sender, suppliedEntropy));
        uint64 endingBatchId = openBatchId;

        for (uint64 batchId = startingBatchId; batchId <= endingBatchId; ++batchId) {
            ForgeBatch storage batch = batches[batchId];
            if (batch.firstReservationId == 0) continue;

            uint64 fromReservation =
                batch.firstReservationId > firstReservationId ? batch.firstReservationId : firstReservationId;
            uint64 toReservation =
                batch.lastReservationId < lastReservationId ? batch.lastReservationId : lastReservationId;
            if (fromReservation > toReservation) continue;

            bytes32 accumulator = batchContributionAccumulator[batchId];
            for (uint64 reservationId = fromReservation; reservationId <= toReservation; ++reservationId) {
                Reservation storage reservation = reservations[reservationId];
                bytes32 leaf = keccak256(
                    abi.encode(
                        "RELIC_FORGE_RESERVATION_ENTROPY_V2",
                        block.chainid,
                        address(this),
                        batchId,
                        reservationId,
                        reservation.payer,
                        reservation.recipient,
                        reservation.quantity,
                        suppliedEntropy
                    )
                );
                accumulator = keccak256(abi.encode(accumulator, leaf));
                emit ForgeReservationEntropyAccepted(reservationId, batchId, reservation.payer, entropyDigest);
            }
            batchContributionAccumulator[batchId] = accumulator;
        }
    }

    /// @notice Returns a contribution only after the batch is immutable/locked.
    /// @dev No timestamp, blockhash, prevrandao, sequencer entropy, or permissionless executor input is used.
    function frozenRandomnessContribution(uint256 context) external view returns (bytes32 contribution, bool ready) {
        if (context == 0 || context > type(uint64).max) return (bytes32(0), false);
        uint64 batchId = uint64(context);
        ForgeBatch storage batch = batches[batchId];
        bytes32 accumulator = batchContributionAccumulator[batchId];
        if (!batch.locked || accumulator == bytes32(0)) return (bytes32(0), false);

        contribution = keccak256(
            abi.encode(
                "RELIC_FORGE_FROZEN_BATCH_CONTRIBUTION_V2",
                block.chainid,
                address(this),
                batchId,
                accumulator,
                batch.firstReservationId,
                batch.lastReservationId,
                batch.reservationCount,
                batch.totalQuantity
            )
        );
        ready = contribution != bytes32(0);
    }
}
