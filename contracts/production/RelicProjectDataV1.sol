// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";

/**
 * @title RelicProjectDataV1
 * @notice Creator-owned configuration/data container that becomes permanently immutable when sealed.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */
contract RelicProjectDataV1 {
    using RFDataReaderV1 for address;

    uint8 public constant MAX_LAYERS = 64;
    uint32 public constant MAX_VALIDATE_BATCH = 500;
    uint32 public constant MAX_VALIDATE_TRAIT_CHECKS = 4_096;

    struct Trait {
        string name;
        address shard;
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
        address shard;
        uint32 offset;
        uint32 length;
        uint8 encoding;
        bool hiddenFromMetadata;
    }

    struct OneOfOneMeta {
        string tokenName;
        string tokenDescription;
        bool exists;
    }

    struct Attribute {
        string traitType;
        string value;
    }

    event ArtShardAdded(uint256 indexed index, address indexed shard, uint256 dataLength);
    event DnaShardAdded(uint256 indexed index, address indexed shard, uint256 dataLength);
    event PlaceholderSet(address indexed shard, uint32 length);
    event ContentSealed(bytes32 indexed provenanceHash);

    address public creator;
    uint32 public maxSupply;
    uint16 public canvasWidth;
    uint16 public canvasHeight;
    uint8 public layerCount;
    uint8 public oneOfOneLayerPlusOne;
    bool public contentSealed;
    bytes32 public provenanceHash;

    uint32 public recipeCount;
    uint16 public recipesPerShard;
    uint32 public validatedRecipeCursor;
    address public placeholderShard;
    uint32 public placeholderLength;

    address[] public artShards;
    address[] public dnaShards;
    mapping(address => bool) public isArtShard;
    mapping(uint8 => mapping(uint8 => Trait)) private _traits;
    mapping(uint8 => uint16) public traitCountByLayer;
    mapping(uint8 => string) public layerNames;
    mapping(uint8 => bool) public layerHiddenFromMetadata;
    mapping(uint8 => OneOfOneMeta) private _oneOfOne;
    mapping(uint8 => Attribute[]) private _oneOfOneAttributes;

    bool private _initialized;

    modifier onlyCreator() {
        if (msg.sender != creator) revert RF_NotController();
        _;
    }

    modifier beforeSeal() {
        if (contentSealed) revert RF_ContentSealed();
        _;
    }

    constructor() { _initialized = true; }

    function initialize(
        address creator_,
        uint32 maxSupply_,
        uint16 canvasWidth_,
        uint16 canvasHeight_,
        uint8 layerCount_
    ) external {
        if (_initialized) revert RF_AlreadyInitialized();
        if (
            creator_ == address(0) || maxSupply_ == 0 || canvasWidth_ == 0 || canvasHeight_ == 0 ||
            layerCount_ == 0 || layerCount_ > MAX_LAYERS
        ) {
            revert RF_BadConfig();
        }
        _initialized = true;
        creator = creator_;
        maxSupply = maxSupply_;
        canvasWidth = canvasWidth_;
        canvasHeight = canvasHeight_;
        layerCount = layerCount_;
    }

    function addArtShard(bytes calldata data) external onlyCreator beforeSeal returns (address pointer) {
        if (data.length == 0 || data.length > 23_000) revert RF_BadShardSize();
        pointer = address(new RelicDataShardV1(data));
        artShards.push(pointer);
        isArtShard[pointer] = true;
        emit ArtShardAdded(artShards.length - 1, pointer, data.length);
    }

    function addDnaShard(bytes calldata data) external onlyCreator beforeSeal returns (address pointer) {
        if (data.length == 0 || data.length > 23_000) revert RF_BadShardSize();
        pointer = address(new RelicDataShardV1(data));
        dnaShards.push(pointer);
        validatedRecipeCursor = 0;
        emit DnaShardAdded(dnaShards.length - 1, pointer, data.length);
    }

    function setPlaceholder(bytes calldata svgFragment) external onlyCreator beforeSeal {
        if (svgFragment.length == 0 || svgFragment.length > 23_000) revert RF_BadShardSize();
        placeholderShard = address(new RelicDataShardV1(svgFragment));
        placeholderLength = uint32(svgFragment.length);
        emit PlaceholderSet(placeholderShard, placeholderLength);
    }

    function setLayerNames(string[] calldata names_) external onlyCreator beforeSeal {
        if (names_.length != layerCount) revert RF_BadConfig();
        for (uint8 i; i < layerCount; ++i) layerNames[i] = names_[i];
    }

    function setLayerMetadataVisibility(bool[] calldata hidden_) external onlyCreator beforeSeal {
        if (hidden_.length != layerCount) revert RF_BadConfig();
        for (uint8 i; i < layerCount; ++i) layerHiddenFromMetadata[i] = hidden_[i];
    }

    function setOneOfOneLayer(uint8 layer) external onlyCreator beforeSeal {
        if (layer >= layerCount) revert RF_BadLayer();
        oneOfOneLayerPlusOne = layer + 1;
    }

    function addTraits(TraitInput[] calldata inputs) external onlyCreator beforeSeal {
        for (uint256 i; i < inputs.length; ++i) {
            TraitInput calldata input = inputs[i];
            if (input.layer >= layerCount) revert RF_BadLayer();
            if (!isArtShard[input.shard] || input.shard.code.length <= 1) revert RF_BadShard();
            if (input.length == 0) revert RF_BadConfig();
            if (input.encoding > 3) revert RF_BadEncoding();
            uint256 available = RFDataReaderV1.dataLength(input.shard);
            if (input.offset > available || input.length > available - input.offset) revert RF_DataBounds();

            validatedRecipeCursor = 0;
            _traits[input.layer][input.index] = Trait({
                name: input.name,
                shard: input.shard,
                offset: input.offset,
                length: input.length,
                encoding: input.encoding,
                hiddenFromMetadata: input.hiddenFromMetadata,
                exists: true
            });
            if (input.index >= traitCountByLayer[input.layer]) traitCountByLayer[input.layer] = uint16(input.index) + 1;
        }
    }

    function setDNAConfig(uint32 recipeCount_, uint16 recipesPerShard_) external onlyCreator beforeSeal {
        if (recipeCount_ != maxSupply || recipesPerShard_ == 0) revert RF_BadConfig();
        recipeCount = recipeCount_;
        recipesPerShard = recipesPerShard_;
        validatedRecipeCursor = 0;
    }

    function setOneOfOneMetadata(
        uint8 index,
        string calldata tokenName,
        string calldata tokenDescription,
        string[] calldata traitTypes,
        string[] calldata values
    ) external onlyCreator beforeSeal {
        if (index == 0 || oneOfOneLayerPlusOne == 0 || traitTypes.length != values.length) revert RF_BadConfig();
        if (traitTypes.length > 64) revert RF_AttributeLimit();
        _oneOfOne[index] = OneOfOneMeta(tokenName, tokenDescription, true);
        delete _oneOfOneAttributes[index];
        for (uint256 i; i < traitTypes.length; ++i) {
            _oneOfOneAttributes[index].push(Attribute(traitTypes[i], values[i]));
        }
    }

    function traitDetails(uint8 layer, uint8 index) external view returns (
        string memory traitName,
        address shard,
        uint32 offset,
        uint32 length,
        uint8 encoding,
        bool hiddenFromMetadata,
        bool exists
    ) {
        Trait storage t = _traits[layer][index];
        return (t.name, t.shard, t.offset, t.length, t.encoding, t.hiddenFromMetadata, t.exists);
    }

    function oneOfOneMetadata(uint8 index) external view returns (
        string memory tokenName,
        string memory tokenDescription,
        bool exists
    ) {
        OneOfOneMeta storage meta = _oneOfOne[index];
        return (meta.tokenName, meta.tokenDescription, meta.exists);
    }

    function oneOfOneAttributeCount(uint8 index) external view returns (uint16) {
        return uint16(_oneOfOneAttributes[index].length);
    }

    function oneOfOneAttribute(uint8 index, uint16 attributeIndex)
        external view returns (string memory traitType, string memory value)
    {
        Attribute storage a = _oneOfOneAttributes[index][attributeIndex];
        return (a.traitType, a.value);
    }

    function readPlaceholder() external view returns (bytes memory) {
        if (placeholderShard == address(0)) revert RF_MissingPlaceholder();
        return RFDataReaderV1.read(placeholderShard, 0, placeholderLength);
    }

    function readRecipe(uint256 recipeId) public view returns (bytes memory) {
        if (recipeId >= recipeCount || recipesPerShard == 0) revert RF_BadConfig();
        uint256 shardIndex = recipeId / recipesPerShard;
        uint256 local = recipeId % recipesPerShard;
        if (shardIndex >= dnaShards.length) revert RF_BadShard();
        return RFDataReaderV1.read(dnaShards[shardIndex], local * layerCount, layerCount);
    }

    /// @notice Validates the next sequential batch of recipes. Validation is reset if DNA or traits change.
    function validateNextRecipes(uint32 quantity) external onlyCreator beforeSeal {
        if (quantity == 0 || quantity > MAX_VALIDATE_BATCH) revert RF_BatchLimit();
        if (uint256(quantity) * layerCount > MAX_VALIDATE_TRAIT_CHECKS) revert RF_BatchLimit();
        if (recipeCount != maxSupply || recipesPerShard == 0) revert RF_BadConfig();
        uint256 end = uint256(validatedRecipeCursor) + quantity;
        if (end > recipeCount) end = recipeCount;
        for (uint256 recipeId = validatedRecipeCursor; recipeId < end; ++recipeId) {
            bytes memory dna = readRecipe(recipeId);
            for (uint8 layer; layer < layerCount; ++layer) {
                if (!_traits[layer][uint8(dna[layer])].exists) revert RF_MissingTrait();
            }
        }
        validatedRecipeCursor = uint32(end);
    }

    function sealContent(bytes32 provenanceHash_) external onlyCreator beforeSeal {
        if (provenanceHash_ == bytes32(0)) revert RF_BadConfig();
        if (recipeCount != maxSupply || recipesPerShard == 0) revert RF_BadConfig();
        if (artShards.length == 0 || dnaShards.length == 0) revert RF_MissingData();
        if (placeholderShard == address(0)) revert RF_MissingPlaceholder();
        if (validatedRecipeCursor != recipeCount) revert RF_BadConfig();

        for (uint8 layer; layer < layerCount; ++layer) {
            if (traitCountByLayer[layer] == 0) revert RF_MissingTrait();
        }

        uint256 requiredShards = (uint256(recipeCount) + recipesPerShard - 1) / recipesPerShard;
        if (dnaShards.length < requiredShards) revert RF_MissingData();
        for (uint256 i; i < requiredShards; ++i) {
            uint256 recipesInShard = recipesPerShard;
            if (i == requiredShards - 1) {
                uint256 usedBefore = i * recipesPerShard;
                recipesInShard = uint256(recipeCount) - usedBefore;
            }
            uint256 requiredBytes = recipesInShard * layerCount;
            if (RFDataReaderV1.dataLength(dnaShards[i]) < requiredBytes) revert RF_DataBounds();
        }

        provenanceHash = provenanceHash_;
        contentSealed = true;
        emit ContentSealed(provenanceHash_);
    }
}
