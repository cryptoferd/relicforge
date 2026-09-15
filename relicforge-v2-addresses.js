(function () {
  'use strict';

  window.RELICFORGE_V2_ADDRESSES = Object.freeze({
    11155111: Object.freeze({
      chainId: 11155111,
      network: 'Ethereum Sepolia',
      environment: 'adaptive-r2-sepolia',
      architectureVersion: 'R12V2-R2-ADAPTIVE',
      immediateOwnership: true,
      automaticConsumerDelivery: true,
      launchEnabled: true,
      factory: '0xAb920d3AbeceBF506711D1817179BC1067e9E6Ca',
      feePolicy: '0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0',
      collectionImplementation: '0x884760377f041833A5E4336d3a847306Febea738',
      dataImplementation: '0x8e404F79CB2e4e290F237253041595454a267945',
      mintPhasesImplementation: '0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C',
      renderer: '0xDB75F85712E4cd68f98B7f93a557643A57735749',
      randomnessAdapter: '0x85Bf6B934028d5E029922283CE8Cf97174ff0ecc',
      reserve: '0x5e810b6E6fa5cA34F75c79B521847F99f38180f5',
      canonicalRegistry: '0x4cB5b8d41082cB97FC8Dc6dDb26dD9B2ca545452',
      ethUsdPriceFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
      chainlinkVrfWrapper: '0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1',
      requestConfirmations: 3,
      requestGasLimit: 1400000,
      autoRevealConsumerCallbackGas: 1400000,
      maxAutoRevealGroupNfts: 20,
      delayedRevealConsumerCallbackGas: 500000,
      adapterCallbackOverheadGas: 250000,
      deliveryGasReserve: 75000,
      defaultBatchWindowSeconds: 30,
      defaultMaxRandomnessCostPerBatchWei: '5000000000000000',
      adaptiveAutoRevealGasTiers: Object.freeze({
        one: 400000,
        twoToFour: 550000,
        fiveToTen: 900000,
        elevenToFifteen: 1150000,
        sixteenToTwenty: 1400000
      }),
      certifiedCollection: '0x3ff6750f82a6eDFDe0B295Fde860343dAa792A42',
      certifiedForgeCollection: '0x3ff6750f82a6eDFDe0B295Fde860343dAa792A42',
      certifiedDelayedCollection: null,
      liveCanaryEvidenceVersion: 'R12V2-R2-Adaptive-Live-Canary-R1.4',
      adaptiveReplayEvidenceVersion: 'R12V2-R2-Exact-Word-Replay-R1.5',
      sourceCommit: '26ed1cc5431fe12ce671df7f005060353d1cf1c0'
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
