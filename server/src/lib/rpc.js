import { Contract, JsonRpcProvider, getAddress } from 'ethers';

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

export function rpcUrl(chainId) {
  const id = Number(chainId);
  const explicit = process.env[`RPC_${id}_URL`];
  if (explicit) return explicit;
  if (id === 1 && process.env.ALCHEMY_ETH_MAINNET_URL) return process.env.ALCHEMY_ETH_MAINNET_URL;
  if (id === 11155111 && process.env.ALCHEMY_ETH_SEPOLIA_URL) return process.env.ALCHEMY_ETH_SEPOLIA_URL;
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error(`No RPC configured for chain ${id}. Add ALCHEMY_API_KEY or RPC_${id}_URL.`);
  if (id === 1) return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
  if (id === 11155111) return `https://eth-sepolia.g.alchemy.com/v2/${key}`;
  throw new Error(`Unsupported chain ${id}. Add RPC_${id}_URL to Railway.`);
}

export function providerFor(chainId) {
  const id = Number(chainId);
  if (!PROVIDERS.has(id)) PROVIDERS.set(id, new JsonRpcProvider(rpcUrl(id), id, { staticNetwork: true }));
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
