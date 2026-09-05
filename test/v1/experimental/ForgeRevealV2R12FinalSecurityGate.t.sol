// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../../../contracts/production/RelicProjectDataV1.sol";
import "../../../contracts/production/RelicForgeFeePolicyV1.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";

interface VmR12Final {
    function envString(string calldata name) external returns (string memory value);
    function createSelectFork(string calldata rpcUrl, uint256 blockNumber) external returns (uint256 forkId);
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function deal(address account, uint256 newBalance) external;
}

interface IR12FinalFactory {
    function collectionImplementation() external view returns (address);
    function dataImplementation() external view returns (address);
    function mintPhasesImplementation() external view returns (address);
    function renderer() external view returns (address);
    function randomnessProvider() external view returns (address);
    function canonicalRegistry() external view returns (address);
    function reserve() external view returns (address);
    function feePolicy() external view returns (address);
    function isRelicForgeCollection(address collection) external view returns (bool);
    function dataForCollection(address collection) external view returns (address);
    function mintPhasesForCollection(address collection) external view returns (address);
}

interface IR12FinalRegistry {
    function isCanonicalCollection(address collection) external view returns (bool);
}

interface IR12FinalAdapter {
    function upstreamRequestIdForLocalRequest(uint256 localRequestId) external view returns (uint256);
    function storedWordForLocalRequest(uint256 localRequestId) external view returns (uint256);
    function wordReadyForLocalRequest(uint256 localRequestId) external view returns (bool);
    function deliveredForLocalRequest(uint256 localRequestId) external view returns (bool);
    function replayFulfillment(uint256 localRequestId) external returns (bool delivered);
    function rawFulfillRandomWords(uint256 upstreamRequestId, uint256[] calldata randomWords) external;
}

interface IR12FinalReserve {
    function founder() external view returns (address);
    function revenueTreasury() external view returns (address);
    function pendingFounder() external view returns (address);
    function pendingRevenueTreasury() external view returns (address);
    function canonicalCollection(address collection) external view returns (bool);
    function requiredReserveWei() external view returns (uint256);
    function availableRevenueWei() external view returns (uint256);
    function collectionExposureWei(address collection) external view returns (uint256);
    function collectionRestrictedSponsoredLiabilityWei(address collection) external view returns (uint256);
    function collectionActiveBatches(address collection) external view returns (uint256);
    function syncCollection(address collection) external;
    function releaseRevenue() external returns (uint256 amount);
    function proposeRevenueTreasury(address payable treasury) external;
    function acceptRevenueTreasury() external;
    function proposeFounder(address founder) external;
    function acceptFounder() external;
}

interface IR12FinalFeePolicy {
    function platformAdmin() external view returns (address);
    function treasury() external view returns (address);
    function pendingTreasury() external view returns (address);
    function pendingPlatformAdmin() external view returns (address);
    function setTreasury(address treasury) external;
    function acceptTreasury() external;
    function transferPlatformAdmin(address admin) external;
    function acceptPlatformAdmin() external;
}

