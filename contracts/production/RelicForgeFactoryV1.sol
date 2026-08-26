// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";
import "./RelicProjectDataV1.sol";
import "./RelicCollectionV1.sol";

/**
 * @title RelicForgeFactoryV1
 * @notice Ownerless, immutable V1 factory. It cannot change implementation, renderer, or randomness provider.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */
contract RelicForgeFactoryV1 {
    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        address indexed dataContract,
        uint256 collectionNumber
    );

    address public immutable collectionImplementation;
    address public immutable dataImplementation;
    address public immutable renderer;
    address public immutable randomnessProvider;

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

        uint256 number = ++collectionCount;
        isRelicForgeCollection[collection] = true;
        dataForCollection[collection] = projectData;
        _creatorCollections[msg.sender].push(collection);
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
