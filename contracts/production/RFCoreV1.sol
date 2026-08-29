// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @title RelicForge V1 Core
 * @notice Shared primitives for the RelicForge production release candidate.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */

library RFBase64V1 {
    function encode(bytes memory data) internal pure returns (string memory result) {
        if (data.length == 0) return "";
        uint256 resultLength = 4 * ((data.length + 2) / 3);
        assembly ("memory-safe") {
            result := mload(0x40)
            mstore(0x1f, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
            mstore(0x3f, "ghijklmnopqrstuvwxyz0123456789+/")
            let resultPtr := add(result, 0x20)
            let resultEnd := add(resultPtr, resultLength)
            let dataPtr := data
            let endPtr := add(data, mload(data))
            let afterPtr := add(endPtr, 0x20)
            let afterCache := mload(afterPtr)
            mstore(afterPtr, 0)
            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(and(shr(18, input), 0x3f)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(shr(12, input), 0x3f)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(shr(6, input), 0x3f)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(input, 0x3f)))
                resultPtr := add(resultPtr, 1)
            }
            mstore(afterPtr, afterCache)
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
            mstore(result, resultLength)
            mstore(0x40, resultEnd)
        }
    }
}

library RFStringsV1 {
    bytes16 private constant HEX = "0123456789abcdef";

    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { ++digits; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked { --digits; }
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function escapeJSON(string memory value) internal pure returns (string memory) {
        bytes memory src = bytes(value);
        bytes memory out = new bytes(src.length * 6);
        uint256 j;
        for (uint256 i; i < src.length; ++i) {
            uint8 c = uint8(src[i]);
            if (c == 0x22 || c == 0x5c) {
                out[j++] = 0x5c; out[j++] = bytes1(c);
            } else if (c == 0x08) {
                out[j++] = 0x5c; out[j++] = 0x62;
            } else if (c == 0x0c) {
                out[j++] = 0x5c; out[j++] = 0x66;
            } else if (c == 0x0a) {
                out[j++] = 0x5c; out[j++] = 0x6e;
            } else if (c == 0x0d) {
                out[j++] = 0x5c; out[j++] = 0x72;
            } else if (c == 0x09) {
                out[j++] = 0x5c; out[j++] = 0x74;
            } else if (c < 0x20) {
                out[j++] = 0x5c; out[j++] = 0x75; out[j++] = 0x30; out[j++] = 0x30;
                out[j++] = HEX[c >> 4]; out[j++] = HEX[c & 0x0f];
            } else {
                out[j++] = bytes1(c);
            }
        }
        assembly ("memory-safe") { mstore(out, j) }
        return string(out);
    }
}

library RFMerkleProofV1 {
    function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i; i < proof.length; ++i) {
            bytes32 p = proof[i];
            computed = uint256(computed) <= uint256(p)
                ? keccak256(abi.encodePacked(computed, p))
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == root;
    }
}

contract RelicDataShardV1 {
    constructor(bytes memory data) {
        // 0xfe INVALID makes ordinary calls/value transfers revert instead of silently trapping ETH.
        // The prefix remains exactly one byte, preserving RFDataReaderV1 offsets.
        bytes memory runtime = abi.encodePacked(hex"fe", data);
        assembly ("memory-safe") { return(add(runtime, 0x20), mload(runtime)) }
    }
}

library RFDataReaderV1 {
    function dataLength(address pointer) internal view returns (uint256) {
        uint256 size = pointer.code.length;
        return size == 0 ? 0 : size - 1;
    }

    function read(address pointer, uint256 offset, uint256 length) internal view returns (bytes memory data) {
        uint256 available = dataLength(pointer);
        if (length == 0 || offset > available || length > available - offset) revert RF_DataBounds();
        data = new bytes(length);
        assembly ("memory-safe") { extcodecopy(pointer, add(data, 0x20), add(offset, 1), length) }
    }
}

interface IERC721ReceiverRFV1 {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external returns (bytes4);
}

interface IRelicRandomnessProviderV1 {
    function requestRandomness(uint256 context) external returns (uint256 requestId);
}

