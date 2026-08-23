// RelicForge Alchemy network registry.
// Endpoint bases are server-side configuration, not secrets. The only Alchemy
// secret required by V11.0.3 is ALCHEMY_API_KEY.
// Endpoint catalog synchronized with Alchemy's supported-network documentation
// on 2026-08-23. Some newly launched networks do not yet have a stable/verified
// EIP-155 chain ID in this registry; their endpoint is still cataloged and can be
// activated immediately with ALCHEMY_NETWORK_OVERRIDES_JSON.

function n(key, label, baseUrl, chainId = null, testnet = false, platform = label) {
  return Object.freeze({ key, label, platform, baseUrl, chainId, testnet, evm: true });
}

export const ALCHEMY_EVM_NETWORKS = Object.freeze([
  n('worldchain-mainnet', 'World Chain Mainnet', 'https://worldchain-mainnet.g.alchemy.com/v2', 480, false, 'World Chain'),
  n('worldchain-sepolia', 'World Chain Sepolia', 'https://worldchain-sepolia.g.alchemy.com/v2', 4801, true, 'World Chain'),
  n('shape-mainnet', 'Shape Mainnet', 'https://shape-mainnet.g.alchemy.com/v2', 360, false, 'Shape'),
  n('shape-sepolia', 'Shape Sepolia', 'https://shape-sepolia.g.alchemy.com/v2', 11011, true, 'Shape'),
  n('eth-mainnet', 'Ethereum Mainnet', 'https://eth-mainnet.g.alchemy.com/v2', 1, false, 'Ethereum'),
  n('eth-sepolia', 'Ethereum Sepolia', 'https://eth-sepolia.g.alchemy.com/v2', 11155111, true, 'Ethereum'),
  n('eth-holesky', 'Ethereum Holesky', 'https://eth-holesky.g.alchemy.com/v2', 17000, true, 'Ethereum'),
  n('eth-hoodi', 'Ethereum Hoodi', 'https://eth-hoodi.g.alchemy.com/v2', 560048, true, 'Ethereum'),
  n('zksync-mainnet', 'ZKsync Mainnet', 'https://zksync-mainnet.g.alchemy.com/v2', 324, false, 'ZKsync'),
  n('zksync-sepolia', 'ZKsync Sepolia', 'https://zksync-sepolia.g.alchemy.com/v2', 300, true, 'ZKsync'),
  n('opt-mainnet', 'OP Mainnet', 'https://opt-mainnet.g.alchemy.com/v2', 10, false, 'OP Mainnet'),
  n('opt-sepolia', 'OP Sepolia', 'https://opt-sepolia.g.alchemy.com/v2', 11155420, true, 'OP Mainnet'),
  n('polygon-mainnet', 'Polygon Mainnet', 'https://polygon-mainnet.g.alchemy.com/v2', 137, false, 'Polygon PoS'),
  n('polygon-amoy', 'Polygon Amoy', 'https://polygon-amoy.g.alchemy.com/v2', 80002, true, 'Polygon PoS'),
  n('arb-mainnet', 'Arbitrum One', 'https://arb-mainnet.g.alchemy.com/v2', 42161, false, 'Arbitrum'),
  n('arb-sepolia', 'Arbitrum Sepolia', 'https://arb-sepolia.g.alchemy.com/v2', 421614, true, 'Arbitrum'),
  n('astar-mainnet', 'Astar Mainnet', 'https://astar-mainnet.g.alchemy.com/v2', 592, false, 'Astar'),
  n('zetachain-mainnet', 'ZetaChain Mainnet', 'https://zetachain-mainnet.g.alchemy.com/v2', 7000, false, 'ZetaChain'),
  n('zetachain-testnet', 'ZetaChain Testnet', 'https://zetachain-testnet.g.alchemy.com/v2', 7001, true, 'ZetaChain'),
  n('mantle-mainnet', 'Mantle Mainnet', 'https://mantle-mainnet.g.alchemy.com/v2', 5000, false, 'Mantle'),
  n('mantle-sepolia', 'Mantle Sepolia', 'https://mantle-sepolia.g.alchemy.com/v2', 5003, true, 'Mantle'),
  n('berachain-mainnet', 'Berachain Mainnet', 'https://berachain-mainnet.g.alchemy.com/v2', 80094, false, 'Berachain'),
  n('berachain-bepolia', 'Berachain Bepolia', 'https://berachain-bepolia.g.alchemy.com/v2', 80069, true, 'Berachain'),
  n('blast-mainnet', 'Blast Mainnet', 'https://blast-mainnet.g.alchemy.com/v2', 81457, false, 'Blast'),
  n('blast-sepolia', 'Blast Sepolia', 'https://blast-sepolia.g.alchemy.com/v2', 168587773, true, 'Blast'),
  n('linea-mainnet', 'Linea Mainnet', 'https://linea-mainnet.g.alchemy.com/v2', 59144, false, 'Linea'),
  n('linea-sepolia', 'Linea Sepolia', 'https://linea-sepolia.g.alchemy.com/v2', 59141, true, 'Linea'),
  n('zora-mainnet', 'Zora Mainnet', 'https://zora-mainnet.g.alchemy.com/v2', 7777777, false, 'Zora'),
  n('zora-sepolia', 'Zora Sepolia', 'https://zora-sepolia.g.alchemy.com/v2', 999999999, true, 'Zora'),
  n('ronin-mainnet', 'Ronin Mainnet', 'https://ronin-mainnet.g.alchemy.com/v2', 2020, false, 'Ronin'),
  n('ronin-saigon', 'Ronin Saigon', 'https://ronin-saigon.g.alchemy.com/v2', 2021, true, 'Ronin'),
  n('plasma-mainnet', 'Plasma Mainnet', 'https://plasma-mainnet.g.alchemy.com/v2', null, false, 'Plasma'),
  n('plasma-testnet', 'Plasma Testnet', 'https://plasma-testnet.g.alchemy.com/v2', null, true, 'Plasma'),
  n('standard-mainnet', 'Standard Mainnet', 'https://standard-mainnet.g.alchemy.com/v2', null, false, 'Standard'),
  n('mythos-mainnet', 'Mythos Mainnet', 'https://mythos-mainnet.g.alchemy.com/v2', null, false, 'Mythos'),
  n('settlus-mainnet', 'Settlus Mainnet', 'https://settlus-mainnet.g.alchemy.com/v2', null, false, 'Settlus'),
  n('settlus-sepolia', 'Settlus Sepolia', 'https://settlus-septestnet.g.alchemy.com/v2', null, true, 'Settlus'),
  n('earnm-mainnet', 'Earnm Mainnet', 'https://earnm-mainnet.g.alchemy.com/v2', null, false, 'Earnm'),
  n('earnm-sepolia', 'Earnm Sepolia', 'https://earnm-sepolia.g.alchemy.com/v2', null, true, 'Earnm'),
  n('xprotocol-mainnet', 'X Protocol Mainnet', 'https://xprotocol-mainnet.g.alchemy.com/v2', null, false, 'X Protocol'),
  n('bob-mainnet', 'BOB Mainnet', 'https://bob-mainnet.g.alchemy.com/v2', 60808, false, 'BOB'),
  n('bob-sepolia', 'BOB Sepolia', 'https://bob-sepolia.g.alchemy.com/v2', null, true, 'BOB'),
  n('megaeth-mainnet', 'MegaETH Mainnet', 'https://megaeth-mainnet.g.alchemy.com/v2', null, false, 'MegaETH'),
  n('megaeth-testnet', 'MegaETH Testnet', 'https://megaeth-testnet.g.alchemy.com/v2', null, true, 'MegaETH'),
  n('rootstock-mainnet', 'Rootstock Mainnet', 'https://rootstock-mainnet.g.alchemy.com/v2', 30, false, 'Rootstock'),
  n('rootstock-testnet', 'Rootstock Testnet', 'https://rootstock-testnet.g.alchemy.com/v2', 31, true, 'Rootstock'),
  n('worldl3-devnet', 'WorldL3 Devnet', 'https://worldl3-devnet.g.alchemy.com/v2', null, true, 'WorldL3'),
  n('citrea-mainnet', 'Citrea Mainnet', 'https://citrea-mainnet.g.alchemy.com/v2', null, false, 'Citrea'),
  n('citrea-testnet', 'Citrea Testnet', 'https://citrea-testnet.g.alchemy.com/v2', null, true, 'Citrea'),
  n('tea-sepolia', 'Tea Sepolia', 'https://tea-sepolia.g.alchemy.com/v2', null, true, 'Tea'),
  n('gensyn-mainnet', 'Gensyn Mainnet', 'https://gensyn-mainnet.g.alchemy.com/v2', null, false, 'Gensyn'),
  n('gensyn-testnet', 'Gensyn Testnet', 'https://gensyn-testnet.g.alchemy.com/v2', null, true, 'Gensyn'),
  n('arc-testnet', 'Arc Testnet', 'https://arc-testnet.g.alchemy.com/v2', null, true, 'Arc'),
  n('story-mainnet', 'DATA Network Mainnet', 'https://story-mainnet.g.alchemy.com/v2', 1514, false, 'DATA Network'),
  n('story-aeneid', 'DATA Network Aeneid', 'https://story-aeneid.g.alchemy.com/v2', 1315, true, 'DATA Network'),
  n('humanity-mainnet', 'Humanity Mainnet', 'https://humanity-mainnet.g.alchemy.com/v2', null, false, 'Humanity'),
  n('humanity-testnet', 'Humanity Testnet', 'https://humanity-testnet.g.alchemy.com/v2', null, true, 'Humanity'),
  n('base-mainnet', 'Base Mainnet', 'https://base-mainnet.g.alchemy.com/v2', 8453, false, 'Base'),
  n('base-sepolia', 'Base Sepolia', 'https://base-sepolia.g.alchemy.com/v2', 84532, true, 'Base'),
  n('tempo-mainnet', 'Tempo Mainnet', 'https://tempo-mainnet.g.alchemy.com/v2', null, false, 'Tempo'),
  n('tempo-moderato', 'Tempo Moderato', 'https://tempo-moderato.g.alchemy.com/v2', null, true, 'Tempo'),
  n('hyperliquid-mainnet', 'HyperEVM Mainnet', 'https://hyperliquid-mainnet.g.alchemy.com/v2', 999, false, 'HyperEVM'),
  n('hyperliquid-testnet', 'HyperEVM Testnet', 'https://hyperliquid-testnet.g.alchemy.com/v2', 998, true, 'HyperEVM'),
  n('galactica-mainnet', 'Galactica Mainnet', 'https://galactica-mainnet.g.alchemy.com/v2', null, false, 'Galactica'),
  n('galactica-cassiopeia', 'Galactica Cassiopeia', 'https://galactica-cassiopeia.g.alchemy.com/v2', null, true, 'Galactica'),
  n('lens-mainnet', 'Lens Mainnet', 'https://lens-mainnet.g.alchemy.com/v2', 232, false, 'Lens'),
  n('lens-sepolia', 'Lens Sepolia', 'https://lens-sepolia.g.alchemy.com/v2', 37111, true, 'Lens'),
  n('worldmobilechain-mainnet', 'World Mobile Chain Mainnet', 'https://worldmobilechain-mainnet.g.alchemy.com/v2', null, false, 'World Mobile Chain'),
  n('frax-mainnet', 'Frax Mainnet', 'https://frax-mainnet.g.alchemy.com/v2', 252, false, 'Frax'),
  n('frax-hoodi', 'Frax Hoodi', 'https://frax-hoodi.g.alchemy.com/v2', 2522, true, 'Frax'),
  n('ink-mainnet', 'Ink Mainnet', 'https://ink-mainnet.g.alchemy.com/v2', 57073, false, 'Ink'),
  n('ink-sepolia', 'Ink Sepolia', 'https://ink-sepolia.g.alchemy.com/v2', 763373, true, 'Ink'),
  n('avax-mainnet', 'Avalanche C-Chain Mainnet', 'https://avax-mainnet.g.alchemy.com/v2', 43114, false, 'Avalanche'),
  n('avax-fuji', 'Avalanche Fuji', 'https://avax-fuji.g.alchemy.com/v2', 43113, true, 'Avalanche'),
  n('gnosis-mainnet', 'Gnosis Mainnet', 'https://gnosis-mainnet.g.alchemy.com/v2', 100, false, 'Gnosis'),
  n('gnosis-chiado', 'Gnosis Chiado', 'https://gnosis-chiado.g.alchemy.com/v2', 10200, true, 'Gnosis'),
  n('bnb-mainnet', 'BNB Smart Chain Mainnet', 'https://bnb-mainnet.g.alchemy.com/v2', 56, false, 'BNB Smart Chain'),
  n('bnb-testnet', 'BNB Smart Chain Testnet', 'https://bnb-testnet.g.alchemy.com/v2', 97, true, 'BNB Smart Chain'),
  n('boba-mainnet', 'Boba Mainnet', 'https://boba-mainnet.g.alchemy.com/v2', 288, false, 'Boba'),
  n('boba-sepolia', 'Boba Sepolia', 'https://boba-sepolia.g.alchemy.com/v2', 28882, true, 'Boba'),
  n('unichain-mainnet', 'Unichain Mainnet', 'https://unichain-mainnet.g.alchemy.com/v2', 130, false, 'Unichain'),
  n('unichain-sepolia', 'Unichain Sepolia', 'https://unichain-sepolia.g.alchemy.com/v2', 1301, true, 'Unichain'),
  n('superseed-mainnet', 'Superseed Mainnet', 'https://superseed-mainnet.g.alchemy.com/v2', 5330, false, 'Superseed'),
  n('superseed-sepolia', 'Superseed Sepolia', 'https://superseed-sepolia.g.alchemy.com/v2', 53302, true, 'Superseed'),
  n('rise-mainnet', 'Rise Mainnet', 'https://rise-mainnet.g.alchemy.com/v2', null, false, 'Rise'),
  n('rise-testnet', 'Rise Testnet', 'https://rise-testnet.g.alchemy.com/v2', null, true, 'Rise'),
  n('monad-mainnet', 'Monad Mainnet', 'https://monad-mainnet.g.alchemy.com/v2', 143, false, 'Monad'),
  n('monad-testnet', 'Monad Testnet', 'https://monad-testnet.g.alchemy.com/v2', 10143, true, 'Monad'),
  n('flow-mainnet', 'Flow EVM Mainnet', 'https://flow-mainnet.g.alchemy.com/v2', 747, false, 'Flow EVM'),
  n('flow-testnet', 'Flow EVM Testnet', 'https://flow-testnet.g.alchemy.com/v2', 545, true, 'Flow EVM'),
  n('openloot-sepolia', 'Openloot Sepolia', 'https://openloot-sepolia.g.alchemy.com/v2', null, true, 'Openloot'),
  n('worldmobile-devnet', 'WorldMobile Devnet', 'https://worldmobile-devnet.g.alchemy.com/v2', null, true, 'Worldmobile'),
  n('worldmobile-testnet', 'WorldMobile Testnet', 'https://worldmobile-testnet.g.alchemy.com/v2', null, true, 'Worldmobile'),
  n('unite-mainnet', 'Unite Mainnet', 'https://unite-mainnet.g.alchemy.com/v2', null, false, 'Unite'),
  n('unite-testnet', 'Unite Testnet', 'https://unite-testnet.g.alchemy.com/v2', null, true, 'Unite'),
  n('degen-mainnet', 'Degen Mainnet', 'https://degen-mainnet.g.alchemy.com/v2', 666666666, false, 'Degen'),
  n('degen-sepolia', 'Degen Sepolia', 'https://degen-sepolia.g.alchemy.com/v2', null, true, 'Degen'),
  n('polynomial-mainnet', 'Polynomial Mainnet', 'https://polynomial-mainnet.g.alchemy.com/v2', null, false, 'Polynomial'),
  n('polynomial-sepolia', 'Polynomial Sepolia', 'https://polynomial-sepolia.g.alchemy.com/v2', null, true, 'Polynomial'),
  n('mode-mainnet', 'Mode Mainnet', 'https://mode-mainnet.g.alchemy.com/v2', 34443, false, 'Mode'),
  n('mode-sepolia', 'Mode Sepolia', 'https://mode-sepolia.g.alchemy.com/v2', 919, true, 'Mode'),
  n('edge-mainnet', 'Edge Mainnet', 'https://edge-mainnet.g.alchemy.com/v2', null, false, 'Edge'),
  n('edge-testnet', 'Edge Testnet', 'https://edge-testnet.g.alchemy.com/v2', null, true, 'Edge'),
  n('moonbeam-mainnet', 'Moonbeam Mainnet', 'https://moonbeam-mainnet.g.alchemy.com/v2', 1284, false, 'Moonbeam'),
  n('apechain-mainnet', 'ApeChain Mainnet', 'https://apechain-mainnet.g.alchemy.com/v2', 33139, false, 'ApeChain'),
  n('apechain-curtis', 'ApeChain Curtis', 'https://apechain-curtis.g.alchemy.com/v2', 33111, true, 'ApeChain'),
  n('celo-mainnet', 'Celo Mainnet', 'https://celo-mainnet.g.alchemy.com/v2', 42220, false, 'Celo'),
  n('celo-sepolia', 'Celo Sepolia', 'https://celo-sepolia.g.alchemy.com/v2', 11142220, true, 'Celo'),
  n('anime-mainnet', 'Anime Mainnet', 'https://anime-mainnet.g.alchemy.com/v2', 69000, false, 'Anime'),
  n('anime-sepolia', 'Anime Sepolia', 'https://anime-sepolia.g.alchemy.com/v2', 6900, true, 'Anime'),
  n('alterscope-mainnet', 'Alterscope Mainnet', 'https://alterscope-mainnet.g.alchemy.com/v2', null, false, 'Alterscope'),
  n('metis-mainnet', 'Metis Mainnet', 'https://metis-mainnet.g.alchemy.com/v2', 1088, false, 'Metis'),
  n('sonic-mainnet', 'Sonic Mainnet', 'https://sonic-mainnet.g.alchemy.com/v2', 146, false, 'Sonic'),
  n('sonic-testnet', 'Sonic Testnet', 'https://sonic-testnet.g.alchemy.com/v2', 57054, true, 'Sonic'),
  n('sei-mainnet', 'Sei EVM Mainnet', 'https://sei-mainnet.g.alchemy.com/v2', 1329, false, 'Sei'),
  n('sei-testnet', 'Sei EVM Testnet', 'https://sei-testnet.g.alchemy.com/v2', 1328, true, 'Sei'),
  n('adi-mainnet', 'ADI Mainnet', 'https://adi-mainnet.g.alchemy.com/v2', null, false, 'ADI'),
  n('adi-testnet', 'ADI Testnet AB', 'https://adi-testnet.g.alchemy.com/v2', null, true, 'ADI'),
  n('scroll-mainnet', 'Scroll Mainnet', 'https://scroll-mainnet.g.alchemy.com/v2', 534352, false, 'Scroll'),
  n('opbnb-mainnet', 'opBNB Mainnet', 'https://opbnb-mainnet.g.alchemy.com/v2', 204, false, 'opBNB'),
  n('opbnb-testnet', 'opBNB Testnet', 'https://opbnb-testnet.g.alchemy.com/v2', 5611, true, 'opBNB'),
  n('race-mainnet', 'Race Mainnet', 'https://race-mainnet.g.alchemy.com/v2', null, false, 'Race'),
  n('race-sepolia', 'Race Sepolia', 'https://race-sepolia.g.alchemy.com/v2', null, true, 'Race'),
  n('crossfi-mainnet', 'CrossFi Mainnet', 'https://crossfi-mainnet.g.alchemy.com/v2', 4158, false, 'CrossFi'),
  n('crossfi-testnet', 'CrossFi Testnet', 'https://crossfi-testnet.g.alchemy.com/v2', 4157, true, 'CrossFi'),
  n('abstract-mainnet', 'Abstract Mainnet', 'https://abstract-mainnet.g.alchemy.com/v2', 2741, false, 'Abstract'),
  n('abstract-testnet', 'Abstract Testnet', 'https://abstract-testnet.g.alchemy.com/v2', 11124, true, 'Abstract'),
  n('soneium-mainnet', 'Soneium Mainnet', 'https://soneium-mainnet.g.alchemy.com/v2', 1868, false, 'Soneium'),
  n('soneium-minato', 'Soneium Minato', 'https://soneium-minato.g.alchemy.com/v2', 1946, true, 'Soneium'),
  n('stable-mainnet', 'Stable Mainnet', 'https://stable-mainnet.g.alchemy.com/v2', null, false, 'Stable'),
  n('stable-testnet', 'Stable Testnet', 'https://stable-testnet.g.alchemy.com/v2', null, true, 'Stable'),
  n('robinhood-mainnet', 'Robinhood Chain Mainnet', 'https://robinhood-mainnet.g.alchemy.com/v2', 4663, false, 'Robinhood Chain'),
  n('robinhood-testnet', 'Robinhood Chain Testnet', 'https://robinhood-testnet.g.alchemy.com/v2', 46630, true, 'Robinhood Chain')
]);