abstract contract R12FinalForkBase {
    VmR12Final internal constant vm = VmR12Final(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant PRE_REVEAL_BLOCK = 11_635_046;
    uint256 internal constant FINAL_REVEAL_BLOCK = 11_635_053;

    address internal constant DEPLOYER = 0xD53437Da19105cd5a0A3AFa6cc7EfA6688227e57;
    address internal constant ATTACKER = address(0xBAD);
    address internal constant SAFE_TREASURY = address(0x7101);
    address internal constant SAFE_TREASURY_2 = address(0x7102);
    address internal constant SAFE_ADMIN = address(0xA7101);
    address internal constant SAFE_FOUNDER = address(0xF7101);
    address internal constant SAFE_RESERVE_TREASURY = address(0x7701);

    address internal constant FACTORY = 0x2d63a398c037fE9EA09C7176eAB378c5A51FA88D;
    address internal constant COLLECTION_IMPL = 0x09Fadf4B686bF9F63D1bd2caf0A1045EB89B7e67;
    address internal constant DATA_IMPL = 0x8e404F79CB2e4e290F237253041595454a267945;
    address internal constant PHASES_IMPL = 0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C;
    address internal constant COLLECTION = 0xaFec424d9EfFb59D6e5008D0A86b9A4DD5582172;
    address internal constant DATA = 0x086B3Ec30fbC3eDd286f091f14D034cb2398010a;
    address internal constant PHASES = 0x7444caC00625D481ce087AB01F6e7c8Cfcf2b91e;
    address internal constant ADAPTER = 0x3B97969C2391b82253cC0CBB23376Fb62867E14F;
    address internal constant RESERVE = 0x33328CC8eD15c6A0a0396Ee8365e39B403c0eA96;
    address internal constant FEE_POLICY = 0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0;
    address internal constant REGISTRY = 0xD5d25d4E1Dc575d4EAf8f0AAeFb61588c38Cea38;
    address internal constant CHAINLINK_WRAPPER = 0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1;

    function _fork(uint256 blockNumber) internal {
        string memory rpc = vm.envString("SEPOLIA_RPC_URL");
        vm.createSelectFork(rpc, blockNumber);
        require(block.chainid == 11155111, "FINAL: wrong fork chain");
    }

    function _assert(bool ok, string memory message) internal pure {
        require(ok, message);
    }

    function _assertEq(uint256 a, uint256 b, string memory message) internal pure {
        require(a == b, message);
    }

    function _assertEq(address a, address b, string memory message) internal pure {
        require(a == b, message);
    }

    function _minimalProxyRuntime(address implementation) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"363d3d373d3d3d363d73", bytes20(implementation), hex"5af43d82803e903d91602b57fd5bf3");
    }

    function _assertCloneLink(address proxy, address implementation, string memory message) internal view {
        bytes memory expected = _minimalProxyRuntime(implementation);
        require(proxy.code.length == 45, message);
        require(keccak256(proxy.code) == keccak256(expected), message);
    }

    function _callAs(address sender, address target, bytes memory data) internal returns (bool ok, bytes memory ret) {
        vm.prank(sender);
        (ok, ret) = target.call(data);
    }

    function _mustFailAs(address sender, address target, bytes memory data, string memory message) internal {
        (bool ok,) = _callAs(sender, target, data);
        require(!ok, message);
    }

    function _collection() internal pure returns (RelicCollectionV2) {
        return RelicCollectionV2(payable(COLLECTION));
    }

    function _data() internal pure returns (RelicProjectDataV1) {
        return RelicProjectDataV1(DATA);
    }

    function _phases() internal pure returns (RelicMintPhasesV2) {
        return RelicMintPhasesV2(PHASES);
    }

    function _fee() internal pure returns (IR12FinalFeePolicy) {
        return IR12FinalFeePolicy(FEE_POLICY);
    }

    function _reserve() internal pure returns (IR12FinalReserve) {
        return IR12FinalReserve(RESERVE);
    }

    function _adapter() internal pure returns (IR12FinalAdapter) {
        return IR12FinalAdapter(ADAPTER);
    }
}

