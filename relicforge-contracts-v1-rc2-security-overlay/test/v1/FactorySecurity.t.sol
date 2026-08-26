// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RelicForgeV1Fixture.sol";

contract FactorySecurityTest is RelicForgeV1Fixture {
    function testFactoryRegistersCollectionAndCreator() public view {
        assertTrue(factory.isRelicForgeCollection(address(collection)), "collection registered");
        assertEq(factory.dataForCollection(address(collection)), address(data), "data registry");
        assertEq(factory.creatorCollectionCount(address(this)), 1, "creator registry count");
        assertEq(factory.creatorCollectionAt(address(this), 0), address(collection), "creator registry entry");
        assertEq(collection.creator(), address(this), "creator identity");
        assertEq(collection.controller(), address(this), "creator is initial controller");
        assertEq(data.creator(), address(this), "data creator identity");
    }

    function testCloneCannotBeReinitialized() public {
        vm.expectRevert(RF_AlreadyInitialized.selector);
        collection.initialize(
            "evil", "EVIL", "evil", BOB, address(data), address(renderer), address(randomness),
            SUPPLY, BOB, BOB, 0
        );

        vm.expectRevert(RF_AlreadyInitialized.selector);
        data.initialize(BOB, SUPPLY, 32, 32, 1);
    }

    function testImplementationContractsCannotBeInitialized() public {
        RelicCollectionV1 impl = new RelicCollectionV1();
        RelicProjectDataV1 dataImpl = new RelicProjectDataV1();

        vm.expectRevert(RF_AlreadyInitialized.selector);
        impl.initialize(
            "evil", "EVIL", "evil", BOB, address(data), address(renderer), address(randomness),
            SUPPLY, BOB, BOB, 0
        );

        vm.expectRevert(RF_AlreadyInitialized.selector);
        dataImpl.initialize(BOB, SUPPLY, 32, 32, 1);
    }

    function testFactoryInfrastructureAddressesMatchImmutableDeployment() public view {
        assertEq(factory.renderer(), address(renderer), "renderer immutable");
        assertEq(factory.randomnessProvider(), address(randomness), "randomness immutable");
        assertTrue(factory.collectionImplementation() != address(0), "collection implementation set");
        assertTrue(factory.dataImplementation() != address(0), "data implementation set");
    }

    function testFactoryHasNoLegacyAdminSetters() public {
        (bool okImplementation,) = address(factory).call(
            abi.encodeWithSignature("setImplementation(address)", address(collection))
        );
        assertFalse(okImplementation, "no implementation setter");

        (bool okRandomness,) = address(factory).call(
            abi.encodeWithSignature("setRandomnessProvider(address)", BOB)
        );
        assertFalse(okRandomness, "no randomness setter");
    }
}
