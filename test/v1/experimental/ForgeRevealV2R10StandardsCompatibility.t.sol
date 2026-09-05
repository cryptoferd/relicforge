// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../TestBase.sol";
import "../../../contracts/production/v2/RelicForgeV2Core.sol";
import "../../../contracts/production/v2/RelicCollectionV2.sol";
import "../../../contracts/production/v2/RelicMintPhasesV2.sol";

interface IR10RandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

interface VmR10Logs {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract R10StandardsDataMock {
    address public creator;
    uint32 public maxSupply;
    bool public contentSealed;

    constructor(address creator_, uint32 maxSupply_) {
        creator = creator_;
        maxSupply = maxSupply_;
    }

    function setContentSealed(bool value) external {
        contentSealed = value;
    }
}

contract R10StandardsRendererMock {
    function tokenURI(address, uint256) external pure returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function contractURI(address) external pure returns (string memory) {
        return "data:application/json;base64,e30=";
    }

    function renderToken(address, uint256) external pure returns (string memory) {
        return "<svg/>";
    }
}

contract R10StandardsProviderMock {
    uint256 public nextRequestId = 1;

    function quoteRequestPrice(uint32) external pure returns (uint256) {
        return 0;
    }

    function requestRandomness(uint256, uint32) external returns (uint256 requestId) {
        requestId = nextRequestId++;
    }

    function deliver(address collection, uint256 requestId, uint256 randomWord) external {
        IR10RandomnessConsumer(collection).fulfillRandomness(requestId, randomWord);
    }
}

contract R10StandardsReserveMock {
    function fundRandomnessShortfall(uint64, uint256) external pure {
        revert("unexpected reserve draw");
    }

    function syncCollection(address) external {}
    function depositFromCollection() external payable {}
}

contract R10StandardsCodeMock {}

contract ForgeRevealV2R10StandardsCompatibilityTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    uint32 internal constant SUPPLY = 4;

