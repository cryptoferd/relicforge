(function () {
  'use strict';

  window.RELICFORGE_V2_ADDRESSES = Object.freeze({
    11155111: Object.freeze({
      chainId: 11155111,
      network: 'Ethereum Sepolia',
      environment: 'certified-preproduction',
      architectureVersion: 'R12V2-R2',
      immediateOwnership: true,
      automaticConsumerDelivery: true,
      launchEnabled: true,
      factory: '0xD6604d82ec0ca67B4d34843a7F40a6Ff7299fA46',
      feePolicy: '0x9eD612FBeC226DDb086CeEDbFaDbf0bE333aB2d0',
      collectionImplementation: '0x1D3E42d22BFd1844fF672ddeAf5eAb20F451983B',
      dataImplementation: '0x8e404F79CB2e4e290F237253041595454a267945',
      mintPhasesImplementation: '0x2408bCD15bf2363c236DfE61EEe0ED3016a7C14C',
      renderer: '0xDB75F85712E4cd68f98B7f93a557643A57735749',
      randomnessAdapter: '0xFd048cc2636c6def06a10BF35EC53Eb6ACB7Dc40',
      reserve: '0xCa7E36F99807b74c280e1a38c192816FbD193C26',
      canonicalRegistry: '0xBb6733A3FAF4f46813f5bEE9A88Ecb649F094A5e',
      ethUsdPriceFeed: '0x694AA1769357215DE4FAC081bf1f309aDC325306',
      chainlinkVrfWrapper: '0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1',
      requestConfirmations: 3,
      requestGasLimit: 1500000,
      autoRevealConsumerCallbackGas: 1500000,
      delayedRevealConsumerCallbackGas: 500000,
      adapterCallbackOverheadGas: 250000,
      deliveryGasReserve: 75000,
      defaultBatchWindowSeconds: 30,
      defaultMaxRandomnessCostPerBatchWei: '20000000000000000',
      certifiedCollection: '0x95dE1A0fb735b95c687e8240CdAF66bBB6cDa094',
      certifiedForgeCollection: '0x95dE1A0fb735b95c687e8240CdAF66bBB6cDa094',
      certifiedDelayedCollection: '0xbce23634c81f5efc4f793f97b3348DB0AaE4D065',
      liveCanaryEvidenceVersion: 'R12V2-R2-Sepolia-Live-Canary-R1.1',
      sourceCommit: 'd748e2ba1a83b80212249a8b96508283b56e7459'
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
