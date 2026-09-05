// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";

/// @title RelicForgeReserveV2
/// @notice Chain-local native-ETH randomness reserve for canonical Relic Forge V2 collections.
/// @dev The reserve can fund only the exact shortfall reported by the calling canonical collection.
///      There is no bridge, swap, arbitrary recipient, or provider-selection surface.
contract RelicForgeReserveV2 is IRelicForgeReserveV2Prod {
    uint256 public constant MAX_SYNC_COLLECTIONS_PER_CALL = 64;

    address public founder;
    address payable public revenueTreasury;
    address payable public pendingRevenueTreasury;
    address public pendingFounder;

    address public bootstrapAuthority;
    address public factory;

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

    // R11: blocks accounting/balance mutations while revenue ETH is in an external call.
    bool private _revenueReleaseActive;

    mapping(address => bool) public canonicalCollection;
    mapping(address => uint256) public collectionExposureWei;
    mapping(address => uint256) public collectionRestrictedSponsoredLiabilityWei;
    mapping(address => uint256) public collectionActiveBatches;
    mapping(address => uint256) public collectionLifetimeSubsidyWei;
    mapping(address => uint256) public collectionDepositsWei;
    address[] public collections;

    event FactoryBound(address indexed factory);
    event CollectionRegistered(address indexed collection);
    event CollectionSynced(
        address indexed collection, uint256 exposureWei, uint256 restrictedSponsoredLiabilityWei, uint256 activeBatches
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
    event RevenueTreasuryTransferStarted(address indexed currentTreasury, address indexed pendingTreasury);
    event RevenueTreasuryUpdated(address indexed treasury);
    event FounderTransferStarted(address indexed currentFounder, address indexed pendingFounder);
    event FounderTransferred(address indexed oldFounder, address indexed newFounder);

    modifier onlyFounder() {
        if (msg.sender != founder) revert RF_NotAuthorized();
        _;
    }

    modifier reserveUnlocked() {
        if (_revenueReleaseActive) revert RF_Reentrant();
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
        if (founder_ == address(0) || revenueTreasury_ == address(0)) {
            revert RF_ZeroAddress();
        }
        if (exposureSafetyBps_ < 10_000 || exposureSafetyBps_ > 50_000) revert RF_BadConfig();
        if (maxSubsidyPerRequestWei_ == 0 || maxSubsidyPerCollectionWei_ == 0) revert RF_BadConfig();

        founder = founder_;
        revenueTreasury = revenueTreasury_;
        bootstrapAuthority = msg.sender;

        minimumReserveWei = minimumReserveWei_;
        perActiveBatchBufferWei = perActiveBatchBufferWei_;
        exposureSafetyBps = exposureSafetyBps_;
        maxSubsidyPerRequestWei = maxSubsidyPerRequestWei_;
        maxSubsidyPerCollectionWei = maxSubsidyPerCollectionWei_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != bootstrapAuthority || bootstrapAuthority == address(0)) revert RF_NotAuthorized();
        if (factory != address(0)) revert RF_AlreadyConfigured();
        if (factory_ == address(0) || factory_.code.length == 0) revert RF_BadImpl();
        if (IRelicForgeFactoryV2View(factory_).reserve() != address(this)) revert RF_BadConfig();

        factory = factory_;
        bootstrapAuthority = address(0);
        emit FactoryBound(factory_);
    }

    function registerCollection(address collection) external reserveUnlocked {
        if (msg.sender != factory || factory == address(0)) revert RF_NotAuthorized();
        if (collection == address(0) || collection.code.length == 0) revert RF_BadConfig();
        if (canonicalCollection[collection]) revert RFV2_CollectionAlreadyRegisteredProd();

        canonicalCollection[collection] = true;
        collections.push(collection);
        emit CollectionRegistered(collection);
        _syncCollection(collection);
    }

    function collectionCount() external view returns (uint256) {
        return collections.length;
    }

    function syncCollection(address collection) public reserveUnlocked {
        if (!canonicalCollection[collection]) revert RFV2_CollectionNotRegisteredProd();
        _syncCollection(collection);
    }

    function syncCollections(uint256 cursor, uint256 maxCollections)
        external
        reserveUnlocked
        returns (uint256 nextCursor)
    {
        if (maxCollections == 0 || maxCollections > MAX_SYNC_COLLECTIONS_PER_CALL) {
            revert RF_BadConfig();
        }

        uint256 count = collections.length;
        if (cursor >= count) return count;

        uint256 end = cursor + maxCollections;
        if (end > count) end = count;

        for (uint256 i = cursor; i < end; ++i) {
            _syncCollection(collections[i]);
        }

        return end;
    }

    function _syncCollection(address collection) internal {
        uint256 oldExposure = collectionExposureWei[collection];
        uint256 oldRestricted = collectionRestrictedSponsoredLiabilityWei[collection];
        uint256 oldActive = collectionActiveBatches[collection];

        uint256 newExposure = IRelicForgeReserveCollectionV2Prod(collection).reserveExposureWei();
        uint256 newRestricted = IRelicForgeReserveCollectionV2Prod(collection).restrictedSponsoredLiabilityWei();
        uint256 newActive = IRelicForgeReserveCollectionV2Prod(collection).activeForgeBatchCount();

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
        uint256 dynamicRequirement = totalRestrictedSponsoredLiabilityWei + (totalExposureWei * exposureSafetyBps)
            / 10_000 + totalActiveBatches * perActiveBatchBufferWei;

        return dynamicRequirement > minimumReserveWei ? dynamicRequirement : minimumReserveWei;
    }

    function availableRevenueWei() public view returns (uint256) {
        uint256 required = requiredReserveWei();
        uint256 balance = address(this).balance;
        return balance > required ? balance - required : 0;
    }

    function depositFromCollection() external payable {
        if (!canonicalCollection[msg.sender]) revert RFV2_CollectionNotRegisteredProd();
        if (msg.value == 0) revert RF_ZeroQuantity();
        collectionDepositsWei[msg.sender] += msg.value;
        emit CollectionDeposit(msg.sender, msg.value);
    }

    function pullCollectionExcess(address collection) external reserveUnlocked returns (uint256 amount) {
        if (!canonicalCollection[collection]) revert RFV2_CollectionNotRegisteredProd();
        amount = IRelicForgeReserveCollectionV2Prod(collection).sweepExcessToReserve();
        _syncCollection(collection);
        emit CollectionExcessPulled(collection, amount, msg.sender);
    }

    function fundRandomnessShortfall(uint64 batchId, uint256 amount) external reserveUnlocked {
        if (!canonicalCollection[msg.sender]) revert RFV2_CollectionNotRegisteredProd();

        uint256 expected = IRelicForgeReserveCollectionV2Prod(msg.sender).randomnessShortfallFor(batchId);
        if (amount == 0 || amount != expected) revert RFV2_BadReserveDrawProd();
        if (amount > maxSubsidyPerRequestWei) revert RFV2_ReserveSubsidyCapProd();

        uint256 lifetime = collectionLifetimeSubsidyWei[msg.sender] + amount;
        if (lifetime > maxSubsidyPerCollectionWei) revert RFV2_ReserveSubsidyCapProd();
        if (address(this).balance < amount) revert RFV2_BadReserveDrawProd();

        collectionLifetimeSubsidyWei[msg.sender] = lifetime;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert RF_WithdrawFailed();

        emit RandomnessShortfallFunded(msg.sender, batchId, amount);
    }

    /// @notice Founder-only O(1) revenue release using conservatively push-synchronized aggregate accounting.
    /// @dev R11 requires every liability-increasing Collection transition to synchronize atomically. Liability-decreasing
    ///      transitions may remain stale only in the conservative direction until a later or permissionless sync.
    function releaseRevenue() external onlyFounder reserveUnlocked returns (uint256 amount) {
        amount = availableRevenueWei();
        if (amount == 0) revert RFV2_NoRevenueAvailableProd();

        uint256 requiredAfter = requiredReserveWei();
        address payable treasury = revenueTreasury;

        totalRevenueReleased += amount;
        _revenueReleaseActive = true;
        (bool ok,) = treasury.call{value: amount}("");
        _revenueReleaseActive = false;
        if (!ok) revert RF_WithdrawFailed();

        emit RevenueReleased(treasury, amount, requiredAfter);
    }

    function setReservePolicy(
        uint256 minimumReserveWei_,
        uint256 perActiveBatchBufferWei_,
        uint32 exposureSafetyBps_,
        uint256 maxSubsidyPerRequestWei_,
        uint256 maxSubsidyPerCollectionWei_
    ) external onlyFounder reserveUnlocked {
        if (exposureSafetyBps_ < 10_000 || exposureSafetyBps_ > 50_000) {
            revert RF_BadConfig();
        }
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

    function proposeRevenueTreasury(address payable treasury_) external onlyFounder reserveUnlocked {
        if (treasury_ == address(0) || treasury_ == revenueTreasury) revert RF_BadConfig();
        pendingRevenueTreasury = treasury_;
        emit RevenueTreasuryTransferStarted(revenueTreasury, treasury_);
    }

    function acceptRevenueTreasury() external reserveUnlocked {
        address payable pending = pendingRevenueTreasury;
        if (pending == address(0) || msg.sender != pending) revert RF_NotAuthorized();

        revenueTreasury = pending;
        pendingRevenueTreasury = payable(address(0));
        emit RevenueTreasuryUpdated(pending);
    }

    function proposeFounder(address newFounder) external onlyFounder reserveUnlocked {
        if (newFounder == address(0) || newFounder == founder) revert RF_BadConfig();
        pendingFounder = newFounder;
        emit FounderTransferStarted(founder, newFounder);
    }

    function acceptFounder() external reserveUnlocked {
        address pending = pendingFounder;
        if (pending == address(0) || msg.sender != pending) revert RF_NotAuthorized();

        address old = founder;
        founder = pending;
        pendingFounder = address(0);

        // Do not allow a treasury redirect proposed by the old founder to survive
        // the ownership handoff. The new founder must explicitly propose it again.
        pendingRevenueTreasury = payable(address(0));

        emit FounderTransferred(old, pending);
    }

    receive() external payable {}
}
