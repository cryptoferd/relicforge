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

contract RelicCollectionV1 is IRelicRandomnessConsumer {
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
    event WhitelistSnapshotRecorded(address indexed sourceContract, uint64 snapshotBlock, uint8 sourceType);
    event CreatorRevealRequested(uint256 indexed requestId);
    event CreatorRevealCompleted(uint256 indexed requestId, uint256 seed);
    event DataFinalized(bytes32 indexed provenanceHash);
    event CollectionSealed();

    struct Trait {
        string name;
        uint16 shard;
        uint32 offset;
        uint32 length;
        uint8 encoding; // 0 SVG fragment, 1 PNG, 2 JPEG, 3 WEBP
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
    uint64 public whitelistSnapshotBlock;
    uint8 public whitelistSourceType; // 0 none, 1 collection snapshot, 2 custom list
    bool public testAutoFulfill;
    uint16 public canvasWidth;
    uint16 public canvasHeight;
    uint8 public layerCount;
    uint8 public revealMode; // 0 Forge Reveal, 1 Creator Reveal
    address public randomnessProvider;

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

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }
    modifier whenMutable() { require(!isSealed, "SEALED"); _; }
    modifier beforeFinalized() { require(!dataFinalized, "DATA_FINALIZED"); _; }
    modifier nonReentrant() { require(_entered == 0, "REENTRANT"); _entered = 1; _; _entered = 0; }

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
        require(!_initialized, "INITIALIZED");
        require(owner_ != address(0), "ZERO_OWNER");
        require(maxSupply_ > 0, "ZERO_SUPPLY");
        require(layerCount_ > 0, "ZERO_LAYERS");
        require(revealMode_ <= 1, "BAD_REVEAL_MODE");
        require(royaltyBps_ <= 10000, "BAD_ROYALTY");
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

    function balanceOf(address holder) external view returns (uint256) { require(holder != address(0), "ZERO"); return _balanceOf[holder]; }
    function ownerOf(uint256 tokenId) public view returns (address) { address holder = _ownerOf[tokenId]; require(holder != address(0), "NOT_MINTED"); return holder; }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        require(msg.sender == holder || isApprovedForAll[holder][msg.sender], "NOT_AUTH");
        getApproved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(to != address(0), "ZERO_TO");
        address holder = ownerOf(tokenId);
        require(holder == from, "WRONG_FROM");
        require(msg.sender == holder || msg.sender == getApproved[tokenId] || isApprovedForAll[holder][msg.sender], "NOT_AUTH");
        delete getApproved[tokenId];
        unchecked { _balanceOf[from]--; _balanceOf[to]++; }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external { safeTransferFrom(from, to, tokenId, ""); }
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length != 0) {
            require(IERC721ReceiverRF(to).onERC721Received(msg.sender, from, tokenId, data) == IERC721ReceiverRF.onERC721Received.selector, "UNSAFE_RECIPIENT");
        }
    }

    function addArtShard(bytes calldata data) external onlyOwner beforeFinalized returns (address pointer) {
        require(data.length > 0 && data.length <= 23000, "BAD_SHARD_SIZE");
        pointer = address(new RelicDataShard(data));
        artShards.push(pointer);
    }

    function addDnaShard(bytes calldata data) external onlyOwner beforeFinalized returns (address pointer) {
        require(data.length > 0 && data.length <= 23000, "BAD_SHARD_SIZE");
        pointer = address(new RelicDataShard(data));
        dnaShards.push(pointer);
    }

    function setPlaceholder(bytes calldata svgFragment) external onlyOwner beforeFinalized {
        require(svgFragment.length > 0 && svgFragment.length <= 23000, "BAD_PLACEHOLDER");
        placeholderShard = address(new RelicDataShard(svgFragment));
        placeholderLength = uint32(svgFragment.length);
    }

    function addTraits(TraitInput[] calldata inputs) external onlyOwner beforeFinalized {
        for (uint256 i; i < inputs.length; ++i) {
            TraitInput calldata input = inputs[i];
            require(input.layer < layerCount, "BAD_LAYER");
            require(input.shard < artShards.length, "BAD_SHARD");
            require(input.length > 0, "ZERO_TRAIT");
            require(input.encoding <= 3, "BAD_ENCODING");
            _traits[input.layer][input.index] = Trait(
                input.name, input.shard, input.offset, input.length, input.encoding, true
            );
            if (input.index >= traitCountByLayer[input.layer]) {
                traitCountByLayer[input.layer] = uint16(input.index) + 1;
            }
        }
    }

    function setLayerNames(string[] calldata names_) external onlyOwner beforeFinalized {
        require(names_.length == layerCount, "BAD_LAYER_NAMES");
        for (uint8 i; i < layerCount; ++i) layerNames[i] = names_[i];
    }

    function traitDetails(uint8 layer, uint8 index) external view returns (Trait memory) { return _traits[layer][index]; }

    function setDNAConfig(uint32 recipeCount_, uint16 recipesPerShard_) external onlyOwner beforeFinalized {
        require(recipeCount_ >= maxSupply, "RECIPES_LT_SUPPLY");
        require(recipesPerShard_ > 0, "BAD_RPS");
        recipeCount = recipeCount_;
        recipesPerShard = recipesPerShard_;
    }

    function finalizeData(bytes32 provenanceHash_) external onlyOwner beforeFinalized {
        require(recipeCount >= maxSupply, "DNA_NOT_CONFIGURED");
        require(dnaShards.length > 0 && artShards.length > 0, "MISSING_DATA");
        require(placeholderShard != address(0), "MISSING_PLACEHOLDER");
        provenanceHash = provenanceHash_;
        dataFinalized = true;
        emit DataFinalized(provenanceHash_);
        emit ContractURIUpdated();
    }

    function sealCollection() external onlyOwner {
        require(dataFinalized, "NOT_FINALIZED");
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
        uint64 snapshotBlock,
        uint8 sourceType
    ) external onlyOwner whenMutable {
        require(sourceType <= 2, "BAD_SOURCE_TYPE");
        if (whitelistEnabled) require(root != bytes32(0), "ZERO_WHITELIST_ROOT");
        publicMintEnabled = publicEnabled;
        whitelistMintEnabled = whitelistEnabled;
        whitelistRoot = root;
        whitelistMintPrice = whitelistPrice;
        whitelistSourceContract = sourceContract;
        whitelistSnapshotBlock = snapshotBlock;
        whitelistSourceType = sourceType;
        emit MintAccessUpdated(publicEnabled, whitelistEnabled, root, whitelistPrice);
        emit WhitelistSnapshotRecorded(sourceContract, snapshotBlock, sourceType);
    }
    function setRoyalty(address receiver, uint96 bps) external onlyOwner whenMutable { require(bps <= 10000, "BAD_ROYALTY"); royaltyReceiver = receiver; royaltyBps = bps; }

    function mint() external payable returns (uint256 tokenId) {
        uint256 start = mint(1);
        return start;
    }

    function mint(uint32 quantity) public payable nonReentrant returns (uint256 startTokenId) {
        require(publicMintEnabled || msg.sender == owner, "PUBLIC_MINT_DISABLED");
        require(quantity > 0, "ZERO_QUANTITY");
        require(dataFinalized, "NOT_READY");
        require(uint256(totalMinted) + quantity <= maxSupply, "SOLD_OUT");
        require(msg.value == mintPrice * quantity, "WRONG_PRICE");
        if (maxPerWallet != 0 && msg.sender != owner) {
            require(uint256(mintedByWallet[msg.sender]) + quantity <= maxPerWallet, "WALLET_LIMIT");
        }
        mintedByWallet[msg.sender] += quantity;
        startTokenId = _mintTokens(msg.sender, quantity);
        _beginReveal(startTokenId, quantity);
    }

    function whitelistMint(uint32 quantity, uint32 allowance, bytes32[] calldata proof) external payable nonReentrant returns (uint256 startTokenId) {
        require(whitelistMintEnabled, "WHITELIST_MINT_DISABLED");
        require(quantity > 0, "ZERO_QUANTITY");
        require(dataFinalized, "NOT_READY");
        require(uint256(totalMinted) + quantity <= maxSupply, "SOLD_OUT");
        require(msg.value == whitelistMintPrice * quantity, "WRONG_PRICE");
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, allowance));
        require(RFMerkleProof.verify(proof, whitelistRoot, leaf), "NOT_WHITELISTED");
        require(uint256(whitelistMintedByWallet[msg.sender]) + quantity <= allowance, "WHITELIST_ALLOWANCE");
        if (maxPerWallet != 0 && msg.sender != owner) {
            require(uint256(mintedByWallet[msg.sender]) + quantity <= maxPerWallet, "WALLET_LIMIT");
        }
        whitelistMintedByWallet[msg.sender] += quantity;
        mintedByWallet[msg.sender] += quantity;
        startTokenId = _mintTokens(msg.sender, quantity);
        _beginReveal(startTokenId, quantity);
    }

    function creatorMint(uint32 quantity) external onlyOwner nonReentrant returns (uint256 startTokenId) {
        require(quantity > 0, "ZERO_QUANTITY");
        require(dataFinalized, "NOT_READY");
        require(uint256(totalMinted) + quantity <= maxSupply, "SOLD_OUT");
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
        require(revealMode == 1, "NOT_CREATOR_REVEAL");
        require(dataFinalized, "NOT_READY");
        require(creatorRevealSeed == 0 && pendingCreatorRevealRequest == 0, "REVEAL_STARTED");
        requestId = IRelicRandomnessProvider(randomnessProvider).requestRandomness(0);
        pendingCreatorRevealRequest = requestId;
        emit CreatorRevealRequested(requestId);
        if (testAutoFulfill) IRelicTestAutoFulfill(randomnessProvider).fulfill(requestId);
    }

    function fulfillRandomness(uint256 requestId, uint256 randomWord) external override {
        require(msg.sender == randomnessProvider, "ONLY_RANDOMNESS");
        if (revealMode == 1 && requestId == pendingCreatorRevealRequest) {
            creatorRevealSeed = randomWord == 0 ? 1 : randomWord;
            pendingCreatorRevealRequest = 0;
            emit CreatorRevealCompleted(requestId, creatorRevealSeed);
            if (totalMinted > 0) emit BatchMetadataUpdate(1, totalMinted);
            return;
        }
        ForgeBatch memory batch = requestToBatch[requestId];
        require(batch.startTokenId != 0 && batch.quantity != 0, "BAD_REQUEST");
        delete requestToBatch[requestId];
        for (uint32 i; i < batch.quantity; ++i) {
            uint256 tokenId = uint256(batch.startTokenId) + i;
            require(assignedRecipePlusOne[tokenId] == 0, "ALREADY_REVEALED");
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
        require(remaining > 0, "NO_RECIPES");
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
            require(p != 0, "NOT_REVEALED");
            return p - 1;
        }
        require(creatorRevealSeed != 0, "NOT_REVEALED");
        return _creatorRecipe(tokenId);
    }

    function isRevealed(uint256 tokenId) public view returns (bool) {
        if (_ownerOf[tokenId] == address(0)) return false;
        return revealMode == 0 ? assignedRecipePlusOne[tokenId] != 0 : creatorRevealSeed != 0;
    }

    function _readRecipe(uint256 recipeId) internal view returns (bytes memory) {
        require(recipeId < recipeCount, "BAD_RECIPE");
        uint256 shardIndex = recipeId / recipesPerShard;
        uint256 local = recipeId % recipesPerShard;
        require(shardIndex < dnaShards.length, "BAD_DNA_SHARD");
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
        else revert("BAD_ENCODING");

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
        for (uint8 layer; layer < layerCount; ++layer) {
            uint8 traitIndex = uint8(dna[layer]);
            Trait storage t = _traits[layer][traitIndex];
            require(t.exists, "MISSING_TRAIT");
            svg = abi.encodePacked(svg, _renderTrait(t));
        }
        return string(abi.encodePacked(svg, "</svg>"));
    }

    function _attributes(uint256 tokenId) internal view returns (string memory) {
        bytes memory dna = _readRecipe(recipeForToken(tokenId));
        bytes memory out = "[";
        for (uint8 layer; layer < layerCount; ++layer) {
            Trait storage t = _traits[layer][uint8(dna[layer])];
            if (layer != 0) out = abi.encodePacked(out, ",");
            out = abi.encodePacked(out, '{"trait_type":"', layerNames[layer], '","value":"', t.name, '"}');
        }
        return string(abi.encodePacked(out, "]"));
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        bool revealed = isRevealed(tokenId);
        string memory svg = revealed ? renderToken(tokenId) : renderPlaceholder();
        string memory json;
        if (revealed) {
            json = string(abi.encodePacked(
                '{"name":"', name, " #", tokenId.toString(), '","description":"', description,
                '","image":"data:image/svg+xml;base64,', RFBase64.encode(bytes(svg)), '","attributes":', _attributes(tokenId), "}"
            ));
        } else {
            json = string(abi.encodePacked(
                '{"name":"', name, " #", tokenId.toString(), ' - Forging","description":"', description,
                '","image":"data:image/svg+xml;base64,', RFBase64.encode(bytes(svg)), '","attributes":[]}'
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
        require(ok, "WITHDRAW_FAILED");
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
        require(r.consumer != address(0) && !r.fulfilled, "BAD_REQUEST");
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

    modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }

    constructor(address implementation_, address randomnessProvider_, bool testAutoFulfill_) {
        require(implementation_.code.length > 0 && randomnessProvider_.code.length > 0, "BAD_INFRA");
        owner = msg.sender;
        implementation = implementation_;
        randomnessProvider = randomnessProvider_;
        testAutoFulfill = testAutoFulfill_;
    }

    function setImplementation(address newImplementation) external onlyOwner { require(newImplementation.code.length > 0, "BAD_IMPL"); implementation = newImplementation; emit ImplementationUpdated(newImplementation); }
    function setRandomnessProvider(address newProvider) external onlyOwner { require(newProvider.code.length > 0, "BAD_PROVIDER"); randomnessProvider = newProvider; emit RandomnessProviderUpdated(newProvider); }
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
        require(instance != address(0), "CLONE_FAILED");
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
        RelicCollectionV1(collection).initialize(
            name_, symbol_, description_, msg.sender, maxSupply_, canvasWidth_, canvasHeight_, layerCount_, revealMode_, randomnessProvider, mintPrice_, maxPerWallet_, royaltyReceiver_, royaltyBps_, testAutoFulfill
        );
        collectionCount += 1;
        isRelicForgeCollection[collection] = true;
        _collectionsByCreator[msg.sender].push(collection);
        emit CollectionCreated(msg.sender, collection, collectionCount, revealMode_);
    }
}