contract ForgeRevealV2R12FinalForkAdversarialTest is R12FinalForkBase {
    function testFinalExactLocalCollectionRuntimeMatchesCertifiedSepoliaImplementation() public {
        _fork(FINAL_REVEAL_BLOCK);

        bytes memory localRuntime = type(RelicCollectionV2).runtimeCode;
        _assertEq(localRuntime.length, 24_492, "FINAL: local Collection runtime size drift");
        _assert(
            keccak256(localRuntime) == keccak256(COLLECTION_IMPL.code),
            "FINAL: local Collection bytecode differs from certified Sepolia implementation"
        );

        _assertCloneLink(COLLECTION, COLLECTION_IMPL, "FINAL: Collection clone link");
        _assertCloneLink(DATA, DATA_IMPL, "FINAL: ProjectData clone link");
        _assertCloneLink(PHASES, PHASES_IMPL, "FINAL: MintPhases clone link");
    }

    function testFinalFactoryRegistryAndStandardsBindingsAreImmutableAndCorrect() public {
        _fork(FINAL_REVEAL_BLOCK);

        IR12FinalFactory factory = IR12FinalFactory(FACTORY);
        RelicCollectionV2 collection = _collection();

        _assertEq(factory.collectionImplementation(), COLLECTION_IMPL, "FINAL: factory Collection impl");
        _assertEq(factory.dataImplementation(), DATA_IMPL, "FINAL: factory Data impl");
        _assertEq(factory.mintPhasesImplementation(), PHASES_IMPL, "FINAL: factory Phases impl");
        _assertEq(factory.randomnessProvider(), ADAPTER, "FINAL: factory adapter");
        _assertEq(factory.reserve(), RESERVE, "FINAL: factory reserve");
        _assertEq(factory.feePolicy(), FEE_POLICY, "FINAL: factory fee policy");
        _assert(factory.isRelicForgeCollection(COLLECTION), "FINAL: factory canonical collection");
        _assertEq(factory.dataForCollection(COLLECTION), DATA, "FINAL: factory data clone");
        _assertEq(factory.mintPhasesForCollection(COLLECTION), PHASES, "FINAL: factory phases clone");
        _assert(IR12FinalRegistry(REGISTRY).isCanonicalCollection(COLLECTION), "FINAL: registry canonical");
        _assert(_reserve().canonicalCollection(COLLECTION), "FINAL: reserve canonical");

        _assert(collection.supportsInterface(0x01ffc9a7), "FINAL: ERC165");
        _assert(collection.supportsInterface(0x80ac58cd), "FINAL: ERC721");
        _assert(collection.supportsInterface(0x5b5e139f), "FINAL: ERC721 metadata");
        _assert(collection.supportsInterface(0x2a55205a), "FINAL: ERC2981");
        _assert(collection.supportsInterface(0x49064906), "FINAL: ERC4906");
        _assert(collection.supportsInterface(0x7f5828d0), "FINAL: ERC173");
        _assert(collection.supportsInterface(0xe8a3d485), "FINAL: ERC7572");
        _assert(!collection.supportsInterface(0x780e9d63), "FINAL: false Enumerable claim");
        _assert(!collection.supportsInterface(0xffffffff), "FINAL: ERC165 invalid interface");
    }

    function testFinalUnauthorizedPrivilegeMatrixCannotChangeCrossContractState() public {
        _fork(PRE_REVEAL_BLOCK);

        RelicCollectionV2 collection = _collection();
        RelicMintPhasesV2 phases = _phases();
        IR12FinalFeePolicy fee = _fee();
        IR12FinalReserve reserve = _reserve();

        address payoutBefore = collection.payoutReceiver();
        address royaltyBefore = collection.royaltyReceiver();
        address controllerBefore = collection.controller();
        address phaseControllerBefore = phases.controller();
        address feeAdminBefore = fee.platformAdmin();
        address feeTreasuryBefore = fee.treasury();
        address founderBefore = reserve.founder();
        address reserveTreasuryBefore = reserve.revenueTreasury();
        uint256 committedBefore = collection.totalCommitted();
        uint256 mintedBefore = collection.totalMinted();

        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("setPayoutReceiver(address)", ATTACKER),
            "FINAL: attacker changed payout"
        );
        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("setRoyalty(address,uint96)", ATTACKER, uint96(10_000)),
            "FINAL: attacker changed royalty"
        );
        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("transferOwnership(address)", ATTACKER),
            "FINAL: attacker seized collection"
        );
        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("requestDelayedReveal()"),
            "FINAL: attacker requested delayed reveal"
        );
        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("creatorMint(address,uint32)", ATTACKER, uint32(1)),
            "FINAL: attacker creatorMint succeeded"
        );
        _mustFailAs(
            ATTACKER,
            PHASES,
            abi.encodeWithSignature("setMasterMintEnabled(bool)", false),
            "FINAL: attacker paused sale"
        );
        _mustFailAs(
            ATTACKER,
            PHASES,
            abi.encodeWithSignature("setPhaseEnabled(uint32,bool)", uint32(1), false),
            "FINAL: attacker changed phase"
        );
        _mustFailAs(
            ATTACKER,
            FEE_POLICY,
            abi.encodeWithSignature("setTreasury(address)", ATTACKER),
            "FINAL: attacker proposed fee treasury"
        );
        _mustFailAs(
            ATTACKER,
            FEE_POLICY,
            abi.encodeWithSignature("transferPlatformAdmin(address)", ATTACKER),
            "FINAL: attacker proposed fee admin"
        );
        _mustFailAs(
            ATTACKER,
            FEE_POLICY,
            abi.encodeWithSignature("setDefaultFeeCents(uint32,uint32)", uint32(0), uint32(0)),
            "FINAL: attacker changed defaults"
        );
        _mustFailAs(
            ATTACKER,
            RESERVE,
            abi.encodeWithSignature("proposeRevenueTreasury(address)", ATTACKER),
            "FINAL: attacker proposed reserve treasury"
        );
        _mustFailAs(
            ATTACKER,
            RESERVE,
            abi.encodeWithSignature("proposeFounder(address)", ATTACKER),
            "FINAL: attacker proposed founder"
        );
        _mustFailAs(
            ATTACKER,
            RESERVE,
            abi.encodeWithSignature(
                "setReservePolicy(uint256,uint256,uint32,uint256,uint256)",
                uint256(0),
                uint256(0),
                uint32(10_000),
                uint256(1),
                uint256(1)
            ),
            "FINAL: attacker changed reserve policy"
        );
        _mustFailAs(ATTACKER, RESERVE, abi.encodeWithSignature("releaseRevenue()"), "FINAL: attacker released revenue");

        uint256[] memory fakeWords = new uint256[](1);
        fakeWords[0] = 123;
        _mustFailAs(
            ATTACKER,
            ADAPTER,
            abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", uint256(123), fakeWords),
            "FINAL: attacker spoofed Chainlink callback"
        );
        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSignature("transferFrom(address,address,uint256)", DEPLOYER, ATTACKER, uint256(1)),
            "FINAL: attacker stole NFT"
        );

        _assertEq(collection.payoutReceiver(), payoutBefore, "FINAL: payout mutated");
        _assertEq(collection.royaltyReceiver(), royaltyBefore, "FINAL: royalty mutated");
        _assertEq(collection.controller(), controllerBefore, "FINAL: controller mutated");
        _assertEq(phases.controller(), phaseControllerBefore, "FINAL: phase controller mutated");
        _assertEq(fee.platformAdmin(), feeAdminBefore, "FINAL: fee admin mutated");
        _assertEq(fee.treasury(), feeTreasuryBefore, "FINAL: fee treasury mutated");
        _assertEq(reserve.founder(), founderBefore, "FINAL: founder mutated");
        _assertEq(reserve.revenueTreasury(), reserveTreasuryBefore, "FINAL: reserve treasury mutated");
        _assertEq(collection.totalCommitted(), committedBefore, "FINAL: committed supply mutated");
        _assertEq(collection.totalMinted(), mintedBefore, "FINAL: minted supply mutated");
    }

    function testFinalClonesCannotBeReinitialized() public {
        _fork(PRE_REVEAL_BLOCK);

        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "attack",
            symbol: "ATK",
            description: "attack",
            creator: ATTACKER,
            dataContract: DATA,
            renderer: IR12FinalFactory(FACTORY).renderer(),
            randomnessProvider: ADAPTER,
            forgeReserve: RESERVE,
            feePolicy: FEE_POLICY,
            mintPhases: PHASES,
            maxSupply: 2,
            payoutReceiver: ATTACKER,
            royaltyReceiver: ATTACKER,
            royaltyBps: 10_000,
            feeMode: 2,
            lockedFeeCents: 50,
            initialRevealMode: 0,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 0.02 ether
        });

        _mustFailAs(
            ATTACKER,
            COLLECTION,
            abi.encodeWithSelector(RelicCollectionV2.initialize.selector, init),
            "FINAL: Collection reinitialized"
        );
        _mustFailAs(
            ATTACKER,
            DATA,
            abi.encodeWithSelector(
                RelicProjectDataV1.initialize.selector, ATTACKER, uint32(2), uint16(32), uint16(32), uint8(2)
            ),
            "FINAL: ProjectData reinitialized"
        );
        _mustFailAs(
            ATTACKER,
            PHASES,
            abi.encodeWithSelector(
                RelicMintPhasesV2.initialize.selector, COLLECTION, ATTACKER, FEE_POLICY, uint8(2), uint32(50)
            ),
            "FINAL: MintPhases reinitialized"
        );
    }

    function testFinalFeePolicyTwoStepHandoffRequiresDestinationPossession() public {
        _fork(FINAL_REVEAL_BLOCK);
        IR12FinalFeePolicy fee = _fee();

        _assertEq(fee.platformAdmin(), DEPLOYER, "FINAL: initial fee admin");
        _assertEq(fee.treasury(), DEPLOYER, "FINAL: initial fee treasury");

        vm.prank(DEPLOYER);
        fee.setTreasury(SAFE_TREASURY);
        _assertEq(fee.treasury(), DEPLOYER, "FINAL: treasury changed before acceptance");
        _assertEq(fee.pendingTreasury(), SAFE_TREASURY, "FINAL: pending treasury");

        _mustFailAs(
            ATTACKER,
            FEE_POLICY,
            abi.encodeWithSignature("acceptTreasury()"),
            "FINAL: wrong wallet accepted fee treasury"
        );

        vm.prank(SAFE_TREASURY);
        fee.acceptTreasury();
        _assertEq(fee.treasury(), SAFE_TREASURY, "FINAL: fee treasury acceptance");
        _assertEq(fee.pendingTreasury(), address(0), "FINAL: fee pending treasury not cleared");

        vm.prank(DEPLOYER);
        fee.setTreasury(SAFE_TREASURY_2);
        vm.prank(DEPLOYER);
        fee.transferPlatformAdmin(SAFE_ADMIN);
        _assertEq(fee.platformAdmin(), DEPLOYER, "FINAL: admin changed before acceptance");

        _mustFailAs(
            ATTACKER,
            FEE_POLICY,
            abi.encodeWithSignature("acceptPlatformAdmin()"),
            "FINAL: wrong wallet accepted fee admin"
        );

        vm.prank(SAFE_ADMIN);
        fee.acceptPlatformAdmin();
        _assertEq(fee.platformAdmin(), SAFE_ADMIN, "FINAL: fee admin acceptance");
        _assertEq(fee.pendingPlatformAdmin(), address(0), "FINAL: pending fee admin not cleared");
        _assertEq(fee.pendingTreasury(), address(0), "FINAL: old-admin treasury proposal survived");

        _mustFailAs(
            DEPLOYER,
            FEE_POLICY,
            abi.encodeWithSignature("setDefaultFeeCents(uint32,uint32)", uint32(1), uint32(1)),
            "FINAL: old fee admin retained authority"
        );
    }

    function testFinalReserveTwoStepHandoffAndRevenueBoundary() public {
        _fork(FINAL_REVEAL_BLOCK);
        IR12FinalReserve reserve = _reserve();

        _assertEq(reserve.founder(), DEPLOYER, "FINAL: initial founder");
        _assertEq(reserve.revenueTreasury(), DEPLOYER, "FINAL: initial reserve treasury");

        vm.prank(DEPLOYER);
        reserve.proposeRevenueTreasury(payable(SAFE_RESERVE_TREASURY));
        _assertEq(reserve.revenueTreasury(), DEPLOYER, "FINAL: reserve treasury changed before accept");
        _assertEq(reserve.pendingRevenueTreasury(), SAFE_RESERVE_TREASURY, "FINAL: pending reserve treasury");

        _mustFailAs(
            ATTACKER,
            RESERVE,
            abi.encodeWithSignature("acceptRevenueTreasury()"),
            "FINAL: wrong wallet accepted reserve treasury"
        );

        vm.prank(SAFE_RESERVE_TREASURY);
        reserve.acceptRevenueTreasury();
        _assertEq(reserve.revenueTreasury(), SAFE_RESERVE_TREASURY, "FINAL: reserve treasury acceptance");

        vm.prank(DEPLOYER);
        reserve.proposeFounder(SAFE_FOUNDER);
        _assertEq(reserve.founder(), DEPLOYER, "FINAL: founder changed before acceptance");

        _mustFailAs(
            ATTACKER, RESERVE, abi.encodeWithSignature("acceptFounder()"), "FINAL: wrong wallet accepted founder"
        );

        vm.prank(SAFE_FOUNDER);
        reserve.acceptFounder();
        _assertEq(reserve.founder(), SAFE_FOUNDER, "FINAL: founder acceptance");

        uint256 requiredBefore = reserve.requiredReserveWei();
        uint256 oldBalance = RESERVE.balance;
        vm.deal(RESERVE, oldBalance + 1 ether);

        vm.prank(SAFE_FOUNDER);
        reserve.releaseRevenue();

        _assert(RESERVE.balance >= reserve.requiredReserveWei(), "FINAL: revenue crossed reserve boundary");
        _assertEq(reserve.requiredReserveWei(), requiredBefore, "FINAL: release changed required reserve accounting");
    }

    function testFinalRealRevealLifecycleOnForkAndDuplicateReplayIsIdempotent() public {
        _fork(PRE_REVEAL_BLOCK);

        RelicCollectionV2 collection = _collection();
        RelicMintPhasesV2 phases = _phases();
        IR12FinalAdapter adapter = _adapter();

        _assert(!collection.delayedRevealRequested(), "FINAL: request already present at pre block");
        _assert(!collection.delayedRevealed(), "FINAL: reveal already present at pre block");
        _assertEq(collection.totalMinted(), 2, "FINAL: pre minted supply");
        _assert(!phases.phaseIsOpen(1), "FINAL: sold-out phase unexpectedly open");

        vm.prank(DEPLOYER);
        uint256 localRequestId = collection.requestDelayedReveal();
        _assert(localRequestId != 0, "FINAL: local request id");
        _assert(collection.delayedRevealRequested(), "FINAL: request flag");
        _assert(!collection.delayedRevealed(), "FINAL: revealed before callback");
        _assert(!phases.phaseIsOpen(1), "FINAL: phase open while reveal pending");

        uint256 upstreamRequestId = adapter.upstreamRequestIdForLocalRequest(localRequestId);
        _assert(upstreamRequestId != 0, "FINAL: upstream request id");

        uint256[] memory words = new uint256[](1);
        words[0] = uint256(keccak256("R12 final hostile fork word"));

        vm.prank(CHAINLINK_WRAPPER);
        adapter.rawFulfillRandomWords(upstreamRequestId, words);

        _assert(adapter.wordReadyForLocalRequest(localRequestId), "FINAL: word not ready");
        _assert(!adapter.deliveredForLocalRequest(localRequestId), "FINAL: callback delivered downstream");
        _assert(!collection.delayedRevealed(), "FINAL: storage-only callback revealed collection");

        vm.prank(ATTACKER);
        bool delivered = adapter.replayFulfillment(localRequestId);
        _assert(delivered, "FINAL: permissionless replay did not deliver");
        _assert(adapter.deliveredForLocalRequest(localRequestId), "FINAL: delivery flag");
        _assert(collection.delayedRevealed(), "FINAL: delayed reveal not complete");

        uint256 seedBefore = collection.delayedRevealSeed();
        uint256 recipe1Before = collection.recipeForToken(1);
        uint256 recipe2Before = collection.recipeForToken(2);
        _assert(recipe1Before < 2 && recipe2Before < 2, "FINAL: recipe range");
        _assert(recipe1Before != recipe2Before, "FINAL: duplicate recipe");
        _assert(bytes(collection.tokenURI(1)).length != 0, "FINAL: tokenURI 1");
        _assert(bytes(collection.tokenURI(2)).length != 0, "FINAL: tokenURI 2");

        vm.prank(ATTACKER);
        try adapter.replayFulfillment(localRequestId) returns (bool ignored) {
            ignored;
        }
            catch {}

        _assertEq(collection.delayedRevealSeed(), seedBefore, "FINAL: duplicate replay changed seed");
        _assertEq(collection.recipeForToken(1), recipe1Before, "FINAL: duplicate replay changed recipe 1");
        _assertEq(collection.recipeForToken(2), recipe2Before, "FINAL: duplicate replay changed recipe 2");
    }

    function testFinalReserveCachedAccountingNeverUnderstatesLiveLiability() public {
        _fork(PRE_REVEAL_BLOCK);
        RelicCollectionV2 collection = _collection();
        IR12FinalReserve reserve = _reserve();

        _assert(
            reserve.collectionExposureWei(COLLECTION) >= collection.reserveExposureWei(),
            "FINAL: cached exposure below live exposure"
        );
        _assert(
            reserve.collectionRestrictedSponsoredLiabilityWei(COLLECTION)
                >= collection.restrictedSponsoredLiabilityWei(),
            "FINAL: cached restricted below live restricted"
        );
        _assert(
            reserve.collectionActiveBatches(COLLECTION) >= collection.activeForgeBatchCount(),
            "FINAL: cached active batches below live"
        );

        reserve.syncCollection(COLLECTION);

        _assertEq(
            reserve.collectionExposureWei(COLLECTION),
            collection.reserveExposureWei(),
            "FINAL: synced exposure mismatch"
        );
        _assertEq(
            reserve.collectionRestrictedSponsoredLiabilityWei(COLLECTION),
            collection.restrictedSponsoredLiabilityWei(),
            "FINAL: synced restricted mismatch"
        );
        _assertEq(
            reserve.collectionActiveBatches(COLLECTION),
            collection.activeForgeBatchCount(),
            "FINAL: synced active mismatch"
        );

        uint256 required = reserve.requiredReserveWei();
        uint256 balance = RESERVE.balance;
        uint256 expectedAvailable = balance > required ? balance - required : 0;
        _assertEq(reserve.availableRevenueWei(), expectedAvailable, "FINAL: available revenue formula");
    }
}