interface IRelicRandomnessConsumerV1 {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

interface IRelicRendererV1 {
    function tokenURI(address collection, uint256 tokenId) external view returns (string memory);
    function contractURI(address collection) external view returns (string memory);
    function renderToken(address collection, uint256 tokenId) external view returns (string memory);
    function renderPlaceholder(address dataContract) external view returns (string memory);
}

interface IRFAggregatorV3V1 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IRelicForgeFeePolicyV1 {
    function platformAdmin() external view returns (address);
    function treasury() external view returns (address);
    function feesEnabled() external view returns (bool);
    function sponsoredFeeCents() external view returns (uint32);
    function minterFeeCents() external view returns (uint32);
    function quoteUsdCents(uint256 usdCents) external view returns (uint256 nativeAmount, bool oracleHealthy);
    function quoteSponsoredFee(uint32 maxSupply)
        external view returns (uint256 feeWei, bool oracleHealthy, bool feeActive);
    function quoteMintFee(address collection, uint32 lockedFeeCents, uint32 quantity)
        external view returns (uint256 feeWei, bool oracleHealthy, bool feeActive);
    function recordSponsoredFee(address collection, address creator, uint32 maxSupply, uint32 feeCents) external payable;
    function depositMintFees(address collection) external payable;
}

interface IRelicCollectionFeeViewV1 {
    function factory() external view returns (address);
    function creator() external view returns (address);
    function maxSupply() external view returns (uint32);
    function feePolicy() external view returns (address);
    function platformFeeMode() external view returns (uint8);
    function lockedPlatformFeeCents() external view returns (uint32);
}

interface IRelicProjectDataV1 {
    function creator() external view returns (address);
    function maxSupply() external view returns (uint32);
    function canvasWidth() external view returns (uint16);
    function canvasHeight() external view returns (uint16);
    function layerCount() external view returns (uint8);
    function oneOfOneLayerPlusOne() external view returns (uint8);
    function contentSealed() external view returns (bool);
    function provenanceHash() external view returns (bytes32);
    function layerNames(uint8 layer) external view returns (string memory);
    function layerHiddenFromMetadata(uint8 layer) external view returns (bool);
    function readRecipe(uint256 recipeId) external view returns (bytes memory);
    function readPlaceholder() external view returns (bytes memory);
    function traitDetails(uint8 layer, uint8 index) external view returns (
        string memory traitName,
        address shard,
        uint32 offset,
        uint32 length,
        uint8 encoding,
        bool hiddenFromMetadata,
        bool exists
    );
    function oneOfOneMetadata(uint8 index) external view returns (
        string memory tokenName,
        string memory tokenDescription,
        bool exists
    );
    function oneOfOneAttributeCount(uint8 index) external view returns (uint16);
    function oneOfOneAttribute(uint8 index, uint16 attributeIndex)
        external view returns (string memory traitType, string memory value);
}

interface IRelicCollectionViewV1 {
    function name() external view returns (string memory);
    function description() external view returns (string memory);
    function dataContract() external view returns (address);
    function recipeForToken(uint256 tokenId) external view returns (uint256);
    function isRevealed(uint256 tokenId) external view returns (bool);
    function renderMode(uint256 tokenId) external view returns (uint8);
    function flattenedRenderBaseURI() external view returns (string memory);
}

error RF_AlreadyConfigured();
error RF_AlreadyFulfilled();
error RF_BadFeeMode();
error RF_BadOracleConfig();
error RF_FeeLimit();
error RF_FeePolicyNotBound();
error RF_AlreadyInitialized();
error RF_AlreadyRevealed();
error RF_AttributeLimit();
error RF_BadAccessType();
error RF_BadConfig();
error RF_BadEncoding();
error RF_BadImpl();
error RF_BadLayer();
error RF_BadPhase();
error RF_BadProof();
error RF_BadProvider();
error RF_BadRenderMode();
error RF_BadRequest();
error RF_BadRoyalty();
error RF_BadShard();
error RF_BadShardSize();
error RF_BadTimeRange();
error RF_BatchLimit();
error RF_CloneFailed();
error RF_ContentNotSealed();
error RF_ContentSealed();
error RF_DataBounds();
error RF_EpochPending();
error RF_InsufficientAllowance();
error RF_InvalidRecipient();
error RF_MissingData();
error RF_MissingPlaceholder();
error RF_MissingRenderer();
error RF_MissingTrait();
error RF_NoDeferredTokens();
error RF_NoRecipes();
error RF_NotAuthorized();
error RF_NotController();
error RF_NotMinted();
error RF_NotRandomnessProvider();
error RF_NotRevealed();
error RF_NotTokenOwner();
error RF_PhaseClosed();
error RF_PhaseDisabled();
error RF_PhaseNotStarted();
error RF_PhaseSoldOut();
error RF_PublicSalePaused();
error RF_Reentrant();
error RF_Renounced();
error RF_RenounceUnsafe();
error RF_SoldOut();
error RF_UnsafeRecipient();
error RF_WalletLimit();
error RF_WithdrawFailed();
error RF_WrongFrom();
error RF_WrongPrice();
error RF_ZeroAddress();
error RF_ZeroQuantity();
