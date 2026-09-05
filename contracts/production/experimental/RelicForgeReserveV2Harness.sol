// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";

error RFV2_CollectionNotRegistered();
error RFV2_CollectionAlreadyRegistered();
error RFV2_BadReserveDraw();
error RFV2_ReserveSubsidyCap();
error RFV2_NoRevenueAvailable();

interface IRelicForgeReserveCollectionV2 {
    function reserveExposureWei() external view returns (uint256);
    function restrictedSponsoredLiabilityWei() external view returns (uint256);
    function activeForgeBatchCount() external view returns (uint256);
    function randomnessShortfallFor(uint64 batchId) external view returns (uint256);
    function sweepExcessToReserve() external returns (uint256 amount);
}

/// @title RelicForgeReserveV2Harness
/// @notice Phase 2C chain-local Forge Reserve / revenue-boundary prototype.
/// @dev EXPERIMENTAL ONLY. Native funds stay on the chain. There is intentionally no bridge/swap logic.
contract RelicForgeReserveV2Harness {
    address public founder;
    address payable public revenueTreasury;

    uint256 public minimumReserveWei;
    uint256 public perActiveBatchBufferWei;
    uint32 public exposureSafetyBps;
    uint256 public maxSubsidyPerRequestWei;
    uint256 public maxSubsidyPerCollectionWei;

    uint256 public totalExposureWei;
    uint256 public totalRestrictedSponsoredLiabilityWei;
    uint256 public totalActiveBatches;
    uint256 public activeCollectionCount;
    uint256 public totalRevenueReleased;

    mapping(address => bool) public canonicalCollection;
    mapping(address => uint256) public collectionExposureWei;
    mapping(address => uint256) public collectionRestrictedSponsoredLiabilityWei;
    mapping(address => uint256) public collectionActiveBatches;
    mapping(address => uint256) public collectionLifetimeSubsidyWei;
    mapping(address => uint256) public collectionDepositsWei;
    address[] public collections;

    event CollectionRegistered(address indexed collection);
    event CollectionSynced(
        address indexed collection,
        uint256 exposureWei,
        uint256 restrictedSponsoredLiabilityWei,
        uint256 activeBatches
    );
    event CollectionDeposit(address indexed collection, uint256 amount);
    event CollectionExcessPulled(address indexed collection, uint256 amount, address indexed caller);
    event RandomnessShortfallFunded(address indexed collection, uint64 indexed batchId, uint256 amount);
    event RevenueReleased(address indexed treasury, uint256 amount, uint256 requiredReserveAfter);
    event ReservePolicyUpdated(
        uint256 minimumReserveWei,
        uint256 perActiveBatchBufferWei,
        uint32 exposureSafetyBps,
        uint256 maxSubsidyPerRequestWei,
        uint256 maxSubsidyPerCollectionWei
    );
    event RevenueTreasuryUpdated(address indexed treasury);
    event FounderTransferred(address indexed oldFounder, address indexed newFounder);

    modifier onlyFounder() {
        if (msg.sender != founder) revert RF_NotAuthorized();
        _;
    }

    constructor(
        address founder_,
        address payable revenueTreasury_,
        uint256 minimumReserveWei_,
        uint256 perActiveBatchBufferWei_,
        uint32 exposureSafetyBps_,
        uint256 maxSubsidyPerRequestWei_,
        uint256 maxSubsidyPerCollectionWei_
    ) payable {
        if (founder_ == address(0) || revenueTreasury_ == address(0)) revert RF_ZeroAddress();
        if (exposureSafetyBps_ < 10_000 || exposureSafetyBps_ > 50_000) revert RF_BadConfig();
        if (maxSubsidyPerRequestWei_ == 0 || maxSubsidyPerCollectionWei_ == 0) revert RF_BadConfig();

        founder = founder_;
        revenueTreasury = revenueTreasury_;
        minimumReserveWei = minimumReserveWei_;
        perActiveBatchBufferWei = perActiveBatchBufferWei_;
        exposureSafetyBps = exposureSafetyBps_;
        maxSubsidyPerRequestWei = maxSubsidyPerRequestWei_;
        maxSubsidyPerCollectionWei = maxSubsidyPerCollectionWei_;
    }

    function registerCollection(address collection) external onlyFounder {
        if (collection == address(0) || collection.code.length == 0) revert RF_BadConfig();
        if (canonicalCollection[collection]) revert RFV2_CollectionAlreadyRegistered();

        canonicalCollection[collection] = true;
        collections.push(collection);
        emit CollectionRegistered(collection);
        _syncCollection(collection);
    }

    function collectionCount() external view returns (uint256) {
        return collections.length;
    }

    /// @notice Permissionless sync. Production may replace O(N) revenue snapshots with a paginated active-set registry.
    function syncCollection(address collection) public {
        if (!canonicalCollection[collection]) revert RFV2_CollectionNotRegistered();
        _syncCollection(collection);
    }

    function syncAllCollections() public {
        uint256 count = collections.length;
        for (uint256 i; i < count; ++i) {
            _syncCollection(collections[i]);
        }
    }

    function _syncCollection(address collection) internal {
        uint256 oldExposure = collectionExposureWei[collection];
        uint256 oldRestricted = collectionRestrictedSponsoredLiabilityWei[collection];
        uint256 oldActive = collectionActiveBatches[collection];

        uint256 newExposure = IRelicForgeReserveCollectionV2(collection).reserveExposureWei();
        uint256 newRestricted =
            IRelicForgeReserveCollectionV2(collection).restrictedSponsoredLiabilityWei();
        uint256 newActive = IRelicForgeReserveCollectionV2(collection).activeForgeBatchCount();

        if (newExposure >= oldExposure) totalExposureWei += newExposure - oldExposure;
        else totalExposureWei -= oldExposure - newExposure;

        if (newRestricted >= oldRestricted) {
            totalRestrictedSponsoredLiabilityWei += newRestricted - oldRestricted;
        } else {
            totalRestrictedSponsoredLiabilityWei -= oldRestricted - newRestricted;
        }

        if (newActive >= oldActive) totalActiveBatches += newActive - oldActive;
        else totalActiveBatches -= oldActive - newActive;

        if (oldActive == 0 && newActive != 0) ++activeCollectionCount;
        else if (oldActive != 0 && newActive == 0) --activeCollectionCount;

        collectionExposureWei[collection] = newExposure;
        collectionRestrictedSponsoredLiabilityWei[collection] = newRestricted;
        collectionActiveBatches[collection] = newActive;

        emit CollectionSynced(collection, newExposure, newRestricted, newActive);
    }

    function requiredReserveWei() public view returns (uint256) {
        uint256 dynamicRequirement =
            totalRestrictedSponsoredLiabilityWei +
            (totalExposureWei * exposureSafetyBps) / 10_000 +
            totalActiveBatches * perActiveBatchBufferWei;

        return dynamicRequirement > minimumReserveWei ? dynamicRequirement : minimumReserveWei;
    }

    function availableRevenueWei() public view returns (uint256) {
        uint256 required = requiredReserveWei();
        uint256 balance = address(this).balance;
        return balance > required ? balance - required : 0;
    }

    /// @notice Collection-only deposit used by hopper sweeps. Funds remain native to this chain.
    function depositFromCollection() external payable {
        if (!canonicalCollection[msg.sender]) revert RFV2_CollectionNotRegistered();
        if (msg.value == 0) revert RF_ZeroQuantity();
        collectionDepositsWei[msg.sender] += msg.value;
        emit CollectionDeposit(msg.sender, msg.value);
    }

    /// @notice Founder or automation can initiate this; collection code mathematically selects the safe amount.
    function pullCollectionExcess(address collection) external returns (uint256 amount) {
        if (!canonicalCollection[collection]) revert RFV2_CollectionNotRegistered();
        amount = IRelicForgeReserveCollectionV2(collection).sweepExcessToReserve();
        _syncCollection(collection);
        emit CollectionExcessPulled(collection, amount, msg.sender);
    }

    /// @notice Exact shortfall only. The collection hopper is consumed first by the calling collection.
    function fundRandomnessShortfall(uint64 batchId, uint256 amount) external {
        if (!canonicalCollection[msg.sender]) revert RFV2_CollectionNotRegistered();

        uint256 expected = IRelicForgeReserveCollectionV2(msg.sender).randomnessShortfallFor(batchId);
        if (amount == 0 || amount != expected) revert RFV2_BadReserveDraw();
        if (amount > maxSubsidyPerRequestWei) revert RFV2_ReserveSubsidyCap();

        uint256 lifetime = collectionLifetimeSubsidyWei[msg.sender] + amount;
        if (lifetime > maxSubsidyPerCollectionWei) revert RFV2_ReserveSubsidyCap();
        if (address(this).balance < amount) revert RFV2_BadReserveDraw();

        collectionLifetimeSubsidyWei[msg.sender] = lifetime;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit RandomnessShortfallFunded(msg.sender, batchId, amount);
    }

    /// @notice Founder initiates revenue extraction; amount is contract-calculated and destination is fixed.
    /// @dev Syncs every registered experimental collection first. Production must paginate this safely at scale.
    function releaseRevenue() external onlyFounder returns (uint256 amount) {
        syncAllCollections();
        amount = availableRevenueWei();
        if (amount == 0) revert RFV2_NoRevenueAvailable();

        totalRevenueReleased += amount;
        (bool ok,) = revenueTreasury.call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit RevenueReleased(revenueTreasury, amount, requiredReserveWei());
    }

    function setReservePolicy(
        uint256 minimumReserveWei_,
        uint256 perActiveBatchBufferWei_,
        uint32 exposureSafetyBps_,
        uint256 maxSubsidyPerRequestWei_,
        uint256 maxSubsidyPerCollectionWei_
    ) external onlyFounder {
        if (exposureSafetyBps_ < 10_000 || exposureSafetyBps_ > 50_000) revert RF_BadConfig();
        if (maxSubsidyPerRequestWei_ == 0 || maxSubsidyPerCollectionWei_ == 0) revert RF_BadConfig();

        minimumReserveWei = minimumReserveWei_;
        perActiveBatchBufferWei = perActiveBatchBufferWei_;
        exposureSafetyBps = exposureSafetyBps_;
        maxSubsidyPerRequestWei = maxSubsidyPerRequestWei_;
        maxSubsidyPerCollectionWei = maxSubsidyPerCollectionWei_;

        emit ReservePolicyUpdated(
            minimumReserveWei_,
            perActiveBatchBufferWei_,
            exposureSafetyBps_,
            maxSubsidyPerRequestWei_,
            maxSubsidyPerCollectionWei_
        );
    }

    function setRevenueTreasury(address payable treasury_) external onlyFounder {
        if (treasury_ == address(0)) revert RF_ZeroAddress();
        revenueTreasury = treasury_;
        emit RevenueTreasuryUpdated(treasury_);
    }

    function transferFounder(address newFounder) external onlyFounder {
        if (newFounder == address(0)) revert RF_ZeroAddress();
        address old = founder;
        founder = newFounder;
        emit FounderTransferred(old, newFounder);
    }

    receive() external payable {}
}
