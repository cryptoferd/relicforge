// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/*
 * RELIC FORGE - SEPOLIA TEST CONTRACTS
 * -------------------------------------
 * TEST ONLY. NOT AUDITED. NOT FOR MAINNET.
 *
 * This source intentionally has no imports so Relic Forge Studio can compile it
 * in a browser Web Worker with the official soljson compiler.
 */

library RFBase64 {
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
            mstore(afterPtr, 0x00)
            for {} lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(and(shr(18, input), 0x3F)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(shr(12, input), 0x3F)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(shr(6, input), 0x3F)))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(and(input, 0x3F)))
                resultPtr := add(resultPtr, 1)
            }
            mstore(afterPtr, afterCache)
            switch mod(mload(data), 3)
            case 1 {
                mstore8(sub(resultPtr, 1), 0x3d)
                mstore8(sub(resultPtr, 2), 0x3d)
            }
            case 2 {
                mstore8(sub(resultPtr, 1), 0x3d)
            }
            mstore(result, resultLength)
            mstore(0x40, resultEnd)
        }
    }
}

library RFStrings {
    function toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

library RFMerkleProof {
    function verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 i; i < proof.length; ++i) {
            bytes32 proofElement = proof[i];
            computedHash = uint256(computedHash) <= uint256(proofElement)
                ? keccak256(abi.encodePacked(computedHash, proofElement))
                : keccak256(abi.encodePacked(proofElement, computedHash));
        }
        return computedHash == root;
    }
}

contract RelicDataShard {
    constructor(bytes memory data) payable {
        bytes memory runtime = abi.encodePacked(hex"00", data);
        assembly ("memory-safe") {
            return(add(runtime, 0x20), mload(runtime))
        }
    }
}

library RFDataReader {
    function read(address pointer, uint256 offset, uint256 length) internal view returns (bytes memory data) {
        data = new bytes(length);
        assembly ("memory-safe") {
            extcodecopy(pointer, add(data, 0x20), add(offset, 1), length)
        }
    }
}

interface IRelicRandomnessConsumer {
    function fulfillRandomness(uint256 requestId, uint256 randomWord) external;
}

interface IRelicRandomnessProvider {
    function requestRandomness(uint256 context) external returns (uint256 requestId);
}

interface IRelicTestAutoFulfill {
    function fulfill(uint256 requestId) external returns (uint256 randomWord);
}

interface IERC721ReceiverRF {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}

// Compact custom errors keep the shared implementation under EIP-170 without removing features.
error RF_AlreadyRevealed();
error RF_Bad1of1Index();
error RF_Bad1of1Layer();
error RF_BadDnaShard();
error RF_BadEncoding();
error RF_BadImpl();
error RF_BadInfra();
error RF_BadLayer();
error RF_BadLayerFlags();
error RF_BadLayerNames();
error RF_BadPlaceholder();
error RF_BadProvider();
error RF_BadRecipe();
error RF_BadRenderMode();
error RF_BadRequest();
error RF_BadRevealMode();
error RF_BadRoyalty();
error RF_BadRps();
error RF_BadShard();
error RF_BadShardSize();
error RF_BadSourceType();
error RF_CloneFailed();
error RF_DataFinalized();
error RF_DnaNotConfigured();
error RF_FlattenedDisabled();
error RF_Initialized();
error RF_Missing1of1();
error RF_MissingData();
error RF_MissingPlaceholder();
error RF_MissingRenderer();
error RF_MissingTrait();
error RF_NotAuth();
error RF_NotCreatorReveal();
error RF_NotFinalized();
error RF_NotMinted();
error RF_NotOwner();
error RF_NotReady();
error RF_NotRevealed();
error RF_NotTokenOwner();
error RF_NotWhitelisted();
error RF_No1of1Layer();
error RF_NoRecipes();
error RF_OnlyRandomness();
error RF_PublicMintDisabled();
error RF_RecipesLtSupply();
error RF_Reentrant();
error RF_RevealStarted();
error RF_Sealed();
error RF_SoldOut();
error RF_UnsafeRecipient();
error RF_WalletLimit();
error RF_WhitelistAllowance();
error RF_WhitelistMintDisabled();
error RF_WithdrawFailed();
error RF_WrongFrom();
error RF_WrongPrice();
error RF_Zero();
error RF_ZeroLayers();
error RF_ZeroOwner();
error RF_ZeroQuantity();
error RF_ZeroSupply();
error RF_ZeroTo();
error RF_ZeroTrait();
error RF_ZeroWhitelistRoot();