export const ALCHEMY_NETWORK_BY_KEY = Object.freeze(Object.fromEntries(ALCHEMY_EVM_NETWORKS.map(v => [v.key, v])));
export const ALCHEMY_NETWORK_BY_CHAIN_ID = Object.freeze(Object.fromEntries(ALCHEMY_EVM_NETWORKS.filter(v => Number.isInteger(v.chainId)).map(v => [String(v.chainId), v])));

function parseJsonEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`${name} must contain valid JSON: ${error.message}`);
  }
}

export function alchemyNetworkForChain(chainId) {
  const id = Number(chainId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid EVM chain ID: ${chainId}`);
  const overrideMap = parseJsonEnv('ALCHEMY_NETWORK_OVERRIDES_JSON');
  const override = overrideMap[String(id)];
  if (override) {
    if (typeof override === 'string' && /^https:\/\//i.test(override)) {
      return { key: `override-${id}`, label: `Chain ${id}`, platform: 'Custom Alchemy endpoint', baseUrl: override.replace(/\/$/, ''), chainId: id, testnet: false, evm: true, override: true };
    }
    const byKey = ALCHEMY_NETWORK_BY_KEY[String(override)];
    if (!byKey) throw new Error(`ALCHEMY_NETWORK_OVERRIDES_JSON maps chain ${id} to unknown Alchemy network key "${override}".`);
    return { ...byKey, chainId: id, override: true };
  }
  return ALCHEMY_NETWORK_BY_CHAIN_ID[String(id)] || null;
}

export function alchemyRpcUrl(chainId, apiKey = process.env.ALCHEMY_API_KEY) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('ALCHEMY_API_KEY is not configured on Railway.');
  const network = alchemyNetworkForChain(chainId);
  if (!network) throw new Error(`Alchemy endpoint is cataloged by network name but chain ${chainId} is not mapped yet. Add ALCHEMY_NETWORK_OVERRIDES_JSON or RPC_${Number(chainId)}_URL.`);
  return `${network.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(key)}`;
}

export function publicAlchemyNetworkCatalog() {
  return ALCHEMY_EVM_NETWORKS.map(({ key, label, platform, baseUrl, chainId, testnet }) => ({
    key, label, platform, baseUrl, chainId, testnet,
    resolved: Number.isInteger(chainId),
    forgeEnabled: chainId === 11155111,
    snapshotEnabled: Number.isInteger(chainId)
  }));
}
