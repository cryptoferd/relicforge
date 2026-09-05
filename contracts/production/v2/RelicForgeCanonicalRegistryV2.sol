// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV2Core.sol";

/// @title RelicForgeCanonicalRegistryV2
/// @notice Immutable canonical-collection registry used as the billing boundary for V2 providers.
/// @dev The deployment authority can only bind the factory once. After binding, only that factory
///      may add collections and there is no unregister/reroute function.
contract RelicForgeCanonicalRegistryV2 is IRelicCanonicalCollectionRegistryV2Prod {
    address public bootstrapAuthority;
    address public factory;
    mapping(address => bool) public isCanonicalCollection;

    event FactoryBound(address indexed factory);
    event CanonicalCollectionRegistered(address indexed collection);

    constructor() {
        bootstrapAuthority = msg.sender;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != bootstrapAuthority || bootstrapAuthority == address(0)) revert RF_NotAuthorized();
        if (factory != address(0)) revert RF_AlreadyConfigured();
        if (factory_ == address(0) || factory_.code.length == 0) revert RF_BadImpl();
        if (IRelicForgeFactoryV2View(factory_).canonicalRegistry() != address(this)) revert RF_BadConfig();

        factory = factory_;
        bootstrapAuthority = address(0);
        emit FactoryBound(factory_);
    }

    function registerCollection(address collection) external {
        if (msg.sender != factory || factory == address(0)) revert RF_NotAuthorized();
        if (collection == address(0) || collection.code.length == 0) revert RF_BadConfig();
        if (isCanonicalCollection[collection]) revert RFV2_CollectionAlreadyRegisteredProd();

        isCanonicalCollection[collection] = true;
        emit CanonicalCollectionRegistered(collection);
    }
}