contract R12FinalHostileHandler is R12FinalForkBase {
    bool public securityViolation;

    function _markIfSuccess(address sender, address target, bytes memory data) internal {
        (bool ok,) = _callAs(sender, target, data);
        if (ok) securityViolation = true;
    }

    function actionAttackCollection(uint256 raw) external {
        uint256 pick = raw % 5;
        if (pick == 0) {
            _markIfSuccess(ATTACKER, COLLECTION, abi.encodeWithSignature("setPayoutReceiver(address)", ATTACKER));
        } else if (pick == 1) {
            _markIfSuccess(
                ATTACKER, COLLECTION, abi.encodeWithSignature("setRoyalty(address,uint96)", ATTACKER, uint96(10_000))
            );
        } else if (pick == 2) {
            _markIfSuccess(ATTACKER, COLLECTION, abi.encodeWithSignature("transferOwnership(address)", ATTACKER));
        } else if (pick == 3) {
            _markIfSuccess(ATTACKER, COLLECTION, abi.encodeWithSignature("requestDelayedReveal()"));
        } else {
            _markIfSuccess(
                ATTACKER, COLLECTION, abi.encodeWithSignature("creatorMint(address,uint32)", ATTACKER, uint32(1))
            );
        }
    }

    function actionAttackMintPhases(uint256 raw) external {
        if ((raw & 1) == 0) {
            _markIfSuccess(ATTACKER, PHASES, abi.encodeWithSignature("setMasterMintEnabled(bool)", false));
        } else {
            _markIfSuccess(ATTACKER, PHASES, abi.encodeWithSignature("setPhaseEnabled(uint32,bool)", uint32(1), false));
        }
    }

    function actionAttackFeePolicy(uint256 raw) external {
        uint256 pick = raw % 3;
        if (pick == 0) {
            _markIfSuccess(ATTACKER, FEE_POLICY, abi.encodeWithSignature("setTreasury(address)", ATTACKER));
        } else if (pick == 1) {
            _markIfSuccess(ATTACKER, FEE_POLICY, abi.encodeWithSignature("transferPlatformAdmin(address)", ATTACKER));
        } else {
            _markIfSuccess(
                ATTACKER, FEE_POLICY, abi.encodeWithSignature("setDefaultFeeCents(uint32,uint32)", uint32(0), uint32(0))
            );
        }
    }

    function actionAttackReserve(uint256 raw) external {
        uint256 pick = raw % 4;
        if (pick == 0) {
            _markIfSuccess(ATTACKER, RESERVE, abi.encodeWithSignature("proposeRevenueTreasury(address)", ATTACKER));
        } else if (pick == 1) {
            _markIfSuccess(ATTACKER, RESERVE, abi.encodeWithSignature("proposeFounder(address)", ATTACKER));
        } else if (pick == 2) {
            _markIfSuccess(
                ATTACKER,
                RESERVE,
                abi.encodeWithSignature(
                    "setReservePolicy(uint256,uint256,uint32,uint256,uint256)",
                    uint256(0),
                    uint256(0),
                    uint32(10_000),
                    uint256(1),
                    uint256(1)
                )
            );
        } else {
            _markIfSuccess(ATTACKER, RESERVE, abi.encodeWithSignature("releaseRevenue()"));
        }
    }

    function actionSpoofProvider(uint256 upstream, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        _markIfSuccess(
            ATTACKER, ADAPTER, abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", upstream, words)
        );
    }

    function actionRequestReveal() external {
        RelicCollectionV2 collection = _collection();
        if (collection.delayedRevealRequested() || collection.delayedRevealed()) return;
        (bool ok,) = _callAs(DEPLOYER, COLLECTION, abi.encodeWithSignature("requestDelayedReveal()"));
        if (!ok) securityViolation = true;
    }

    function actionFulfill(uint256 word) external {
        RelicCollectionV2 collection = _collection();
        IR12FinalAdapter adapter = _adapter();
        if (!collection.delayedRevealRequested() || collection.delayedRevealed()) return;
        uint256 localRequestId = collection.delayedRevealRequestId();
        if (localRequestId == 0 || adapter.wordReadyForLocalRequest(localRequestId)) return;

        uint256 upstreamRequestId = adapter.upstreamRequestIdForLocalRequest(localRequestId);
        if (upstreamRequestId == 0) {
            securityViolation = true;
            return;
        }

        uint256[] memory words = new uint256[](1);
        words[0] = word;
        vm.prank(CHAINLINK_WRAPPER);
        try adapter.rawFulfillRandomWords(upstreamRequestId, words) {}
        catch {
            securityViolation = true;
        }
    }

    function actionReplay() external {
        RelicCollectionV2 collection = _collection();
        IR12FinalAdapter adapter = _adapter();
        if (!collection.delayedRevealRequested()) return;
        uint256 localRequestId = collection.delayedRevealRequestId();
        if (!adapter.wordReadyForLocalRequest(localRequestId) || adapter.deliveredForLocalRequest(localRequestId)) {
            return;
        }

        vm.prank(ATTACKER);
        try adapter.replayFulfillment(localRequestId) returns (bool delivered) {
            if (!delivered || !adapter.deliveredForLocalRequest(localRequestId)) securityViolation = true;
        } catch {
            securityViolation = true;
        }
    }

    function actionDuplicateReplay() external {
        RelicCollectionV2 collection = _collection();
        IR12FinalAdapter adapter = _adapter();
        if (!collection.delayedRevealed()) return;
        uint256 localRequestId = collection.delayedRevealRequestId();
        if (!adapter.deliveredForLocalRequest(localRequestId)) {
            securityViolation = true;
            return;
        }

        uint256 seedBefore = collection.delayedRevealSeed();
        uint256 recipe1Before = collection.recipeForToken(1);
        uint256 recipe2Before = collection.recipeForToken(2);

        vm.prank(ATTACKER);
        try adapter.replayFulfillment(localRequestId) returns (bool ignored) {
            ignored;
        }
            catch {}

        if (
            collection.delayedRevealSeed() != seedBefore || collection.recipeForToken(1) != recipe1Before
                || collection.recipeForToken(2) != recipe2Before
        ) {
            securityViolation = true;
        }
    }

    function actionPermissionlessReserveSync() external {
        try _reserve().syncCollection(COLLECTION) {}
        catch {
            securityViolation = true;
        }
    }

    function actionAttackerMint() external {
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(ATTACKER);
        try _collection().mint(1, 1, 0, proof) returns (uint256 mintedTokenId) {
            mintedTokenId;
            securityViolation = true;
        } catch {}
    }

    function actionAttackerTransfer() external {
        address holder;
        try _collection().ownerOf(1) returns (address current) {
            holder = current;
        } catch {
            securityViolation = true;
            return;
        }

        vm.prank(ATTACKER);
        try _collection().transferFrom(holder, ATTACKER, 1) {
            securityViolation = true;
        } catch {}
    }
}

