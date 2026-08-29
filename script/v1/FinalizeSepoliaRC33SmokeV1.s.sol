// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "./SepoliaRC33Base.sol";
import "../../contracts/production/RelicProjectDataV1.sol";
import "../../contracts/production/RelicCollectionV1.sol";
import "../../contracts/production/RelicChainlinkVRFV25DirectFundingAdapterV1.sol";

contract FinalizeSepoliaRC33SmokeV1 is SepoliaRC33Base {
    function run() external returns (uint256 recipe, uint256 randomWord) {
        _assertSepolia();

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        RelicChainlinkVRFV25DirectFundingAdapterV1 adapter =
            RelicChainlinkVRFV25DirectFundingAdapterV1(payable(_smokeAddress("adapter")));
        RelicCollectionV1 collection =
            RelicCollectionV1(_smokeAddress("collection"));
        RelicProjectDataV1 data =
            RelicProjectDataV1(_smokeAddress("projectData"));

        uint256 localRequestId = _smokeUint("localRequestId");
        uint256 upstreamRequestId = _smokeUint("upstreamRequestId");

        (
            address consumer,
            uint256 context,
            uint256 word,
            bool wordReady,
            bool delivered
        ) = adapter.deliveries(localRequestId);

        require(consumer == address(collection), "RC33: delivery consumer mismatch");
        require(context != 0, "RC33: missing request context");
        require(wordReady, "RC33: VRF word not ready yet");
        require(delivered, "RC33: VRF word not delivered yet");
        require(adapter.localToUpstreamRequestId(localRequestId) == upstreamRequestId, "RC33: upstream mapping mismatch");
        require(data.contentSealed(), "RC33: data not sealed");

        randomWord = word;

        vm.startBroadcast(deployerKey);

        // Live idempotency check: once Chainlink delivery succeeded, replay must report
        // success without invoking the collection a second time.
        require(adapter.replayFulfillment(localRequestId), "RC33: idempotent replay failed");

        collection.processReveal(10);

        uint256 remainingCredit = adapter.nativeCredit(address(collection));
        if (remainingCredit != 0) {
            adapter.withdrawConsumerCredit(address(collection), remainingCredit);
        }

        vm.stopBroadcast();

        require(collection.isRevealed(1), "RC33: token not revealed");
        require(collection.ownerOf(1) == deployer, "RC33: owner changed");
        recipe = collection.recipeForToken(1);
        require(recipe < 2, "RC33: recipe out of range");
        require(adapter.nativeCredit(address(collection)) == 0, "RC33: unused credit not recovered");
        require(bytes(collection.tokenURI(1)).length != 0, "RC33: empty token URI");
        require(bytes(collection.renderToken(1)).length != 0, "RC33: empty canonical render");

        vm.createDir(_manifestDir(), true);
        string memory objectKey = "rc33-final";

        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "deployer", deployer);
        vm.serializeAddress(objectKey, "adapter", address(adapter));
        vm.serializeAddress(objectKey, "collection", address(collection));
        vm.serializeUint(objectKey, "localRequestId", localRequestId);
        vm.serializeUint(objectKey, "upstreamRequestId", upstreamRequestId);
        vm.serializeUint(objectKey, "randomWord", randomWord);
        string memory json = vm.serializeUint(objectKey, "recipe", recipe);

        vm.writeJson(json, _finalPath());
    }
}