contract RelicCollectionV2 is IRelicRandomnessConsumer {
    using RFStrings for uint256;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 indexed fromTokenId, uint256 indexed toTokenId);
    event ContractURIUpdated();
    event ForgeRequested(uint256 indexed tokenId, uint256 indexed requestId);
    event ForgeBatchRequested(uint256 indexed startTokenId, uint32 quantity, uint256 indexed requestId);
    event MintLimitUpdated(uint32 maxPerWallet);
    event MintAccessUpdated(bool publicMintEnabled, bool whitelistMintEnabled, bytes32 whitelistRoot, uint256 whitelistMintPrice);
    event WhitelistSnapshotRecorded(address indexed sourceContract, uint64 sourceChainId, uint64 snapshotBlock, uint8 sourceType);
    event CreatorRevealRequested(uint256 indexed requestId);
    event CreatorRevealCompleted(uint256 indexed requestId, uint256 seed);
    event DataFinalized(bytes32 indexed provenanceHash);
    event CollectionSealed();
    event RenderConfigUpdated(string flattenedRenderBaseURI, bool holderRenderModeEnabled, uint8 defaultRenderMode);
    event RenderModeUpdated(uint256 indexed tokenId, uint8 renderMode);

    struct Trait {
        string name;
        uint16 shard;
        uint32 offset;
        uint32 length;
        uint8 encoding; // 0 SVG fragment, 1 PNG, 2 JPEG, 3 WEBP
        bool hiddenFromMetadata;
        bool exists;
    }

    struct TraitInput {
        uint8 layer;
        uint8 index;
        string name;
        uint16 shard;
        uint32 offset;
        uint32 length;
        uint8 encoding;
        bool hiddenFromMetadata;
    }

    struct OneOfOneMetadata {
        string tokenName;
        string tokenDescription;
        string attributesJson;
        bool exists;
    }

    struct OneOfOneMetadataInput {
        uint8 index;
        string tokenName;
        string tokenDescription;
        string attributesJson;
    }

    string public name;
    string public symbol;
    string public description;
    address public owner;
    address public royaltyReceiver;
    uint96 public royaltyBps;
    uint256 public mintPrice;
    uint32 public maxSupply;
    uint32 public totalMinted;
    uint32 public maxPerWallet;
    bool public publicMintEnabled;
    bool public whitelistMintEnabled;
    bytes32 public whitelistRoot;
    uint256 public whitelistMintPrice;
    address public whitelistSourceContract;
    uint64 public whitelistSourceChainId;
    uint64 public whitelistSnapshotBlock;
    uint8 public whitelistSourceType; // 0 none, 1 collection snapshot, 2 custom list
    bool public testAutoFulfill;
    uint16 public canvasWidth;
    uint16 public canvasHeight;
    uint8 public layerCount;
    uint8 public oneOfOneLayerPlusOne; // 0 disabled, otherwise layer index + 1
    uint8 public revealMode; // 0 Forge Reveal, 1 Creator Reveal
    address public randomnessProvider;

    // Render mode 0 = canonical fully-onchain SVG. Render mode 1 = offchain presentation URL.
    // V11 retains the legacy .png URL suffix for deployed-contract compatibility; the RelicForge
    // HTTP renderer may respond with another image content type when animation must be preserved.
    // The offchain URL is presentation-only; renderToken() always remains the canonical onchain renderer.
    string public flattenedRenderBaseURI;
    bool public holderRenderModeEnabled;
    uint8 public defaultRenderMode;
    mapping(uint256 => uint8) private _renderModeOverridePlusOne;

    bool public dataFinalized;
    bool public isSealed;
    bytes32 public provenanceHash;

    address[] public artShards;
    address[] public dnaShards;
    address public placeholderShard;
    uint32 public placeholderLength;

    uint32 public recipeCount;
    uint16 public recipesPerShard;
    uint32 public forgeAssignments;
    uint256 public creatorRevealSeed;
    uint256 public pendingCreatorRevealRequest;

    mapping(uint8 => mapping(uint8 => Trait)) internal _traits;
    mapping(uint8 => uint16) public traitCountByLayer;
    mapping(uint8 => string) public layerNames;
    mapping(uint8 => bool) public layerHiddenFromMetadata;
    mapping(uint8 => OneOfOneMetadata) internal _oneOfOneMetadata;

    mapping(uint256 => address) internal _ownerOf;
    mapping(address => uint256) internal _balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    struct ForgeBatch { uint32 startTokenId; uint32 quantity; }
    mapping(uint256 => uint256) public assignedRecipePlusOne;
    mapping(uint256 => ForgeBatch) public requestToBatch;
    mapping(address => uint32) public mintedByWallet;
    mapping(address => uint32) public whitelistMintedByWallet;
    mapping(uint256 => uint256) internal _poolSwapPlusOne;

    bool private _initialized;
    uint256 private _entered;

    modifier onlyOwner() { if (!(msg.sender == owner)) revert RF_NotOwner(); _; }
    modifier whenMutable() { if (!(!isSealed)) revert RF_Sealed(); _; }
    modifier beforeFinalized() { if (!(!dataFinalized)) revert RF_DataFinalized(); _; }
    modifier nonReentrant() { if (!(_entered == 0)) revert RF_Reentrant(); _entered = 1; _; _entered = 0; }

    constructor() { _initialized = true; }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        address owner_,
        uint32 maxSupply_,
        uint16 canvasWidth_,
        uint16 canvasHeight_,
        uint8 layerCount_,
        uint8 revealMode_,
        address randomnessProvider_,
        uint256 mintPrice_,
        uint32 maxPerWallet_,
        address royaltyReceiver_,
        uint96 royaltyBps_,
        bool testAutoFulfill_
    ) external {
        if (!(!_initialized)) revert RF_Initialized();
        if (!(owner_ != address(0))) revert RF_ZeroOwner();
        if (!(maxSupply_ > 0)) revert RF_ZeroSupply();
        if (!(layerCount_ > 0)) revert RF_ZeroLayers();
        if (!(revealMode_ <= 1)) revert RF_BadRevealMode();
        if (!(royaltyBps_ <= 10000)) revert RF_BadRoyalty();
        _initialized = true;
        name = name_;
        symbol = symbol_;
        description = description_;
        owner = owner_;
        maxSupply = maxSupply_;
        canvasWidth = canvasWidth_;
        canvasHeight = canvasHeight_;
        layerCount = layerCount_;
        revealMode = revealMode_;
        randomnessProvider = randomnessProvider_;
        mintPrice = mintPrice_;
        maxPerWallet = maxPerWallet_;
        publicMintEnabled = true;
        testAutoFulfill = testAutoFulfill_;
        royaltyReceiver = royaltyReceiver_ == address(0) ? owner_ : royaltyReceiver_;
        royaltyBps = royaltyBps_;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x2a55205a || interfaceId == 0x49064906;
    }

    function balanceOf(address holder) external view returns (uint256) { if (!(holder != address(0))) revert RF_Zero(); return _balanceOf[holder]; }
    function ownerOf(uint256 tokenId) public view returns (address) { address holder = _ownerOf[tokenId]; if (!(holder != address(0))) revert RF_NotMinted(); return holder; }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (!(msg.sender == holder || isApprovedForAll[holder][msg.sender])) revert RF_NotAuth();
        getApproved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (!(to != address(0))) revert RF_ZeroTo();
        address holder = ownerOf(tokenId);
        if (!(holder == from)) revert RF_WrongFrom();
        if (!(msg.sender == holder || msg.sender == getApproved[tokenId] || isApprovedForAll[holder][msg.sender])) revert RF_NotAuth();
        delete getApproved[tokenId];
        unchecked { _balanceOf[from]--; _balanceOf[to]++; }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external { safeTransferFrom(from, to, tokenId, ""); }
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            if (!(IERC721ReceiverRF(to).onERC721Received(msg.sender, from, tokenId, data) == IERC721ReceiverRF.onERC721Received.selector)) revert RF_UnsafeRecipient();
        }
    }

    function addArtShard(bytes calldata data) external onlyOwner beforeFinalized returns (address pointer) {
        if (!(data.length > 0 && data.length <= 23000)) revert RF_BadShardSize();
        pointer = address(new RelicDataShard(data));
        artShards.push(pointer);
    }

    function addDnaShard(bytes calldata data) external onlyOwner beforeFinalized returns (address pointer) {
        if (!(data.length > 0 && data.length <= 23000)) revert RF_BadShardSize();
        pointer = address(new RelicDataShard(data));
        dnaShards.push(pointer);
    }

    function setPlaceholder(bytes calldata svgFragment) external onlyOwner beforeFinalized {
        if (!(svgFragment.length > 0 && svgFragment.length <= 23000)) revert RF_BadPlaceholder();
        placeholderShard = address(new RelicDataShard(svgFragment));
        placeholderLength = uint32(svgFragment.length);
    }

    function addTraits(TraitInput[] calldata inputs) external onlyOwner beforeFinalized {
        for (uint256 i; i < inputs.length; ++i) {
            TraitInput calldata input = inputs[i];
            if (!(input.layer < layerCount)) revert RF_BadLayer();
            if (!(input.shard < artShards.length)) revert RF_BadShard();
            if (!(input.length > 0)) revert RF_ZeroTrait();
            if (!(input.encoding <= 3)) revert RF_BadEncoding();
            _traits[input.layer][input.index] = Trait(
                input.name, input.shard, input.offset, input.length, input.encoding, input.hiddenFromMetadata, true
            );
            if (input.index >= traitCountByLayer[input.layer]) {
                traitCountByLayer[input.layer] = uint16(input.index) + 1;
            }
        }
    }

    function setLayerNames(string[] calldata names_) external onlyOwner beforeFinalized {
        if (!(names_.length == layerCount)) revert RF_BadLayerNames();
        for (uint8 i; i < layerCount; ++i) layerNames[i] = names_[i];
    }

    function setLayerMetadataVisibility(bool[] calldata hidden_) external onlyOwner beforeFinalized {
        if (!(hidden_.length == layerCount)) revert RF_BadLayerFlags();
        for (uint8 i; i < layerCount; ++i) layerHiddenFromMetadata[i] = hidden_[i];
    }

    function setOneOfOneLayer(uint8 layer) external onlyOwner beforeFinalized {
        if (!(layer < layerCount)) revert RF_Bad1of1Layer();
        oneOfOneLayerPlusOne = layer + 1;
    }

    function setOneOfOneMetadata(OneOfOneMetadataInput[] calldata inputs) external onlyOwner beforeFinalized {
        if (!(oneOfOneLayerPlusOne != 0)) revert RF_No1of1Layer();
        for (uint256 i; i < inputs.length; ++i) {
            OneOfOneMetadataInput calldata input = inputs[i];
            if (!(input.index != 0)) revert RF_Bad1of1Index();
            _oneOfOneMetadata[input.index] = OneOfOneMetadata(
                input.tokenName, input.tokenDescription, input.attributesJson, true
            );
        }
    }

    function traitDetails(uint8 layer, uint8 index) external view returns (Trait memory) { return _traits[layer][index]; }

    function setDNAConfig(uint32 recipeCount_, uint16 recipesPerShard_) external onlyOwner beforeFinalized {
        if (!(recipeCount_ >= maxSupply)) revert RF_RecipesLtSupply();
        if (!(recipesPerShard_ > 0)) revert RF_BadRps();
        recipeCount = recipeCount_;
        recipesPerShard = recipesPerShard_;
    }

    function finalizeData(bytes32 provenanceHash_) external onlyOwner beforeFinalized {
        if (!(recipeCount >= maxSupply)) revert RF_DnaNotConfigured();
        if (!(dnaShards.length > 0 && artShards.length > 0)) revert RF_MissingData();
        if (!(placeholderShard != address(0))) revert RF_MissingPlaceholder();
        provenanceHash = provenanceHash_;
        dataFinalized = true;
        emit DataFinalized(provenanceHash_);
        emit ContractURIUpdated();
    }

    function sealCollection() external onlyOwner {
        if (!(dataFinalized)) revert RF_NotFinalized();
        isSealed = true;
        emit CollectionSealed();
    }

    function setMintPrice(uint256 price) external onlyOwner whenMutable { mintPrice = price; }
    function setMaxPerWallet(uint32 limit) external onlyOwner whenMutable { maxPerWallet = limit; emit MintLimitUpdated(limit); }
    function setMintAccess(
        bool publicEnabled,
        bool whitelistEnabled,
        bytes32 root,
        uint256 whitelistPrice,
        address sourceContract,
        uint64 sourceChainId,
        uint64 snapshotBlock,
        uint8 sourceType
    ) external onlyOwner whenMutable {
        if (!(sourceType <= 2)) revert RF_BadSourceType();
        if (whitelistEnabled) if (!(root != bytes32(0))) revert RF_ZeroWhitelistRoot();
        publicMintEnabled = publicEnabled;
        whitelistMintEnabled = whitelistEnabled;
        whitelistRoot = root;
        whitelistMintPrice = whitelistPrice;
        whitelistSourceContract = sourceContract;
        whitelistSourceChainId = sourceChainId;
        whitelistSnapshotBlock = snapshotBlock;
        whitelistSourceType = sourceType;
        emit MintAccessUpdated(publicEnabled, whitelistEnabled, root, whitelistPrice);
        emit WhitelistSnapshotRecorded(sourceContract, sourceChainId, snapshotBlock, sourceType);
    }
    function setRoyalty(address receiver, uint96 bps) external onlyOwner whenMutable { if (!(bps <= 10000)) revert RF_BadRoyalty(); royaltyReceiver = receiver; royaltyBps = bps; }

    function setRenderConfig(string calldata baseURI, bool holderEnabled, uint8 defaultMode) external onlyOwner whenMutable {
        if (!(defaultMode <= 1)) revert RF_BadRenderMode();
        if (defaultMode == 1) if (!(bytes(baseURI).length != 0)) revert RF_MissingRenderer();
        flattenedRenderBaseURI = baseURI;
        holderRenderModeEnabled = holderEnabled;
        defaultRenderMode = defaultMode;
        emit RenderConfigUpdated(baseURI, holderEnabled, defaultMode);
        if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    function renderMode(uint256 tokenId) public view returns (uint8) {
        ownerOf(tokenId);
        uint8 overridePlusOne = _renderModeOverridePlusOne[tokenId];
        return overridePlusOne == 0 ? defaultRenderMode : overridePlusOne - 1;
    }

    function flattenedImageURI(uint256 tokenId) public view returns (string memory) {
        ownerOf(tokenId);
        if (!(bytes(flattenedRenderBaseURI).length != 0)) revert RF_MissingRenderer();
        return string(abi.encodePacked(flattenedRenderBaseURI, tokenId.toString(), ".png"));
    }

    function setRenderMode(uint256 tokenId, uint8 mode) external {
        address holder = ownerOf(tokenId);
        if (!(msg.sender == holder)) revert RF_NotTokenOwner();
        if (!(mode <= 1)) revert RF_BadRenderMode();
        // Holders can always return to the canonical onchain SVG. Flattened mode
        // is available only when the creator enabled it before sealing.
        if (mode == 1) {
            if (!(holderRenderModeEnabled)) revert RF_FlattenedDisabled();
            if (!(bytes(flattenedRenderBaseURI).length != 0)) revert RF_MissingRenderer();
        }
        _renderModeOverridePlusOne[tokenId] = mode + 1;
        emit RenderModeUpdated(tokenId, mode);
        emit MetadataUpdate(tokenId);
    }

    function mint() external payable returns (uint256 tokenId) {
        uint256 start = mint(1);
        return start;
    }

    function mint(uint32 quantity) public payable nonReentrant returns (uint256 startTokenId) {
        if (!(publicMintEnabled || msg.sender == owner)) revert RF_PublicMintDisabled();
        if (!(quantity > 0)) revert RF_ZeroQuantity();
        if (!(dataFinalized)) revert RF_NotReady();
        if (!(uint256(totalMinted) + quantity <= maxSupply)) revert RF_SoldOut();
        if (!(msg.value == mintPrice * quantity)) revert RF_WrongPrice();
        if (maxPerWallet != 0) {
            if (!(uint256(mintedByWallet[msg.sender]) + quantity <= maxPerWallet)) revert RF_WalletLimit();
        }
        mintedByWallet[msg.sender] += quantity;
        startTokenId = _mintTokens(msg.sender, quantity);
        _beginReveal(startTokenId, quantity);
    }

    function whitelistMint(uint32 quantity, uint32 allowance, bytes32[] calldata proof) external payable nonReentrant returns (uint256 startTokenId) {
        if (!(whitelistMintEnabled)) revert RF_WhitelistMintDisabled();
        if (!(quantity > 0)) revert RF_ZeroQuantity();
        if (!(dataFinalized)) revert RF_NotReady();
        if (!(uint256(totalMinted) + quantity <= maxSupply)) revert RF_SoldOut();
        if (!(msg.value == whitelistMintPrice * quantity)) revert RF_WrongPrice();
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, allowance));
        if (!(RFMerkleProof.verify(proof, whitelistRoot, leaf))) revert RF_NotWhitelisted();
        if (!(uint256(whitelistMintedByWallet[msg.sender]) + quantity <= allowance)) revert RF_WhitelistAllowance();
        if (maxPerWallet != 0) {
            if (!(uint256(mintedByWallet[msg.sender]) + quantity <= maxPerWallet)) revert RF_WalletLimit();
        }
        whitelistMintedByWallet[msg.sender] += quantity;
        mintedByWallet[msg.sender] += quantity;
        startTokenId = _mintTokens(msg.sender, quantity);
        _beginReveal(startTokenId, quantity);
    }

    function creatorMint(uint32 quantity) external onlyOwner nonReentrant returns (uint256 startTokenId) {
        if (!(quantity > 0)) revert RF_ZeroQuantity();
        if (!(dataFinalized)) revert RF_NotReady();
        if (!(uint256(totalMinted) + quantity <= maxSupply)) revert RF_SoldOut();
        mintedByWallet[msg.sender] += quantity;
        startTokenId = _mintTokens(msg.sender, quantity);
        _beginReveal(startTokenId, quantity);
    }

    function _mintTokens(address to, uint32 quantity) internal returns (uint256 startTokenId) {
        startTokenId = uint256(totalMinted) + 1;
        for (uint32 i; i < quantity; ++i) {
            uint256 tokenId = startTokenId + i;
            _ownerOf[tokenId] = to;
            _balanceOf[to] += 1;
            emit Transfer(address(0), to, tokenId);
        }
        totalMinted += quantity;
    }

    function _beginReveal(uint256 startTokenId, uint32 quantity) internal {
        if (revealMode == 0) {
            // Chunk large creator/public batches so production VRF callbacks stay bounded.
            uint32 remaining = quantity;
            uint32 cursor = uint32(startTokenId);
            while (remaining > 0) {
                uint32 chunk = remaining > 25 ? 25 : remaining;
                uint256 context = (uint256(cursor) << 32) | uint256(chunk);
                uint256 requestId = IRelicRandomnessProvider(randomnessProvider).requestRandomness(context);
                requestToBatch[requestId] = ForgeBatch(cursor, chunk);
                emit ForgeBatchRequested(cursor, chunk, requestId);
                if (chunk == 1) emit ForgeRequested(cursor, requestId);
                if (testAutoFulfill) IRelicTestAutoFulfill(randomnessProvider).fulfill(requestId);
                cursor += chunk;
                remaining -= chunk;
            }
        } else if (creatorRevealSeed != 0) {
            emit BatchMetadataUpdate(startTokenId, startTokenId + quantity - 1);
        }
    }

    function requestCreatorReveal() external onlyOwner returns (uint256 requestId) {
        if (!(revealMode == 1)) revert RF_NotCreatorReveal();
        if (!(dataFinalized)) revert RF_NotReady();
        if (!(creatorRevealSeed == 0 && pendingCreatorRevealRequest == 0)) revert RF_RevealStarted();
        requestId = IRelicRandomnessProvider(randomnessProvider).requestRandomness(0);
        pendingCreatorRevealRequest = requestId;
        emit CreatorRevealRequested(requestId);
        if (testAutoFulfill) IRelicTestAutoFulfill(randomnessProvider).fulfill(requestId);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        if (!(msg.sender == randomnessProvider)) revert RF_OnlyRandomness();
        if (revealMode == 1 && requestId == pendingCreatorRevealRequest) {
            creatorRevealSeed = randomWord == 0 ? 1 : randomWord;
            pendingCreatorRevealRequest = 0;
            emit CreatorRevealCompleted(requestId, creatorRevealSeed);
            if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
            return;
        }
        ForgeBatch memory batch = requestToBatch[requestId];
        if (!(batch.startTokenId != 0 && batch.quantity != 0)) revert RF_BadRequest();
        delete requestToBatch[requestId];
        for (uint32 i; i < batch.quantity; ++i) {
            uint256 tokenId = uint256(batch.startTokenId) + i;
            if (!(assignedRecipePlusOne[tokenId] == 0)) revert RF_AlreadyRevealed();
            uint256 derivedWord = uint256(keccak256(abi.encodePacked(randomWord, requestId, tokenId, i)));
            _assignForgeRecipe(tokenId, derivedWord);
        }
        emit BatchMetadataUpdate(batch.startTokenId, uint256(batch.startTokenId) + batch.quantity - 1);
    }

    function _poolValue(uint256 index) internal view returns (uint256) {
        uint256 stored = _poolSwapPlusOne[index];
        return stored == 0 ? index : stored - 1;
    }

    function _assignForgeRecipe(uint256 tokenId, uint256 randomWord) internal {
        uint256 remaining = uint256(recipeCount) - uint256(forgeAssignments);
        if (!(remaining > 0)) revert RF_NoRecipes();
        uint256 pick = randomWord % remaining;
        uint256 selected = _poolValue(pick);
        uint256 last = _poolValue(remaining - 1);
        _poolSwapPlusOne[pick] = last + 1;
        forgeAssignments += 1;
        assignedRecipePlusOne[tokenId] = selected + 1;
    }

    function _gcd(uint256 a, uint256 b) internal pure returns (uint256) {
        while (b != 0) { uint256 t = b; b = a % b; a = t; }
        return a;
    }

    function _creatorRecipe(uint256 tokenId) internal view returns (uint256) {
        uint256 n = recipeCount;
        uint256 a = (creatorRevealSeed % n) | 1;
        if (a >= n) a = 1;
        while (_gcd(a, n) != 1) {
            a += 2;
            if (a >= n) a = 1;
        }
        uint256 b = uint256(keccak256(abi.encodePacked(creatorRevealSeed, "RF_B"))) % n;
        return (a * (tokenId - 1) + b) % n;
    }

    function recipeForToken(uint256 tokenId) public view returns (uint256) {
        ownerOf(tokenId);
        if (revealMode == 0) {
            uint256 p = assignedRecipePlusOne[tokenId];
            if (!(p != 0)) revert RF_NotRevealed();
            return p - 1;
        }
        if (!(creatorRevealSeed != 0)) revert RF_NotRevealed();
        return _creatorRecipe(tokenId);
    }

    function isRevealed(uint256 tokenId) public view returns (bool) {
        if (_ownerOf[tokenId] == address(0)) return false;
        return revealMode == 0 ? assignedRecipePlusOne[tokenId] != 0 : creatorRevealSeed != 0;
    }

    function _readRecipe(uint256 recipeId) internal view returns (bytes memory) {
        if (!(recipeId < recipeCount)) revert RF_BadRecipe();
        uint256 shardIndex = recipeId / recipesPerShard;
        uint256 local = recipeId % recipesPerShard;
        if (!(shardIndex < dnaShards.length)) revert RF_BadDnaShard();
        return RFDataReader.read(dnaShards[shardIndex], local * layerCount, layerCount);
    }

    function _svgOpen() internal view returns (bytes memory) {
        return abi.encodePacked('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', uint256(canvasWidth).toString(), " ", uint256(canvasHeight).toString(), '" shape-rendering="crispEdges">');
    }

    function renderPlaceholder() public view returns (string memory) {
        bytes memory fragment = RFDataReader.read(placeholderShard, 0, placeholderLength);
        return string(abi.encodePacked(_svgOpen(), fragment, "</svg>"));
    }

    function _renderTrait(Trait storage t) internal view returns (bytes memory) {
        bytes memory raw = RFDataReader.read(artShards[t.shard], t.offset, t.length);
        if (t.encoding == 0) return raw;

        string memory mime;
        if (t.encoding == 1) mime = "image/png";
        else if (t.encoding == 2) mime = "image/jpeg";
        else if (t.encoding == 3) mime = "image/webp";
        else revert RF_BadEncoding();

        return abi.encodePacked(
            '<image x="0" y="0" width="', uint256(canvasWidth).toString(),
            '" height="', uint256(canvasHeight).toString(),
            '" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:',
            mime, ';base64,', RFBase64.encode(raw), '"/>'
        );
    }

    function renderToken(uint256 tokenId) public view returns (string memory) {
        uint256 recipeId = recipeForToken(tokenId);
        bytes memory dna = _readRecipe(recipeId);
        bytes memory svg = _svgOpen();
        if (oneOfOneLayerPlusOne != 0) {
            uint8 specialLayer = oneOfOneLayerPlusOne - 1;
            uint8 specialIndex = uint8(dna[specialLayer]);
            if (specialIndex != 0) {
                Trait storage specialTrait = _traits[specialLayer][specialIndex];
                if (!(specialTrait.exists)) revert RF_Missing1of1();
                return string(abi.encodePacked(svg, _renderTrait(specialTrait), "</svg>"));
            }
        }
        for (uint8 layer; layer < layerCount; ++layer) {
            if (oneOfOneLayerPlusOne != 0 && layer == oneOfOneLayerPlusOne - 1) continue;
            uint8 traitIndex = uint8(dna[layer]);
            Trait storage t = _traits[layer][traitIndex];
            if (!(t.exists)) revert RF_MissingTrait();
            svg = abi.encodePacked(svg, _renderTrait(t));
        }
        return string(abi.encodePacked(svg, "</svg>"));
    }

    function _oneOfOneIndex(uint256 tokenId) internal view returns (uint8 specialIndex) {
        if (oneOfOneLayerPlusOne == 0) return 0;
        bytes memory dna = _readRecipe(recipeForToken(tokenId));
        specialIndex = uint8(dna[oneOfOneLayerPlusOne - 1]);
    }

    function _tokenNameDescription(uint256 tokenId) internal view returns (string memory tokenName_, string memory tokenDescription_) {
        tokenName_ = string(abi.encodePacked(name, " #", tokenId.toString()));
        tokenDescription_ = description;
        uint8 specialIndex = _oneOfOneIndex(tokenId);
        if (specialIndex != 0) {
            OneOfOneMetadata storage meta = _oneOfOneMetadata[specialIndex];
            if (meta.exists) {
                if (bytes(meta.tokenName).length != 0) tokenName_ = meta.tokenName;
                if (bytes(meta.tokenDescription).length != 0) tokenDescription_ = meta.tokenDescription;
            }
        }
    }

    function _attributes(uint256 tokenId) internal view returns (string memory) {
        bytes memory dna = _readRecipe(recipeForToken(tokenId));
        if (oneOfOneLayerPlusOne != 0) {
            uint8 specialLayer = oneOfOneLayerPlusOne - 1;
            uint8 specialIndex = uint8(dna[specialLayer]);
            if (specialIndex != 0) {
                OneOfOneMetadata storage meta = _oneOfOneMetadata[specialIndex];
                if (meta.exists && bytes(meta.attributesJson).length != 0) return meta.attributesJson;
                Trait storage specialTrait = _traits[specialLayer][specialIndex];
                if (specialTrait.hiddenFromMetadata || layerHiddenFromMetadata[specialLayer]) return "[]";
                return string(abi.encodePacked('[{"trait_type":"1/1","value":"', specialTrait.name, '"}]'));
            }
        }
        bytes memory out = "[";
        bool first = true;
        for (uint8 layer; layer < layerCount; ++layer) {
            if (oneOfOneLayerPlusOne != 0 && layer == oneOfOneLayerPlusOne - 1) continue;
            if (layerHiddenFromMetadata[layer]) continue;
            Trait storage t = _traits[layer][uint8(dna[layer])];
            if (t.hiddenFromMetadata) continue;
            if (!first) out = abi.encodePacked(out, ",");
            first = false;
            out = abi.encodePacked(out, '{"trait_type":"', layerNames[layer], '","value":"', t.name, '"}');
        }
        return string(abi.encodePacked(out, "]"));
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        bool revealed = isRevealed(tokenId);
        string memory json;
        if (revealed) {
            (string memory tokenName_, string memory tokenDescription_) = _tokenNameDescription(tokenId);
            string memory imageURI;
            if (renderMode(tokenId) == 1 && bytes(flattenedRenderBaseURI).length != 0) {
                // Flattened presentation avoids reconstructing the full SVG inside tokenURI().
                // renderToken(tokenId) remains independently available as the canonical onchain image.
                imageURI = flattenedImageURI(tokenId);
            } else {
                string memory svg = renderToken(tokenId);
                imageURI = string(abi.encodePacked("data:image/svg+xml;base64,", RFBase64.encode(bytes(svg))));
            }
            json = string(abi.encodePacked(
                '{"name":"', tokenName_, '","description":"', tokenDescription_,
                '","image":"', imageURI, '","attributes":', _attributes(tokenId), "}"
            ));
        } else {
            string memory placeholderSvg = renderPlaceholder();
            json = string(abi.encodePacked(
                '{"name":"', name, " #", tokenId.toString(), ' - Forging","description":"', description,
                '","image":"data:image/svg+xml;base64,', RFBase64.encode(bytes(placeholderSvg)), '","attributes":[]}'
            ));
        }
        return string(abi.encodePacked("data:application/json;base64,", RFBase64.encode(bytes(json))));
    }

    function contractURI() external view returns (string memory) {
        string memory image = placeholderShard == address(0) ? "" : string(abi.encodePacked("data:image/svg+xml;base64,", RFBase64.encode(bytes(renderPlaceholder()))));
        string memory json = string(abi.encodePacked('{"name":"', name, '","description":"', description, '","image":"', image, '"}'));
        return string(abi.encodePacked("data:application/json;base64,", RFBase64.encode(bytes(json))));
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        receiver = royaltyReceiver;
        royaltyAmount = (salePrice * royaltyBps) / 10000;
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool ok,) = payable(owner).call{value: address(this).balance}("");
        if (!(ok)) revert RF_WithdrawFailed();
    }
}

