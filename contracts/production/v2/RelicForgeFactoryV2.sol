// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../RFCoreV1.sol";
import "../RelicProjectDataV1.sol";
import "./RelicCollectionV2.sol";
import "./RelicMintPhasesV2.sol";
import "./RelicForgeCanonicalRegistryV2.sol";
import "./RelicForgeReserveV2.sol";

/// @title RelicForgeFactoryV2
/// @notice Ownerless minimal-proxy launch factory for Relic Forge V2 collections.
/// @dev The factory has no post-launch collection admin powers. It binds immutable infrastructure,
///      creates a ProjectData clone + Collection clone, initializes creator-owned state, and registers
///      the collection in both the public Factory registry and the provider/Reserve registries.
contract RelicForgeFactoryV2 is IRelicForgeFactoryV2View {
    struct LaunchConfig {
        string name;
        string symbol;
        string description;
        uint32 maxSupply;
        uint16 canvasWidth;
        uint16 canvasHeight;
        uint8 layerCount;
        address payoutReceiver;
        address royaltyReceiver;
        uint96 royaltyBps;
        uint8 feeMode;
        uint8 initialRevealMode;
        uint64 batchWindowSeconds;
        uint256 maxRandomnessCostPerBatchWei;
    }

    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;
    uint8 public constant REVEAL_DEFERRED = 0;
    uint8 public constant REVEAL_FORGE = 1;

    uint64 public constant DEFAULT_BATCH_WINDOW_SECONDS = 180;
    uint256 public constant DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI = 0.02 ether;

    address public immutable collectionImplementation;
    address public immutable dataImplementation;
    address public immutable mintPhasesImplementation;
    address public immutable renderer;
    address public immutable randomnessProvider;
    address public immutable canonicalRegistry;
    address public immutable reserve;
    address public immutable feePolicy;

    uint256 public collectionCount;
    mapping(address => bool) public isRelicForgeCollection;
    mapping(address => address) public dataForCollection;
    mapping(address => address) public mintPhasesForCollection;
    mapping(address => address[]) private _creatorCollections;

    event CollectionCreated(
        address indexed creator, address indexed collection, address indexed dataContract, uint256 collectionNumber
    );
    event CollectionLaunchTerms(
        address indexed collection,
        uint8 feeMode,
        uint32 lockedFeeCents,
        uint256 sponsoredPrepaidWei,
        uint8 initialRevealMode,
        uint64 batchWindowSeconds,
        uint256 maxRandomnessCostPerBatchWei
    );

    constructor(
        address collectionImplementation_,
        address dataImplementation_,
        address mintPhasesImplementation_,
        address renderer_,
        address randomnessProvider_,
        address canonicalRegistry_,
        address reserve_,
        address feePolicy_
    ) {
        if (
            collectionImplementation_.code.length == 0 || dataImplementation_.code.length == 0
                || mintPhasesImplementation_.code.length == 0 || renderer_.code.length == 0
                || randomnessProvider_.code.length == 0 || canonicalRegistry_.code.length == 0
                || reserve_.code.length == 0 || feePolicy_.code.length == 0
        ) revert RF_BadImpl();

        collectionImplementation = collectionImplementation_;
        dataImplementation = dataImplementation_;
        mintPhasesImplementation = mintPhasesImplementation_;
        renderer = renderer_;
        randomnessProvider = randomnessProvider_;
        canonicalRegistry = canonicalRegistry_;
        reserve = reserve_;
        feePolicy = feePolicy_;
    }

    function infrastructureReady() public view returns (bool) {
        return RelicForgeCanonicalRegistryV2(canonicalRegistry).factory() == address(this)
            && RelicForgeReserveV2(payable(reserve)).factory() == address(this);
    }

    function quoteCollectionFeeTerms(uint32 maxSupply, uint8 feeMode)
        public
        view
        returns (uint32 lockedFeeCents, uint256 upfrontFeeWei, bool oracleHealthy, bool feeActive)
    {
        IRelicForgeFeePolicyV1 policy = IRelicForgeFeePolicyV1(feePolicy);

        if (feeMode == FEE_MODE_SPONSORED) {
            lockedFeeCents = policy.sponsoredFeeCents();
            (upfrontFeeWei, oracleHealthy, feeActive) = policy.quoteSponsoredFee(maxSupply);
        } else if (feeMode == FEE_MODE_MINTER_SUPPORTED) {
            lockedFeeCents = policy.minterFeeCents();
            feeActive = lockedFeeCents != 0;
            if (feeActive) {
                (, oracleHealthy) = policy.quoteUsdCents(lockedFeeCents);
            } else {
                oracleHealthy = true;
            }
        } else {
            revert RF_BadFeeMode();
        }
    }

    function createCollection(
        string calldata name,
        string calldata symbol,
        string calldata description,
        uint32 maxSupply,
        uint16 canvasWidth,
        uint16 canvasHeight,
        uint8 layerCount,
        address payoutReceiver,
        address royaltyReceiver,
        uint96 royaltyBps
    ) external returns (address collection, address projectData) {
        LaunchConfig memory launch = LaunchConfig({
            name: name,
            symbol: symbol,
            description: description,
            maxSupply: maxSupply,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            layerCount: layerCount,
            payoutReceiver: payoutReceiver,
            royaltyReceiver: royaltyReceiver,
            royaltyBps: royaltyBps,
            feeMode: FEE_MODE_MINTER_SUPPORTED,
            initialRevealMode: REVEAL_DEFERRED,
            batchWindowSeconds: DEFAULT_BATCH_WINDOW_SECONDS,
            maxRandomnessCostPerBatchWei: DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI
        });
        return _createCollection(launch);
    }

    function createCollectionWithFeeMode(
        string calldata name,
        string calldata symbol,
        string calldata description,
        uint32 maxSupply,
        uint16 canvasWidth,
        uint16 canvasHeight,
        uint8 layerCount,
        address payoutReceiver,
        address royaltyReceiver,
        uint96 royaltyBps,
        uint8 feeMode
    ) external payable returns (address collection, address projectData) {
        LaunchConfig memory launch = LaunchConfig({
            name: name,
            symbol: symbol,
            description: description,
            maxSupply: maxSupply,
            canvasWidth: canvasWidth,
            canvasHeight: canvasHeight,
            layerCount: layerCount,
            payoutReceiver: payoutReceiver,
            royaltyReceiver: royaltyReceiver,
            royaltyBps: royaltyBps,
            feeMode: feeMode,
            initialRevealMode: REVEAL_DEFERRED,
            batchWindowSeconds: DEFAULT_BATCH_WINDOW_SECONDS,
            maxRandomnessCostPerBatchWei: DEFAULT_MAX_RANDOMNESS_COST_PER_BATCH_WEI
        });
        return _createCollection(launch);
    }

    /// @notice Full V2 launch entrypoint.
    /// @dev Uses one calldata tuple instead of a 14-argument ABI surface. The R4 wide
    ///      signature caused the via-IR/Yul decoder itself to exceed stack depth.
    ///      The legacy-compatible createCollection() and createCollectionWithFeeMode()
    ///      entrypoints above remain unchanged.
    function createCollectionV2(LaunchConfig calldata launch)
        external
        payable
        returns (address collection, address projectData)
    {
        LaunchConfig memory launchCopy = launch;
        return _createCollection(launchCopy);
    }

    function _createCollection(LaunchConfig memory launch) internal returns (address collection, address projectData) {
        if (!infrastructureReady()) revert RF_BadConfig();
        if (launch.initialRevealMode > REVEAL_FORGE) revert RF_BadConfig();
        if (launch.batchWindowSeconds == 0 || launch.maxRandomnessCostPerBatchWei == 0) revert RF_BadConfig();

        (uint32 lockedFeeCents, uint256 upfrontFeeWei, bool oracleHealthy, bool feeActive) =
            quoteCollectionFeeTerms(launch.maxSupply, launch.feeMode);

        if (launch.feeMode == FEE_MODE_SPONSORED) {
            if (feeActive && !oracleHealthy) revert RF_FeeOracleUnavailable();
            if (msg.value != upfrontFeeWei) revert RF_WrongPrice();
        } else if (msg.value != 0) {
            revert RF_WrongPrice();
        }

        projectData = _clone(dataImplementation);
        RelicProjectDataV1(projectData)
            .initialize(msg.sender, launch.maxSupply, launch.canvasWidth, launch.canvasHeight, launch.layerCount);

        collection = _clone(collectionImplementation);
        address mintPhases = _clone(mintPhasesImplementation);
        RelicMintPhasesV2(mintPhases).initialize(collection, msg.sender, feePolicy, launch.feeMode, lockedFeeCents);

        RelicCollectionInitV2 memory collectionInit = RelicCollectionInitV2({
            name: launch.name,
            symbol: launch.symbol,
            description: launch.description,
            creator: msg.sender,
            dataContract: projectData,
            renderer: renderer,
            randomnessProvider: randomnessProvider,
            forgeReserve: reserve,
            feePolicy: feePolicy,
            mintPhases: mintPhases,
            maxSupply: launch.maxSupply,
            payoutReceiver: launch.payoutReceiver,
            royaltyReceiver: launch.royaltyReceiver,
            royaltyBps: launch.royaltyBps,
            feeMode: launch.feeMode,
            lockedFeeCents: lockedFeeCents,
            initialRevealMode: launch.initialRevealMode,
            batchWindowSeconds: launch.batchWindowSeconds,
            maxRandomnessCostPerBatchWei: launch.maxRandomnessCostPerBatchWei
        });
        RelicCollectionV2(payable(collection)).initialize{value: upfrontFeeWei}(collectionInit);

        uint256 number = ++collectionCount;
        isRelicForgeCollection[collection] = true;
        dataForCollection[collection] = projectData;
        mintPhasesForCollection[collection] = mintPhases;
        _creatorCollections[msg.sender].push(collection);

        RelicForgeCanonicalRegistryV2(canonicalRegistry).registerCollection(collection);
        RelicForgeReserveV2(payable(reserve)).registerCollection(collection);

        emit CollectionLaunchTerms(
            collection,
            launch.feeMode,
            lockedFeeCents,
            upfrontFeeWei,
            launch.initialRevealMode,
            launch.batchWindowSeconds,
            launch.maxRandomnessCostPerBatchWei
        );
        emit CollectionCreated(msg.sender, collection, projectData, number);
    }

    function creatorCollectionCount(address creator) external view returns (uint256) {
        return _creatorCollections[creator].length;
    }

    function creatorCollectionAt(address creator, uint256 index) external view returns (address) {
        return _creatorCollections[creator][index];
    }

    function _clone(address implementation) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(implementation),
            hex"5af43d82803e903d91602b57fd5bf3"
        );

        assembly ("memory-safe") {
            instance := create(0, add(code, 0x20), mload(code))
        }
        if (instance == address(0)) revert RF_CloneFailed();
    }
}