contract ForgeRevealV2R12FinalCrossContractInvariant is R12FinalForkBase {
    R12FinalHostileHandler internal handler;
    address[] private _targetedContracts;

    function targetContracts() public view returns (address[] memory) {
        return _targetedContracts;
    }

    function setUp() public {
        _fork(PRE_REVEAL_BLOCK);
        handler = new R12FinalHostileHandler();
        _targetedContracts.push(address(handler));
    }

    function invariantNoUnauthorizedHostileActionEverSucceeds() public view {
        require(!handler.securityViolation(), "FINAL invariant: hostile action succeeded");
    }

    function invariantSupplyOwnershipAndRecipeBoundsAlwaysHold() public view {
        RelicCollectionV2 collection = _collection();
        uint256 committed = collection.totalCommitted();
        uint256 minted = collection.totalMinted();
        uint256 maxSupply = collection.maxSupply();

        require(maxSupply == 2, "FINAL invariant: max supply changed");
        require(committed <= maxSupply, "FINAL invariant: committed exceeds supply");
        require(minted <= committed, "FINAL invariant: minted exceeds committed");
        require(collection.totalSupply() == minted, "FINAL invariant: totalSupply mismatch");

        for (uint256 tokenId = 1; tokenId <= minted; ++tokenId) {
            require(collection.ownerOf(tokenId) != address(0), "FINAL invariant: owner missing");
        }

        if (collection.delayedRevealed()) {
            uint256 recipe1 = collection.recipeForToken(1);
            uint256 recipe2 = collection.recipeForToken(2);
            require(recipe1 < maxSupply && recipe2 < maxSupply, "FINAL invariant: recipe out of range");
            require(recipe1 != recipe2, "FINAL invariant: duplicate recipes");
        }
    }

    function invariantRolesAndImmutableBindingsNeverDriftToAttacker() public view {
        RelicCollectionV2 collection = _collection();
        RelicMintPhasesV2 phases = _phases();
        IR12FinalFeePolicy fee = _fee();
        IR12FinalReserve reserve = _reserve();
        IR12FinalFactory factory = IR12FinalFactory(FACTORY);

        require(collection.controller() == DEPLOYER, "FINAL invariant: collection controller drift");
        require(phases.controller() == DEPLOYER, "FINAL invariant: phase controller drift");
        require(fee.platformAdmin() == DEPLOYER, "FINAL invariant: fee admin drift");
        require(fee.treasury() == DEPLOYER, "FINAL invariant: fee treasury drift");
        require(reserve.founder() == DEPLOYER, "FINAL invariant: reserve founder drift");
        require(reserve.revenueTreasury() == DEPLOYER, "FINAL invariant: reserve treasury drift");

        require(factory.collectionImplementation() == COLLECTION_IMPL, "FINAL invariant: factory impl drift");
        require(factory.dataImplementation() == DATA_IMPL, "FINAL invariant: data impl drift");
        require(factory.mintPhasesImplementation() == PHASES_IMPL, "FINAL invariant: phases impl drift");
        require(factory.randomnessProvider() == ADAPTER, "FINAL invariant: adapter drift");
        require(factory.reserve() == RESERVE, "FINAL invariant: reserve drift");
        require(factory.feePolicy() == FEE_POLICY, "FINAL invariant: fee policy drift");
    }

    function invariantClonesRemainImmutablyLinkedAndCanonical() public view {
        _assertCloneLink(COLLECTION, COLLECTION_IMPL, "FINAL invariant: Collection clone link");
        _assertCloneLink(DATA, DATA_IMPL, "FINAL invariant: Data clone link");
        _assertCloneLink(PHASES, PHASES_IMPL, "FINAL invariant: Phases clone link");
        require(IR12FinalFactory(FACTORY).isRelicForgeCollection(COLLECTION), "FINAL invariant: factory registry");
        require(IR12FinalRegistry(REGISTRY).isCanonicalCollection(COLLECTION), "FINAL invariant: provider registry");
        require(_reserve().canonicalCollection(COLLECTION), "FINAL invariant: reserve registry");
        require(_data().contentSealed(), "FINAL invariant: content unsealed");
    }

    function invariantReserveCacheNeverUnderstatesLiveLiability() public view {
        RelicCollectionV2 collection = _collection();
        IR12FinalReserve reserve = _reserve();

        require(
            reserve.collectionExposureWei(COLLECTION) >= collection.reserveExposureWei(),
            "FINAL invariant: cached exposure under live"
        );
        require(
            reserve.collectionRestrictedSponsoredLiabilityWei(COLLECTION)
                >= collection.restrictedSponsoredLiabilityWei(),
            "FINAL invariant: cached restricted under live"
        );
        require(
            reserve.collectionActiveBatches(COLLECTION) >= collection.activeForgeBatchCount(),
            "FINAL invariant: cached active under live"
        );

        uint256 required = reserve.requiredReserveWei();
        uint256 balance = RESERVE.balance;
        uint256 expectedAvailable = balance > required ? balance - required : 0;
        require(reserve.availableRevenueWei() == expectedAvailable, "FINAL invariant: available revenue math");
    }

    function invariantRevealDeliveryAndStandardsRemainConsistent() public view {
        RelicCollectionV2 collection = _collection();
        IR12FinalAdapter adapter = _adapter();

        require(collection.supportsInterface(0x01ffc9a7), "FINAL invariant: ERC165");
        require(collection.supportsInterface(0x80ac58cd), "FINAL invariant: ERC721");
        require(collection.supportsInterface(0x5b5e139f), "FINAL invariant: metadata");
        require(collection.supportsInterface(0x2a55205a), "FINAL invariant: ERC2981");
        require(collection.supportsInterface(0x49064906), "FINAL invariant: ERC4906");
        require(collection.supportsInterface(0x7f5828d0), "FINAL invariant: ERC173");
        require(collection.supportsInterface(0xe8a3d485), "FINAL invariant: ERC7572");
        require(!collection.supportsInterface(0x780e9d63), "FINAL invariant: Enumerable false claim");

        if (collection.delayedRevealRequested()) {
            uint256 requestId = collection.delayedRevealRequestId();
            require(requestId != 0, "FINAL invariant: missing request id");
            if (adapter.deliveredForLocalRequest(requestId)) {
                require(collection.delayedRevealed(), "FINAL invariant: delivered but not revealed");
            }
        }

        if (collection.delayedRevealRequested() && !collection.delayedRevealed()) {
            require(!_phases().phaseIsOpen(1), "FINAL invariant: sale open during pending reveal");
        }
    }
}