contract RelicRandomnessMock is IRelicRandomnessProvider {
    struct Request { address consumer; uint256 context; bool fulfilled; }
    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) public requests;
    event RandomnessRequested(uint256 indexed requestId, address indexed consumer, uint256 context);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomWord);

    function requestRandomness(uint256 context) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request(msg.sender, context, false);
        emit RandomnessRequested(requestId, msg.sender, context);
    }

    // TEST ONLY: public pseudo-random fulfillment. Replace with VRF in production.
    function fulfill(uint256 requestId) external returns (uint256 randomWord) {
        Request storage r = requests[requestId];
        if (!(r.consumer != address(0) && !r.fulfilled)) revert RF_BadRequest();
        r.fulfilled = true;
        randomWord = uint256(keccak256(abi.encodePacked(block.prevrandao, blockhash(block.number - 1), requestId, r.consumer, r.context, msg.sender)));
        if (randomWord == 0) randomWord = 1;
        IRelicRandomnessConsumer(r.consumer).fulfillRandomness(requestId, randomWord);
        emit RandomnessFulfilled(requestId, randomWord);
    }
}

contract RelicForgeFactory {
    address public owner;
    address public implementation;
    address public randomnessProvider;
    bool public testAutoFulfill;
    uint256 public collectionCount;
    mapping(address => bool) public isRelicForgeCollection;
    mapping(address => address[]) internal _collectionsByCreator;

    event CollectionCreated(address indexed creator, address indexed collection, uint256 indexed number, uint8 revealMode);
    event ImplementationUpdated(address indexed implementation);
    event RandomnessProviderUpdated(address indexed provider);

    modifier onlyOwner() { if (!(msg.sender == owner)) revert RF_NotOwner(); _; }

    constructor(address implementation_, address randomnessProvider_, bool testAutoFulfill_) {
        if (!(implementation_.code.length > 0 && randomnessProvider_.code.length > 0)) revert RF_BadInfra();
        owner = msg.sender;
        implementation = implementation_;
        randomnessProvider = randomnessProvider_;
        testAutoFulfill = testAutoFulfill_;
    }

    function setImplementation(address newImplementation) external onlyOwner { if (!(newImplementation.code.length > 0)) revert RF_BadImpl(); implementation = newImplementation; emit ImplementationUpdated(newImplementation); }
    function setRandomnessProvider(address newProvider) external onlyOwner { if (!(newProvider.code.length > 0)) revert RF_BadProvider(); randomnessProvider = newProvider; emit RandomnessProviderUpdated(newProvider); }
    function collectionsByCreator(address creator) external view returns (address[] memory) { return _collectionsByCreator[creator]; }

    function _clone(address target) internal returns (address instance) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3",
            hex"363d3d373d3d3d363d73",
            bytes20(target),
            hex"5af43d82803e903d91602b57fd5bf3"
        );
        assembly ("memory-safe") {
            instance := create(0, add(code, 0x20), mload(code))
        }
        if (!(instance != address(0))) revert RF_CloneFailed();
    }

    function createCollection(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        uint32 maxSupply_,
        uint16 canvasWidth_,
        uint16 canvasHeight_,
        uint8 layerCount_,
        uint8 revealMode_,
        uint256 mintPrice_,
        uint32 maxPerWallet_,
        address royaltyReceiver_,
        uint96 royaltyBps_
    ) external returns (address collection) {
        collection = _clone(implementation);
        RelicCollectionV2(collection).initialize(
            name_, symbol_, description_, msg.sender, maxSupply_, canvasWidth_, canvasHeight_, layerCount_, revealMode_, randomnessProvider, mintPrice_, maxPerWallet_, royaltyReceiver_, royaltyBps_, testAutoFulfill
        );
        collectionCount += 1;
        isRelicForgeCollection[collection] = true;
        _collectionsByCreator[msg.sender].push(collection);
        emit CollectionCreated(msg.sender, collection, collectionCount, revealMode_);
    }
}
