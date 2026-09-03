import { Contract, JsonRpcProvider, getAddress } from 'ethers';
import { alchemyNetworkForChain, alchemyRpcUrl } from './alchemy-networks.js';

const PROVIDERS = new Map();
export const COLLECTION_READ_ABI = [
  // Shared ERC-721 / metadata reads.
  'function name() view returns (string)',
  'function description() view returns (string)',
  'function maxSupply() view returns (uint32)',
  'function totalMinted() view returns (uint32)',
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function factory() view returns (address)',
  'function platformFeeMode() view returns (uint8)',
  'function isRevealed(uint256) view returns (bool)',
  'function renderToken(uint256) view returns (string)',
  'function renderMode(uint256) view returns (uint8)',
  'function holderRenderModeEnabled() view returns (bool)',
  'function flattenedRenderBaseURI() view returns (string)',
  'function tokenURI(uint256) view returns (string)',

  // Canonical Relic Forge V1.
  'function creator() view returns (address)',
  'function controller() view returns (address)',
  'function masterMintEnabled() view returns (bool)',
  'function futureRevealMode() view returns (uint8)',
  'function phaseCount() view returns (uint32)',
  'function phases(uint32) view returns (uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
  'function phaseWalletMinted(uint32,address) view returns (uint32)',
  'function phaseIsOpen(uint32) view returns (bool)',
  'function quoteMint(uint32,uint32) view returns (uint256 creatorPrice,uint256 platformFeeWei,uint256 minimumValue,bool oracleHealthy,bool feeActive)',

  // Legacy V11 compatibility. These are intentionally retained so already-published
  // test collections continue to work while V1 becomes the canonical path.
  'function owner() view returns (address)',
  'function maxPerWallet() view returns (uint32)',
  'function mintPrice() view returns (uint256)',
  'function whitelistMintPrice() view returns (uint256)',
  'function publicMintEnabled() view returns (bool)',
  'function whitelistMintEnabled() view returns (bool)',
  'function whitelistRoot() view returns (bytes32)',
  'function revealMode() view returns (uint8)',
  'function mintedByWallet(address) view returns (uint32)',
  'function whitelistMintedByWallet(address) view returns (uint32)'
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

  const explicit = String(process.env[`RPC_${id}_URL`] || '').trim();
  if (explicit) return explicit;

  const bulkOverride = String(jsonOverrides()[String(id)] || '').trim();
  if (bulkOverride) return bulkOverride;

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

export async function collectionCreator(chainId, address) {
  const contract = collectionFor(chainId, address);
  try {
    return getAddress(await contract.creator());
  } catch (v1Error) {
    try {
      return getAddress(await contract.owner());
    } catch {
      throw v1Error;
    }
  }
}

export async function verifyCollectionOwner(chainId, address, wallet) {
  const creator = await collectionCreator(chainId, address);
  if (creator.toLowerCase() !== String(wallet).toLowerCase()) {
    throw new Error('Connected wallet is not the collection creator.');
  }
  return creator;
}
