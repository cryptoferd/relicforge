(function () {
  'use strict';
  if (window.RelicForgeNetworks) return;

  const NETWORKS = Object.freeze({
    1: Object.freeze({
      chainId: 1, name: 'Ethereum Mainnet', shortName: 'Ethereum',
      explorer: 'https://etherscan.io', currency: 'ETH', testnet: false,
      rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
    }),
    11155111: Object.freeze({
      chainId: 11155111, name: 'Ethereum Sepolia', shortName: 'Sepolia',
      explorer: 'https://sepolia.etherscan.io', currency: 'ETH', testnet: true,
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org', 'https://rpc.sepolia.org']
    })
  });
  const REQUIRED = [
    'factory', 'feePolicy', 'collectionImplementation', 'dataImplementation',
    'mintPhasesImplementation', 'renderer', 'randomnessAdapter', 'reserve', 'canonicalRegistry'
  ];
  const V2_BINDINGS = {
    collectionImplementation: 'collectionImplementation',
    dataImplementation: 'dataImplementation',
    mintPhasesImplementation: 'mintPhasesImplementation',
    renderer: 'renderer', randomnessAdapter: 'randomnessProvider',
    canonicalRegistry: 'canonicalRegistry', reserve: 'reserve', feePolicy: 'feePolicy'
  };
  const FACTORY_ABI = [
    'function infrastructureReady() view returns(bool)',
    ...Object.values(V2_BINDINGS).map(name => 'function ' + name + '() view returns(address)')
  ];
  const CHOICE_KEY = 'relicforge_selected_network_v2';
  const JOURNAL_KEY = 'relicforge_v2_deployment_journals_v2';
  const LEGACY_JOURNAL_KEY = 'relicforge_v2_deployment_journals_v1';
  const providers = new Map();

  function chainId(value) {
    const id = typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)
      ? Number(BigInt(value)) : Number(value);
    if (!Number.isSafeInteger(id) || !NETWORKS[id]) throw new Error('Unsupported Relic Forge network.');
    return id;
  }
  function metadata(id = 1) { return NETWORKS[chainId(id)]; }
  function config(id = 1) { return window.RELICFORGE_V2_ADDRESSES?.[chainId(id)] || null; }
  function validAddress(value) {
    if (!/^0x[0-9a-f]{40}$/i.test(String(value)) || /^0x0{40}$/i.test(String(value))) return false;
    try { return window.ethers?.isAddress ? !!window.ethers.isAddress(value) : true; }
    catch (_) { return false; }
  }
  function isLaunchEnabled(id = 1) {
    id = chainId(id);
    const cfg = config(id);
    if (!cfg || Number(cfg.chainId) !== id || cfg.launchEnabled !== true) return false;
    if (id === 1 && (cfg.environment !== 'production' || !cfg.releaseId || !cfg.deploymentManifestHash)) return false;
    return REQUIRED.every(field => validAddress(cfg[field]));
  }
  function requireLaunch(id = 1) {
    id = chainId(id);
    if (!isLaunchEnabled(id)) throw new Error(
      metadata(id).name + ' infrastructure is not available for deployment yet. No transaction has been prepared.'
    );
    return config(id);
  }
  function preferredChainId() {
    const query = new URLSearchParams(location.search).get('chain');
    if (query && NETWORKS[Number(query)]) return Number(query);
    try {
      const stored = Number(sessionStorage.getItem(CHOICE_KEY) || localStorage.getItem(CHOICE_KEY));
      if (NETWORKS[stored]) return stored;
    } catch (_) {}
    return 1;
  }
  function select(id, {reload = true} = {}) {
    id = chainId(id);
    try {
      sessionStorage.setItem(CHOICE_KEY, String(id));
      localStorage.setItem(CHOICE_KEY, String(id));
    } catch (_) {}
    if (reload) {
      const url = new URL(location.href);
      url.searchParams.set('chain', String(id));
      // A collection address is never carried into a different network.
      url.searchParams.delete('contract');
      url.searchParams.delete('collection');
      location.assign(url.toString());
    }
    return id;
  }
  function explorerUrl(identifier, id = 1, kind = 'address') {
    id = chainId(id);
    if (!['address', 'tx', 'token'].includes(kind)) throw new Error('Unsupported explorer link.');
    if (kind === 'tx' ? !/^0x[0-9a-f]{64}$/i.test(String(identifier)) : !validAddress(identifier))
      throw new Error('Invalid explorer identifier.');
    return metadata(id).explorer + '/' + kind + '/' + identifier;
  }
  function collectionUrl(address, id, page = 'mint.html') {
    id = chainId(id);
    if (!validAddress(address)) throw new Error('Invalid collection address.');
    if (!['mint.html','dashboard.html'].includes(page)) throw new Error('Unsupported collection page.');
    const url = new URL('./' + page, location.href);
    url.searchParams.set(page === 'mint.html' ? 'contract' : 'collection', address);
    url.searchParams.set('chain', String(id));
    return url.toString();
  }
  function scopedKey(kind, id, wallet, factory, identity = '') {
    id = chainId(id);
    const address = value => {
      if (!validAddress(value)) throw new Error('Network-scoped storage requires a valid wallet and Factory.');
      return String(value).toLowerCase();
    };
    return [String(kind), id, address(wallet), address(factory), String(identity).toLowerCase()].join(':');
  }
  function journalKey(provenance, wallet, factory, id) {
    if (!/^0x[0-9a-f]{64}$/i.test(String(provenance))) throw new Error('Invalid deployment provenance.');
    return scopedKey('journal', id, wallet, factory, provenance);
  }
  function journalMap() {
    try { return JSON.parse(localStorage.getItem(JOURNAL_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function readJournal(provenance, wallet, factory, id) {
    id = chainId(id);
    const key = journalKey(provenance, wallet, factory, id);
    const map = journalMap();
    if (map[key]) {
      const value = map[key];
      if (Number(value.chainId) !== id || String(value.wallet || '').toLowerCase() !== String(wallet).toLowerCase() ||
          String(value.factory || '').toLowerCase() !== String(factory).toLowerCase() ||
          String(value.provenance || '').toLowerCase() !== String(provenance).toLowerCase())
        throw new Error('Stored deployment journal identity mismatch.');
      return JSON.parse(JSON.stringify(value));
    }
    if (id !== 11155111) return null;
    // Only legacy Sepolia records are eligible for migration.
    let old;
    try { old = JSON.parse(localStorage.getItem(LEGACY_JOURNAL_KEY) || '{}') || {}; }
    catch (_) { old = {}; }
    const candidate = old[String(provenance).toLowerCase()];
    if (!candidate || Number(candidate.chainId || 11155111) !== id ||
        String(candidate.factory || '').toLowerCase() !== String(factory).toLowerCase()) return null;
    // Ownerless legacy journals require an onchain creator check before adoption.
    if (!candidate.wallet || String(candidate.wallet).toLowerCase() !== String(wallet).toLowerCase()) return null;
    const migrated = {...candidate, chainId:id, wallet, factory, schema:'relic-forge/deployment-journal@2'};
    map[key] = migrated;
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(map));
    return JSON.parse(JSON.stringify(migrated));
  }
  function writeJournal(journal, wallet, factory, id) {
    id = chainId(id);
    const key = journalKey(journal?.provenance, wallet, factory, id);
    if (journal.chainId != null && Number(journal.chainId) !== id) throw new Error('Deployment journal network mismatch.');
    if (journal.factory && String(journal.factory).toLowerCase() !== String(factory).toLowerCase()) throw new Error('Deployment journal Factory mismatch.');
    if (journal.wallet && String(journal.wallet).toLowerCase() !== String(wallet).toLowerCase()) throw new Error('Deployment journal wallet mismatch.');
    const value = JSON.parse(JSON.stringify({...journal, chainId:id, wallet, factory, schema:'relic-forge/deployment-journal@2'}));
    const map = journalMap();
    map[key] = value;
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(map));
    return value;
  }
  function projectChain(project) {
    const candidates = [
      project?.chainId, project?.networkChainId, project?.launchChainId,
      project?.deploymentJournal?.chainId, project?.forgeState?.chainId,
      project?.forgeState?.deploymentJournal?.chainId
    ];
    for (const value of candidates) if (value !== undefined && value !== null && value !== '') return chainId(value);
    // Existing deployed projects predate chain-aware storage and belong to Sepolia.
    if (project?.collectionAddress || project?.deploymentJournal?.collectionAddress ||
        project?.forgeState?.collectionAddress || project?.forgeState?.deploymentJournal?.collectionAddress) return 11155111;
    return null;
  }
  function assertProject(project, id) {
    const original = projectChain(project);
    if (original !== null && original !== chainId(id))
      throw new Error('This project belongs to ' + metadata(original).name + '. Select its original network.');
    return true;
  }
  function readProvider(id = 1) {
    id = chainId(id);
    if (!window.ethers?.JsonRpcProvider) throw new Error('ethers.js is unavailable.');
    if (!providers.has(id)) {
      const base = String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
      const url = base ? base + '/api/public/rpc/' + id : metadata(id).rpcUrls[0];
      providers.set(id, new window.ethers.JsonRpcProvider(url, id, {staticNetwork:true,batchMaxCount:20}));
    }
    return providers.get(id);
  }
  async function assertProvider(provider, id) {
    id = chainId(id);
    if (!provider) throw new Error('Network connection is unavailable.');
    const actual = typeof provider.send === 'function'
      ? await provider.send('eth_chainId', []) : (await provider.getNetwork()).chainId;
    if (chainId(actual) !== id) throw new Error('RPC chain ID does not match the selected network.');
    return provider;
  }
  async function ensureWalletChain(injected, id) {
    id = chainId(id);
    if (!injected?.request) throw new Error('No selected wallet provider is available.');
    const target = '0x' + id.toString(16);
    if (String(await injected.request({method:'eth_chainId'})).toLowerCase() !== target) {
      try { await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:target}]}); }
      catch (error) {
        if (Number(error?.code) !== 4902) throw error;
        const m = metadata(id);
        await injected.request({method:'wallet_addEthereumChain',params:[{
          chainId:target,chainName:m.name,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
          rpcUrls:m.rpcUrls,blockExplorerUrls:[m.explorer]
        }]});
      }
    }
    if (String(await injected.request({method:'eth_chainId'})).toLowerCase() !== target)
      throw new Error('Wallet did not switch to the selected network.');
    return injected;
  }
  async function verifyInfrastructure(id, provider) {
    id = chainId(id);
    const cfg = requireLaunch(id);
    if (!window.ethers?.Contract) throw new Error('ethers.js is unavailable.');
    const rpc = await assertProvider(provider || readProvider(id), id);
    const factoryCode = await rpc.getCode(cfg.factory);
    if (!factoryCode || factoryCode === '0x')
      throw new Error('The configured Factory has no deployed code.');
    const factory = new window.ethers.Contract(cfg.factory, FACTORY_ABI, rpc);
    if (!await factory.infrastructureReady()) throw new Error('Factory infrastructure is not fully bound.');
    for (const [field, getter] of Object.entries(V2_BINDINGS)) {
      const actual = await factory[getter]();
      if (String(actual).toLowerCase() !== String(cfg[field]).toLowerCase())
        throw new Error('Factory ' + field + ' binding does not match the deployment registry.');
      const code = await rpc.getCode(actual);
      if (!code || code === '0x') throw new Error('Factory ' + field + ' has no deployed code.');
    }
    return cfg;
  }
  window.RelicForgeNetworks = Object.freeze({
    metadata, config, chainId, preferredChainId, select, isLaunchEnabled,
    requireLaunch, explorerUrl, collectionUrl, scopedKey, projectChain,
    assertProject, readJournal, writeJournal, readProvider, assertProvider,
    ensureWalletChain, verifyInfrastructure,
    supported: () => Object.values(NETWORKS)
  });
})();