    VmR10Logs internal constant vmLogs = VmR10Logs(address(uint160(uint256(keccak256("hevm cheat code")))));

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
        require(instance != address(0), "clone failed");
    }

    function _fixture()
        internal
        returns (
            RelicCollectionV2 collection,
            R10StandardsDataMock data,
            RelicMintPhasesV2 phases,
            R10StandardsProviderMock provider
        )
    {
        RelicCollectionV2 collectionImpl = new RelicCollectionV2();
        RelicMintPhasesV2 phasesImpl = new RelicMintPhasesV2();

        address collectionAddress = _clone(address(collectionImpl));
        address phasesAddress = _clone(address(phasesImpl));

        data = new R10StandardsDataMock(ALICE, SUPPLY);
        R10StandardsRendererMock renderer = new R10StandardsRendererMock();
        provider = new R10StandardsProviderMock();
        R10StandardsReserveMock reserve = new R10StandardsReserveMock();
        R10StandardsCodeMock feePolicy = new R10StandardsCodeMock();

        phases = RelicMintPhasesV2(phasesAddress);
        phases.initialize(collectionAddress, ALICE, address(feePolicy), 1, 0);

        collection = RelicCollectionV2(payable(collectionAddress));
        RelicCollectionInitV2 memory init = RelicCollectionInitV2({
            name: "Relic Forge R10 Standards",
            symbol: "RFR10",
            description: "R10 standards compatibility",
            creator: ALICE,
            dataContract: address(data),
            renderer: address(renderer),
            randomnessProvider: address(provider),
            forgeReserve: address(reserve),
            feePolicy: address(feePolicy),
            mintPhases: address(phases),
            maxSupply: SUPPLY,
            payoutReceiver: ALICE,
            royaltyReceiver: ALICE,
            royaltyBps: 500,
            feeMode: 1,
            lockedFeeCents: 0,
            initialRevealMode: 0,
            batchWindowSeconds: 180,
            maxRandomnessCostPerBatchWei: 1 ether
        });
        collection.initialize(init);
    }

    function testR10ERC165AndMarketplaceInterfaceSurface() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock unusedData,
            RelicMintPhasesV2 unusedPhases,
            R10StandardsProviderMock unusedProvider
        ) = _fixture();
        unusedData;
        unusedPhases;
        unusedProvider;

        assertTrue(collection.supportsInterface(0x01ffc9a7), "ERC165");
        assertTrue(collection.supportsInterface(0x80ac58cd), "ERC721");
        assertTrue(collection.supportsInterface(0x5b5e139f), "ERC721 metadata");
        assertTrue(collection.supportsInterface(0x2a55205a), "ERC2981");
        assertTrue(collection.supportsInterface(0x49064906), "ERC4906");
        assertTrue(collection.supportsInterface(0x7f5828d0), "ERC173");
        assertTrue(collection.supportsInterface(0xe8a3d485), "ERC7572");
        assertFalse(collection.supportsInterface(0x780e9d63), "must not claim full ERC721Enumerable");
        assertFalse(collection.supportsInterface(0xffffffff), "ERC165 invalid interface");

        assertEq(collection.owner(), ALICE, "ERC173 owner");
        assertEq(collection.creator(), ALICE, "creator provenance");
        assertEq(collection.totalSupply(), 0, "initial totalSupply");
        assertEq(collection.maxSupply(), SUPPLY, "max supply remains separate");

        vm.expectRevert();
        collection.getApproved(1);
    }

    function testR10TotalSupplyAndERC721ApprovalSemantics() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock data,
            RelicMintPhasesV2 unusedPhases,
            R10StandardsProviderMock unusedProvider
        ) = _fixture();
        unusedPhases;
        unusedProvider;

        data.setContentSealed(true);
        vm.prank(ALICE);
        collection.creatorMint(ALICE, 2);

        assertEq(collection.totalSupply(), 2, "totalSupply tracks minted NFTs");
        assertEq(collection.totalMinted(), 2, "legacy minted counter");
        assertEq(collection.ownerOf(1), ALICE, "ownerOf");
        assertEq(collection.getApproved(1), address(0), "approval starts empty");

        vm.prank(ALICE);
        collection.approve(BOB, 1);
        assertEq(collection.getApproved(1), BOB, "approval persisted");

        vm.prank(BOB);
        collection.transferFrom(ALICE, BOB, 1);
        assertEq(collection.ownerOf(1), BOB, "approved transfer");
        assertEq(collection.getApproved(1), address(0), "approval cleared on transfer");
        assertEq(collection.totalSupply(), 2, "transfer does not change totalSupply");
    }

    function testR10ERC173TransferKeepsMintPhasesControllerInSync() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock data,
            RelicMintPhasesV2 phases,
            R10StandardsProviderMock unusedProvider
        ) = _fixture();
        unusedProvider;

        vm.prank(ALICE);
        collection.transferOwnership(BOB);

        assertEq(collection.owner(), BOB, "ERC173 owner transferred");
        assertEq(collection.controller(), BOB, "collection controller transferred");
        assertEq(collection.creator(), ALICE, "creator provenance immutable");
        assertEq(phases.controller(), BOB, "sale controller transferred atomically");

        vm.prank(ALICE);
        vm.expectRevert();
        collection.setPayoutReceiver(ALICE);

        vm.prank(BOB);
        phases.setMasterMintEnabled(false);

        data.setContentSealed(true);
        vm.prank(BOB);
        collection.transferOwnership(address(0));

        assertEq(collection.owner(), address(0), "ERC173 renounced owner");
        assertEq(collection.controller(), address(0), "collection controller renounced");
        assertEq(phases.controller(), address(0), "sale controller renounced");
    }

    function testR10ERC4906MetadataUpdateUsesCanonicalNonIndexedLayout() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock data,
            RelicMintPhasesV2 unusedPhases,
            R10StandardsProviderMock unusedProvider
        ) = _fixture();
        unusedPhases;
        unusedProvider;

        vm.prank(ALICE);
        collection.setRenderConfig("", true, 0);

        data.setContentSealed(true);
        vm.prank(ALICE);
        collection.creatorMint(ALICE, 1);

        vmLogs.recordLogs();
        vm.prank(ALICE);
        collection.setTokenRenderMode(1, 1);
        VmR10Logs.Log[] memory logs = vmLogs.getRecordedLogs();

        bytes32 signature = keccak256("MetadataUpdate(uint256)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(collection) && logs[i].topics.length != 0 && logs[i].topics[0] == signature)
            {
                assertEq(logs[i].topics.length, 1, "MetadataUpdate must have signature topic only");
                assertEq(logs[i].data.length, 32, "MetadataUpdate token ID must be in data");
                assertEq(abi.decode(logs[i].data, (uint256)), 1, "MetadataUpdate token ID");
                found = true;
                break;
            }
        }
        assertTrue(found, "canonical MetadataUpdate log missing");
    }

    function testR10ERC4906BatchMetadataUpdateUsesCanonicalNonIndexedLayout() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock data,
            RelicMintPhasesV2 unusedPhases,
            R10StandardsProviderMock provider
        ) = _fixture();
        unusedPhases;

        data.setContentSealed(true);
        vm.prank(ALICE);
        collection.creatorMint(ALICE, 1);

        vm.prank(ALICE);
        uint256 requestId = collection.requestDelayedReveal();

        vmLogs.recordLogs();
        provider.deliver(address(collection), requestId, 123456789);
        VmR10Logs.Log[] memory logs = vmLogs.getRecordedLogs();

        bytes32 signature = keccak256("BatchMetadataUpdate(uint256,uint256)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(collection) && logs[i].topics.length != 0 && logs[i].topics[0] == signature)
            {
                assertEq(logs[i].topics.length, 1, "BatchMetadataUpdate must have signature topic only");
                assertEq(logs[i].data.length, 64, "BatchMetadataUpdate range must be in data");
                (uint256 fromTokenId, uint256 toTokenId) = abi.decode(logs[i].data, (uint256, uint256));
                assertEq(fromTokenId, 1, "batch from token");
                assertEq(toTokenId, 1, "batch to token");
                found = true;
                break;
            }
        }
        assertTrue(found, "canonical BatchMetadataUpdate log missing");
        assertTrue(collection.delayedRevealed(), "delayed reveal completed");
        assertTrue(collection.hybridForgeActive(), "future mints switched to Forge");
    }

    function testR10ERC2981AndERC7572Surface() public {
        (
            RelicCollectionV2 collection,
            R10StandardsDataMock unusedData,
            RelicMintPhasesV2 unusedPhases,
            R10StandardsProviderMock unusedProvider
        ) = _fixture();
        unusedData;
        unusedPhases;
        unusedProvider;

        (address receiver, uint256 royaltyAmount) = collection.royaltyInfo(1, 1 ether);
        assertEq(receiver, ALICE, "ERC2981 receiver");
        assertEq(royaltyAmount, 0.05 ether, "ERC2981 amount");

        string memory uri = collection.contractURI();
        assertTrue(bytes(uri).length > 29, "contractURI nonempty");
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory raw = bytes(uri);
        for (uint256 i; i < prefix.length; ++i) {
            require(raw[i] == prefix[i], "contractURI data URI prefix");
        }
    }
}
