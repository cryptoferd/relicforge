(() => {
  'use strict';

  const QA_QUERY_PARAM = 'qa';
  const QA_STORAGE_KEY = 'relicforge_qa_mode';
  const params = new URLSearchParams(window.location.search);
  if (params.get(QA_QUERY_PARAM) === '1') {
    try { localStorage.setItem(QA_STORAGE_KEY, '1'); } catch (_) {}
  } else if (params.get(QA_QUERY_PARAM) === '0') {
    try { localStorage.removeItem(QA_STORAGE_KEY); } catch (_) {}
  }

  let storedQa = false;
  try { storedQa = localStorage.getItem(QA_STORAGE_KEY) === '1'; } catch (_) {}
  const qaMode = params.get(QA_QUERY_PARAM) === '1' || storedQa;

  const list = [
    {
      key: 'ethereum', chainId: 1, name: 'Ethereum', walletName: 'Ethereum Mainnet', badge: 'ETHEREUM',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      explorer: 'https://etherscan.io',
      publicRpcs: ['https://ethereum-rpc.publicnode.com'],
      alchemyKey: 'eth-mainnet', production: true, qa: false,
    },
    {
      key: 'base', chainId: 8453, name: 'Base', walletName: 'Base Mainnet', badge: 'BASE',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      explorer: 'https://base.blockscout.com',
      publicRpcs: ['https://mainnet.base.org'],
      alchemyKey: 'base-mainnet', production: true, qa: false,
    },
    {
      key: 'robinhood', chainId: 4663, name: 'Robinhood Chain', walletName: 'Robinhood Chain', badge: 'ROBINHOOD',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      explorer: 'https://robinhoodchain.blockscout.com',
      publicRpcs: ['https://rpc.mainnet.chain.robinhood.com'],
      alchemyKey: 'robinhood-mainnet', production: true, qa: false,
    },
    {
      key: 'ethereum-sepolia', chainId: 11155111, name: 'Ethereum Sepolia', walletName: 'Ethereum Sepolia', badge: 'ETHEREUM QA',
      nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
      explorer: 'https://sepolia.etherscan.io',
      publicRpcs: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org', 'https://rpc.sepolia.org'],
      alchemyKey: 'eth-sepolia', production: false, qa: true,
    },
    {
      key: 'base-sepolia', chainId: 84532, name: 'Base Sepolia', walletName: 'Base Sepolia', badge: 'BASE QA',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      explorer: 'https://sepolia-explorer.base.org',
      publicRpcs: ['https://sepolia.base.org'],
      alchemyKey: 'base-sepolia', production: false, qa: true,
    },
    {
      key: 'robinhood-testnet', chainId: 46630, name: 'Robinhood Chain Testnet', walletName: 'Robinhood Chain Testnet', badge: 'ROBINHOOD QA',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      explorer: 'https://explorer.testnet.chain.robinhood.com',
      publicRpcs: ['https://rpc.testnet.chain.robinhood.com'],
      alchemyKey: 'robinhood-testnet', production: false, qa: true,
    },
  ].map(item => Object.freeze({ ...item, chainHex: `0x${item.chainId.toString(16)}` }));

  const byId = Object.freeze(Object.fromEntries(list.map(item => [String(item.chainId), item])));
  const byKey = Object.freeze(Object.fromEntries(list.map(item => [item.key, item])));

  function get(chainId) { return byId[String(Number(chainId))] || null; }
  function label(chainId) { return get(chainId)?.name || `Chain ${chainId}`; }
  function visibleLaunchNetworks() { return list.filter(item => item.production || (qaMode && item.qa)); }
  function productionNetworks() { return list.filter(item => item.production); }
  function qaNetworks() { return list.filter(item => item.qa); }
  function canonical(chainId) { return window.RELICFORGE_V1_ADDRESSES?.[Number(chainId)] || null; }
  function canonicalReady(chainId) {
    const cfg = canonical(chainId);
    if (!cfg) return false;
    return ['factory','feePolicy','renderer','randomnessAdapter'].every(key => /^0x[0-9a-fA-F]{40}$/.test(String(cfg[key] || '')));
  }
  function explorerAddress(chainId, address) {
    const network = get(chainId);
    return network?.explorer && address ? `${network.explorer.replace(/\/$/, '')}/address/${address}` : '';
  }
  function explorerTx(chainId, hash) {
    const network = get(chainId);
    return network?.explorer && hash ? `${network.explorer.replace(/\/$/, '')}/tx/${hash}` : '';
  }
  function walletAddParams(chainId) {
    const network = get(chainId);
    if (!network) return null;
    return {
      chainId: network.chainHex,
      chainName: network.walletName,
      nativeCurrency: network.nativeCurrency,
      rpcUrls: [...network.publicRpcs],
      blockExplorerUrls: network.explorer ? [network.explorer] : [],
    };
  }

  window.RelicForgeNetworks = Object.freeze({
    qaMode,
    list: Object.freeze(list),
    byId,
    byKey,
    get,
    label,
    productionNetworks,
    qaNetworks,
    visibleLaunchNetworks,
    canonical,
    canonicalReady,
    explorerAddress,
    explorerTx,
    walletAddParams,
  });
})();
