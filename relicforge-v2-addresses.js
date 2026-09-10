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
      defaultBatchWindowSeconds: 30,
      defaultMaxRandomnessCostPerBatchWei: '20000000000000000',
      certifiedCollection: '0xaFec424d9EfFb59D6e5008D0A86b9A4DD5582172',
      sourceCommit: '57946d6f7f9146d570b1f87954b28204f1b0d6c2'
    }),
    1: Object.freeze({
      chainId: 1,
      network: 'Ethereum Mainnet',
      environment: 'production',
      // Part 6E.2A exposes the already-certified production release to Studio.
      // Server policy, chain verification, Factory binding checks, and wallet-chain
      // verification still run before any transaction can be prepared.
      launchEnabled: true,
      releaseId: 'RelicForge-Mainnet-R12V2-R1',
      deploymentManifestHash: 'ad99569e1dd416a01c0f159ab2bb6c2fe7749ee50aa44527c32639983ee57c14',
      factory: '0xd614d4dd3757365fb456789d2669dd55b6e6d6d5',
      feePolicy: '0x61c5c153e96a9ded09fe3afcdca65a5958281e67',
      collectionImplementation: '0x43bc4a9181960601c13b96f630adee74a0b219cf',
      dataImplementation: '0x5cac5280b00ee729c9351c0e3235151c645f9834',
      mintPhasesImplementation: '0xd7ef23619fab079941b05bdc2ac0f5ff90af4e4a',
      renderer: '0xf449700e0fafdb1d0edb1af40096f61c229bc41f',
      randomnessAdapter: '0x231ccd119188c3e9a8ae18b62dc536d8e3ed675a',
      reserve: '0xf20442fcf072f87bb694eb6b7697ee2362ce5a49',
      canonicalRegistry: '0xc9a8096aa3ead34282fbf24eaacabd414a00ee31',
      defaultBatchWindowSeconds: 30
    })
  });
})();
