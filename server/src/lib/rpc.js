import { Contract, JsonRpcProvider, getAddress } from 'ethers';
import { alchemyNetworkForChain, alchemyRpcUrl } from './alchemy-networks.js';

const PROVIDERS = new Map();
export const COLLECTION_READ_ABI = [
  'function name() view returns (string)', 'function description() view returns (string)', 'function owner() view returns (address)',
  'function maxSupply() view returns (uint32)', 'function totalMinted() view returns (uint32)', 'function maxPerWallet() view returns (uint32)',
  'function mintPrice() view returns (uint256)', 'function whitelistMintPrice() view returns (uint256)', 'function publicMintEnabled() view returns (bool)',
  'function whitelistMintEnabled() view returns (bool)', 'function whitelistRoot() view returns (bytes32)', 'function revealMode() view returns (uint8)',
  'function mintedByWallet(address) view returns (uint32)', 'function whitelistMintedByWallet(address) view returns (uint32)',
  'function balanceOf(address) view returns (uint256)', 'function isRevealed(uint256) view returns (bool)',
  'function renderToken(uint256) view returns (string)', 'function renderMode(uint256) view returns (uint8)',
  'function holderRenderModeEnabled() view returns (bool)', 'function flattenedRenderBaseURI() view returns (string)',
  'function tokenURI(uint256) view returns (string)'
];

function jsonOverrides() {
  const raw = String(process.env.RPC_OVERRIDES_JSON || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`RPC_OVERRIDES_JSON must contain valid JSON: ${error.message}`);
  }
}

export function rpcUrl(chainId) {
  const id = Number(chainId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid EVM chain ID: ${chainId}`);

  // Per-chain environment variables remain the highest priority emergency override.
  const explicit = String(process.env[`RPC_${id}_URL`] || '').trim();
  if (explicit) return explicit;

  // One JSON variable can override several networks without adding many Railway vars.
  const bulkOverride = String(jsonOverrides()[String(id)] || '').trim();
  if (bulkOverride) return bulkOverride;

  // Normal V11.1.2 path: one ALCHEMY_API_KEY + built-in endpoint registry.
  return alchemyRpcUrl(id);
}

export function rpcInfo(chainId) {
  const id = Number(chainId);
  const explicit = String(process.env[`RPC_${id}_URL`] || '').trim();
  const bulkOverride = String(jsonOverrides()[String(id)] || '').trim();
  const network = alchemyNetworkForChain(id);
  return {
    chainId: id,
    source: explicit ? `RPC_${id}_URL` : bulkOverride ? 'RPC_OVERRIDES_JSON' : 'alchemy',
    network: network ? { key: network.key, label: network.label, platform: network.platform, baseUrl: network.baseUrl, testnet: network.testnet } : null,
    configured: Boolean(explicit || bulkOverride || (network && process.env.ALCHEMY_API_KEY))
  };
}

export function providerFor(chainId) {
  const id = Number(chainId);
  if (!PROVIDERS.has(id)) PROVIDERS.set(id, new JsonRpcProvider(rpcUrl(id), id, { staticNetwork: true, batchMaxCount: 20 }));
  return PROVIDERS.get(id);
}
export function collectionFor(chainId, address) {
  return new Contract(getAddress(address), COLLECTION_READ_ABI, providerFor(chainId));
}
export async function verifyCollectionOwner(chainId, address, wallet) {
  const contract = collectionFor(chainId, address);
  const owner = String(await contract.owner()).toLowerCase();
  if (owner !== String(wallet).toLowerCase()) throw new Error('Connected wallet is not the collection owner.');
  return getAddress(owner);
}
