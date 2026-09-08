(function () {
  'use strict';

  window.RELICFORGE_V2_ADDRESSES = Object.freeze({
    11155111: Object.freeze({
      chainId: 11155111,
      network: 'Ethereum Sepolia',
      environment: 'certified-preproduction',
      launchEnabled: true,
      factory: '0x2d63a398c037fE9EA09C7176eAB378c5A51FA88D',
      feePolicy: '0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0',
      collectionImplementation: '0x09Fadf4B686bF9F63D1bd2caf0A1045EB89B7e67',
      dataImplementation: '0x8e404F79CB2e4e290F237253041595454a267945',
      mintPhasesImplementation: '0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C',
      renderer: '0xDB75F85712E4cd68f98B7f93a557643A57735749',
      randomnessAdapter: '0x3B97969C2391b82253cC0CBB23376Fb62867E14F',
      reserve: '0x33328CC8eD15c6A0a0396Ee8365e39B403c0eA96',
      canonicalRegistry: '0xD5d25d4E1Dc575d4EAf8f0AAeFb61588c38Cea38',
      ethUsdPriceFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
      chainlinkVrfWrapper: '0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1',
      requestConfirmations: 3,
      requestGasLimit: 1500000,
      replayGasLimit: 1000000,
      consumerWordDeliveryGas: 400000,
      defaultBatchWindowSeconds: 180,
      defaultMaxRandomnessCostPerBatchWei: '20000000000000000',
      certifiedCollection: '0xaFec424d9EfFb59D6e5008D0A86b9A4DD5582172',
      sourceCommit: '57946d6f7f9146d570b1f87954b28204f1b0d6c2'
    }),
    1: Object.freeze({
      chainId: 1,
      network: 'Ethereum Mainnet',
      environment: 'not-deployed',
      launchEnabled: false,
      // R3D production release identity remains deliberately blank until an
      // independently verified Ethereum Mainnet deployment is certified.
      releaseId: '',
      deploymentManifestHash: '',
      factory: '',
      feePolicy: '',
      collectionImplementation: '',
      dataImplementation: '',
      mintPhasesImplementation: '',
      renderer: '',
      randomnessAdapter: '',
      reserve: '',
      canonicalRegistry: ''
    })
  });
})();
