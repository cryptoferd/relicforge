// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./RFCoreV1.sol";

/**
 * @title RelicRendererV1
 * @notice Shared canonical onchain renderer. One deployment can serve every V1 collection on a chain.
 * @dev RELEASE CANDIDATE. NOT AUDITED. NOT FOR MAINNET YET.
 */
contract RelicRendererV1 is IRelicRendererV1 {
    using RFStringsV1 for uint256;

    function _svgOpen(IRelicProjectDataV1 data) internal view returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ',
            uint256(data.canvasWidth()).toString(), " ", uint256(data.canvasHeight()).toString(),
            '" shape-rendering="crispEdges">'
        );
    }

    function renderPlaceholder(address dataAddress) public view returns (string memory) {
        IRelicProjectDataV1 data = IRelicProjectDataV1(dataAddress);
        return string(abi.encodePacked(_svgOpen(data), data.readPlaceholder(), "</svg>"));
    }

    function _renderTrait(
        IRelicProjectDataV1 data,
        address shard,
        uint32 offset,
        uint32 length,
        uint8 encoding
    ) internal view returns (bytes memory) {
        bytes memory raw = RFDataReaderV1.read(shard, offset, length);
        if (encoding == 0) return raw;

        string memory mime;
        if (encoding == 1) mime = "image/png";
        else if (encoding == 2) mime = "image/jpeg";
        else if (encoding == 3) mime = "image/webp";
        else revert RF_BadEncoding();

        return abi.encodePacked(
            '<image x="0" y="0" width="', uint256(data.canvasWidth()).toString(),
            '" height="', uint256(data.canvasHeight()).toString(),
            '" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:',
            mime, ';base64,', RFBase64V1.encode(raw), '"/>'
        );
    }

    function renderToken(address collection, uint256 tokenId) public view returns (string memory) {
        IRelicCollectionViewV1 c = IRelicCollectionViewV1(collection);
        IRelicProjectDataV1 data = IRelicProjectDataV1(c.dataContract());
        bytes memory dna = data.readRecipe(c.recipeForToken(tokenId));
        bytes memory svg = _svgOpen(data);

        uint8 oneOfOnePlusOne = data.oneOfOneLayerPlusOne();
        if (oneOfOnePlusOne != 0) {
            uint8 specialLayer = oneOfOnePlusOne - 1;
            uint8 specialIndex = uint8(dna[specialLayer]);
            if (specialIndex != 0) {
                (
                string memory _specialName,
                address shard,
                uint32 offset,
                uint32 length,
                uint8 encoding,
                bool _specialHidden,
                bool exists
            ) = data.traitDetails(specialLayer, specialIndex);
            _specialName; _specialHidden;
                if (!exists) revert RF_MissingTrait();
                return string(abi.encodePacked(svg, _renderTrait(data, shard, offset, length, encoding), "</svg>"));
            }
        }

        uint8 layers = data.layerCount();
        for (uint8 layer; layer < layers; ++layer) {
            if (oneOfOnePlusOne != 0 && layer == oneOfOnePlusOne - 1) continue;
            uint8 traitIndex = uint8(dna[layer]);
            (
                string memory _traitName,
                address shard,
                uint32 offset,
                uint32 length,
                uint8 encoding,
                bool _traitHidden,
                bool exists
            ) = data.traitDetails(layer, traitIndex);
            _traitName; _traitHidden;
            if (!exists) revert RF_MissingTrait();
            svg = abi.encodePacked(svg, _renderTrait(data, shard, offset, length, encoding));
        }
        return string(abi.encodePacked(svg, "</svg>"));
    }

    function _specialIndex(IRelicProjectDataV1 data, bytes memory dna) internal view returns (uint8) {
        uint8 oneOfOnePlusOne = data.oneOfOneLayerPlusOne();
        return oneOfOnePlusOne == 0 ? 0 : uint8(dna[oneOfOnePlusOne - 1]);
    }

    function _attributes(IRelicProjectDataV1 data, bytes memory dna) internal view returns (string memory) {
        uint8 specialIndex = _specialIndex(data, dna);
        if (specialIndex != 0) {
            uint16 customCount = data.oneOfOneAttributeCount(specialIndex);
            if (customCount != 0) {
                bytes memory custom = "[";
                for (uint16 i; i < customCount; ++i) {
                    (string memory tt, string memory value) = data.oneOfOneAttribute(specialIndex, i);
                    if (i != 0) custom = abi.encodePacked(custom, ",");
                    custom = abi.encodePacked(
                        custom,
                        '{"trait_type":"', RFStringsV1.escapeJSON(tt),
                        '","value":"', RFStringsV1.escapeJSON(value), '"}'
                    );
                }
                return string(abi.encodePacked(custom, "]"));
            }
        }

        bytes memory out = "[";
        bool first = true;
        uint8 layers = data.layerCount();
        uint8 oneOfOnePlusOne = data.oneOfOneLayerPlusOne();
        for (uint8 layer; layer < layers; ++layer) {
            if (oneOfOnePlusOne != 0 && layer == oneOfOnePlusOne - 1) continue;
            if (data.layerHiddenFromMetadata(layer)) continue;
            uint8 traitIndex = uint8(dna[layer]);
            (
                string memory traitName,
                address _shard,
                uint32 _offset,
                uint32 _length,
                uint8 _encoding,
                bool hidden,
                bool exists
            ) = data.traitDetails(layer, traitIndex);
            _shard; _offset; _length; _encoding;
            if (!exists) revert RF_MissingTrait();
            if (hidden) continue;
            if (!first) out = abi.encodePacked(out, ",");
            first = false;
            out = abi.encodePacked(
                out,
                '{"trait_type":"', RFStringsV1.escapeJSON(data.layerNames(layer)),
                '","value":"', RFStringsV1.escapeJSON(traitName), '"}'
            );
        }
        return string(abi.encodePacked(out, "]"));
    }

    function tokenURI(address collection, uint256 tokenId) external view returns (string memory) {
        IRelicCollectionViewV1 c = IRelicCollectionViewV1(collection);
        IRelicProjectDataV1 data = IRelicProjectDataV1(c.dataContract());

        string memory collectionName = RFStringsV1.escapeJSON(c.name());
        string memory description = RFStringsV1.escapeJSON(c.description());
        string memory tokenName = string(abi.encodePacked(collectionName, " #", tokenId.toString()));
        string memory imageURI;
        string memory attrs = "[]";

        if (c.isRevealed(tokenId)) {
            bytes memory dna = data.readRecipe(c.recipeForToken(tokenId));
            uint8 specialIndex = _specialIndex(data, dna);
            if (specialIndex != 0) {
                (string memory customName, string memory customDescription, bool exists) = data.oneOfOneMetadata(specialIndex);
                if (exists) {
                    if (bytes(customName).length != 0) tokenName = RFStringsV1.escapeJSON(customName);
                    if (bytes(customDescription).length != 0) description = RFStringsV1.escapeJSON(customDescription);
                }
            }
            attrs = _attributes(data, dna);
            if (c.renderMode(tokenId) == 1 && bytes(c.flattenedRenderBaseURI()).length != 0) {
                imageURI = string(abi.encodePacked(c.flattenedRenderBaseURI(), tokenId.toString(), ".png"));
            } else {
                imageURI = string(abi.encodePacked("data:image/svg+xml;base64,", RFBase64V1.encode(bytes(renderToken(collection, tokenId)))));
            }
        } else {
            tokenName = string(abi.encodePacked(collectionName, " #", tokenId.toString(), " - Forging"));
            imageURI = string(abi.encodePacked("data:image/svg+xml;base64,", RFBase64V1.encode(bytes(renderPlaceholder(address(data))))));
        }

        string memory json = string(abi.encodePacked(
            '{"name":"', tokenName,
            '","description":"', description,
            '","image":"', RFStringsV1.escapeJSON(imageURI),
            '","attributes":', attrs, "}"
        ));
        return string(abi.encodePacked("data:application/json;base64,", RFBase64V1.encode(bytes(json))));
    }

    function contractURI(address collection) external view returns (string memory) {
        IRelicCollectionViewV1 c = IRelicCollectionViewV1(collection);
        string memory image = string(abi.encodePacked(
            "data:image/svg+xml;base64,",
            RFBase64V1.encode(bytes(renderPlaceholder(c.dataContract())))
        ));
        string memory json = string(abi.encodePacked(
            '{"name":"', RFStringsV1.escapeJSON(c.name()),
            '","description":"', RFStringsV1.escapeJSON(c.description()),
            '","image":"', RFStringsV1.escapeJSON(image), '"}'
        ));
        return string(abi.encodePacked("data:application/json;base64,", RFBase64V1.encode(bytes(json))));
    }
}
