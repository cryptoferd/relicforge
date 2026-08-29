// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";
import "./RelicProjectDataV1.sol";
import "./RelicCollectionV1.sol";

/**
 * @title RelicForgeFactoryV1
 * @notice Ownerless V1 clone factory with one-time immutable fee-policy binding.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */
contract RelicForgeFactoryV1 {
    uint8 public constant FEE_MODE_SPONSORED = 1;
    uint8 public constant FEE_MODE_MINTER_SUPPORTED = 2;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        address indexed dataContract,
        uint256 collectionNumber
    );
    event FeePolicyBound(address indexed feePolicy);
    event CollectionFeeTerms(
        address indexed collection,
        uint8 indexed feeMode,
        uint32 lockedFeeCents,
        uint256 upfrontFeeWei,
        bool oracleHealthy,
        bool feeActive
    );

    address public immutable collectionImplementation;
    address public immutable dataImplementation;
    address public immutable renderer;
    address public immutable randomnessProvider;

    address public feePolicy;
    address public feePolicyBootstrapAuthority;

    uint256 public collectionCount;
    mapping(address => bool) public isRelicForgeCollection;
    mapping(address => address) public dataForCollection;
    mapping(address => address[]) private _creatorCollections;

    constructor(address collectionImplementation_, address dataImplementation_, address renderer_, address randomnessProvider_) {
        if (
            collectionImplementation_.code.length == 0 ||
            dataImplementation_.code.length == 0 ||
            renderer_.code.length == 0 ||
            randomnessProvider_.code.length == 0
        ) revert RF_BadImpl();

        collectionImplementation = collectionImplementation_;
        dataImplementation = dataImplementation_;
        renderer = renderer_;
        randomnessProvider = randomnessProvider_;
        feePolicyBootstrapAuthority = msg.sender;
    }

    /// @notice One-time prelaunch binding. Collection creation is disabled until this succeeds.
    function bindFeePolicy(address feePolicy_) external {
        if (msg.sender != feePolicyBootstrapAuthority || feePolicyBootstrapAuthority == address(0)) {
            revert RF_NotAuthorized();
        }
        if (feePolicy != address(0)) revert RF_AlreadyConfigured();
        if (feePolicy_.code.length == 0) revert RF_BadConfig();

        IRelicForgeFeePolicyV1 policy = IRelicForgeFeePolicyV1(feePolicy_);
        if (policy.platformAdmin() == address(0) || policy.treasury() == address(0)) revert RF_BadConfig();

        feePolicy = feePolicy_;
        feePolicyBootstrapAuthority = address(0);
        emit FeePolicyBound(feePolicy_);
    }

    /**
     * @notice Backward-compatible creation entrypoint.
     * @dev Defaults to Minter Supported. The Studio UI uses createCollectionWithFeeMode for explicit choice.
     */
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
        return _createCollection(
            name,
            symbol,
            description,
            maxSupply,
            canvasWidth,
            canvasHeight,
            layerCount,
            payoutReceiver,
            royaltyReceiver,
            royaltyBps,
            FEE_MODE_MINTER_SUPPORTED
        );
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
        return _createCollection(
            name,
            symbol,
            description,
            maxSupply,
            canvasWidth,
            canvasHeight,
            layerCount,
            payoutReceiver,
            royaltyReceiver,
            royaltyBps,
            feeMode
        );
    }

    function quoteCollectionFeeTerms(uint32 maxSupply, uint8 feeMode)
        public view
        returns (
            uint32 lockedFeeCents,
            uint256 upfrontFeeWei,
            bool oracleHealthy,
            bool feeActive
        )
    {
        address policyAddress = feePolicy;
        if (policyAddress == address(0)) revert RF_FeePolicyNotBound();

        IRelicForgeFeePolicyV1 policy = IRelicForgeFeePolicyV1(policyAddress);

        if (feeMode == FEE_MODE_SPONSORED) {
            lockedFeeCents = policy.sponsoredFeeCents();
            (upfrontFeeWei, oracleHealthy, feeActive) = policy.quoteSponsoredFee(maxSupply);
        } else if (feeMode == FEE_MODE_MINTER_SUPPORTED) {
            lockedFeeCents = policy.minterFeeCents();
            feeActive = policy.feesEnabled();
            if (feeActive && lockedFeeCents != 0) {
                (, oracleHealthy) = policy.quoteUsdCents(lockedFeeCents);
            } else {
                oracleHealthy = true;
            }
        } else {
            revert RF_BadFeeMode();
        }
    }

    function _createCollection(
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
    ) internal returns (address collection, address projectData) {
        address policyAddress = feePolicy;
        if (policyAddress == address(0)) revert RF_FeePolicyNotBound();

        (
            uint32 lockedFeeCents,
            uint256 upfrontFeeWei,
            bool oracleHealthy,
            bool feeActive
        ) = quoteCollectionFeeTerms(maxSupply, feeMode);

        if (feeMode == FEE_MODE_SPONSORED) {
            if (msg.value != upfrontFeeWei) revert RF_WrongPrice();
        } else {
            if (msg.value != 0) revert RF_WrongPrice();
        }

        projectData = _clone(dataImplementation);
        RelicProjectDataV1(projectData).initialize(msg.sender, maxSupply, canvasWidth, canvasHeight, layerCount);

        collection = _clone(collectionImplementation);
        RelicCollectionV1(collection).initialize(
            name,
            symbol,
            description,
            msg.sender,
            projectData,
            renderer,
            randomnessProvider,
            maxSupply,
            payoutReceiver,
            royaltyReceiver,
            royaltyBps
        );
        RelicCollectionV1(collection).configurePlatformFees(policyAddress, feeMode, lockedFeeCents);

        uint256 number = ++collectionCount;
        isRelicForgeCollection[collection] = true;
        dataForCollection[collection] = projectData;
        _creatorCollections[msg.sender].push(collection);

        if (feeMode == FEE_MODE_SPONSORED) {
            IRelicForgeFeePolicyV1(policyAddress).recordSponsoredFee{value: upfrontFeeWei}(
                collection,
                msg.sender,
                maxSupply,
                lockedFeeCents
            );
        }

        emit CollectionFeeTerms(
            collection,
            feeMode,
            lockedFeeCents,
            upfrontFeeWei,
            oracleHealthy,
            feeActive
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