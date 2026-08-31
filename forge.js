(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const MAX_TRAIT_BYTES = 22000;
  const MAX_SHARD_BYTES = 22000;
  const MINT_PAGE_MAX_BYTES = 2 * 1024 * 1024;
  const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
  const INFRA_KEY = 'relicforge_sepolia_test_infra_v11_0_1';
  const FACTORY_REGISTRY_KEY = 'relicforge_sepolia_factory_registry_v1';
  const MANUAL_LAUNCH_KEY_PREFIX = 'relicforge_sepolia_manual_launches_v1';
  const V1_FEE_MODE_SPONSORED = 1;
  const V1_FEE_MODE_MINTER_SUPPORTED = 2;
  const V1_FACTORY_ABI = [
    'function quoteCollectionFeeTerms(uint32 maxSupply,uint8 feeMode) view returns (uint32 lockedFeeCents,uint256 upfrontFeeWei,bool oracleHealthy,bool feeActive)',
    'function createCollectionWithFeeMode(string name,string symbol,string description,uint32 maxSupply,uint16 canvasWidth,uint16 canvasHeight,uint8 layerCount,address payoutReceiver,address royaltyReceiver,uint96 royaltyBps,uint8 feeMode) payable returns(address collection,address projectData)',
    'function feePolicy() view returns (address)',
    'function randomnessProvider() view returns (address)',
    'function renderer() view returns (address)',
    'function creatorCollectionCount(address creator) view returns (uint256)',
    'function creatorCollectionAt(address creator,uint256 index) view returns (address)',
    'event CollectionCreated(address indexed creator,address indexed collection,address indexed projectData,uint256 number)',
    'event CollectionFeeTerms(address indexed collection,uint8 feeMode,uint32 lockedFeeCents,uint256 upfrontFeeWei,bool oracleHealthy,bool feeActive)'
  ];

  const V1_PROJECT_DATA_ABI = [
    'function addArtShard(bytes data) returns(address pointer)',
    'function addDnaShard(bytes data) returns(address pointer)',
    'function artShards(uint256 index) view returns(address)',
    'function dnaShards(uint256 index) view returns(address)',
    'function setPlaceholder(bytes svgFragment)',
    'function setLayerNames(string[] names)',
    'function setLayerMetadataVisibility(bool[] hidden)',
    'function setOneOfOneLayer(uint8 layer)',
    'function addTraits(tuple(uint8 layer,uint8 index,string name,address shard,uint32 offset,uint32 length,uint8 encoding,bool hiddenFromMetadata)[] inputs)',
    'function setDNAConfig(uint32 recipeCount,uint16 recipesPerShard)',
    'function setOneOfOneMetadata(uint8 index,string tokenName,string tokenDescription,string[] traitTypes,string[] values)',
    'function validateNextRecipes(uint32 quantity)',
    'function validatedRecipeCursor() view returns(uint64)',
    'function sealContent(bytes32 provenanceHash)',
    'function contentSealed() view returns(bool)',
    'function provenanceHash() view returns(bytes32)'
  ];

  const V1_COLLECTION_ABI = [
    'function name() view returns(string)',
    'function symbol() view returns(string)',
    'function description() view returns(string)',
    'function creator() view returns(address)',
    'function dataContract() view returns(address)',
    'function controller() view returns(address)',
    'function payoutReceiver() view returns(address)',
    'function royaltyReceiver() view returns(address)',
    'function royaltyBps() view returns(uint96)',
    'function holderRenderModeEnabled() view returns(bool)',
    'function defaultRenderMode() view returns(uint8)',
    'function flattenedRenderBaseURI() view returns(string)',
    'function maxSupply() view returns(uint32)',
    'function totalMinted() view returns(uint32)',
    'function masterMintEnabled() view returns(bool)',
    'function futureRevealMode() view returns(uint8)',
    'function deferredPendingCount() view returns(uint32)',
    'function nextRequestSequence() view returns(uint64)',
    'function nextProcessSequence() view returns(uint64)',
    'function nextEpochStartToken() view returns(uint64)',
    'function revealRequests(uint64 sequence) view returns(uint8 kind,uint64 startTokenId,uint64 endTokenId,uint64 cursor,uint32 assignmentNonce,bool fulfilled,uint256 seed)',
    'function phaseCount() view returns(uint32)',
    'function phases(uint32) view returns(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 minted,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled)',
    'function phaseIsOpen(uint32 phaseId) view returns(bool)',
    'function createPhase(uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority,bool enabled) returns(uint32 phaseId)',
    'function setMasterMintEnabled(bool enabled)',
    'function setPhaseEnabled(uint32 phaseId,bool enabled)',
    'function updatePhase(uint32 phaseId,uint96 price,uint64 startTime,uint64 endTime,uint32 phaseSupply,uint32 maxPerWallet,bytes32 merkleRoot,uint8 accessType,uint16 priority)',
    'function setPayoutReceiver(address receiver)',
    'function setRoyalty(address receiver,uint96 bps)',
    'function setFutureRevealMode(uint8 mode)',
    'function setRenderConfig(string baseURI,bool holderEnabled,uint8 defaultMode)',
    'function quoteMint(uint32 phaseId,uint32 quantity) view returns(uint256 creatorPrice,uint256 platformFeeWei,uint256 minimumValue,bool oracleHealthy,bool feeActive)',
    'function mint(uint32 phaseId,uint32 quantity,uint32 allowance,bytes32[] proof) payable returns(uint256 startTokenId)',
    'function creatorMint(address to,uint32 quantity) returns(uint256 startTokenId)',
    'function requestRevealEpoch() returns(uint64 sequence,uint256 requestId)',
    'function processReveal(uint32 maxSteps)',
    'function tokenURI(uint256 tokenId) view returns(string)',
    'function isRevealed(uint256 tokenId) view returns(bool)',
    'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
    'event PhaseCreated(uint32 indexed phaseId,uint8 accessType,uint96 price,uint16 priority)',
    'event RevealRequested(uint64 indexed sequence,uint256 indexed requestId,uint8 kind,uint64 startTokenId,uint64 endTokenId)'
  ];

  const V1_RANDOMNESS_ABI = [
    'function quoteRequestPrice() view returns(uint256)',
    'function nativeCredit(address consumer) view returns(uint256)',
    'function fundConsumer(address consumer) payable'
  ];
  const PUBLIC_SEPOLIA_GAS_RPCS = [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.drpc.org',
    'https://rpc.sepolia.org',
  ];

  const WHITELIST_SOURCE_CHAINS = {
    1: { chainId: 1, label: 'Ethereum Mainnet', rpc: 'https://ethereum-rpc.publicnode.com', historyRpc: 'https://eth.drpc.org' },
    11155111: { chainId: 11155111, label: 'Ethereum Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', historyRpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  };

  const forgeState = {
    compiled: null,
    contractArtifacts: null,
    provider: null,
    signer: null,
    wallet: null,
    gasPrice: null,
    placeholderFile: null,
    collectionAddress: null,
    dataAddress: null,
    publicPhaseId: null,
    whitelistPhaseId: null,
    masterMintArmed: false,
    latestRequestId: null,
    latestTokenId: null,
    latestCreatorRevealRequestId: null,
    infra: null,
    viewerAddress: null,
    viewerPage: 1,
    viewerPageSize: 8,
    viewerTotalMinted: 0,
    viewerMeta: null,
    whitelist: null,
    mintPageImageFile: null,
    mintPageBannerFile: null,
    launchedCollections: [],
    launchedSelected: null,
    dashboardMintPageImageFile: null,
    dashboardMintPageBannerFile: null,
  };

  function bridge() {
    if (!window.RelicForgeStudioBridge) throw new Error('Studio bridge is unavailable. Reload the page.');
    return window.RelicForgeStudioBridge;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shortAddr(value) {
    const text = String(value || '');
    return text && text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : (text || '—');
  }

  const cloudReadProviders = new Map();
  function readProvider(chainId = 11155111) {
    const apiBase = String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
    if (apiBase && window.ethers) {
      const id = Number(chainId);
      if (!cloudReadProviders.has(id)) cloudReadProviders.set(id, new window.ethers.JsonRpcProvider(`${apiBase}/api/public/rpc/${id}`, id, { staticNetwork: true, batchMaxCount: 20 }));
      return cloudReadProviders.get(id);
    }
    return forgeState.provider;
  }

  async function loadCloudNetworkCatalog() {
    const apiBase = String(window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
    const select = $('whitelistSourceChain');
    if (!apiBase || !select) return;
    const previous = String(select.value || '1');
    const response = await fetch(`${apiBase}/api/public/networks`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Network catalog HTTP ${response.status}`);
    const payload = await response.json();
    const networks = (payload.networks || []).filter(v => v && v.snapshotEnabled && Number.isInteger(Number(v.chainId)));
    networks.forEach(v => {
      const id = Number(v.chainId);
      WHITELIST_SOURCE_CHAINS[id] = {
        chainId: id,
        label: v.label || `Chain ${id}`,
        rpc: `${apiBase}/api/public/rpc/${id}`,
        historyRpc: `${apiBase}/api/public/rpc/${id}`,
        testnet: !!v.testnet,
        alchemyKey: v.key || ''
      };
    });
    const mainnets = networks.filter(v => !v.testnet).sort((a,b) => String(a.label).localeCompare(String(b.label)));
    const testnets = networks.filter(v => v.testnet).sort((a,b) => String(a.label).localeCompare(String(b.label)));
    select.innerHTML = '';
    const appendGroup = (label, list) => {
      if (!list.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      list.forEach(v => {
        const option = document.createElement('option');
        option.value = String(v.chainId);
        option.textContent = `${v.label} (${v.chainId})`;
        group.appendChild(option);
      });
      select.appendChild(group);
    };
    appendGroup('Mainnets', mainnets);
    appendGroup('Testnets', testnets);
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
    else if ([...select.options].some(o => o.value === '1')) select.value = '1';
    if ($('whitelistStatus') && payload.apiKeyConfigured === false) {
      $('whitelistStatus').textContent = 'Alchemy network catalog loaded, but ALCHEMY_API_KEY is not configured on Railway yet.';
    }
  }

  function fileToDataUrl(file) {
    if (!file) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Unable to read image file.'));
      reader.readAsDataURL(file);
    });
  }

  function validateMintPageMedia(file, label = 'Mint-page image') {
    if (!file) return null;
    if (Number(file.size || 0) > MINT_PAGE_MAX_BYTES) throw new Error(`${label} exceeds the 2 MB limit.`);
    const type = String(file.type || '').toLowerCase();
    const ext = String(file.name || '').split('.').pop()?.toLowerCase() || '';
    const knownImageExt = new Set(['apng','avif','bmp','gif','heic','heif','ico','jfif','jpeg','jpg','png','svg','tif','tiff','webp']);
    if (!type.startsWith('image/') && !knownImageExt.has(ext)) throw new Error(`${label} must be an image file.`);
    return file;
  }

  function setPreviewImage(hostId, dataUrl, fallback) {
    const host = $(hostId);
    if (!host) return;
    host.innerHTML = dataUrl ? `<img src="${dataUrl}" alt=""/>` : `<span>${esc(fallback)}</span>`;
  }

  async function updateMintPagePreview() {
    const title = $('launchName')?.value.trim() || bridge().getCoreState?.()?.collectionName || 'Your Collection';
    const description = $('launchDescription')?.value.trim() || 'A fully onchain collection forged with Relic Forge.';
    if ($('mintPagePreviewTitle')) $('mintPagePreviewTitle').textContent = title;
    if ($('mintPagePreviewDescription')) $('mintPagePreviewDescription').textContent = description;
    const [image, banner] = await Promise.all([fileToDataUrl(forgeState.mintPageImageFile), fileToDataUrl(forgeState.mintPageBannerFile)]);
    setPreviewImage('mintPagePreviewImage', image, 'RF');
    setPreviewImage('mintPagePreviewBanner', banner, 'BANNER');
  }

  async function buildMintPageConfig(collectionAddress = forgeState.collectionAddress) {
    if (!collectionAddress || !window.ethers.isAddress(collectionAddress)) throw new Error('Forge a collection before generating its mint page.');
    const [collectionImage, bannerImage] = await Promise.all([fileToDataUrl(forgeState.mintPageImageFile), fileToDataUrl(forgeState.mintPageBannerFile)]);
    return {
      schema: 'relic-forge/mint-page@1',
      chainId: 11155111,
      contract: collectionAddress,
      collectionImage,
      bannerImage,
      whitelistEntries: forgeState.whitelist?.entries || [],
      whitelistRoot: forgeState.whitelist?.root || null,
      generatedAt: new Date().toISOString(),
    };
  }

  async function persistMintPageConfig(collectionAddress = forgeState.collectionAddress) {
    const config = await buildMintPageConfig(collectionAddress);
    const key = `relicforge_mint_page_${config.chainId}_${config.contract.toLowerCase()}`;
    try { localStorage.setItem(key, JSON.stringify(config)); }
    catch (_) { /* Large whitelists may exceed localStorage. Standalone export still works. */ }
    return config;
  }

  async function publishedMintPageConfig(collectionAddress, chainId = 11155111) {
    if (!window.RelicForgeCloud?.enabled?.()) return {};
    try {
      const result = await window.RelicForgeCloud.json(`/api/public/mint/${chainId}/${collectionAddress}/config`);
      return result?.config || {};
    } catch (_) { return {}; }
  }

  async function publishMintPageCloud(collectionAddress = forgeState.collectionAddress, dashboard = false) {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('RelicForge Cloud API is not configured. Set apiBase in relicforge-config.js first.');
    if (!forgeState.wallet) await connectWallet();
    await window.RelicForgeCloud.ensureSignedIn(forgeState.wallet);

    // The launch builder and the launched-collection dashboard have separate UI state.
    // When publishing from the dashboard, use the address-scoped saved mint config rather
    // than the currently-open Studio project's launch files. This prevents one project
    // from accidentally supplying another collection's local presentation settings.
    const localConfig = dashboard
      ? {
          ...readMintPageConfig(collectionAddress, 11155111),
          schema: 'relic-forge/mint-page@1',
          chainId: 11155111,
          contract: collectionAddress,
          generatedAt: new Date().toISOString(),
        }
      : await buildMintPageConfig(collectionAddress);

    const existingCloud = await publishedMintPageConfig(collectionAddress, localConfig.chainId);
    const imageFile = dashboard ? forgeState.dashboardMintPageImageFile : forgeState.mintPageImageFile;
    const bannerFile = dashboard ? forgeState.dashboardMintPageBannerFile : forgeState.mintPageBannerFile;
    const config = {
      ...existingCloud,
      ...localConfig,
      collectionImageAssetId: existingCloud.collectionImageAssetId || localConfig.collectionImageAssetId || null,
      bannerImageAssetId: existingCloud.bannerImageAssetId || localConfig.bannerImageAssetId || null,
    };
    delete config.collectionImage; delete config.bannerImage; delete config.whitelistEntries;
    const projectId = window.RelicForgeProjects?.getCurrentProjectId?.() || null;
    await window.RelicForgeCloud.publishMintPage({
      chainId: localConfig.chainId,
      contract: collectionAddress,
      projectId,
      collectionImageFile: imageFile,
      bannerImageFile: bannerFile,
      config,
      whitelist: dashboard ? null : forgeState.whitelist
    });
    return true;
  }

  function mintPageConfigKey(collectionAddress, chainId = 11155111) {
    return `relicforge_mint_page_${chainId}_${String(collectionAddress || '').toLowerCase()}`;
  }

  function readMintPageConfig(collectionAddress, chainId = 11155111) {
    try { return JSON.parse(localStorage.getItem(mintPageConfigKey(collectionAddress, chainId)) || '{}'); }
    catch (_) { return {}; }
  }

  function writeMintPageConfig(config) {
    if (!config?.contract || !window.ethers.isAddress(config.contract)) throw new Error('Mint page config is missing a valid collection address.');
    localStorage.setItem(mintPageConfigKey(config.contract, config.chainId || 11155111), JSON.stringify(config));
    return config;
  }

  async function openMintPage() {
    try {
      const config = await persistMintPageConfig();
      if (window.RelicForgeCloud?.enabled?.()) {
        if ($('mintPageStatus')) $('mintPageStatus').textContent = 'Publishing current mint page settings globally…';
        await publishMintPageCloud(config.contract);
      }
      window.open(`./mint.html?contract=${encodeURIComponent(config.contract)}&chain=${config.chainId}`, '_blank', 'noopener');
      if ($('mintPageStatus')) $('mintPageStatus').textContent = window.RelicForgeCloud?.enabled?.()
        ? '✓ Mint page published globally and opened.'
        : 'Mint page opened from local settings. Cloud publishing is not configured.';
    } catch (error) { if ($('mintPageStatus')) $('mintPageStatus').textContent = `Mint page: ${error.message}`; }
  }

  function safeDownloadName(value) {
    return String(value || 'relicforge').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'relicforge';
  }

  async function downloadMintPageFromConfig(config, filenameBase = 'relicforge') {
    const [templateRes, walletRes, scriptRes] = await Promise.all([
      fetch('./mint.html', { cache: 'no-store' }),
      fetch('./wallet.js?v=11.1.6', { cache: 'no-store' }),
      fetch('./mint.js?v=11.1.6', { cache: 'no-store' })
    ]);
    if (!templateRes.ok || !walletRes.ok || !scriptRes.ok) throw new Error('Unable to load the mint page template.');
    let html = await templateRes.text();
    const walletScript = await walletRes.text();
    const script = await scriptRes.text();
    const configJson = JSON.stringify(config).replace(/<\/script/gi, '<\\/script');
    const runtimeConfigJson = JSON.stringify({ apiBase: window.RelicForgeCloud?.apiBase?.() || window.RELICFORGE_CONFIG?.apiBase || '', renderBase: window.RELICFORGE_CONFIG?.renderBase || '', cloudEnabled: true, mintRpcMode: window.RELICFORGE_CONFIG?.mintRpcMode || 'public-first', version: '11.1.6' }).replace(/<\/script/gi, '<\\/script');
    html = html.replace(/<script src="\.\/relicforge-config\.js(?:\?v=[^"]+)?"><\/script>/, `<script>window.RELICFORGE_CONFIG = ${runtimeConfigJson};<\/script>`);
    html = html.replace('<script>window.RELICFORGE_MINT_CONFIG = null;</script>', `<script>window.RELICFORGE_MINT_CONFIG = ${configJson};<\/script>`);
    html = html.replace(/<script src="\.\/wallet\.js(?:\?v=[^"]+)?"><\/script>/, `<script>${walletScript.replace(/<\/script/gi, '<\\/script')}<\/script>`);
    html = html.replace(/<script src="\.\/mint\.js(?:\?v=[^"]+)?"><\/script>/, `<script>${script.replace(/<\/script/gi, '<\\/script')}<\/script>`);
    html = html.replace(/href="\.\/index\.html"/g, 'href="https://cryptoferd.github.io/relicforge/"');
    html = html.replace(/src="\.\/relic-forge-logo\.svg"/g, 'src="https://cryptoferd.github.io/relicforge/relic-forge-logo.svg"');
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeDownloadName(filenameBase)}-mint.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadStandaloneMintPage() {
    try {
      const config = await buildMintPageConfig();
      await downloadMintPageFromConfig(config, $('launchName')?.value || 'relicforge');
      if ($('mintPageStatus')) $('mintPageStatus').textContent = 'Standalone mint page downloaded. It contains the page media and whitelist entries needed to build wallet proofs.';
    } catch (error) { if ($('mintPageStatus')) $('mintPageStatus').textContent = `Mint page export: ${error.message}`; }
  }

  function whitelistSourceChainConfig() {
    const chainId = Number($('whitelistSourceChain')?.value || 1);
    return WHITELIST_SOURCE_CHAINS[chainId] || WHITELIST_SOURCE_CHAINS[1];
  }

  function whitelistSourceProvider(useHistory = false) {
    const config = whitelistSourceChainConfig();
    const override = $('whitelistSnapshotRpc')?.value.trim() || '';
    const cloudRpc = window.RelicForgeCloud?.enabled?.() ? window.RelicForgeCloud.publicUrl(`/api/public/rpc/${config.chainId}`) : '';
    const rpc = override || cloudRpc || (useHistory ? (config.historyRpc || config.rpc) : config.rpc);
    return new window.ethers.JsonRpcProvider(rpc, config.chainId, { staticNetwork: true, batchMaxCount: 20 });
  }

  function currentWhitelistSourceMode() {
    return document.querySelector('input[name="whitelistSourceMode"]:checked')?.value || 'snapshot';
  }

  function updateWhitelistUi() {
    const enabled = !!$('whitelistEnabled')?.checked;
    $('whitelistSettings')?.classList.toggle('hidden', !enabled);
    const mode = currentWhitelistSourceMode();
    $('whitelistSnapshotPanel')?.classList.toggle('hidden', mode !== 'snapshot');
    $('whitelistCustomPanel')?.classList.toggle('hidden', mode !== 'custom');
    document.querySelectorAll('[data-whitelist-source-card]').forEach(card => card.classList.toggle('selected', card.dataset.whitelistSourceCard === mode));
    if ($('forgeWhitelistMintBtn')) $('forgeWhitelistMintBtn').disabled = !enabled || !forgeState.collectionAddress;
    bridge().updateLaunchSummary?.();
  }

  function whitelistDefaultAllowance() {
    const value = Math.floor(Number($('whitelistDefaultAllowance')?.value || 1));
    if (!Number.isFinite(value) || value < 1 || value > 4294967295) throw new Error('Whitelist allowance must be between 1 and 4,294,967,295.');
    return value;
  }

  function normalizeWhitelistEntries(entries, fallbackAllowance) {
    const map = new Map();
    for (const raw of entries || []) {
      const rawAddress = typeof raw === 'string' ? raw : raw?.address;
      if (!rawAddress || !window.ethers.isAddress(rawAddress)) continue;
      const address = window.ethers.getAddress(rawAddress);
      const allowanceRaw = typeof raw === 'string' ? fallbackAllowance : (raw.allowance ?? fallbackAllowance);
      const allowance = Math.floor(Number(allowanceRaw));
      if (!Number.isFinite(allowance) || allowance < 1 || allowance > 4294967295) continue;
      const key = address.toLowerCase();
      const existing = map.get(key);
      if (!existing || allowance > existing.allowance) map.set(key, { address, allowance });
    }
    return [...map.values()].sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  }

  function whitelistLeaf(entry) {
    return window.ethers.keccak256(window.ethers.solidityPacked(['address', 'uint32'], [entry.address, entry.allowance]));
  }

  function hashPair(a, b) {
    if (!b) return a;
    return BigInt(a) <= BigInt(b)
      ? window.ethers.keccak256(window.ethers.concat([a, b]))
      : window.ethers.keccak256(window.ethers.concat([b, a]));
  }

  function buildMerkleWhitelist(entries) {
    if (!entries.length) throw new Error('Whitelist contains no valid addresses.');
    const leaves = entries.map(whitelistLeaf);
    const layers = [leaves];
    while (layers[layers.length - 1].length > 1) {
      const current = layers[layers.length - 1];
      const next = [];
      for (let i = 0; i < current.length; i += 2) next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
      layers.push(next);
    }
    const proofForIndex = index => {
      const proof = [];
      let cursor = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level];
        const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
        if (sibling < layer.length) proof.push(layer[sibling]);
        cursor = Math.floor(cursor / 2);
      }
      return proof;
    };
    const proofByAddress = {};
    entries.forEach((entry, i) => { proofByAddress[entry.address.toLowerCase()] = { allowance: entry.allowance, proof: proofForIndex(i) }; });
    return { root: layers[layers.length - 1][0], entries, proofByAddress };
  }

  function whitelistLeafV1(entry, collectionAddress, phaseId) {
    const encoded = window.ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256','address','uint32','address','uint32'],
      [11155111n, collectionAddress, Number(phaseId), entry.address, entry.allowance]
    );
    return window.ethers.keccak256(encoded);
  }

  function buildMerkleWhitelistV1(entries, collectionAddress, phaseId) {
    if (!window.ethers.isAddress(collectionAddress)) throw new Error('V1 whitelist collection address is invalid.');
    if (!Number.isInteger(Number(phaseId)) || Number(phaseId) < 1) throw new Error('V1 whitelist phase id is invalid.');
    if (!entries?.length) throw new Error('Whitelist contains no eligible wallets.');
    const leaves = entries.map(entry => whitelistLeafV1(entry, collectionAddress, phaseId));
    const layers = [leaves];
    while (layers[layers.length - 1].length > 1) {
      const current = layers[layers.length - 1];
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
      }
      layers.push(next);
    }
    const proofForIndex = index => {
      const proof = [];
      let cursor = index;
      for (let level = 0; level < layers.length - 1; level++) {
        const layer = layers[level];
        const sibling = cursor % 2 === 0 ? cursor + 1 : cursor - 1;
        if (sibling < layer.length) proof.push(layer[sibling]);
        cursor = Math.floor(cursor / 2);
      }
      return proof;
    };
    const proofByAddress = {};
    entries.forEach((entry, i) => {
      proofByAddress[entry.address.toLowerCase()] = { allowance: entry.allowance, proof: proofForIndex(i) };
    });
    return {
      root: layers[layers.length - 1][0],
      entries,
      proofByAddress,
      domainCollection: window.ethers.getAddress(collectionAddress),
      phaseId: Number(phaseId),
      chainId: 11155111
    };
  }
  function renderWhitelistSummary() {
    const target = $('whitelistSummary');
    if (!target) return;
    const wl = forgeState.whitelist;
    if (!wl) { target.innerHTML = ''; return; }
    target.innerHTML = [
      ['Eligible wallets', wl.entries.length.toLocaleString()],
      ['Merkle root', `<code>${esc(wl.root.slice(0, 10))}…${esc(wl.root.slice(-8))}</code>`],
      ['Source', wl.sourceType === 1 ? `${esc(wl.sourceChainLabel || `Chain ${wl.sourceChainId}`)} · block ${Number(wl.snapshotBlock).toLocaleString()}` : 'Custom whitelist'],
      ['Allowance', wl.uniformAllowance ? `${wl.uniformAllowance} per wallet` : 'Per-wallet allowances'],
    ].map(([label, value]) => `<div class="forge-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
  }

  function setWhitelistResult(result) {
    forgeState.whitelist = result;
    if ($('whitelistStatus')) $('whitelistStatus').textContent = `✓ ${result.entries.length.toLocaleString()} eligible wallet${result.entries.length === 1 ? '' : 's'} · root ${result.root.slice(0, 10)}…`;
    renderWhitelistSummary();
    $('downloadWhitelistBtn')?.classList.remove('hidden');
  }

  function exportWhitelistProofs() {
    const wl = forgeState.whitelist;
    if (!wl) throw new Error('Build a whitelist first.');
    const data = {
      schema: 'relic-forge/whitelist@1',
      chainId: wl.sourceChainId || 11155111,
      root: wl.root,
      sourceType: wl.sourceType === 1 ? 'collection-snapshot' : 'custom',
      sourceContract: wl.sourceContract,
      snapshotBlock: wl.snapshotBlock,
      tokenStandard: wl.tokenStandard,
      entries: wl.entries.map(entry => ({ ...entry, proof: wl.proofByAddress[entry.address.toLowerCase()]?.proof || [] })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `relicforge-whitelist-${wl.root.slice(2, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function parseCustomWhitelistText(text, fallbackAllowance) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : (parsed.addresses || parsed.whitelist || parsed.entries || []);
      if (Array.isArray(list)) return normalizeWhitelistEntries(list.map(item => typeof item === 'string' ? item : ({ address: item.address || item.wallet, allowance: item.allowance ?? item.maxMints })), fallbackAllowance);
    } catch (_) {}
    const rows = trimmed.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const row of rows) {
      if (/^address\b/i.test(row)) continue;
      const parts = row.split(/[,;\t ]+/).filter(Boolean);
      const address = parts.find(part => window.ethers.isAddress(part));
      if (!address) continue;
      const addrIndex = parts.indexOf(address);
      const allowanceCandidate = parts.slice(addrIndex + 1).find(part => /^\d+$/.test(part));
      out.push({ address, allowance: allowanceCandidate ? Number(allowanceCandidate) : fallbackAllowance });
    }
    return normalizeWhitelistEntries(out, fallbackAllowance);
  }

  const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

  async function multicallAtBlock(provider, calls, blockTag) {
    const abi = ['function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns(tuple(bool success,bytes returnData)[])'];
    const multicall = new window.ethers.Contract(MULTICALL3_ADDRESS, abi, provider);
    return multicall.aggregate3.staticCall(calls, { blockTag });
  }

  async function ownerOfBatch(provider, source, tokenIds, blockTag) {
    const iface = new window.ethers.Interface(['function ownerOf(uint256) view returns(address)']);
    const calls = tokenIds.map(tokenId => ({ target: source, allowFailure: true, callData: iface.encodeFunctionData('ownerOf', [tokenId]) }));
    const results = await multicallAtBlock(provider, calls, blockTag);
    return results.map((result, index) => {
      if (!result.success || result.returnData === '0x') return null;
      try { return window.ethers.getAddress(iface.decodeFunctionResult('ownerOf', result.returnData)[0]); }
      catch (_) { return null; }
    });
  }

  async function snapshotEnumerable721(provider, source, totalSupply, blockTag, onProgress) {
    const enumIface = new window.ethers.Interface(['function tokenByIndex(uint256) view returns(uint256)']);
    const tokenIds = [];
    const batchSize = 250;
    for (let start = 0; start < totalSupply; start += batchSize) {
      const end = Math.min(totalSupply, start + batchSize);
      const calls = [];
      for (let i = start; i < end; i++) calls.push({ target: source, allowFailure: false, callData: enumIface.encodeFunctionData('tokenByIndex', [i]) });
      const results = await multicallAtBlock(provider, calls, blockTag);
      for (const result of results) tokenIds.push(BigInt(enumIface.decodeFunctionResult('tokenByIndex', result.returnData)[0]));
      onProgress?.(end, totalSupply, 'token indexes');
    }
    const owners = [];
    for (let start = 0; start < tokenIds.length; start += batchSize) {
      const ids = tokenIds.slice(start, start + batchSize);
      owners.push(...await ownerOfBatch(provider, source, ids, blockTag));
      onProgress?.(Math.min(tokenIds.length, start + batchSize), tokenIds.length, 'owners');
    }
    return owners.filter(Boolean);
  }

  async function snapshotSequential721(provider, source, totalSupply, blockTag, onProgress) {
    if (totalSupply <= 0) return [];
    if (totalSupply > 100000) throw new Error('Collection is too large for direct browser ownership enumeration. Historical/indexer fallback required.');
    const probeOwners = await ownerOfBatch(provider, source, [0n, 1n], blockTag);
    let cursor = probeOwners[0] ? 0 : 1;
    const owners = [];
    const seenTokens = new Set();
    const batchSize = 400;
    // Allow room for burned/gapped token IDs while keeping accidental random-ID scans bounded.
    const maxAttempts = Math.min(250000, Math.max(totalSupply + 2048, Math.ceil(totalSupply * 1.75)));
    let attempted = 0;
    while (owners.length < totalSupply && attempted < maxAttempts) {
      const count = Math.min(batchSize, maxAttempts - attempted);
      const ids = Array.from({ length: count }, (_, i) => BigInt(cursor + i));
      const batchOwners = await ownerOfBatch(provider, source, ids, blockTag);
      for (let i = 0; i < batchOwners.length; i++) {
        if (!batchOwners[i]) continue;
        const id = ids[i].toString();
        if (seenTokens.has(id)) continue;
        seenTokens.add(id);
        owners.push(batchOwners[i]);
        if (owners.length >= totalSupply) break;
      }
      cursor += count;
      attempted += count;
      onProgress?.(owners.length, totalSupply, `current owners · scanned ${attempted.toLocaleString()} token IDs`);
    }
    if (owners.length !== totalSupply) {
      throw new Error(`Direct current-state scan found ${owners.length.toLocaleString()} of ${totalSupply.toLocaleString()} live tokens. Historical/indexer fallback required for this token-ID layout.`);
    }
    return owners;
  }

  async function snapshotERC721CurrentState(provider, source, snapshotBlock, onProgress) {
    const abi = [
      'function totalSupply() view returns(uint256)',
      'function supportsInterface(bytes4) view returns(bool)'
    ];
    const contract = new window.ethers.Contract(source, abi, provider);
    const totalSupply = Number(await contract.totalSupply({ blockTag: snapshotBlock }));
    if (!Number.isSafeInteger(totalSupply) || totalSupply < 0) throw new Error('Invalid totalSupply() response.');
    let enumerable = false;
    try { enumerable = await contract.supportsInterface('0x780e9d63', { blockTag: snapshotBlock }); } catch (_) {}
    onProgress?.(0, totalSupply, enumerable ? 'ERC-721 Enumerable current-state scan' : 'ERC-721 current-state scan');
    return enumerable
      ? snapshotEnumerable721(provider, source, totalSupply, snapshotBlock, onProgress)
      : snapshotSequential721(provider, source, totalSupply, snapshotBlock, onProgress);
  }

  async function getLogsChunked(provider, filterBase, fromBlock, toBlock, onProgress) {
    const logs = [];
    let cursor = fromBlock;
    let chunk = 50000;
    while (cursor <= toBlock) {
      let end = Math.min(toBlock, cursor + chunk - 1);
      try {
        const part = await provider.getLogs({ ...filterBase, fromBlock: cursor, toBlock: end });
        logs.push(...part);
        cursor = end + 1;
        if (chunk < 100000) chunk = Math.min(100000, Math.floor(chunk * 1.5));
        onProgress?.(cursor, toBlock, logs.length);
      } catch (error) {
        if (chunk <= 500) throw error;
        chunk = Math.max(500, Math.floor(chunk / 2));
      }
    }
    return logs;
  }

  async function snapshotCollectionHolders() {
    try {
      const source = $('whitelistCollectionAddress')?.value.trim() || '';
      if (!window.ethers.isAddress(source)) throw new Error('Enter a valid collection contract address.');
      const allowance = whitelistDefaultAllowance();
      const chain = whitelistSourceChainConfig();
      const provider = whitelistSourceProvider(false);
      $('whitelistStatus').textContent = `Connecting to ${chain.label}…`;
      const snapshotBlock = await provider.getBlockNumber();
      const code = await provider.getCode(source);
      if (!code || code === '0x') throw new Error(`No contract exists at this address on ${chain.label}. Check the Source network selection.`);
      const contract = new window.ethers.Contract(source, ['function supportsInterface(bytes4) view returns(bool)', 'function totalSupply() view returns(uint256)'], provider);
      let is1155 = false, is721 = false;
      try { is1155 = await contract.supportsInterface('0xd9b67a26', { blockTag: snapshotBlock }); } catch (_) {}
      try { is721 = await contract.supportsInterface('0x80ac58cd', { blockTag: snapshotBlock }); } catch (_) {}
      // Some older/nonconforming ERC-721 contracts do not report ERC-165 correctly. A working totalSupply is a useful secondary probe.
      if (!is721 && !is1155) {
        try { await contract.totalSupply({ blockTag: snapshotBlock }); is721 = true; } catch (_) {}
      }
      if (!is721 && !is1155) throw new Error(`A contract exists on ${chain.label}, but Relic Forge could not identify it as ERC-721 or ERC-1155.`);
      const zero = window.ethers.ZeroAddress.toLowerCase();
      let addresses = [];
      if (is1155) {
        const historyProvider = whitelistSourceProvider(true);
        const deploymentBlock = 0;
        $('whitelistStatus').textContent = `ERC-1155 requires transfer-history reconstruction. Scanning ${chain.label} through the historical RPC…`;
        const singleTopic = window.ethers.id('TransferSingle(address,address,address,uint256,uint256)');
        const batchTopic = window.ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
        const logs = await getLogsChunked(historyProvider, { address: source, topics: [[singleTopic, batchTopic]] }, deploymentBlock, snapshotBlock, (cursor, end, count) => {
          $('whitelistStatus').textContent = `Scanning ERC-1155 · block ${Math.min(cursor, end).toLocaleString()} / ${end.toLocaleString()} · ${count.toLocaleString()} transfer events`;
        });
        const totals = new Map();
        const coder = window.ethers.AbiCoder.defaultAbiCoder();
        const add = (addr, delta) => {
          const key = addr.toLowerCase(); if (key === zero) return;
          totals.set(key, (totals.get(key) || 0n) + delta);
        };
        for (const logEntry of logs) {
          const from = window.ethers.getAddress(`0x${logEntry.topics[2].slice(26)}`);
          const to = window.ethers.getAddress(`0x${logEntry.topics[3].slice(26)}`);
          if (logEntry.topics[0] === singleTopic) {
            const [, value] = coder.decode(['uint256','uint256'], logEntry.data);
            add(from, -BigInt(value)); add(to, BigInt(value));
          } else {
            const [, values] = coder.decode(['uint256[]','uint256[]'], logEntry.data);
            const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
            add(from, -total); add(to, total);
          }
        }
        addresses = [...totals.entries()].filter(([, balance]) => balance > 0n).map(([address]) => window.ethers.getAddress(address));
      } else {
        try {
          $('whitelistStatus').textContent = `Reading current ERC-721 ownership at ${chain.label} block ${snapshotBlock.toLocaleString()}…`;
          const currentOwners = await snapshotERC721CurrentState(provider, source, snapshotBlock, (done, total, phase) => {
            $('whitelistStatus').textContent = `${phase} · ${Number(done).toLocaleString()} / ${Number(total).toLocaleString()} at block ${snapshotBlock.toLocaleString()}`;
          });
          addresses = [...new Set(currentOwners.map(a => a.toLowerCase()))].map(a => window.ethers.getAddress(a));
        } catch (directError) {
          const historyProvider = whitelistSourceProvider(true);
          $('whitelistStatus').textContent = `Current-state enumeration unavailable (${directError.message}). Falling back to transfer history…`;
          const topic = window.ethers.id('Transfer(address,address,uint256)');
          const logs = await getLogsChunked(historyProvider, { address: source, topics: [topic] }, 0, snapshotBlock, (cursor, end, count) => {
            $('whitelistStatus').textContent = `Historical ERC-721 fallback · block ${Math.min(cursor, end).toLocaleString()} / ${end.toLocaleString()} · ${count.toLocaleString()} transfers`;
          });
          const owners = new Map();
          for (const logEntry of logs) {
            if (logEntry.topics.length < 4) continue;
            const to = window.ethers.getAddress(`0x${logEntry.topics[2].slice(26)}`);
            const tokenId = BigInt(logEntry.topics[3]).toString();
            if (to.toLowerCase() === zero) owners.delete(tokenId); else owners.set(tokenId, to);
          }
          addresses = [...new Set([...owners.values()].map(a => a.toLowerCase()))].map(a => window.ethers.getAddress(a));
        }
      }
      const entries = normalizeWhitelistEntries(addresses, allowance);
      const tree = buildMerkleWhitelist(entries);
      setWhitelistResult({ ...tree, sourceType: 1, sourceContract: window.ethers.getAddress(source), sourceChainId: chain.chainId, sourceChainLabel: chain.label, snapshotBlock, tokenStandard: is1155 ? 'ERC-1155' : 'ERC-721', uniformAllowance: allowance });
    } catch (error) {
      const message = String(error?.message || error);
      if (/archive requests|archive|historical/i.test(message)) {
        $('whitelistStatus').textContent = 'Snapshot error: the fallback RPC does not provide the historical data this collection needs. ERC-721 collections with sequential/enumerable IDs normally avoid this. For unusual ERC-721 layouts or ERC-1155, open Advanced snapshot RPC and paste an archive-capable Alchemy/Infura/RPC endpoint.';
      } else {
        $('whitelistStatus').textContent = `Snapshot error: ${message}`;
      }
    }
  }

  async function buildCustomWhitelist() {
    try {
      const allowance = whitelistDefaultAllowance();
      let text = $('whitelistCustomText')?.value || '';
      const file = $('whitelistFileInput')?.files?.[0];
      if (file) text = `${text}
${await file.text()}`;
      const entries = parseCustomWhitelistText(text, allowance);
      const tree = buildMerkleWhitelist(entries);
      const uniformAllowance = entries.every(entry => entry.allowance === entries[0].allowance) ? entries[0].allowance : null;
      setWhitelistResult({ ...tree, sourceType: 2, sourceContract: window.ethers.ZeroAddress, sourceChainId: 0, sourceChainLabel: 'Custom list', snapshotBlock: 0, tokenStandard: 'custom', uniformAllowance });
    } catch (error) {
      $('whitelistStatus').textContent = `Whitelist error: ${error.message}`;
    }
  }

  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function log(id, line, reset = false) {
    const target = $(id);
    if (!target) return;
    target.textContent = reset ? line : `${target.textContent}${target.textContent ? '\n' : ''}${line}`;
    target.scrollTop = target.scrollHeight;
  }

  function setCompileProgress(pct, text) {
    const bar = $('forgeCompileProgressBar');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if ($('forgeCompileStatus')) $('forgeCompileStatus').textContent = text;
  }

  function cleanMetadataString(value, field, allowEmpty = false) {
    const text = String(value ?? '').trim();
    if (!text && !allowEmpty) throw new Error(`${field} is required.`);
    if (/["\\\n\r]/.test(text)) throw new Error(`${field} cannot contain quotes, backslashes, or line breaks in this Sepolia test build.`);
    return text;
  }

  function concatUint8(parts) {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
  }

  async function bytesDigest(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function canvasPngBytes(file) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG recompression failed.')), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function rasterEncoding(file) {
    const type = String(file?.type || '').toLowerCase();
    const ext = String(file?.name || '').split('.').pop().toLowerCase();
    if (type === 'image/png' || ext === 'png') return { code: 1, label: 'png' };
    if (type === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return { code: 2, label: 'jpeg' };
    if (type === 'image/webp' || ext === 'webp') return { code: 3, label: 'webp' };
    return null;
  }

  async function compileTraitAsset(source) {
    if (isNoneTrait(source)) {
      const data = enc.encode('<g/>');
      return { data, encoding: 'none-svg', encodingCode: 0, sourceBytes: 0, assetKey: `0:${await bytesDigest(data)}` };
    }
    if (!source?.file) throw new Error(`Missing source file for trait ${source?.name || ''}.`);

    const sourceData = new Uint8Array(await source.file.arrayBuffer());
    const raster = rasterEncoding(source.file);
    const isGif = String(source.file.type || '').toLowerCase() === 'image/gif' || /\.gif$/i.test(source.file.name || '');
    let chosenData = sourceData;
    let encodingCode = raster?.code ?? 0;
    let encoding = raster ? `raw-${raster.label}` : 'svg-fragment';

    // Keep GIF animation intact while remaining compatible with already-deployed V11 factories.
    // Encoding 0 is an SVG fragment, so the existing implementation can render an embedded GIF
    // without any Solidity change or factory redeployment.
    if (isGif) {
      const fragment = `<image x="0" y="0" width="${bridge().getState().imageWidth || source.width || 1}" height="${bridge().getState().imageHeight || source.height || 1}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/gif;base64,${bytesToBase64(sourceData)}"/>`;
      chosenData = enc.encode(fragment);
      encodingCode = 0;
      encoding = 'animated-gif-svg';
      if (chosenData.length > MAX_TRAIT_BYTES) {
        throw new Error(`${source.name || source.file.name} is an animated GIF using ${fmtBytes(sourceData.length)} (${fmtBytes(chosenData.length)} when embedded onchain). V11.1.6 preserves GIF animation without requiring a new factory, but the current single-artwork shard limit is ${fmtBytes(MAX_TRAIT_BYTES)}. Optimize the GIF (fewer frames/colors or a smaller canvas) and re-upload it.`);
      }
    }
    // PNG is already highly compressed. Vectorizing every pixel can be much larger,
    // so compare lossless representations and store whichever is smallest.
    else if (raster?.code === 1) {
      let smallestPng = sourceData;
      try {
        const recompressed = await canvasPngBytes(source.file);
        if (recompressed.length < smallestPng.length) smallestPng = recompressed;
      } catch (_) {}

      const fragment = (await bridge().traitToSvgFragment(source)) || '<g/>';
      const vectorData = enc.encode(fragment);
      if (vectorData.length < smallestPng.length) {
        chosenData = vectorData;
        encodingCode = 0;
        encoding = 'pixel-svg';
      } else {
        chosenData = smallestPng;
        encodingCode = 1;
        encoding = smallestPng.length < sourceData.length ? 'optimized-png' : 'raw-png';
      }
    } else if (!raster) {
      const fragment = (await bridge().traitToSvgFragment(source)) || '<g/>';
      chosenData = enc.encode(fragment);
      encodingCode = 0;
      encoding = 'svg-fragment';
    }

    return {
      data: chosenData,
      encoding,
      encodingCode,
      sourceBytes: source.file.size || sourceData.length,
      assetKey: `${encodingCode}:${await bytesDigest(chosenData)}`,
    };
  }

  function normalized(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function isNoneTrait(trait) {
    return !!trait?.isNone || ['none', 'null', 'empty', 'no trait'].includes(normalized(trait?.name));
  }

  function currentRevealMode() {
    return Number(document.querySelector('input[name="revealMode"]:checked')?.value || 0);
  }

  function updateRevealUi() {
    const reveal = currentRevealMode();
    document.querySelectorAll('[data-reveal-card]').forEach(card => card.classList.toggle('selected', Number(card.dataset.revealCard) === reveal));
    $('creatorPlaceholderWrap')?.classList.toggle('hidden', reveal !== 1);
    bridge().updateLaunchSummary?.();
    if (forgeState.compiled && forgeState.compiled.core.revealMode !== reveal) invalidateCompile('Reveal mode changed — recompile for onchain.');
  }

  function invalidateCompile(message = 'Collection changed — recompile for onchain.') {
    forgeState.compiled = null;
    if ($('forgeCollectionBtn')) $('forgeCollectionBtn').disabled = true;
    if ($('forgeCompileStatus')) $('forgeCompileStatus').textContent = message;
    if ($('forgeCompiledSummary')) $('forgeCompiledSummary').textContent = 'Compile for onchain before deployment.';
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
  }

  async function compilePlaceholderFile(file, expectedWidth, expectedHeight) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'svg') {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.querySelector('parsererror')) throw new Error('Creator placeholder is not valid SVG.');
      const root = doc.documentElement;
      root.querySelectorAll('script,foreignObject,iframe,object,embed').forEach(n => n.remove());
      root.querySelectorAll('*').forEach(node => {
        [...node.attributes].forEach(attr => {
          const n = attr.name.toLowerCase();
          const v = attr.value.trim().toLowerCase();
          if (n.startsWith('on') || v.startsWith('javascript:')) node.removeAttribute(attr.name);
          if ((n === 'href' || n === 'xlink:href') && /^(https?:|\/\/)/.test(v)) node.removeAttribute(attr.name);
        });
      });
      const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3])) {
        if (Math.round(vb[2]) !== expectedWidth || Math.round(vb[3]) !== expectedHeight) {
          throw new Error(`Creator placeholder SVG is ${vb[2]}×${vb[3]}; expected ${expectedWidth}×${expectedHeight}.`);
        }
      }
      const fragment = root.innerHTML.replace(/<!--([\s\S]*?)-->/g, '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim() || '<g/>';
      return { fragment, encoding: 'native-svg' };
    }

    if (ext === 'gif' || String(file.type || '').toLowerCase() === 'image/gif') {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
        const dims = `${bitmap.width}×${bitmap.height}`;
        bitmap.close();
        throw new Error(`Creator placeholder is ${dims}; expected ${expectedWidth}×${expectedHeight}.`);
      }
      bitmap.close();
      const raw = new Uint8Array(await file.arrayBuffer());
      const data = bytesToBase64(raw);
      return {
        fragment: `<image x="0" y="0" width="${expectedWidth}" height="${expectedHeight}" preserveAspectRatio="none" style="image-rendering:pixelated" href="data:image/gif;base64,${data}"/>`,
        encoding: 'animated-gif'
      };
    }

    const bitmap = await createImageBitmap(file);
    if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
      const dims = `${bitmap.width}×${bitmap.height}`;
      bitmap.close();
      throw new Error(`Creator placeholder is ${dims}; expected ${expectedWidth}×${expectedHeight}.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rectangles = [];
    let active = new Map();
    for (let y = 0; y < canvas.height; y++) {
      const rowRuns = [];
      let x = 0;
      while (x < canvas.width) {
        const i = (y * canvas.width + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
        if (!a) { x++; continue; }
        let end = x + 1;
        while (end < canvas.width) {
          const j = (y * canvas.width + end) * 4;
          if (pixels[j] !== r || pixels[j + 1] !== g || pixels[j + 2] !== b || pixels[j + 3] !== a) break;
          end++;
        }
        rowRuns.push({ x, w: end - x, r, g, b, a });
        x = end;
      }
      const next = new Map(), seen = new Set();
      for (const run of rowRuns) {
        const key = `${run.x}:${run.w}:${run.r}:${run.g}:${run.b}:${run.a}`;
        seen.add(key);
        const existing = active.get(key);
        if (existing) { existing.h += 1; next.set(key, existing); }
        else next.set(key, { ...run, y, h: 1 });
      }
      for (const [key, rect] of active) if (!seen.has(key)) rectangles.push(rect);
      active = next;
    }
    rectangles.push(...active.values());
    const groups = new Map();
    for (const rect of rectangles) {
      const key = `${rect.r}:${rect.g}:${rect.b}:${rect.a}`;
      if (!groups.has(key)) groups.set(key, { ...rect, commands: [] });
      groups.get(key).commands.push(`M${rect.x} ${rect.y}h${rect.w}v${rect.h}h-${rect.w}Z`);
    }
    const hex = n => n.toString(16).padStart(2, '0');
    const fragments = [];
    for (const group of groups.values()) {
      const fill = `#${hex(group.r)}${hex(group.g)}${hex(group.b)}`;
      const opacity = group.a === 255 ? '' : ` fill-opacity="${(group.a / 255).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}"`;
      fragments.push(`<path fill="${fill}"${opacity} d="${group.commands.join('')}"/>`);
    }
    return { fragment: fragments.join('') || '<g/>', encoding: 'pixel-rectangles' };
  }

  function defaultForgePlaceholderFragment(width, height) {
    const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
    const rx = Math.max(2, Math.floor(width * 0.28)), ry = Math.max(2, Math.floor(height * 0.28));
    const top = Math.max(0, cy - ry), right = Math.min(width, cx + rx), bottom = Math.min(height, cy + ry), left = Math.max(0, cx - rx);
    return `<rect width="${width}" height="${height}" fill="#111214"/><path fill="#b95d35" d="M${cx} ${top}L${right} ${cy} ${cx} ${bottom} ${left} ${cy}Z"/><rect x="${Math.max(0, cx - 1)}" y="${Math.max(0, cy - Math.max(1, Math.floor(ry / 2)))}" width="${Math.min(2, width)}" height="${Math.max(2, ry)}" fill="#e5b56c"/>`;
  }

  function packTraitBytes(compiledTraits) {
    const shards = [];
    const exactAssetIndex = new Map();
    let currentParts = [], currentLength = 0;
    const flush = () => {
      if (!currentLength) return;
      shards.push(concatUint8(currentParts));
      currentParts = []; currentLength = 0;
    };
    for (const trait of compiledTraits) {
      const bytes = trait.data;
      if (!(bytes instanceof Uint8Array)) throw new Error(`Missing compiled bytes for ${trait.layerName} / ${trait.name}.`);
      if (bytes.length > MAX_TRAIT_BYTES) throw new Error(`${trait.layerName} / ${trait.name} needs ${fmtBytes(bytes.length)} after lossless optimization, above the ${fmtBytes(MAX_TRAIT_BYTES)} V11 test limit.`);
      const prior = exactAssetIndex.get(trait.assetKey);
      if (prior) {
        Object.assign(trait, prior, { deduped: true });
        continue;
      }
      if (currentLength + bytes.length > MAX_SHARD_BYTES) flush();
      trait.shard = shards.length;
      trait.offset = currentLength;
      trait.length = bytes.length;
      trait.deduped = false;
      exactAssetIndex.set(trait.assetKey, { shard: trait.shard, offset: trait.offset, length: trait.length });
      currentParts.push(bytes); currentLength += bytes.length;
    }
    flush();
    return shards;
  }

  function buildDna(studioState, layerDefs) {
    const tokens = studioState.compiledTokens;
    if (!tokens?.length) throw new Error('Build the final collection in Step 4 first.');
    const layerCount = layerDefs.length;
    const bytes = new Uint8Array(tokens.length * layerCount);
    const errors = [];
    tokens.forEach((token, recipeIndex) => {
      for (let li = 0; li < layerDefs.length; li++) {
        const layer = layerDefs[li];
        let index = -1;
        if (layer.isOneOfOneLayer) {
          index = token.oneOfOneId ? layer.traits.findIndex(t => t.id === token.oneOfOneId) : 0;
        } else if (token.oneOfOneId) {
          // Standalone 1/1 recipes do not use layered art. Use index zero as inert DNA;
          // the contract ignores normal layers whenever the special 1/1 slot is nonzero.
          index = 0;
        } else {
          const traitId = token.traits[layer.id];
          index = layer.traits.findIndex(t => t.id === traitId);
        }
        if (index < 0) { errors.push(`Recipe ${recipeIndex + 1} is missing a valid trait for ${layer.name}.`); continue; }
        if (index > 255) { errors.push(`${layer.name} exceeds the v1 limit of 256 traits.`); continue; }
        bytes[recipeIndex * layerCount + li] = index;
      }
    });
    if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
    const recipesPerShard = Math.max(1, Math.floor(MAX_SHARD_BYTES / layerCount));
    const shards = [];
    for (let start = 0; start < tokens.length; start += recipesPerShard) {
      const count = Math.min(recipesPerShard, tokens.length - start);
      shards.push(bytes.slice(start * layerCount, (start + count) * layerCount));
    }
    return { recipeCount: tokens.length, recipesPerShard, shards, rawBytes: bytes };
  }

  async function hashCompiled(core, artShards, dnaShards, placeholderBytes) {
    if (!window.ethers) throw new Error('ethers.js did not load; an internet connection is required for the Sepolia Forge module.');
    const chunks = [window.ethers.toUtf8Bytes(JSON.stringify(core)), ...artShards, ...dnaShards, placeholderBytes];
    return window.ethers.keccak256(window.ethers.concat(chunks));
  }

  async function compileForOnchain() {
    try {
      const studio = bridge().getState();
      if (!studio.compiledTokens?.length) throw new Error('Build the collection in Step 4 first.');
      if (studio.compilerReport?.compilerVersion !== '11.0.0') throw new Error('This collection was compiled with an older collection compiler. Rebuild it in Step 4 before forging.');
      if (!studio.compilerReport || studio.compilerReport.ruleViolations || studio.compilerReport.exactIssues?.length || studio.compilerReport.distributionIssues?.length) throw new Error('The Step 4 collection compiler still has rule, exact-count, or rarity-distribution issues.');
      if (!studio.layers?.length) throw new Error('Upload artwork in Step 1 first.');
      const revealMode = currentRevealMode();
      if (studio.layers.length + (studio.oneOfOnes?.length ? 1 : 0) > 64) throw new Error('Relic Forge V1 supports at most 64 layers including the optional 1/1 layer.');
      if (studio.imageWidth > 65535 || studio.imageHeight > 65535) throw new Error('Canvas dimensions exceed the v1 uint16 renderer limit.');

      setCompileProgress(2, 'Reading final Studio collection…');
      const layerDefs = studio.layers.map((layer, layerIndex) => {
        cleanMetadataString(layer.name, `Layer ${layerIndex + 1} name`);
        if (!layer.traits.length) throw new Error(`${layer.name} has no trait artwork.`);
        if (layer.traits.length > 256) throw new Error(`${layer.name} has more than 256 traits.`);
        return {
          id: layer.id,
          name: layer.name,
          index: layerIndex,
          isOneOfOneLayer: false,
          metadataHidden: !!layer.metadataHidden,
          traits: layer.traits.map((trait, traitIndex) => ({
            id: trait.id,
            name: cleanMetadataString(trait.name, `${layer.name} trait name`),
            trait,
            traitIndex,
            metadataHidden: !!trait.metadataHidden || (!!trait.isNone && !!studio.hideNoneMetadata),
          })),
        };
      });
      let oneOfOneLayerIndex = -1;
      if (studio.oneOfOnes?.length) {
        if (studio.oneOfOnes.length > 255) throw new Error('A collection can contain at most 255 standalone 1/1 artworks in the v1 DNA format.');
        oneOfOneLayerIndex = layerDefs.length;
        const none = { id: '__rf_oneofone_none__', name: 'None', isNone: true, file: null };
        layerDefs.push({
          id: '__rf_oneofone_layer__',
          name: '1/1 Artwork',
          index: oneOfOneLayerIndex,
          isOneOfOneLayer: true,
          metadataHidden: false,
          traits: [
            { id: none.id, name: 'None', trait: none, traitIndex: 0, metadataHidden: true },
            ...studio.oneOfOnes.map((item, i) => ({ id: item.id, name: cleanMetadataString(item.name, `1/1 artwork ${i + 1}`), trait: item, traitIndex: i + 1, metadataHidden: false })),
          ],
        });
      }

      const compiledTraits = [];
      const totalTraits = layerDefs.reduce((n, layer) => n + layer.traits.length, 0);
      let done = 0;
      for (const layer of layerDefs) {
        for (const traitDef of layer.traits) {
          setCompileProgress(5 + 55 * (done / Math.max(1, totalTraits)), `Optimizing ${layer.name} / ${traitDef.name}…`);
          const source = traitDef.trait;
          const asset = await compileTraitAsset(source);
          compiledTraits.push({
            ...traitDef,
            layerIndex: layer.index,
            layerName: layer.name,
            ...asset,
          });
          done++;
        }
      }

      const unsupportedV1 = compiledTraits.filter(t => Number(t.encodingCode) > 3);
      if (unsupportedV1.length) {
        const first = unsupportedV1[0];
        throw new Error(`Relic Forge V1 cannot store raw GIF trait encoding (${first.layerName} / ${first.name}). Convert animated trait art to animated WEBP or SVG before forging. Mint-page images and banners may still use GIF.`);
      }

      setCompileProgress(64, 'Packing artwork into immutable bytecode shards...');
      const artShards = packTraitBytes(compiledTraits);
      setCompileProgress(73, 'Packing exact recipe DNA…');
      const dna = buildDna(studio, layerDefs);
      setCompileProgress(81, 'Compiling reveal placeholder…');
      const placeholder = forgeState.placeholderFile
        ? await compilePlaceholderFile(forgeState.placeholderFile, studio.imageWidth, studio.imageHeight)
        : { fragment: defaultForgePlaceholderFragment(studio.imageWidth, studio.imageHeight), encoding: 'relicforge-default' };
      const placeholderBytes = enc.encode(placeholder.fragment);
      if (placeholderBytes.length > MAX_TRAIT_BYTES) throw new Error(`Reveal placeholder compiles to ${fmtBytes(placeholderBytes.length)}, above the ${fmtBytes(MAX_TRAIT_BYTES)} test limit.`);

      const oneOfOneMetadataInputs = [];
      if (oneOfOneLayerIndex >= 0) {
        for (let i = 0; i < (studio.oneOfOnes || []).length; i++) {
          const item = studio.oneOfOnes[i];
          const tokenName = item.tokenName?.trim() ? cleanMetadataString(item.tokenName, `1/1 ${i + 1} token name`, true) : '';
          const tokenDescription = item.description?.trim() ? cleanMetadataString(item.description, `1/1 ${i + 1} description`, true) : '';
          const rows = (item.metadata || []).filter(row => String(row.traitType || '').trim() && String(row.value || '').trim());
          const attributeParts = [];
          if (item.includeDefaultAttribute !== false) {
            const defaultValue = cleanMetadataString(item.name, `1/1 ${i + 1} artwork label`);
            attributeParts.push(`{"trait_type":"1/1","value":"${defaultValue}"}`);
          }
          rows.forEach((row, ri) => {
            const traitType = cleanMetadataString(row.traitType, `1/1 ${i + 1} metadata trait ${ri + 1}`);
            const value = cleanMetadataString(row.value, `1/1 ${i + 1} metadata value ${ri + 1}`);
            attributeParts.push(`{"trait_type":"${traitType}","value":"${value}"}`);
          });
          // Empty string means use the contract's default 1/1 attribute. An explicit [] means hide it.
          const attributesJson = attributeParts.length ? `[${attributeParts.join(',')}]` : (item.includeDefaultAttribute === false ? '[]' : '');
          oneOfOneMetadataInputs.push([i + 1, tokenName, tokenDescription, attributesJson]);
        }
      }

      setCompileProgress(88, 'Generating provenance commitment…');
      const core = {
        schema: 'relic-forge/onchain-compile@0.1',
        name: cleanMetadataString($('launchName').value, 'Collection name'),
        symbol: cleanMetadataString($('launchSymbol').value, 'Symbol'),
        description: cleanMetadataString($('launchDescription').value, 'Description'),
        maxSupply: studio.compiledTokens.length,
        canvas: [studio.imageWidth, studio.imageHeight],
        revealMode,
        oneOfOneLayerIndex,
        hideNoneMetadata: !!studio.hideNoneMetadata,
        layers: layerDefs.map(layer => ({ name: layer.name, metadataHidden: !!layer.metadataHidden, traits: layer.traits.map(t => ({ name: t.name, metadataHidden: !!t.metadataHidden })) })),
        oneOfOneMetadata: oneOfOneMetadataInputs,
      };
      const provenance = await hashCompiled(core, artShards, dna.shards, placeholderBytes);
      const sourceBytes = compiledTraits.reduce((n, t) => n + t.sourceBytes, 0) + (forgeState.placeholderFile?.size || 0);
      const artBytes = artShards.reduce((n, s) => n + s.length, 0);
      const dnaBytes = dna.shards.reduce((n, s) => n + s.length, 0);
      forgeState.compiled = {
        core,
        layerDefs,
        traits: compiledTraits,
        artShards,
        dnaShards: dna.shards,
        recipeCount: dna.recipeCount,
        recipesPerShard: dna.recipesPerShard,
        placeholderBytes,
        placeholderEncoding: placeholder.encoding,
        oneOfOneLayerIndex,
        oneOfOneMetadataInputs,
        provenance,
        sourceBytes,
        artBytes,
        dnaBytes,
        totalCompiledBytes: artBytes + dnaBytes + placeholderBytes.length,
      };
      setCompileProgress(100, 'Onchain collection compiled and validated.');
      renderCompileReport();
      await refreshCostEstimate();
      $('forgeCollectionBtn').disabled = false;
      bridge().showStatus?.('Onchain collection compiled successfully.', 'success');
    } catch (error) {
      forgeState.compiled = null;
      setCompileProgress(0, `Compile failed: ${error.message}`);
      $('forgeCollectionBtn').disabled = true;
      $('forgeValidationList').innerHTML = `<div class="forge-check bad">✕ ${esc(error.message).replace(/\n/g, '<br>')}</div>`;
    }
  }

  function renderCompileReport() {
    const c = forgeState.compiled;
    if (!c) return;
    const artDelta = c.sourceBytes > 0 ? (1 - (c.artBytes / c.sourceBytes)) * 100 : 0;
    const savingsText = artDelta >= 0 ? `${artDelta.toFixed(1)}%` : `+${Math.abs(artDelta).toFixed(1)}%`;
    const vals = [
      fmtBytes(c.sourceBytes), fmtBytes(c.artBytes), fmtBytes(c.dnaBytes),
      String(c.artShards.length), String(c.dnaShards.length), savingsText,
    ];
    [...$('forgeCompileMetrics').children].forEach((node, i) => node.querySelector('strong').textContent = vals[i]);
    const largest = [...c.traits].sort((a, b) => b.length - a.length).slice(0, 8);
    $('forgeLargestTraits').innerHTML = largest.map(t => `<div class="forge-row"><span>${esc(t.layerName)} / ${esc(t.name)} <small>${esc(t.encoding)}</small></span><strong>${fmtBytes(t.length)}</strong></div>`).join('');
    const warnings = [];
    if (c.totalCompiledBytes > 512 * 1024) warnings.push('Project exceeds the 512 KB recommended economic zone.');
    if (c.traits.some(t => t.length > 16000)) warnings.push('One or more traits exceeds 16 KB compiled.');
    $('forgeValidationList').innerHTML = [
      `<div class="forge-check good">✓ ${c.layerDefs.length} layer(s), ${c.traits.length} trait(s)</div>`,
      `<div class="forge-check good">✓ ${c.recipeCount} exact recipes compiled from Step 4</div>`,
      `<div class="forge-check good">✓ ${c.traits.filter(t => t.deduped).length} exact duplicate art asset(s) deduplicated</div>`,
      `<div class="forge-check good">✓ ${c.traits.filter(t => t.encodingCode === 1).length} PNG trait(s) stored as compressed raster because that was smaller than SVG</div>`,
      `<div class="forge-check good">✓ ${c.traits.filter(t => t.encodingCode === 4).length} animated GIF trait(s) preserved as raw animation</div>`,
      `<div class="forge-check good">✓ ${c.artShards.length + c.dnaShards.length + 1} data shard(s) including placeholder</div>`,
      `<div class="forge-check good">✓ ${c.core.revealMode === 0 ? 'Forge Reveal' : 'Deferred Reveal'} configured</div>`,
      ...warnings.map(w => `<div class="forge-check warn">⚠ ${esc(w)}</div>`),
    ].join('');
    $('forgeProvenance').innerHTML = `Collection provenance <code>${esc(c.provenance)}</code>`;
    $('forgeCompiledSummary').innerHTML = `<strong>${esc(c.core.name)}</strong> · ${c.recipeCount.toLocaleString()} NFTs · ${c.layerDefs.length} layers · ${c.traits.length} traits · ${fmtBytes(c.totalCompiledBytes)} compiled · ${c.artShards.length} art shard(s) + ${c.dnaShards.length} DNA shard(s).`;
  }

  const publicGasProviders = new Map();
  function publicGasProvider(rpc) {
    if (!window.ethers) return null;
    if (!publicGasProviders.has(rpc)) publicGasProviders.set(rpc, new window.ethers.JsonRpcProvider(rpc, 11155111, { staticNetwork: true, batchMaxCount: 1 }));
    return publicGasProviders.get(rpc);
  }

  async function liveSepoliaGasPrice() {
    let lastError = null;
    for (const rpc of PUBLIC_SEPOLIA_GAS_RPCS) {
      try {
        const provider = publicGasProvider(rpc);
        const raw = await Promise.race([
          provider.send('eth_gasPrice', []),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Public gas RPC timeout')), 3500)),
        ]);
        const gasPrice = BigInt(raw);
        if (gasPrice > 0n) return { gasPrice, source: 'Public RPC' };
      } catch (error) { lastError = error; }
    }
    // A connected wallet is a safe fallback because it uses the user's wallet RPC,
    // not the RelicForge Railway/Alchemy account.
    if (forgeState.provider) {
      try {
        const raw = await forgeState.provider.send('eth_gasPrice', []);
        const gasPrice = BigInt(raw);
        if (gasPrice > 0n) return { gasPrice, source: 'Wallet RPC' };
      } catch (error) { lastError = error; }
    }
    if (lastError) console.warn('Live Sepolia gas price unavailable:', lastError.message || lastError);
    return null;
  }

  function roughGasBreakdown(c) {
    const shardGas = bytes => 75000 + bytes * 225;
    const art = c.artShards.reduce((n, shard) => n + shardGas(shard.length), 0);
    const dna = c.dnaShards.reduce((n, shard) => n + shardGas(shard.length), 0);
    const placeholder = shardGas(c.placeholderBytes.length);
    const clone = 360000;
    const traits = 70000 + c.traits.length * 30000;
    const layerNames = 45000 + c.layerDefs.length * 22000;
    const metadataVisibility = 35000 + c.layerDefs.length * 5000;
    const oneOfOneMetadata = (c.oneOfOneMetadataInputs || []).reduce((gas, row) => gas + 35000 + (String(row[1]).length + String(row[2]).length + String(row[3]).length) * 700, 0);
    const finalize = 180000;
    const mintAccess = 125000;
    return { clone, art, dna, placeholder, traits, layerNames, metadataVisibility, oneOfOneMetadata, finalize, mintAccess, total: clone + art + dna + placeholder + traits + layerNames + metadataVisibility + oneOfOneMetadata + finalize + mintAccess };
  }

  function currentGweiMode() {
    return document.querySelector('input[name="gweiMode"]:checked')?.value || 'auto';
  }

  function updateGweiUi() {
    const custom = currentGweiMode() === 'custom';
    $('forgeCustomGweiWrap')?.classList.toggle('hidden', !custom);
    document.querySelectorAll('[data-gwei-card]').forEach(card => card.classList.toggle('selected', card.dataset.gweiCard === (custom ? 'custom' : 'auto')));
    refreshCostEstimate().catch(() => {});
  }

  async function refreshCostEstimate() {
    if (!forgeState.compiled) {
      $('forgeEstimatedCost').textContent = '—';
      $('forgeEstimatedGas').textContent = 'Compile first';
      $('forgeCostBreakdown').innerHTML = '';
      return;
    }
    const b = roughGasBreakdown(forgeState.compiled);
    let totalText = `~${b.total.toLocaleString()} gas`;
    let feeText = 'Live public Sepolia gas unavailable · enter custom gwei if needed';
    let liveGwei = null;
    let gasSource = '';
    try {
      if (window.ethers) {
        const live = await liveSepoliaGasPrice();
        forgeState.gasPrice = live?.gasPrice || null;
        gasSource = live?.source || '';
        if (forgeState.gasPrice) liveGwei = Number(window.ethers.formatUnits(forgeState.gasPrice, 'gwei'));
      }
    } catch (_) {}
    if ($('forgeCurrentGwei')) $('forgeCurrentGwei').textContent = liveGwei == null ? 'Current: unavailable' : `Current: ${liveGwei.toFixed(3)} gwei${gasSource ? ` · ${gasSource}` : ''}`;

    let selectedGwei = liveGwei;
    if (currentGweiMode() === 'custom') {
      const raw = Number($('forgeCustomGwei')?.value || 0);
      selectedGwei = Number.isFinite(raw) && raw > 0 ? raw : null;
      if (selectedGwei == null) feeText = `~${b.total.toLocaleString()} gas · enter custom gwei`;
    }

    if (selectedGwei != null && window.ethers) {
      const gasWei = window.ethers.parseUnits(String(selectedGwei), 'gwei');
      const wei = BigInt(b.total) * gasWei;
      totalText = `~${Number(window.ethers.formatEther(wei)).toFixed(5)} Sepolia ETH`;
      feeText = `~${b.total.toLocaleString()} gas at ${selectedGwei.toFixed(2)} gwei${currentGweiMode() === 'custom' ? ' (custom)' : ''}`;
    }
    $('forgeEstimatedCost').textContent = totalText;
    $('forgeEstimatedGas').textContent = feeText;
    const labels = [
      ['Collection clone + initialize', b.clone], ['Artwork shard writes', b.art],
      ['Trait index/name setup', b.traits], ['Layer names', b.layerNames],
      ['Metadata visibility flags', b.metadataVisibility], ['1/1 custom metadata', b.oneOfOneMetadata],
      ['DNA shard writes', b.dna], ['Placeholder storage', b.placeholder],
      ['Finalize + provenance', b.finalize], ['Mint access / whitelist root', b.mintAccess],
    ];
    $('forgeCostBreakdown').innerHTML = labels.map(([name, gas]) => `<div class="forge-row"><span>${esc(name)}</span><strong>~${gas.toLocaleString()} gas</strong></div>`).join('');
  }

  function activeInjectedWallet() {
    if (window.RelicForgeWalletSession?.getProvider) return window.RelicForgeWalletSession.getProvider() || null;
    if (window.RelicForgeWallets) return window.RelicForgeWallets.getProvider?.() || null;
    return window.ethereum || null;
  }

  async function switchSepolia(provider = activeInjectedWallet()) {
    if (!provider?.request) throw new Error('No selected EVM wallet provider found.');
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (chainId.toLowerCase() === SEPOLIA_CHAIN_ID_HEX) return;
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
    } catch (error) {
      if (Number(error.code) !== 4902) throw error;
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] }],
      });
    }
  }

  function resetWalletSessionUi(message = 'No wallet connected.') {
    forgeState.provider = null;
    forgeState.signer = null;
    forgeState.wallet = null;
    if ($('forgeWalletStatus')) $('forgeWalletStatus').textContent = message;
    if ($('connectForgeWalletBtn')) $('connectForgeWalletBtn').textContent = 'Connect Wallet';
    if ($('launchedDashboardWallet')) $('launchedDashboardWallet').textContent = 'Connect wallet to load launches';
    if ($('launchedConnectBtn')) $('launchedConnectBtn').textContent = 'Connect Wallet';
    $('launchedChangeWalletBtn')?.classList.add('hidden');
    $('launchedDisconnectBtn')?.classList.add('hidden');
    if ($('launchedCollectionList')) $('launchedCollectionList').innerHTML = '<div class="forge-market-empty">Connect your wallet to load launched projects.</div>';
    if ($('launchedCollectionDetail')) $('launchedCollectionDetail').innerHTML = '<div class="forge-market-empty">Choose a launched collection to open its creator controls.</div>';
  }

  async function requestForgeAccount({ forceChooser = false } = {}) {
    if (window.RelicForgeWalletSession?.requestAccount) return window.RelicForgeWalletSession.requestAccount({ forceChooser });
    if (window.RelicForgeWallets?.requestAccount) return window.RelicForgeWallets.requestAccount({ forceChooser });
    if (!window.ethereum?.request) throw new Error('No injected EVM wallet found.');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts?.[0]) throw new Error('Wallet did not return an account.');
    return accounts[0];
  }

  async function connectWallet({ forceChooser = false } = {}) {
    try {
      if (!window.ethers) throw new Error('ethers.js did not load. Check the internet connection and reload.');
      await requestForgeAccount({ forceChooser });
      const injected = activeInjectedWallet();
      if (!injected) throw new Error('No selected EVM wallet provider found.');
      await switchSepolia(injected);
      forgeState.provider = new window.ethers.BrowserProvider(injected);
      forgeState.signer = await forgeState.provider.getSigner();
      forgeState.wallet = await forgeState.signer.getAddress();
      window.dispatchEvent(new CustomEvent('relicforge:wallet-connected', { detail: { address: forgeState.wallet } }));
      const forgeWalletStatus = $('forgeWalletStatus');
      if (forgeWalletStatus) forgeWalletStatus.textContent = `${forgeState.wallet.slice(0, 6)}…${forgeState.wallet.slice(-4)} · Sepolia`;
      if (window.RelicForgeCloud?.enabled?.()) {
        try {
          await window.RelicForgeCloud.ensureSignedIn(forgeState.wallet);
          if (forgeWalletStatus) forgeWalletStatus.textContent += ' · Cloud';
        } catch (cloudError) {
          if (forgeWalletStatus) forgeWalletStatus.textContent += ' · Cloud sign-in pending';
        }
      }
      if ($('connectForgeWalletBtn')) $('connectForgeWalletBtn').textContent = 'Wallet Connected';
      if ($('royaltyWallet') && !$('royaltyWallet').value.trim()) $('royaltyWallet').value = forgeState.wallet;
      if ($('payoutWallet') && !$('payoutWallet').value.trim()) $('payoutWallet').value = forgeState.wallet;
      if ($('launchedConnectBtn')) $('launchedConnectBtn').textContent = `${forgeState.wallet.slice(0, 6)}…${forgeState.wallet.slice(-4)}`;
      $('launchedChangeWalletBtn')?.classList.remove('hidden');
      $('launchedDisconnectBtn')?.classList.remove('hidden');
      renderCanonicalV1();
      await refreshPlatformFeeQuote();
      await refreshVrfQuote();
      if ($('forgeCostEstimate')) await refreshCostEstimate();
      return forgeState.wallet;
    } catch (error) {
      if ($('forgeWalletStatus')) $('forgeWalletStatus').textContent = `Wallet error: ${error.message}`;
      if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Wallet error: ${error.message}`;
      throw error;
    }
  }

  async function disconnectForgeWallet() {
    try {
      if (window.RelicForgeWalletSession?.disconnect) await window.RelicForgeWalletSession.disconnect({ revoke: true });
      else window.RelicForgeCloud?.clearSession?.();
    } catch (_) { window.RelicForgeCloud?.clearSession?.(); }
    resetWalletSessionUi('Wallet disconnected.');
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = 'Wallet disconnected. Connect a creator wallet to rediscover launched collections.';
    window.dispatchEvent(new CustomEvent('relicforge:wallet-disconnected'));
  }

  async function changeForgeWallet() {
    window.RelicForgeCloud?.clearSession?.();
    resetWalletSessionUi('Choose another wallet account…');
    window.dispatchEvent(new CustomEvent('relicforge:wallet-disconnected'));
    const address = await connectWallet({ forceChooser: true });
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Connected ${shortAddr(address)}. Refreshing launched projects…`;
    return address;
  }

  function canonicalV1Config() {
    const config = window.RELICFORGE_V1_ADDRESSES?.[11155111];
    if (!config || !window.ethers?.isAddress(config.factory) || !window.ethers?.isAddress(config.feePolicy)) {
      throw new Error('Canonical Relic Forge V1 Sepolia configuration is unavailable.');
    }
    return config;
  }

  function currentPlatformFeeMode() {
    return Number(document.querySelector('input[name="platformFeeMode"]:checked')?.value || V1_FEE_MODE_MINTER_SUPPORTED);
  }

  function canonicalSupply() {
    const compiled = Number(forgeState.compiled?.recipeCount || 0);
    if (compiled > 0) return compiled;
    return Math.max(1, Number(document.getElementById('collectionSize')?.value || 1));
  }

  function shortV1(value) {
    return value && value.length > 18 ? `${value.slice(0,10)}…${value.slice(-8)}` : (value || '—');
  }

  function renderCanonicalV1() {
    try {
      const cfg = canonicalV1Config();
      const fields = {
        canonicalFactoryAddress: cfg.factory,
        canonicalFeePolicyAddress: cfg.feePolicy,
        canonicalRandomnessAddress: cfg.randomnessAdapter,
        canonicalRendererAddress: cfg.renderer
      };
      Object.entries(fields).forEach(([id,value]) => {
        const node = $(id);
        if (node) { node.textContent = shortV1(value); node.title = value; }
      });
      if ($('canonicalV1Status')) $('canonicalV1Status').textContent =
        `✓ Canonical V1 loaded · ${String(cfg.sourceCommit || '').slice(0,8)} · no creator infrastructure deployment.`;
      return cfg;
    } catch (error) {
      if ($('canonicalV1Status')) $('canonicalV1Status').textContent = `V1 CONFIG ERROR: ${error.message}`;
      return null;
    }
  }

  async function refreshPlatformFeeQuote() {
    const cfg = renderCanonicalV1();
    if (!cfg || !window.ethers) return;
    const mode = currentPlatformFeeMode();
    document.querySelectorAll('[data-fee-mode-card]').forEach(card => card.classList.toggle('selected', Number(card.dataset.feeModeCard) === mode));
    try {
      const provider = readProvider(11155111);
      if (!provider) throw new Error('Sepolia RPC unavailable.');
      const factory = new window.ethers.Contract(cfg.factory, V1_FACTORY_ABI, provider);
      const supply = canonicalSupply();
      const [cents, upfront, healthy, active] = await factory.quoteCollectionFeeTerms(supply, mode);
      const rate = Number(cents);
      const name = mode === V1_FEE_MODE_SPONSORED ? 'Sponsored' : 'Minter Supported';
      if ($('platformFeePolicyLabel')) $('platformFeePolicyLabel').textContent = `${name}${active ? ' · active' : ' · $0 policy'}`;
      if ($('platformFeeRate')) $('platformFeeRate').textContent =
        mode === V1_FEE_MODE_SPONSORED ? `$${(rate/100).toFixed(2)} × ${supply.toLocaleString()} max supply` : `$${(rate/100).toFixed(2)} / NFT`;
      if ($('platformFeeUpfront')) $('platformFeeUpfront').textContent =
        mode === V1_FEE_MODE_SPONSORED ? `${Number(window.ethers.formatEther(upfront)).toFixed(6)} ETH` : '0 ETH';
      if ($('platformFeeQuoteStatus')) $('platformFeeQuoteStatus').textContent =
        healthy ? `Live canonical quote · ${name}.` : (mode === V1_FEE_MODE_SPONSORED ? 'Sponsored launch unavailable until the ETH/USD oracle is healthy.' : 'Oracle unavailable; existing Minter Supported mints fail open to $0 platform fee.');
    } catch (error) {
      if ($('platformFeeQuoteStatus')) $('platformFeeQuoteStatus').textContent = `Fee quote unavailable: ${error.message}`;
    }
  }
  function v1RandomnessContract(runner = readProvider(11155111)) {
    const cfg = canonicalV1Config();
    return new window.ethers.Contract(cfg.randomnessAdapter, V1_RANDOMNESS_ABI, runner);
  }

  function requestedVrfFundingRequests() {
    const n = Math.floor(Number($('vrfFundingRequests')?.value || 5));
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error('Initial VRF request budget must be between 1 and 100.');
    return n;
  }

  async function refreshVrfQuote() {
    if (!window.ethers || !$('vrfQuoteStatus')) return;
    try {
      const requests = requestedVrfFundingRequests();
      const live = await liveSepoliaGasPrice();
      if (!live?.gasPrice) throw new Error('Live Sepolia gas price is unavailable for the Chainlink VRF estimate.');
      const price = await v1RandomnessContract().quoteRequestPrice({ gasPrice: live.gasPrice });
      if (price <= 0n) throw new Error('Chainlink wrapper returned a zero request price even with a live gas-price simulation.');
      const funded = (price * BigInt(requests) * 120n + 99n) / 100n;
      $('vrfQuoteStatus').textContent =
        `Current VRF request ~ ${Number(window.ethers.formatEther(price)).toFixed(6)} ETH  -  initial isolated credit ~ ${Number(window.ethers.formatEther(funded)).toFixed(6)} ETH (${requests} requests + 20% buffer).`;
      return { requests, price, funded };
    } catch (error) {
      $('vrfQuoteStatus').textContent = `VRF quote unavailable: ${error.message}`;
      return null;
    }
  }
  async function compileContracts() {
    if (forgeState.contractArtifacts) return forgeState.contractArtifacts;
    log('forgeInfraStatus', 'Loading contracts/RelicForgeTest.sol…', true);
    const sourceResponse = await fetch('./contracts/RelicForgeTest.sol', { cache: 'no-store' });
    if (!sourceResponse.ok) throw new Error(`Could not load Solidity source (${sourceResponse.status}).`);
    const source = await sourceResponse.text();
    log('forgeInfraStatus', 'Loading official Solidity 0.8.30 compiler in a Web Worker…');
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker('./js/solc-worker.js?v=11.1.6');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Solidity compiler timed out.')); }, 120000);
      worker.onmessage = event => {
        clearTimeout(timer); worker.terminate();
        event.data.ok ? resolve(event.data) : reject(new Error(event.data.error));
      };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'Compiler worker failed.')); };
      worker.postMessage({ source });
    });
    const output = result.output;
    const messages = output.errors || [];
    messages.forEach(message => log('forgeInfraStatus', `${message.severity.toUpperCase()}: ${message.formattedMessage || message.message}`));
    const fatal = messages.filter(message => message.severity === 'error');
    if (fatal.length) throw new Error(`Solidity compilation failed with ${fatal.length} error(s).`);
    const contracts = output.contracts?.['RelicForgeTest.sol'];
    if (!contracts) throw new Error('Compiler returned no RelicForge contracts.');
    const pick = name => ({ abi: contracts[name].abi, bytecode: `0x${contracts[name].evm.bytecode.object}`, deployedBytecode: `0x${contracts[name].evm.deployedBytecode.object}` });
    forgeState.contractArtifacts = {
      RelicCollectionV2: pick('RelicCollectionV2'),
      RelicRandomnessMock: pick('RelicRandomnessMock'),
      RelicForgeFactory: pick('RelicForgeFactory'),
    };
    const runtimeSizes = Object.fromEntries(Object.entries(forgeState.contractArtifacts).map(([name, artifact]) => [name, (artifact.deployedBytecode.length - 2) / 2]));
    const eip170Limit = 24576;
    const collectionSize = runtimeSizes.RelicCollectionV2;
    const collectionMargin = eip170Limit - collectionSize;
    const collectionUsage = ((collectionSize / eip170Limit) * 100).toFixed(1);
    if (collectionSize > eip170Limit) {
      throw new Error(`RelicCollectionV2 runtime is ${collectionSize} bytes (${collectionUsage}% of EIP-170), ${Math.abs(collectionMargin)} bytes over the ${eip170Limit}-byte limit. The shared implementation must deploy successfully before the clone factory can be deployed.`);
    }
    log('forgeInfraStatus', `Compiled with ${result.version}.\nRelicCollectionV2: ${collectionSize} / ${eip170Limit} bytes (${collectionUsage}%, ${collectionMargin} bytes free)\nRelicRandomnessMock: ${runtimeSizes.RelicRandomnessMock} bytes runtime\nRelicForgeFactory: ${runtimeSizes.RelicForgeFactory} bytes runtime${collectionMargin < 1024 ? '\nWARNING: Implementation is deployable but has less than 1 KB of EIP-170 headroom.' : ''}\n✓ Ready for Sepolia test deployment.`);
    return forgeState.contractArtifacts;
  }

  async function deployOne(name, args = []) {
    const artifact = forgeState.contractArtifacts[name];
    const factory = new window.ethers.ContractFactory(artifact.abi, artifact.bytecode, forgeState.signer);
    log('forgeInfraStatus', `Deploying ${name}…`);
    const contract = await factory.deploy(...args);
    const tx = contract.deploymentTransaction();
    log('forgeInfraStatus', `  tx ${tx.hash}`);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    log('forgeInfraStatus', `  ✓ ${address}`);
    return address;
  }

  async function deployInfrastructure() {
    try {
      if (!forgeState.signer) await connectWallet();
      await compileContracts();
      log('forgeInfraStatus', 'Deploying shared Sepolia TEST infrastructure…', true);
      const implementation = await deployOne('RelicCollectionV2');
      const randomness = await deployOne('RelicRandomnessMock');
      const factory = await deployOne('RelicForgeFactory', [implementation, randomness, true]);
      forgeState.infra = { implementation, randomness, factory };
      localStorage.setItem(INFRA_KEY, JSON.stringify(forgeState.infra));
      rememberFactory(factory);
      $('factoryAddress').value = factory;
      $('randomnessAddress').value = randomness;
      log('forgeInfraStatus', '✓ Infrastructure saved in this browser. Future Sepolia collections can reuse this factory.');
    } catch (error) {
      log('forgeInfraStatus', `ERROR: ${error.message}`);
    }
  }

  function restoreInfra() {
    try {
      const raw = localStorage.getItem(INFRA_KEY);
      if (!raw) return;
      const infra = JSON.parse(raw);
      if (!infra.factory) return;
      forgeState.infra = infra;
      rememberFactory(infra.factory);
      if ($('factoryAddress') && !$('factoryAddress').value.trim()) $('factoryAddress').value = infra.factory;
      if ($('randomnessAddress') && !$('randomnessAddress').value.trim()) $('randomnessAddress').value = infra.randomness || '';
    } catch (_) {}
  }

  function renderDeployProgress(steps) {
    $('forgeProgressList').innerHTML = steps.map(step => `<div class="forge-deploy-step"><span>${esc(step.label)}</span><strong class="${step.status === 'done' ? 'good' : ''}">${step.status === 'done' ? '✓' : step.status === 'active' ? '◉' : '○'}</strong></div>`).join('');
  }

  async function sendStep(label, call, steps, index) {
    steps[index].status = 'active'; renderDeployProgress(steps);
    const tx = await call();
    steps[index].label = `${label} · ${tx.hash.slice(0, 10)}…`; renderDeployProgress(steps);
    await tx.wait();
    steps[index].status = 'done'; steps[index].label = label; renderDeployProgress(steps);
  }

  function v1ProjectDataContract(address = forgeState.dataAddress, runner = forgeState.signer) {
    if (!address || !window.ethers.isAddress(address)) throw new Error('No V1 ProjectData clone is loaded.');
    if (!runner) throw new Error('Connect the creator wallet first.');
    return new window.ethers.Contract(address, V1_PROJECT_DATA_ABI, runner);
  }

  function collectionContract(runner = forgeState.signer) {
    if (!forgeState.collectionAddress || !window.ethers.isAddress(forgeState.collectionAddress)) throw new Error('No forged V1 collection is loaded.');
    if (!runner) throw new Error('Connect the creator wallet first.');
    return new window.ethers.Contract(forgeState.collectionAddress, V1_COLLECTION_ABI, runner);
  }

  function parseOneOfOneAttributes(attributesJson) {
    if (!attributesJson) return { traitTypes: [], values: [] };
    let parsed;
    try { parsed = JSON.parse(attributesJson); }
    catch { throw new Error('Compiled 1/1 metadata JSON is invalid. Rebuild the collection in Step 4.'); }
    if (!Array.isArray(parsed)) throw new Error('Compiled 1/1 metadata must be an attribute array.');
    const traitTypes = [];
    const values = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const tt = String(row.trait_type ?? '').trim();
      const value = String(row.value ?? '').trim();
      if (!tt || !value) continue;
      traitTypes.push(tt);
      values.push(value);
    }
    if (traitTypes.length > 64) throw new Error('A V1 standalone 1/1 can have at most 64 custom metadata attributes.');
    return { traitTypes, values };
  }

  async function sendV1Step(label, call, steps, index) {
    steps[index].status = 'active';
    renderDeployProgress(steps);
    const tx = await call();
    steps[index].label = `${label}  -  ${tx.hash.slice(0,10)}...`;
    renderDeployProgress(steps);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`${label} transaction failed.`);
    steps[index].status = 'done';
    steps[index].label = label;
    renderDeployProgress(steps);
    return receipt;
  }

  function phaseScheduleFromInputs(startId, endId, label) {
    const parse = (id, field) => {
      const raw = String($(id)?.value || '').trim();
      if (!raw) return 0;
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error(`${label} ${field} date/time is invalid.`);
      const seconds = Math.floor(date.getTime() / 1000);
      if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error(`${label} ${field} date/time is outside the supported range.`);
      return seconds;
    };
    const startTime = parse(startId, 'start');
    const endTime = parse(endId, 'end');
    if (endTime && endTime <= startTime) throw new Error(`${label} end must be later than its start.`);
    return { startTime, endTime };
  }

  async function forgeCollection() {
    try {
      if (!forgeState.compiled) throw new Error('Compile the collection for onchain first.');
      if (currentRevealMode() !== forgeState.compiled.core.revealMode) throw new Error('Reveal mode changed after compilation. Recompile first.');
      if (!forgeState.signer) await connectWallet();

      const cfg = canonicalV1Config();
      const network = await forgeState.provider.getNetwork();
      if (Number(network.chainId) !== 11155111) throw new Error('Creator wallet must be connected to Ethereum Sepolia.');

      const c = forgeState.compiled;
      if (c.layerDefs.length < 1 || c.layerDefs.length > 64) throw new Error('V1 requires between 1 and 64 layers.');
      if (c.traits.some(t => Number(t.encodingCode) > 3)) throw new Error('V1 raw GIF trait encoding is unsupported. Convert GIF traits to animated WEBP or SVG and recompile.');

      const royaltyWallet = $('royaltyWallet')?.value.trim() || forgeState.wallet;
      const payoutWallet = $('payoutWallet')?.value.trim() || forgeState.wallet;
      if (!window.ethers.isAddress(royaltyWallet)) throw new Error('Royalty wallet is invalid.');
      if (!window.ethers.isAddress(payoutWallet)) throw new Error('Mint proceeds wallet is invalid.');

      const royaltyBps = Math.round(Number($('royalty')?.value || 0) * 100);
      if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 1000) throw new Error('Royalty must be between 0% and 10% in Studio.');

      const publicEnabled = !!$('publicMintEnabled')?.checked;
      const whitelistEnabled = !!$('whitelistEnabled')?.checked;
      if (whitelistEnabled && !forgeState.whitelist?.entries?.length) throw new Error('Build or snapshot the whitelist before forging.');

      const publicPrice = window.ethers.parseEther(String(Math.max(0, Number($('mintPrice')?.value || 0))));
      const whitelistPrice = window.ethers.parseEther(String(Math.max(0, Number($('whitelistMintPrice')?.value || 0))));
      const maxPerWallet = Math.max(0, Math.floor(Number($('maxPerWallet')?.value || 0)));
      if (maxPerWallet > 4294967295) throw new Error('Max mints per wallet is too large.');
      const publicSchedule = phaseScheduleFromInputs('publicMintStart', 'publicMintEnd', 'Public phase');
      const whitelistSchedule = phaseScheduleFromInputs('whitelistMintStart', 'whitelistMintEnd', 'Whitelist phase');
      const enabledSchedules = [
        ...(publicEnabled ? [publicSchedule] : []),
        ...(whitelistEnabled ? [whitelistSchedule] : []),
      ];
      // Auto-arming is safe only when every enabled phase has an explicit start.
      // Otherwise a startTime=0 phase would become live immediately when Master Mint
      // is armed for a different scheduled phase.
      const autoArmScheduledMint = enabledSchedules.length > 0 && enabledSchedules.every(schedule => schedule.startTime > 0);

      const holderRenderEnabled = !!$('holderRenderModeEnabled')?.checked;
      const defaultRenderMode = Number($('defaultRenderMode')?.value || 0);
      if (![0,1].includes(defaultRenderMode)) throw new Error('Default render mode is invalid.');
      if (defaultRenderMode === 1 && !window.RelicForgeCloud?.enabled?.()) throw new Error('Offchain rendering cannot be the default until RelicForge Cloud is configured.');

      const feeMode = currentPlatformFeeMode();
      const factory = new window.ethers.Contract(cfg.factory, V1_FACTORY_ABI, forgeState.signer);
      const [lockedFeeCents, upfrontFeeWei, oracleHealthy, feeActive] =
        await factory.quoteCollectionFeeTerms(c.recipeCount, feeMode);

      if (feeMode === V1_FEE_MODE_SPONSORED && Number(lockedFeeCents) > 0 && !oracleHealthy) {
        throw new Error('Sponsored collection creation requires a healthy live ETH/USD fee quote when the Sponsored rate is nonzero. Try again when the oracle is healthy.');
      }

      const vrfQuote = await refreshVrfQuote();
      if (!vrfQuote) throw new Error('Could not establish the initial Chainlink VRF credit quote.');

      const validationBatch = Math.max(1, Math.min(500, Math.floor(4096 / c.layerDefs.length)));
      const validationBatches = Math.ceil(c.recipeCount / validationBatch);
      const traitBatches = Math.ceil(c.traits.length / 30);
      const oneOfOneMetadataCount = (c.oneOfOneMetadataInputs || []).length;
      const phaseCount = (publicEnabled ? 1 : 0) + (whitelistEnabled ? 1 : 0);

      const steps = [
        { label: `Create V1 Collection + ProjectData  -  ${feeMode === V1_FEE_MODE_SPONSORED ? 'Sponsored' : 'Minter Supported'}`, status: 'pending' },
        ...c.artShards.map((_,i) => ({ label:`Write artwork shard ${i+1}/${c.artShards.length}`, status:'pending' })),
        { label:'Register layer names', status:'pending' },
        { label:'Configure metadata visibility', status:'pending' },
        ...(c.oneOfOneLayerIndex >= 0 ? [{ label:'Configure standalone 1/1 layer', status:'pending' }] : []),
        ...Array.from({length:oneOfOneMetadataCount},(_,i)=>({label:`Store 1/1 metadata ${i+1}/${oneOfOneMetadataCount}`,status:'pending'})),
        ...Array.from({length:traitBatches},(_,i)=>({label:`Register trait batch ${i+1}/${traitBatches}`,status:'pending'})),
        ...c.dnaShards.map((_,i)=>({label:`Write DNA shard ${i+1}/${c.dnaShards.length}`,status:'pending'})),
        { label:'Configure DNA', status:'pending' },
        { label:'Store forging placeholder', status:'pending' },
        { label:'Configure renderer policy', status:'pending' },
        ...Array.from({length:validationBatches},(_,i)=>({label:`Validate recipe batch ${i+1}/${validationBatches}`,status:'pending'})),
        { label:'Seal immutable collection content', status:'pending' },
        { label:'Set future reveal mode', status:'pending' },
        { label:`Fund ${vrfQuote.requests} Chainlink VRF request credits`, status:'pending' },
        ...Array.from({length:phaseCount},(_,i)=>({label:`Create mint phase ${i+1}/${phaseCount}`,status:'pending'})),
        ...(autoArmScheduledMint ? [{ label:'Arm scheduled Master Mint', status:'pending' }] : []),
      ];

      renderDeployProgress(steps);
      let si = 0;

      // Create the two creator-owned V1 clones through the canonical factory.
      steps[si].status = 'active';
      renderDeployProgress(steps);
      const createTx = await factory.createCollectionWithFeeMode(
        c.core.name,
        c.core.symbol,
        c.core.description,
        c.recipeCount,
        c.core.canvas[0],
        c.core.canvas[1],
        c.layerDefs.length,
        payoutWallet,
        royaltyWallet,
        royaltyBps,
        feeMode,
        { value: feeMode === V1_FEE_MODE_SPONSORED ? upfrontFeeWei : 0n }
      );
      steps[si].label = `${steps[si].label}  -  ${createTx.hash.slice(0,10)}...`;
      renderDeployProgress(steps);
      const createReceipt = await createTx.wait();
      if (createReceipt.status !== 1) throw new Error('V1 collection creation transaction failed.');

      let collectionAddress = null;
      let dataAddress = null;
      for (const entry of createReceipt.logs) {
        try {
          const parsed = factory.interface.parseLog(entry);
          if (parsed?.name === 'CollectionCreated') {
            collectionAddress = parsed.args.collection;
            dataAddress = parsed.args.projectData;
            break;
          }
        } catch (_) {}
      }
      if (!collectionAddress || !dataAddress) throw new Error('CollectionCreated event did not include both V1 clone addresses.');

      forgeState.collectionAddress = window.ethers.getAddress(collectionAddress);
      forgeState.dataAddress = window.ethers.getAddress(dataAddress);
      forgeState.publicPhaseId = null;
      forgeState.whitelistPhaseId = null;
      forgeState.masterMintArmed = false;

      steps[si].status = 'done';
      steps[si].label = 'Create V1 Collection + ProjectData';
      si++;
      renderDeployProgress(steps);

      $('forgedCollectionAddress').textContent = forgeState.collectionAddress;
      $('forgedEtherscanLink').href = `https://sepolia.etherscan.io/address/${forgeState.collectionAddress}`;
      $('forgeResult').classList.remove('hidden');
      if ($('viewerCollectionAddress')) $('viewerCollectionAddress').value = forgeState.collectionAddress;

      const data = v1ProjectDataContract();
      const collection = collectionContract();

      const artPointers = [];
      for (let i=0;i<c.artShards.length;i++,si++) {
        await sendV1Step(`Write artwork shard ${i+1}/${c.artShards.length}`, () => data.addArtShard(window.ethers.hexlify(c.artShards[i])), steps, si);
        artPointers[i] = await data.artShards(i);
      }

      await sendV1Step('Register layer names', () => data.setLayerNames(c.layerDefs.map(layer=>layer.name)), steps, si++);
      await sendV1Step('Configure metadata visibility', () => data.setLayerMetadataVisibility(c.layerDefs.map(layer=>!!layer.metadataHidden)), steps, si++);

      if (c.oneOfOneLayerIndex >= 0) {
        await sendV1Step('Configure standalone 1/1 layer', () => data.setOneOfOneLayer(c.oneOfOneLayerIndex), steps, si++);
      }

      for (let i=0;i<(c.oneOfOneMetadataInputs||[]).length;i++,si++) {
        const row = c.oneOfOneMetadataInputs[i];
        const attrs = parseOneOfOneAttributes(row[3]);
        await sendV1Step(
          `Store 1/1 metadata ${i+1}/${c.oneOfOneMetadataInputs.length}`,
          () => data.setOneOfOneMetadata(row[0], row[1], row[2], attrs.traitTypes, attrs.values),
          steps,
          si
        );
      }

      for (let start=0,batch=1;start<c.traits.length;start+=30,batch++,si++) {
        const items = c.traits.slice(start,start+30);
        const inputs = items.map(t => {
          const pointer = artPointers[Number(t.shard)];
          if (!pointer) throw new Error(`Artwork pointer missing for ${t.layerName} / ${t.name}.`);
          return [t.layerIndex, t.traitIndex, t.name, pointer, t.offset, t.length, t.encodingCode, !!t.metadataHidden];
        });
        await sendV1Step(`Register trait batch ${batch}/${traitBatches}`, () => data.addTraits(inputs), steps, si);
      }

      for (let i=0;i<c.dnaShards.length;i++,si++) {
        await sendV1Step(`Write DNA shard ${i+1}/${c.dnaShards.length}`, () => data.addDnaShard(window.ethers.hexlify(c.dnaShards[i])), steps, si);
      }

      await sendV1Step('Configure DNA', () => data.setDNAConfig(c.recipeCount, c.recipesPerShard), steps, si++);
      await sendV1Step('Store forging placeholder', () => data.setPlaceholder(window.ethers.hexlify(c.placeholderBytes)), steps, si++);

      const renderHost = String(window.RELICFORGE_CONFIG?.renderBase || window.RelicForgeCloud?.apiBase?.() || '').replace(/\/$/,'');
      const renderBase = renderHost ? `${renderHost}/api/public/render/11155111/${forgeState.collectionAddress}/` : '';
      await sendV1Step('Configure renderer policy', () => collection.setRenderConfig(renderBase, holderRenderEnabled && !!renderBase, defaultRenderMode), steps, si++);

      let remaining = c.recipeCount;
      for (let batch=1;remaining>0;batch++,si++) {
        const quantity = Math.min(validationBatch, remaining);
        await sendV1Step(`Validate recipe batch ${batch}/${validationBatches}`, () => data.validateNextRecipes(quantity), steps, si);
        remaining -= quantity;
      }

      await sendV1Step('Seal immutable collection content', () => data.sealContent(c.provenance), steps, si++);

      // UI: 0 Forge Reveal, 1 Deferred. Contract: 1 Forge, 0 Deferred.
      const contractRevealMode = currentRevealMode() === 0 ? 1 : 0;
      await sendV1Step('Set future reveal mode', () => collection.setFutureRevealMode(contractRevealMode), steps, si++);

      const randomness = v1RandomnessContract(forgeState.signer);
      await sendV1Step(
        `Fund ${vrfQuote.requests} Chainlink VRF request credits`,
        () => randomness.fundConsumer(forgeState.collectionAddress, { value: vrfQuote.funded }),
        steps,
        si++
      );

      let nextPhaseId = 1;
      if (publicEnabled) {
        forgeState.publicPhaseId = nextPhaseId++;
        await sendV1Step(
          'Create public mint phase',
          () => collection.createPhase(publicPrice, publicSchedule.startTime, publicSchedule.endTime, 0, maxPerWallet, window.ethers.ZeroHash, 0, 100, true),
          steps,
          si++
        );
      }

      if (whitelistEnabled) {
        forgeState.whitelistPhaseId = nextPhaseId++;
        const sourceMeta = forgeState.whitelist;
        const finalTree = buildMerkleWhitelistV1(sourceMeta.entries, forgeState.collectionAddress, forgeState.whitelistPhaseId);
        forgeState.whitelist = { ...sourceMeta, ...finalTree, root:finalTree.root, proofByAddress:finalTree.proofByAddress };
        renderWhitelistSummary();
        if ($('whitelistStatus')) $('whitelistStatus').textContent =
          `OK V1 whitelist bound to ${shortAddr(forgeState.collectionAddress)}  -  phase ${forgeState.whitelistPhaseId}  -  ${finalTree.entries.length.toLocaleString()} wallets`;

        await sendV1Step(
          'Create whitelist mint phase',
          () => collection.createPhase(whitelistPrice, whitelistSchedule.startTime, whitelistSchedule.endTime, 0, 0, finalTree.root, 1, 200, true),
          steps,
          si++
        );
      }

      if (autoArmScheduledMint) {
        await sendV1Step('Arm scheduled Master Mint', () => collection.setMasterMintEnabled(true), steps, si++);
        forgeState.masterMintArmed = true;
      }

      const masterMintEnabled = Boolean(await collection.masterMintEnabled());
      if (autoArmScheduledMint && !masterMintEnabled) throw new Error('V1 schedule safety check failed: scheduled Master Mint was not enabled.');
      if (!autoArmScheduledMint && masterMintEnabled) throw new Error('V1 safety check failed: unscheduled collection master mint was unexpectedly enabled.');
      const publicPhaseOpen = forgeState.publicPhaseId ? Boolean(await collection.phaseIsOpen(forgeState.publicPhaseId)) : false;
      const whitelistPhaseOpen = forgeState.whitelistPhaseId ? Boolean(await collection.phaseIsOpen(forgeState.whitelistPhaseId)) : false;

      if ($('forgeArmMintBtn')) {
        $('forgeArmMintBtn').disabled = masterMintEnabled;
        $('forgeArmMintBtn').textContent = masterMintEnabled ? 'Master Mint Enabled (Scheduled)' : 'Enable Master Mint';
      }
      if ($('forgeMintTestBtn')) $('forgeMintTestBtn').disabled = !publicPhaseOpen;
      if ($('forgeWhitelistMintBtn')) $('forgeWhitelistMintBtn').disabled = !whitelistPhaseOpen;
      if ($('forgeCreatorMintBtn')) $('forgeCreatorMintBtn').disabled = false;
      if ($('forgeDeferredRevealBtn')) $('forgeDeferredRevealBtn').disabled = currentRevealMode() !== 1;
      if ($('forgeProcessRevealBtn')) $('forgeProcessRevealBtn').disabled = false;
      if ($('forgeInspectBtn')) $('forgeInspectBtn').disabled = false;

      const rc47bMintPageReady = !!window.RelicForgeCloud?.__rc47bPublishWrapped;
      if ($('openMintPageBtn')) $('openMintPageBtn').disabled = !rc47bMintPageReady;
      if ($('publishMintPageBtn')) $('publishMintPageBtn').disabled = !rc47bMintPageReady || !window.RelicForgeCloud?.enabled?.();
      if ($('downloadMintPageBtn')) $('downloadMintPageBtn').disabled = !rc47bMintPageReady;
      if ($('mintPageStatus')) $('mintPageStatus').textContent = rc47bMintPageReady
        ? 'Canonical V1 mint-page adapter ready. Registering this forged collection with RelicForge Cloud…'
        : 'V1 collection forged. Open the Creator Dashboard to recover/register this collection if the mint-page adapter is unavailable.';

      if (rc47bMintPageReady && window.RelicForgeCloud?.enabled?.() && (forgeState.publicPhaseId || forgeState.whitelistPhaseId)) {
        try {
          await publishMintPageCloud(forgeState.collectionAddress);
          if ($('mintPageStatus')) $('mintPageStatus').textContent =
            '✓ Canonical V1 mint page registered with RelicForge Cloud. Upcoming Mints settings were published if enabled.';
        } catch (registrationError) {
          if ($('mintPageStatus')) $('mintPageStatus').textContent =
            `V1 collection forged, but Cloud registration did not complete: ${registrationError.message}. The Creator Dashboard can recover this collection from the canonical factory without redeploying it.`;
        }
      }

      log(
        'forgeTestStatus',
        `OK Canonical V1 collection forged.\nCollection: ${forgeState.collectionAddress}\nProjectData: ${forgeState.dataAddress}\nPlatform fee: ${feeMode === V1_FEE_MODE_SPONSORED ? 'Sponsored' : 'Minter Supported'}  -  base ${Number(lockedFeeCents)/100} USD/NFT\nVRF credit funded: ${window.ethers.formatEther(vrfQuote.funded)} ETH\nMaster mint: ${masterMintEnabled ? 'ON (scheduled phase timestamps still enforced)' : 'OFF (manual enable required)'}`,
        true
      );

      bridge().showStatus?.(
        masterMintEnabled
          ? 'Canonical V1 collection forged on Sepolia. Scheduled phases are armed and will open only at their onchain start times.'
          : 'Canonical V1 collection forged on Sepolia. Master mint remains OFF.',
        'success'
      );
    } catch (error) {
      const partial = forgeState.collectionAddress ? `\nPartial V1 collection: ${forgeState.collectionAddress}` : '';
      log('forgeTestStatus', `FORGE ERROR: ${error.shortMessage || error.message}${partial}`, true);
      if (forgeState.collectionAddress) {
        bridge().showStatus?.('Forge stopped after the V1 collection was created. Do not forge a duplicate; keep the displayed collection address for troubleshooting.', 'error');
      }
    }
  }

  function requestedMintQuantity() {
    const quantity = Math.floor(Number($('forgeMintQuantity')?.value || 1));
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) throw new Error('V1 mint quantity must be between 1 and 50.');
    return quantity;
  }

  async function armMasterMint() {
    try {
      const collection = collectionContract();
      log('forgeTestStatus','Enabling master mint...',true);
      const tx = await collection.setMasterMintEnabled(true);
      await tx.wait();
      forgeState.masterMintArmed = true;
      if ($('forgeArmMintBtn')) { $('forgeArmMintBtn').disabled = true; $('forgeArmMintBtn').textContent = 'Master Mint Enabled'; }
      if ($('forgeMintTestBtn')) $('forgeMintTestBtn').disabled = !forgeState.publicPhaseId;
      if ($('forgeWhitelistMintBtn')) $('forgeWhitelistMintBtn').disabled = !forgeState.whitelistPhaseId;
      log('forgeTestStatus','OK Master mint enabled. Enabled phases may now mint.');
    } catch (error) {
      log('forgeTestStatus',`MASTER MINT ERROR: ${error.shortMessage || error.message}`,true);
    }
  }

  async function mintTest() {
    try {
      if (!forgeState.publicPhaseId) throw new Error('This project did not create a public V1 mint phase.');
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      const quote = await collection.quoteMint(forgeState.publicPhaseId, quantity);
      const minimumValue = quote.minimumValue ?? quote[2];
      log('forgeTestStatus',`Public minting ${quantity} through phase ${forgeState.publicPhaseId}...`,true);
      const tx = await collection.mint(forgeState.publicPhaseId, quantity, 0, [], { value: minimumValue });
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      log('forgeTestStatus',`OK Minted ${tokenIds.length || quantity} token(s). ${currentRevealMode() === 0 ? 'Chainlink VRF request submitted; process after callback fulfillment.' : 'Tokens are deferred until you request an epoch.'}`);
    } catch (error) {
      log('forgeTestStatus',`MINT ERROR: ${error.shortMessage || error.message}`,true);
    }
  }

  async function whitelistMintTest() {
    try {
      if (!forgeState.whitelistPhaseId) throw new Error('This project did not create a whitelist V1 mint phase.');
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      if (!forgeState.wallet) await connectWallet();
      const entry = forgeState.whitelist?.proofByAddress?.[forgeState.wallet.toLowerCase()];
      if (!entry) throw new Error('Connected wallet is not eligible for the final V1 whitelist phase.');
      const quote = await collection.quoteMint(forgeState.whitelistPhaseId, quantity);
      const minimumValue = quote.minimumValue ?? quote[2];
      log('forgeTestStatus',`Whitelist minting ${quantity} through phase ${forgeState.whitelistPhaseId} with allowance ${entry.allowance}...`,true);
      const tx = await collection.mint(forgeState.whitelistPhaseId, quantity, entry.allowance, entry.proof, { value: minimumValue });
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const logEntry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(logEntry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      log('forgeTestStatus',`OK Whitelist minted ${tokenIds.length || quantity} token(s).`);
    } catch (error) {
      log('forgeTestStatus',`WHITELIST MINT ERROR: ${error.shortMessage || error.message}`,true);
    }
  }

  async function creatorMintTest() {
    try {
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      if (!forgeState.wallet) await connectWallet();
      log('forgeTestStatus',`Creator minting ${quantity} token(s) to ${shortAddr(forgeState.wallet)}...`,true);
      const tx = await collection.creatorMint(forgeState.wallet, quantity);
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      log('forgeTestStatus',`OK Creator minted ${tokenIds.length || quantity} token(s). Creator mint bypasses public phase price/allowance and platform minter fee.`);
    } catch (error) {
      log('forgeTestStatus',`CREATOR MINT ERROR: ${error.shortMessage || error.message}`,true);
    }
  }

  async function requestDeferredReveal() {
    try {
      if (currentRevealMode() !== 1) throw new Error('This Studio project uses Forge Reveal, not Deferred Reveal.');
      const collection = collectionContract();
      log('forgeTestStatus','Requesting deferred reveal epoch from Chainlink VRF...',true);
      const tx = await collection.requestRevealEpoch();
      const receipt = await tx.wait();
      let requestId = null;
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'RevealRequested') requestId = parsed.args.requestId;
        } catch (_) {}
      }
      log('forgeTestStatus',`OK Deferred epoch requested${requestId != null ? `  -  request ${requestId}` : ''}. Wait for the Chainlink callback, then click Process Ready Reveal.`);
    } catch (error) {
      log('forgeTestStatus',`DEFERRED REVEAL ERROR: ${error.shortMessage || error.message}`,true);
    }
  }

  async function processReadyReveal() {
    try {
      const collection = collectionContract();
      log('forgeTestStatus','Processing up to 50 ready reveal steps...',true);
      const tx = await collection.processReveal(50);
      await tx.wait();
      log('forgeTestStatus','OK Reveal processing transaction confirmed. Inspect a token; if it is still forging, the VRF callback may not be fulfilled yet or additional processing may be needed.');
    } catch (error) {
      log('forgeTestStatus',`PROCESS REVEAL ERROR: ${error.shortMessage || error.message}`,true);
    }
  }
  function decodeDataUri(uri) {
    const comma = uri.indexOf(',');
    if (comma < 0) return uri;
    const header = uri.slice(0, comma);
    const payload = uri.slice(comma + 1);
    return /;base64/i.test(header) ? atob(payload) : decodeURIComponent(payload);
  }

  async function inspectToken() {
    try {
      if (!forgeState.collectionAddress) return;
      const collection = collectionContract();
      const tokenId = BigInt(Math.max(1, Number.parseInt($('forgeInspectTokenId').value || '1', 10) || 1));
      const uri = await collection.tokenURI(tokenId);
      const jsonText = decodeDataUri(uri);
      const metadata = JSON.parse(jsonText);
      log('forgeTestStatus', `tokenURI(${tokenId})\n${JSON.stringify(metadata, null, 2)}`, true);
      const preview = $('forgeTokenPreview');
      preview.classList.remove('hidden');
      preview.innerHTML = `<div class="forge-preview-image"></div><div><strong>${esc(metadata.name || `Token #${tokenId}`)}</strong><small>${esc(metadata.description || '')}</small><div class="forge-preview-traits">${(metadata.attributes || []).map(a => `<span>${esc(a.trait_type)}: ${esc(a.value)}</span>`).join('')}</div></div>`;
      if (metadata.image?.startsWith('data:image/svg+xml')) {
        preview.querySelector('.forge-preview-image').innerHTML = decodeDataUri(metadata.image);
      }
    } catch (error) {
      log('forgeTestStatus', `INSPECT: ${error.message}`, true);
    }
  }

  function setViewerMetric(id, value) { const node = $(id); if (node) node.textContent = value; }

  function viewerAddressInput() { return $('viewerCollectionAddress')?.value.trim() || forgeState.collectionAddress || ''; }

  async function viewerContract() {
    await compileContracts();
    const address = viewerAddressInput();
    if (!window.ethers.isAddress(address)) throw new Error('Enter a valid Sepolia collection address.');
    forgeState.viewerAddress = address;
    const runner = readProvider(11155111) || forgeState.provider;
    if (!runner) throw new Error('No Sepolia read provider is available. Configure RelicForge Cloud/Alchemy or connect a wallet.');
    return new window.ethers.Contract(address, forgeState.contractArtifacts.RelicCollectionV2.abi, runner);
  }

  async function loadViewerCollection(resetPage = true) {
    try {
      const collection = await viewerContract();
      const [name, symbol, description, owner, totalMinted, maxSupply, revealMode] = await Promise.all([
        collection.name(),
        collection.symbol(),
        collection.description(),
        collection.owner(),
        collection.totalMinted(),
        collection.maxSupply(),
        collection.revealMode(),
      ]);
      forgeState.viewerMeta = {
        name, symbol, description, owner,
        totalMinted: Number(totalMinted),
        maxSupply: Number(maxSupply),
        revealMode: Number(revealMode),
      };
      forgeState.viewerTotalMinted = Number(totalMinted);
      if (resetPage) forgeState.viewerPage = 1;
      setViewerMetric('viewerMetricName', name || '—');
      setViewerMetric('viewerMetricSymbol', symbol || '—');
      setViewerMetric('viewerMetricMinted', String(Number(totalMinted)));
      setViewerMetric('viewerMetricSupply', String(Number(maxSupply)));
      setViewerMetric('viewerMetricReveal', Number(revealMode) === 0 ? 'Forge' : 'Creator');
      setViewerMetric('viewerMetricOwner', shortAddr(owner));
      const links = $('viewerLinks');
      if (links) links.classList.remove('hidden');
      const eLink = $('viewerEtherscanLink');
      if (eLink) eLink.href = `https://sepolia.etherscan.io/address/${forgeState.viewerAddress}`;
      const metaBox = $('viewerCollectionMeta');
      if (metaBox) {
        metaBox.classList.remove('hidden');
        metaBox.innerHTML = `<strong>${esc(name)}</strong><br>${esc(description || 'No description.')}<br><br>Collection: <code>${esc(forgeState.viewerAddress)}</code>`;
      }
      $('viewerStatus').textContent = `Loaded ${name} on Sepolia.`;
      await renderViewerPage();
    } catch (error) {
      $('viewerStatus').textContent = `Viewer error: ${error.message}`;
      $('viewerGrid').innerHTML = `<div class="forge-market-empty">${esc(error.message)}</div>`;
    }
  }

  async function renderViewerPage() {
    const grid = $('viewerGrid');
    if (!grid) return;
    const total = forgeState.viewerTotalMinted || 0;
    if (!forgeState.viewerAddress) {
      grid.innerHTML = '<div class="forge-market-empty">Deploy or enter a collection address to browse the Sepolia collection.</div>';
      $('viewerPagination')?.classList.add('hidden');
      $('viewerPagerStatus')?.classList.add('hidden');
      return;
    }
    if (total <= 0) {
      grid.innerHTML = '<div class="forge-market-empty">No NFTs have been minted yet. Mint a test NFT to populate the marketplace viewer.</div>';
      $('viewerPagination')?.classList.add('hidden');
      $('viewerPagerStatus')?.classList.add('hidden');
      return;
    }
    const pageSize = forgeState.viewerPageSize;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (forgeState.viewerPage > pageCount) forgeState.viewerPage = pageCount;
    if (forgeState.viewerPage < 1) forgeState.viewerPage = 1;
    const start = (forgeState.viewerPage - 1) * pageSize + 1;
    const end = Math.min(total, start + pageSize - 1);
    $('viewerStatus').textContent = `Loading tokens ${start}-${end} from ${forgeState.viewerMeta?.name || shortAddr(forgeState.viewerAddress)}…`;
    grid.innerHTML = '<div class="forge-market-empty">Loading token metadata from Sepolia…</div>';
    const collection = await viewerContract();
    const tokenIds = []; for (let i=start; i<=end; i++) tokenIds.push(i);
    const cards = await Promise.all(tokenIds.map(async (tokenId) => {
      try {
        const [uri, owner] = await Promise.all([collection.tokenURI(tokenId), collection.ownerOf(tokenId)]);
        const metadata = JSON.parse(decodeDataUri(uri));
        const image = metadata.image?.startsWith('data:image/svg+xml') ? decodeDataUri(metadata.image) : '';
        const revealed = Array.isArray(metadata.attributes) && metadata.attributes.length > 0;
        const traits = (metadata.attributes || []).map(a => `<span>${esc(a.trait_type)}: ${esc(a.value)}</span>`).join('');
        return `
          <article class="forge-market-card">
            <div class="forge-market-thumb">${image || '<div class="forge-market-empty">No preview</div>'}</div>
            <div class="forge-market-body">
              <div class="forge-market-topline"><strong>${esc(metadata.name || `Token #${tokenId}`)}</strong><span>#${tokenId}</span></div>
              <div class="forge-market-owner">Owner: ${esc(shortAddr(owner))}</div>
              <div class="forge-market-state">${revealed ? 'Revealed' : 'Placeholder'}</div>
              <div class="forge-market-traits">${traits || '<span>Unrevealed</span>'}</div>
            </div>
          </article>`;
      } catch (error) {
        return `
          <article class="forge-market-card">
            <div class="forge-market-thumb"><div class="forge-market-empty">Token #${tokenId}</div></div>
            <div class="forge-market-body">
              <div class="forge-market-topline"><strong>Token #${tokenId}</strong><span>Error</span></div>
              <div class="forge-market-owner">${esc(error.message)}</div>
            </div>
          </article>`;
      }
    }));
    grid.innerHTML = cards.join('');
    const pager = $('viewerPagination');
    const pagerStatus = $('viewerPagerStatus');
    if (pager) pager.classList.remove('hidden');
    if (pagerStatus) { pagerStatus.classList.remove('hidden'); pagerStatus.textContent = `Showing tokens ${start}-${end} of ${total} · Page ${forgeState.viewerPage} of ${pageCount}`; }
    if ($('viewerPrevBtn')) $('viewerPrevBtn').disabled = forgeState.viewerPage <= 1;
    if ($('viewerNextBtn')) $('viewerNextBtn').disabled = forgeState.viewerPage >= pageCount;
    $('viewerStatus').textContent = `Loaded ${end - start + 1} token${end - start + 1 === 1 ? '' : 's'} from ${forgeState.viewerMeta?.name || shortAddr(forgeState.viewerAddress)}.`;
  }

  async function readViewerContractUri() {
    try {
      const collection = await viewerContract();
      const uri = await collection.contractURI();
      const jsonText = decodeDataUri(uri);
      const metadata = JSON.parse(jsonText);
      log('forgeTestStatus', `contractURI()\n${JSON.stringify(metadata, null, 2)}`, true);
    } catch (error) {
      log('forgeTestStatus', `CONTRACT URI: ${error.message}`, true);
    }
  }


  function rememberFactory(address) {
    if (!window.ethers?.isAddress(address || '')) return;
    try {
      const current = JSON.parse(localStorage.getItem(FACTORY_REGISTRY_KEY) || '[]');
      const next = [...new Set([...current, window.ethers.getAddress(address)])];
      localStorage.setItem(FACTORY_REGISTRY_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  function knownFactories() {
    const out = [];
    const push = value => {
      if (!window.ethers?.isAddress(value || '')) return;
      const normalized = window.ethers.getAddress(value);
      if (!out.some(x => x.toLowerCase() === normalized.toLowerCase())) out.push(normalized);
    };
    try { (JSON.parse(localStorage.getItem(FACTORY_REGISTRY_KEY) || '[]') || []).forEach(push); } catch (_) {}
    try { push(canonicalV1Config().factory); } catch (_) {}
    push(forgeState.infra?.factory);
    push($('factoryAddress')?.value.trim());
    push($('launchedFactoryInput')?.value.trim());
    return out;
  }

  function manualLaunchKey() {
    return `${MANUAL_LAUNCH_KEY_PREFIX}_${String(forgeState.wallet || '').toLowerCase()}`;
  }

  function manualLaunches() {
    if (!forgeState.wallet) return [];
    try { return JSON.parse(localStorage.getItem(manualLaunchKey()) || '[]') || []; }
    catch (_) { return []; }
  }

  function rememberManualLaunch(address) {
    if (!forgeState.wallet || !window.ethers.isAddress(address || '')) return;
    try {
      const current = manualLaunches();
      const normalized = window.ethers.getAddress(address);
      const next = [...new Set([...current, normalized])];
      localStorage.setItem(manualLaunchKey(), JSON.stringify(next));
    } catch (_) {}
  }

  function launchedModal(open) {
    const modal = $('launchedDashboardModal');
    if (!modal) return;
    modal.classList.toggle('hidden', !open);
    document.body.classList.toggle('modal-open', !!open);
  }

  async function openLaunchedDashboard() {
    launchedModal(true);
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = 'Connect your creator wallet to rediscover launched collections.';
    try {
      await connectWallet();
      await loadLaunchedProjects();
    } catch (error) {
      if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`;
    }
  }

  async function legacyCollectionDashboardSnapshot(address, runner) {
    const c = new window.ethers.Contract(address, COLLECTION_DASHBOARD_ABI, runner);
    const [name, symbol, description, owner, maxSupply, totalMinted, mintPrice, maxPerWallet, publicEnabled, whitelistEnabled, root, whitelistPrice, sourceContract, sourceChainId, snapshotBlock, sourceType, royaltyReceiver, royaltyBps, revealMode, creatorRevealSeed, finalized, sealed, provenance, holderRenderEnabled, defaultRenderMode, flattenedRenderBaseURI] = await Promise.all([
      c.name(), c.symbol(), c.description(), c.owner(), c.maxSupply(), c.totalMinted(), c.mintPrice(), c.maxPerWallet(), c.publicMintEnabled(), c.whitelistMintEnabled(), c.whitelistRoot(), c.whitelistMintPrice(),
      c.whitelistSourceContract(), c.whitelistSourceChainId(), c.whitelistSnapshotBlock(), c.whitelistSourceType(), c.royaltyReceiver(), c.royaltyBps(), c.revealMode(), c.creatorRevealSeed(), c.dataFinalized(), c.isSealed(), c.provenanceHash(),
      c.holderRenderModeEnabled().catch(() => false), c.defaultRenderMode().catch(() => 0n), c.flattenedRenderBaseURI().catch(() => '')
    ]);
    return {
      isV1: false,
      address, name, symbol, description, owner,
      maxSupply: Number(maxSupply), totalMinted: Number(totalMinted), mintPrice, maxPerWallet: Number(maxPerWallet),
      publicEnabled, whitelistEnabled, root, whitelistPrice, sourceContract, sourceChainId: Number(sourceChainId), snapshotBlock: Number(snapshotBlock), sourceType: Number(sourceType),
      royaltyReceiver, royaltyBps: Number(royaltyBps), revealMode: Number(revealMode), creatorRevealSeed: BigInt(creatorRevealSeed), finalized, sealed, provenance,
      holderRenderEnabled: Boolean(holderRenderEnabled), defaultRenderMode: Number(defaultRenderMode), flattenedRenderBaseURI,
    };
  }

  async function collectionDashboardSnapshot(address, runner = readProvider(11155111) || forgeState.provider) {
    const v1 = new window.ethers.Contract(address, V1_COLLECTION_ABI, runner);
    try {
      const creator = await v1.creator();
      const [
        name, symbol, description, controller, dataAddress, payoutReceiver, royaltyReceiver, royaltyBps,
        maxSupply, totalMinted, masterMintEnabled, futureRevealMode, phaseCount,
        deferredPendingCount, nextRequestSequence, nextProcessSequence, nextEpochStartToken,
        holderRenderEnabled, defaultRenderMode, flattenedRenderBaseURI
      ] = await Promise.all([
        v1.name(), v1.symbol(), v1.description(), v1.controller(), v1.dataContract(), v1.payoutReceiver(), v1.royaltyReceiver(), v1.royaltyBps(),
        v1.maxSupply(), v1.totalMinted(), v1.masterMintEnabled(), v1.futureRevealMode(), v1.phaseCount(),
        v1.deferredPendingCount().catch(() => 0n), v1.nextRequestSequence().catch(() => 1n), v1.nextProcessSequence().catch(() => 1n), v1.nextEpochStartToken().catch(() => 1n),
        v1.holderRenderModeEnabled().catch(() => false), v1.defaultRenderMode().catch(() => 0n), v1.flattenedRenderBaseURI().catch(() => '')
      ]);

      const totalPhases = Number(phaseCount);
      if (!Number.isSafeInteger(totalPhases) || totalPhases < 0) throw new Error('Invalid V1 phaseCount response.');
      const scanCount = Math.min(totalPhases, 500);
      const phases = [];
      for (let start = 1; start <= scanCount; start += 25) {
        const ids = Array.from({ length: Math.min(25, scanCount - start + 1) }, (_, i) => start + i);
        const rows = await Promise.all(ids.map(async id => {
          const raw = await v1.phases(id);
          let open = false;
          try { open = Boolean(await v1.phaseIsOpen(id)); } catch (_) {}
          return {
            id,
            price: BigInt(raw.price ?? raw[0] ?? 0n),
            startTime: Number(raw.startTime ?? raw[1] ?? 0n),
            endTime: Number(raw.endTime ?? raw[2] ?? 0n),
            phaseSupply: Number(raw.phaseSupply ?? raw[3] ?? 0n),
            minted: Number(raw.minted ?? raw[4] ?? 0n),
            maxPerWallet: Number(raw.maxPerWallet ?? raw[5] ?? 0n),
            merkleRoot: String(raw.merkleRoot ?? raw[6] ?? window.ethers.ZeroHash),
            accessType: Number(raw.accessType ?? raw[7] ?? 0n),
            priority: Number(raw.priority ?? raw[8] ?? 0n),
            enabled: Boolean(raw.enabled ?? raw[9] ?? false),
            open,
          };
        }));
        phases.push(...rows);
      }

      const publicPhases = phases.filter(phase => phase.accessType === 0);
      const whitelistPhases = phases.filter(phase => phase.accessType === 1);
      const preferred = rows => [...rows].sort((a, b) =>
        Number(b.open) - Number(a.open) ||
        Number(b.enabled) - Number(a.enabled) ||
        b.priority - a.priority ||
        a.id - b.id
      )[0] || null;
      const publicPhase = preferred(publicPhases);
      const whitelistPhase = preferred(whitelistPhases);

      const deferredPending = Number(deferredPendingCount);
      const nextRequest = Number(nextRequestSequence);
      const nextProcess = Number(nextProcessSequence);
      const nextEpochStart = Number(nextEpochStartToken);
      const revealQueuePending = Math.max(0, nextRequest - nextProcess);
      let nextReveal = null;
      if (revealQueuePending > 0) {
        try {
          const raw = await v1.revealRequests(nextProcessSequence);
          nextReveal = {
            sequence: nextProcess,
            kind: Number(raw.kind ?? raw[0] ?? 0n),
            startTokenId: Number(raw.startTokenId ?? raw[1] ?? 0n),
            endTokenId: Number(raw.endTokenId ?? raw[2] ?? 0n),
            cursor: Number(raw.cursor ?? raw[3] ?? 0n),
            fulfilled: Boolean(raw.fulfilled ?? raw[5] ?? false),
          };
        } catch (_) {}
      }
      const deferredRequestable = deferredPending > 0 && nextEpochStart <= Number(totalMinted);
      let contentSealed = false;
      let provenance = window.ethers.ZeroHash;
      try {
        const data = new window.ethers.Contract(dataAddress, V1_PROJECT_DATA_ABI, runner);
        [contentSealed, provenance] = await Promise.all([data.contentSealed(), data.provenanceHash()]);
      } catch (_) {}

      const controllerActive = String(controller).toLowerCase() !== window.ethers.ZeroAddress.toLowerCase();
      return {
        isV1: true,
        address: window.ethers.getAddress(address),
        name, symbol, description,
        owner: window.ethers.getAddress(creator),
        creator: window.ethers.getAddress(creator),
        controller: window.ethers.getAddress(controller),
        controllerActive,
        dataAddress: window.ethers.getAddress(dataAddress),
        payoutReceiver: window.ethers.getAddress(payoutReceiver),
        maxSupply: Number(maxSupply),
        totalMinted: Number(totalMinted),
        masterMintEnabled: Boolean(masterMintEnabled),
        futureRevealMode: Number(futureRevealMode),
        deferredPendingCount: deferredPending,
        deferredRequestable,
        revealQueuePending,
        nextReveal,
        nextEpochStartToken: nextEpochStart,
        phaseCount: totalPhases,
        phases,
        phasesTruncated: totalPhases > scanCount,
        publicPhases,
        whitelistPhases,
        publicPhaseId: publicPhase?.id || null,
        whitelistPhaseId: whitelistPhase?.id || null,
        publicPhase,
        whitelistPhase,
        mintPrice: publicPhase?.price || 0n,
        maxPerWallet: publicPhase?.maxPerWallet || 0,
        publicEnabled: Boolean(publicPhase?.enabled),
        whitelistEnabled: Boolean(whitelistPhase?.enabled),
        root: whitelistPhase?.merkleRoot || window.ethers.ZeroHash,
        whitelistPrice: whitelistPhase?.price || 0n,
        sourceContract: window.ethers.ZeroAddress,
        sourceChainId: 0,
        snapshotBlock: 0,
        sourceType: 0,
        royaltyReceiver: window.ethers.getAddress(royaltyReceiver),
        royaltyBps: Number(royaltyBps),
        revealMode: Number(futureRevealMode) === 1 ? 0 : 1,
        creatorRevealSeed: 0n,
        finalized: Boolean(contentSealed),
        sealed: Boolean(contentSealed),
        contentSealed: Boolean(contentSealed),
        provenance,
        holderRenderEnabled: Boolean(holderRenderEnabled),
        defaultRenderMode: Number(defaultRenderMode),
        flattenedRenderBaseURI,
      };
    } catch (v1Error) {
      try {
        return await legacyCollectionDashboardSnapshot(address, runner);
      } catch (_) {
        throw v1Error;
      }
    }
  }

  async function loadLaunchedProjects() {
    if (!forgeState.signer) await connectWallet();
    const wallet = forgeState.wallet;
    if ($('launchedDashboardWallet')) $('launchedDashboardWallet').textContent = `${wallet.slice(0, 6)}…${wallet.slice(-4)} · Sepolia`;
    if ($('launchedConnectBtn')) $('launchedConnectBtn').textContent = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
    const extra = $('launchedFactoryInput')?.value.trim();
    if (extra) {
      if (!window.ethers.isAddress(extra)) throw new Error('Additional Factory address is invalid.');
      rememberFactory(extra);
    }
    const factories = knownFactories();
    const addresses = new Set(manualLaunches().map(x => x.toLowerCase()));
    if (window.RelicForgeCloud?.enabled?.()) {
      try {
        await window.RelicForgeCloud.ensureSignedIn(wallet);
        const cloudCollections = (await window.RelicForgeCloud.json('/api/collections', {}, true)).collections || [];
        cloudCollections.filter(item => Number(item.chain_id) === 11155111).forEach(item => addresses.add(String(item.contract_address).toLowerCase()));
      } catch (_) {}
    }
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Searching ${factories.length} known Factor${factories.length === 1 ? 'y' : 'ies'} for ${shortAddr(wallet)}…`;
    for (const factoryAddress of factories) {
      try {
        const rp = readProvider(11155111) || forgeState.provider;
        const code = await rp.getCode(factoryAddress);
        if (!code || code === '0x') continue;
        const factory = new window.ethers.Contract(factoryAddress, [
          'function creatorCollectionCount(address creator) view returns(uint256)',
          'function creatorCollectionAt(address creator,uint256 index) view returns(address)',
          'function collectionsByCreator(address creator) view returns(address[])'
        ], rp);
        let v1Found = false;
        try {
          const count = Number(await factory.creatorCollectionCount(wallet));
          if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid V1 creator collection count.');
          const bounded = Math.min(count, 5000);
          for (let start = 0; start < bounded; start += 50) {
            const indexes = Array.from({ length: Math.min(50, bounded - start) }, (_, i) => start + i);
            const found = await Promise.all(indexes.map(index => factory.creatorCollectionAt(wallet, index)));
            found.forEach(address => addresses.add(String(address).toLowerCase()));
          }
          v1Found = true;
        } catch (_) {}
        if (!v1Found) {
          try {
            const found = await factory.collectionsByCreator(wallet);
            found.forEach(address => addresses.add(String(address).toLowerCase()));
          } catch (_) {}
        }
      } catch (_) {}
    }
    const snapshots = [];
    for (const raw of addresses) {
      try {
        const address = window.ethers.getAddress(raw);
        const snap = await collectionDashboardSnapshot(address);
        if (String(snap.owner).toLowerCase() === wallet.toLowerCase()) snapshots.push(snap);
      } catch (_) {}
    }
    snapshots.sort((a, b) => b.totalMinted - a.totalMinted || a.name.localeCompare(b.name));
    forgeState.launchedCollections = snapshots;
    const list = $('launchedCollectionList');
    if (list) {
      list.innerHTML = snapshots.length ? snapshots.map(item => `
        <button class="launched-collection-item${forgeState.launchedSelected?.toLowerCase() === item.address.toLowerCase() ? ' selected' : ''}" data-launched-address="${esc(item.address)}" type="button">
          <strong>${esc(item.name || 'Unnamed collection')}</strong>
          <span>${esc(item.symbol || '')} · ${item.totalMinted.toLocaleString()} / ${item.maxSupply.toLocaleString()} minted</span>
          <small>${esc(shortAddr(item.address))}${item.isV1 ? (item.controllerActive ? ' · V1' : ' · V1 · CONTROL RENOUNCED') : (item.sealed ? ' · SEALED' : '')}</small>
        </button>`).join('') : '<div class="forge-market-empty">No launched collections found for this wallet with the known Sepolia factories.</div>';
      list.querySelectorAll('[data-launched-address]').forEach(button => button.addEventListener('click', () => openLaunchedCollection(button.dataset.launchedAddress)));
    }
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = snapshots.length ? `Found ${snapshots.length} launched collection${snapshots.length === 1 ? '' : 's'}.` : 'No launched collections found. You can paste an older Factory or collection address below.';
    if (snapshots.length) {
      const selectedExists = snapshots.some(x => x.address.toLowerCase() === String(forgeState.launchedSelected || '').toLowerCase());
      await openLaunchedCollection(selectedExists ? forgeState.launchedSelected : snapshots[0].address);
    } else if ($('launchedCollectionDetail')) {
      $('launchedCollectionDetail').innerHTML = '<div class="forge-market-empty">Choose a launched collection to open its creator controls.</div>';
    }
  }

  function dashboardDatetimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function dashboardV1PhaseOptions(phases, selected) {
    const selectedId = Number(selected || 0);
    const rows = ['<option value="">None</option>'];
    for (const phase of phases || []) {
      const state = phase.open ? 'OPEN' : (phase.enabled ? 'Enabled' : 'Disabled');
      rows.push(`<option value="${phase.id}" ${phase.id === selectedId ? 'selected' : ''}>Phase ${phase.id} · ${state} · ${esc(window.ethers.formatEther(phase.price))} ETH</option>`);
    }
    return rows.join('');
  }

  function dashboardPhaseLocal(seconds) {
    return Number(seconds) > 0 ? dashboardDatetimeLocal(new Date(Number(seconds) * 1000).toISOString()) : '';
  }

  function dashboardPhaseTimeLabel(seconds, fallback) {
    if (!Number(seconds)) return fallback;
    return new Intl.DateTimeFormat(undefined, { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' }).format(new Date(Number(seconds) * 1000));
  }

  function dashboardEarliestPhaseStart(snap, publicPhaseId, whitelistPhaseId) {
    const ids = [Number(publicPhaseId || 0), Number(whitelistPhaseId || 0)].filter(Boolean);
    const starts = ids.map(id => snap.phases?.find(phase => phase.id === id)?.startTime || 0).filter(value => Number(value) > 0);
    return starts.length ? Math.min(...starts.map(Number)) : 0;
  }

  function dashboardV1PhaseRows(snap, canControl = false) {
    if (!snap.phases?.length) return '<div class="forge-market-empty">No V1 mint phases have been created.</div>';
    return `<div class="rc47c-phase-list">${snap.phases.map(phase => {
      const access = phase.accessType === 1 ? 'Whitelist / Merkle' : 'Public';
      const state = phase.open ? 'OPEN' : (phase.enabled ? 'Enabled / not open' : 'Disabled');
      const limit = phase.maxPerWallet ? `${phase.maxPerWallet} / wallet` : 'Unlimited / wallet';
      const supply = phase.phaseSupply ? `${phase.minted}/${phase.phaseSupply}` : `${phase.minted} minted`;
      return `<article class="rc47c-phase-card">
        <div class="rc47c-phase-card-head"><div><strong>Phase ${phase.id} · ${access}</strong><small>${window.ethers.formatEther(phase.price)} ETH · ${limit} · ${supply}</small></div><span class="rc47c-phase-state">${state}</span></div>
        <div class="rc47c-phase-time-grid">
          <label class="field"><span>Start</span><input id="dashboardV1PhaseStart${phase.id}" type="datetime-local" value="${esc(dashboardPhaseLocal(phase.startTime))}" ${canControl ? '' : 'disabled'}/><small>${esc(dashboardPhaseTimeLabel(phase.startTime, 'Immediate after Master Mint'))}</small></label>
          <label class="field"><span>End</span><input id="dashboardV1PhaseEnd${phase.id}" type="datetime-local" value="${esc(dashboardPhaseLocal(phase.endTime))}" ${canControl ? '' : 'disabled'}/><small>${esc(dashboardPhaseTimeLabel(phase.endTime, 'No automatic end'))}</small></label>
        </div>
        <div class="launched-actions"><button class="ghost-btn" data-v1-phase-schedule="${phase.id}" ${canControl ? '' : 'disabled'} type="button">Save Phase Schedule</button></div>
      </article>`;
    }).join('')}</div>${snap.phasesTruncated ? '<small class="forge-footnote">Only the first 500 phases are shown in the browser recovery view.</small>' : ''}`;
  }

  async function saveV1PhaseSchedule(snap, phaseId) {
    if (!forgeState.signer) await connectWallet();
    if (String(snap.owner).toLowerCase() !== String(forgeState.wallet).toLowerCase()) throw new Error('Connected wallet is not the collection creator.');
    if (!snap.controllerActive) throw new Error('V1 controller has been renounced; phase schedules can no longer be changed.');
    const phase = snap.phases.find(row => row.id === Number(phaseId));
    if (!phase) throw new Error('V1 phase was not found.');
    const parse = (id, label) => {
      const raw = String($(id)?.value || '').trim();
      if (!raw) return 0;
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error(`${label} date/time is invalid.`);
      return Math.floor(date.getTime() / 1000);
    };
    const startTime = parse(`dashboardV1PhaseStart${phase.id}`, 'Phase start');
    const endTime = parse(`dashboardV1PhaseEnd${phase.id}`, 'Phase end');
    if (endTime && endTime <= startTime) throw new Error('Phase end must be later than its start.');
    const contract = new window.ethers.Contract(snap.address, V1_COLLECTION_ABI, forgeState.signer);
    launchedStatus(`Updating Phase ${phase.id} schedule onchain…`);
    const tx = await contract.updatePhase(phase.id, phase.price, startTime, endTime, phase.phaseSupply, phase.maxPerWallet, phase.merkleRoot, phase.accessType, phase.priority);
    launchedStatus(`Phase ${phase.id} update submitted · ${tx.hash.slice(0,12)}…`);
    await tx.wait();

    const refreshed = await collectionDashboardSnapshot(snap.address, forgeState.signer);
    const published = await publishedMintPageConfig(snap.address);
    if (published.schema === 'relic-forge/mint-page@2' && published.showcaseEnabled) {
      const earliest = dashboardEarliestPhaseStart(refreshed, published.publicPhaseId, published.whitelistPhaseId);
      if (earliest) {
        await window.RelicForgeCloud.ensureSignedIn(forgeState.wallet);
        const config = { ...published, showcaseStart:new Date(earliest * 1000).toISOString(), updatedAt:new Date().toISOString() };
        delete config.collectionImage; delete config.bannerImage;
        await window.RelicForgeCloud.json(`/api/rc47b/collections/11155111/${encodeURIComponent(snap.address)}/mint-page`, { method:'PUT', body:JSON.stringify({ projectId:null, config }) }, true);
      }
    }
    launchedStatus(`Phase ${phase.id} schedule updated.${refreshed.masterMintEnabled ? '' : ' Master Mint is still OFF.'}`);
    await loadLaunchedProjects();
  }

  async function publishRecoveredV1MintPage(snap) {
    if (!window.RelicForgeCloud?.enabled?.()) throw new Error('RelicForge Cloud is not configured.');
    if (!forgeState.wallet) await connectWallet();
    await window.RelicForgeCloud.ensureSignedIn(forgeState.wallet);

    const current = await publishedMintPageConfig(snap.address);
    const imageAsset = forgeState.dashboardMintPageImageFile
      ? await window.RelicForgeCloud.uploadAsset(forgeState.dashboardMintPageImageFile, { purpose: 'mint-page' })
      : null;
    const bannerAsset = forgeState.dashboardMintPageBannerFile
      ? await window.RelicForgeCloud.uploadAsset(forgeState.dashboardMintPageBannerFile, { purpose: 'mint-page' })
      : null;

    const publicPhaseId = Number($('dashboardV1PublicPhase')?.value || 0) || null;
    const whitelistPhaseId = Number($('dashboardV1WhitelistPhase')?.value || 0) || null;
    if (publicPhaseId && !snap.publicPhases.some(phase => phase.id === publicPhaseId)) throw new Error('Selected Public phase is not a canonical V1 public phase.');
    if (whitelistPhaseId && !snap.whitelistPhases.some(phase => phase.id === whitelistPhaseId)) throw new Error('Selected Whitelist phase is not a canonical V1 Merkle phase.');

    const showcaseEnabled = !!$('dashboardV1ShowcaseEnabled')?.checked;
    const scheduledStart = dashboardEarliestPhaseStart(snap, publicPhaseId, whitelistPhaseId);
    const rawStart = $('dashboardV1ShowcaseStart')?.value || '';
    let showcaseStart = scheduledStart ? new Date(scheduledStart * 1000).toISOString() : null;
    if (!showcaseStart && rawStart) {
      const parsed = new Date(rawStart);
      if (!Number.isFinite(parsed.getTime())) throw new Error('Upcoming Mints start date/time is invalid.');
      showcaseStart = parsed.toISOString();
    }
    if (showcaseEnabled && !showcaseStart) throw new Error('Schedule a published mint phase or choose an Upcoming Mints fallback start before enabling discovery.');

    const config = {
      schema: 'relic-forge/mint-page@2',
      chainId: 11155111,
      contract: snap.address,
      title: String($('dashboardV1Title')?.value || snap.name || 'Relic Forge Collection').trim(),
      description: String($('dashboardV1Description')?.value || snap.description || '').trim(),
      publicPhaseId,
      whitelistPhaseId,
      collectionImageAssetId: imageAsset?.id || current.collectionImageAssetId || null,
      bannerImageAssetId: bannerAsset?.id || current.bannerImageAssetId || null,
      showcaseEnabled,
      showcaseStart,
      updatedAt: new Date().toISOString(),
    };

    const result = await window.RelicForgeCloud.json(
      `/api/rc47b/collections/11155111/${encodeURIComponent(snap.address)}/mint-page`,
      { method: 'PUT', body: JSON.stringify({ projectId: null, config }) },
      true
    );

    forgeState.dashboardMintPageImageFile = null;
    forgeState.dashboardMintPageBannerFile = null;
    try {
      const refreshed = await publishedMintPageConfig(snap.address);
      writeMintPageConfig(refreshed);
    } catch (_) {}
    return result?.config || config;
  }

  async function handleV1LaunchedAction(action, snap) {
    try {
      if (!forgeState.signer) await connectWallet();
      const isOwner = String(snap.owner).toLowerCase() === String(forgeState.wallet).toLowerCase();
      const contract = new window.ethers.Contract(snap.address, V1_COLLECTION_ABI, forgeState.signer);

      if (action === 'mintpage') {
        const config = await publishedMintPageConfig(snap.address);
        if (config.schema !== 'relic-forge/mint-page@2') throw new Error('Publish this recovered V1 mint page before opening it.');
        window.open(`./mint.html?contract=${encodeURIComponent(snap.address)}&chain=11155111`, '_blank', 'noopener');
        return;
      }

      if (!isOwner) throw new Error('Connected wallet is not the collection creator.');

      if (action === 'publish') {
        launchedStatus('Publishing recovered V1 mint page to RelicForge Cloud…');
        const config = await publishRecoveredV1MintPage(snap);
        launchedStatus(config.showcaseEnabled ? 'V1 mint page published and Upcoming Mints enabled.' : 'V1 mint page published and collection registered with RelicForge Cloud.');
        await loadLaunchedProjects();
        return;
      }
      if (action === 'spotlightoff') {
        const current = await publishedMintPageConfig(snap.address);
        if (current.schema !== 'relic-forge/mint-page@2') throw new Error('This V1 collection is not currently published.');
        await window.RelicForgeCloud.ensureSignedIn(forgeState.wallet);
        const config = { ...current, showcaseEnabled:false, updatedAt:new Date().toISOString() };
        delete config.collectionImage; delete config.bannerImage;
        await window.RelicForgeCloud.json(`/api/rc47b/collections/11155111/${encodeURIComponent(snap.address)}/mint-page`, { method:'PUT', body:JSON.stringify({ projectId:null, config }) }, true);
        launchedStatus('Removed from Upcoming Mints. The public mint page and onchain collection were not changed.');
        await loadLaunchedProjects();
        return;
      }

      if (action === 'processreveal') {
        if (!snap.nextReveal?.fulfilled) throw new Error('No fulfilled reveal request is ready to process. Refresh the dashboard after randomness fulfillment.');
        const steps = Math.max(1, Math.min(500, Math.floor(Number($('dashboardV1RevealSteps')?.value || 50))));
        launchedStatus(`Processing ready reveal batch with up to ${steps} step${steps === 1 ? '' : 's'}...`);
        const tx = await contract.processReveal(steps);
        launchedStatus(`Reveal processing submitted - ${tx.hash.slice(0, 12)}...`);
        await tx.wait();
        launchedStatus('Ready reveal processing confirmed.');
        await loadLaunchedProjects();
        return;
      }
      if (!snap.controllerActive) throw new Error('V1 controller has been renounced; creator onchain controls are permanently disabled.');

      if (action === 'mastermint') {
        const next = !snap.masterMintEnabled;
        launchedStatus(`${next ? 'Enabling' : 'Disabling'} V1 master mint…`);
        const tx = await contract.setMasterMintEnabled(next);
        launchedStatus(`Transaction submitted · ${tx.hash.slice(0, 12)}…`);
        await tx.wait();
        launchedStatus(`V1 master mint ${next ? 'enabled' : 'disabled'}.`);
      } else if (action === 'creatormint') {
        const quantity = Math.max(1, Math.min(50, Math.floor(Number($('dashboardV1CreatorMintQty')?.value || 1))));
        launchedStatus(`Creator minting ${quantity} V1 NFT${quantity === 1 ? '' : 's'}…`);
        const tx = await contract.creatorMint(forgeState.wallet, quantity);
        launchedStatus(`Creator Mint submitted · ${tx.hash.slice(0, 12)}…`);
        await tx.wait();
        launchedStatus('V1 Creator Mint confirmed.');
      } else if (action === 'deferredreveal') {
        if (!snap.deferredRequestable) throw new Error('There are no unrequested deferred tokens ready for a new reveal epoch.');
        launchedStatus('Requesting deferred reveal epoch...');
        const tx = await contract.requestRevealEpoch();
        launchedStatus(`Deferred reveal request submitted - ${tx.hash.slice(0, 12)}...`);
        await tx.wait();
        launchedStatus('Deferred reveal epoch requested. Wait for randomness fulfillment, then refresh and process the ready reveal.');
      }

      await loadLaunchedProjects();
    } catch (error) {
      launchedStatus(`Dashboard error: ${error.shortMessage || error.message}`);
    }
  }

  async function openV1LaunchedCollection(snap) {
    forgeState.launchedSelected = snap.address;
    $('launchedCollectionList')?.querySelectorAll('[data-launched-address]').forEach(button => {
      button.classList.toggle('selected', button.dataset.launchedAddress.toLowerCase() === snap.address.toLowerCase());
    });

    const isOwner = String(snap.owner).toLowerCase() === String(forgeState.wallet).toLowerCase();
    const canControl = isOwner && snap.controllerActive;
    const dashboardMintConfig = await publishedMintPageConfig(snap.address);
    const publishedV1 = dashboardMintConfig.schema === 'relic-forge/mint-page@2';
    const dashboardMintImage = dashboardMintConfig.collectionImage || '';
    const dashboardMintBanner = dashboardMintConfig.bannerImage || '';
    const selectedPublic = snap.publicPhases.some(phase => phase.id === Number(dashboardMintConfig.publicPhaseId))
      ? Number(dashboardMintConfig.publicPhaseId)
      : snap.publicPhaseId;
    const selectedWhitelist = snap.whitelistPhases.some(phase => phase.id === Number(dashboardMintConfig.whitelistPhaseId))
      ? Number(dashboardMintConfig.whitelistPhaseId)
      : snap.whitelistPhaseId;
    const scheduledShowcaseStart = dashboardEarliestPhaseStart(snap, selectedPublic, selectedWhitelist);
    const dashboardShowcaseStart = dashboardMintConfig.showcaseStart || (scheduledShowcaseStart ? new Date(scheduledShowcaseStart * 1000).toISOString() : null);

    forgeState.dashboardMintPageImageFile = null;
    forgeState.dashboardMintPageBannerFile = null;

    const detail = $('launchedCollectionDetail');
    if (!detail) return;
    detail.innerHTML = `
      <div class="launched-detail-head">
        <div><span class="eyebrow">CANONICAL V1 COLLECTION</span><h3>${esc(snap.name)}</h3><p>${esc(snap.address)}</p></div>
        <span class="launched-badge ${snap.controllerActive ? 'good' : 'warn'}">${snap.controllerActive ? 'CREATOR CONTROL ACTIVE' : 'CONTROL RENOUNCED'}</span>
      </div>
      ${isOwner ? '' : '<div class="launched-owner-warning">The connected wallet is not the creator of this collection. Creator actions are disabled.</div>'}
      <div class="launched-stats">
        <div><span>Supply</span><strong>${snap.totalMinted.toLocaleString()} / ${snap.maxSupply.toLocaleString()}</strong></div>
        <div><span>Master Mint</span><strong>${snap.masterMintEnabled ? 'ON' : 'OFF'}</strong></div>
        <div><span>Reveal</span><strong>${snap.futureRevealMode === 1 ? 'Forge Reveal' : 'Deferred Reveal'}</strong></div>
        <div><span>Phases</span><strong>${snap.phaseCount.toLocaleString()}</strong></div>
      </div>

      <div class="launched-actions">
        <button class="ghost-btn" data-v1-dashboard-action="mintpage" ${publishedV1 ? '' : 'disabled'} type="button">Open Public Mint Page</button>
        <a class="ghost-btn link-btn" href="https://sepolia.etherscan.io/address/${esc(snap.address)}" rel="noreferrer" target="_blank">View on Etherscan</a>
      </div>

      <div class="launched-section">
        <h4>V1 Mint Page & Upcoming Mints</h4>
        <p class="forge-footnote">This recovery panel registers an already-forged V1 collection with RelicForge Cloud. It does not redeploy or alter your NFT artwork.</p>
        <div class="launched-controls-grid">
          <label class="field"><span>Display title</span><input id="dashboardV1Title" type="text" maxlength="180" value="${esc(dashboardMintConfig.title || snap.name || '')}" ${!isOwner ? 'disabled' : ''}/></label>
          <label class="field"><span>Public phase</span><select id="dashboardV1PublicPhase" ${!isOwner ? 'disabled' : ''}>${dashboardV1PhaseOptions(snap.publicPhases, selectedPublic)}</select></label>
          <label class="field"><span>Whitelist phase</span><select id="dashboardV1WhitelistPhase" ${!isOwner ? 'disabled' : ''}>${dashboardV1PhaseOptions(snap.whitelistPhases, selectedWhitelist)}</select></label>
          <label class="field"><span>Upcoming start fallback</span><input id="dashboardV1ShowcaseStart" type="datetime-local" value="${esc(dashboardDatetimeLocal(dashboardShowcaseStart))}" ${!isOwner ? 'disabled' : ''}/><small>${scheduledShowcaseStart ? 'The earliest selected onchain phase start is used automatically.' : 'Used only when the selected phases do not have a scheduled start.'}</small></label>
        </div>
        <label class="field"><span>Description</span><textarea id="dashboardV1Description" maxlength="3000" rows="3" ${!isOwner ? 'disabled' : ''}>${esc(dashboardMintConfig.description || snap.description || '')}</textarea></label>
        <label class="project-toggle-row"><span><strong>Show on Upcoming Mints</strong><small>Opt this published V1 mint page into Relic Forge discovery.</small></span><input id="dashboardV1ShowcaseEnabled" type="checkbox" ${dashboardMintConfig.showcaseEnabled ? 'checked' : ''} ${!isOwner ? 'disabled' : ''}/></label>

        <div class="mint-page-builder-grid dashboard-mint-page-builder">
          <div class="mint-page-media-settings">
            <label class="compact-upload" for="dashboardMintPageImageInput"><strong>Collection image</strong><span id="dashboardMintPageImageName">${dashboardMintImage ? 'Current image saved · choose a file to replace it' : '2 MB max · image file'}</span><input accept="image/*,.svg" id="dashboardMintPageImageInput" type="file" ${!isOwner ? 'disabled' : ''}/></label>
            <label class="compact-upload" for="dashboardMintPageBannerInput"><strong>Collection banner</strong><span id="dashboardMintPageBannerName">${dashboardMintBanner ? 'Current banner saved · choose a file to replace it' : '2 MB max · image file'}</span><input accept="image/*,.svg" id="dashboardMintPageBannerInput" type="file" ${!isOwner ? 'disabled' : ''}/></label>
            <div class="launched-actions">
              <button class="primary-btn" data-v1-dashboard-action="publish" ${!isOwner ? 'disabled' : ''} type="button">${publishedV1 ? 'Update / Publish Mint Page' : 'Register & Publish Mint Page'}</button>
              <button class="ghost-btn" data-v1-dashboard-action="mintpage" ${publishedV1 ? '' : 'disabled'} type="button">Open Mint Page</button>
              ${dashboardMintConfig.showcaseEnabled && isOwner ? '<button class="ghost-btn danger-btn" data-v1-dashboard-action="spotlightoff" type="button">Remove from Spotlight</button>' : ''}
            </div>
            <small class="forge-footnote">${publishedV1 ? 'This collection is registered with RelicForge Cloud.' : 'This collection exists onchain but has not yet been registered with RelicForge Cloud.'} Whitelist wallet proofs are not recreated from chain state; if this collection uses a whitelist, reopen the saved Studio project to republish its proof table.</small>
          </div>
          <div class="mint-page-studio-preview">
            <div class="mint-page-preview-banner" id="dashboardMintPagePreviewBanner">${dashboardMintBanner ? `<img src="${esc(dashboardMintBanner)}" alt=""/>` : '<span>BANNER</span>'}</div>
            <div class="mint-page-preview-content">
              <div class="mint-page-preview-avatar" id="dashboardMintPagePreviewImage">${dashboardMintImage ? `<img src="${esc(dashboardMintImage)}" alt=""/>` : '<span>RF</span>'}</div>
              <div><small>CANONICAL V1</small><strong>${esc(dashboardMintConfig.title || snap.name)}</strong><p>${esc(dashboardMintConfig.description || snap.description || 'A fully onchain collection forged with Relic Forge.')}</p></div>
              <div class="mint-page-preview-action"><span>Mint</span><button type="button" disabled>Connect Wallet</button></div>
            </div>
          </div>
        </div>
      </div>

      <div class="launched-section">
        <h4>Mint & Creator Controls</h4>
        <p class="forge-footnote">${snap.masterMintEnabled ? 'Minting is LIVE, subject to each phase schedule. Pause Mint immediately stops all collector minting without changing phase dates, prices, or allowlists.' : 'Minting is PAUSED. Phase schedules and settings are preserved; Resume Mint re-enables any phase that is otherwise eligible to open.'}</p>
        <div class="launched-actions">
          <button class="${snap.masterMintEnabled ? 'ghost-btn danger-btn' : 'primary-btn'}" data-v1-dashboard-action="mastermint" ${canControl ? '' : 'disabled'} type="button">${snap.masterMintEnabled ? 'Pause Mint' : 'Resume Mint'}</button>
          <label class="field"><span>Creator Mint quantity</span><input id="dashboardV1CreatorMintQty" min="1" max="${Math.max(1, Math.min(50, snap.maxSupply - snap.totalMinted))}" type="number" value="1" ${canControl && snap.totalMinted < snap.maxSupply ? '' : 'disabled'}/></label>
          <button class="ghost-btn" data-v1-dashboard-action="creatormint" ${canControl && snap.totalMinted < snap.maxSupply ? '' : 'disabled'} type="button">Creator Mint</button>
        </div>
      </div>

      <div class="launched-section">
        <h4>Reveal Controls</h4>
        <p class="forge-footnote">${snap.futureRevealMode === 1 ? 'Forge Reveal requests randomness automatically after each mint. Once Chainlink fulfills the next request, process the ready batch to assign recipes and reveal those tokens.' : 'Deferred Reveal keeps minted tokens hidden until you request a reveal epoch. After Chainlink fulfills the request, process the ready batch to assign recipes and reveal those tokens.'}</p>
        <div class="launched-stats">
          <div><span>Mode</span><strong>${snap.futureRevealMode === 1 ? 'FORGE REVEAL' : 'DEFERRED REVEAL'}</strong></div>
          <div><span>Deferred pending</span><strong>${Number(snap.deferredPendingCount || 0).toLocaleString()}</strong></div>
          <div><span>Reveal queue</span><strong>${Number(snap.revealQueuePending || 0).toLocaleString()}</strong></div>
          <div><span>Next request</span><strong>${snap.nextReveal ? (snap.nextReveal.fulfilled ? 'READY TO PROCESS' : 'WAITING FOR RANDOMNESS') : 'NONE'}</strong></div>
        </div>
        ${snap.nextReveal ? `<div class="forge-inline-status">Request #${snap.nextReveal.sequence} covers token #${snap.nextReveal.startTokenId} through #${snap.nextReveal.endTokenId}. ${snap.nextReveal.fulfilled ? 'Randomness is fulfilled and the batch can be processed now.' : 'Randomness has been requested but is not fulfilled yet.'}</div>` : ''}
        <div class="launched-actions">
          <button class="primary-btn" data-v1-dashboard-action="deferredreveal" ${canControl && snap.deferredRequestable ? '' : 'disabled'} type="button">Request Deferred Reveal</button>
          <label class="field"><span>Process steps</span><input id="dashboardV1RevealSteps" min="1" max="500" type="number" value="50" ${isOwner && snap.revealQueuePending > 0 ? '' : 'disabled'}/><small>Use another transaction if a large batch needs more steps.</small></label>
          <button class="ghost-btn" data-v1-dashboard-action="processreveal" ${isOwner && snap.nextReveal?.fulfilled ? '' : 'disabled'} type="button">Process Ready Reveal</button>
        </div>
        <small class="forge-footnote">Request Deferred Reveal is enabled only when minted deferred tokens have not yet been assigned to an epoch. Process Ready Reveal becomes available after the next queued request receives randomness. Processing is permissionless onchain, so it remains possible even after creator control is renounced.</small>
      </div>
      <div class="launched-section">
        <h4>Mint Phases</h4>
        ${dashboardV1PhaseRows(snap, canControl)}
      </div>

      <div class="launched-section">
        <h4>Collection Integrity</h4>
        <div class="forge-rows">
          <div class="forge-row"><span>ProjectData</span><strong>${esc(shortAddr(snap.dataAddress))}</strong></div>
          <div class="forge-row"><span>Content sealed</span><strong>${snap.contentSealed ? 'Yes' : 'No'}</strong></div>
          <div class="forge-row"><span>Provenance</span><strong>${esc(shortAddr(snap.provenance))}</strong></div>
          <div class="forge-row"><span>Controller</span><strong>${snap.controllerActive ? esc(shortAddr(snap.controller)) : 'Renounced'}</strong></div>
        </div>
      </div>

      <div class="launched-tx-status" id="launchedTxStatus">Ready.</div>`;

    detail.querySelectorAll('[data-v1-dashboard-action]').forEach(button => {
      button.addEventListener('click', () => handleV1LaunchedAction(button.dataset.v1DashboardAction, snap));
    });
    detail.querySelectorAll('[data-v1-phase-schedule]').forEach(button => {
      button.addEventListener('click', () => saveV1PhaseSchedule(snap, Number(button.dataset.v1PhaseSchedule)).catch(error => launchedStatus(`Dashboard error: ${error.shortMessage || error.message}`)));
    });

    $('dashboardMintPageImageInput')?.addEventListener('change', async event => {
      try {
        forgeState.dashboardMintPageImageFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection image');
        if ($('dashboardMintPageImageName')) $('dashboardMintPageImageName').textContent = forgeState.dashboardMintPageImageFile
          ? `${forgeState.dashboardMintPageImageFile.name} · ${(forgeState.dashboardMintPageImageFile.size / 1024 / 1024).toFixed(2)} MB`
          : (dashboardMintImage ? 'Current image saved · choose a file to replace it' : '2 MB max · image file');
        const preview = forgeState.dashboardMintPageImageFile ? await fileToDataUrl(forgeState.dashboardMintPageImageFile) : dashboardMintImage;
        setPreviewImage('dashboardMintPagePreviewImage', preview, 'RF');
      } catch (error) {
        event.target.value = '';
        forgeState.dashboardMintPageImageFile = null;
        if ($('dashboardMintPageImageName')) $('dashboardMintPageImageName').textContent = `Image rejected: ${error.message}`;
      }
    });

    $('dashboardMintPageBannerInput')?.addEventListener('change', async event => {
      try {
        forgeState.dashboardMintPageBannerFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection banner');
        if ($('dashboardMintPageBannerName')) $('dashboardMintPageBannerName').textContent = forgeState.dashboardMintPageBannerFile
          ? `${forgeState.dashboardMintPageBannerFile.name} · ${(forgeState.dashboardMintPageBannerFile.size / 1024 / 1024).toFixed(2)} MB`
          : (dashboardMintBanner ? 'Current banner saved · choose a file to replace it' : '2 MB max · image file');
        const preview = forgeState.dashboardMintPageBannerFile ? await fileToDataUrl(forgeState.dashboardMintPageBannerFile) : dashboardMintBanner;
        setPreviewImage('dashboardMintPagePreviewBanner', preview, 'BANNER');
      } catch (error) {
        event.target.value = '';
        forgeState.dashboardMintPageBannerFile = null;
        if ($('dashboardMintPageBannerName')) $('dashboardMintPageBannerName').textContent = `Banner rejected: ${error.message}`;
      }
    });
  }

  async function openLaunchedCollection(address) {
    try {
      if (!forgeState.signer) await connectWallet();
      const snap = await collectionDashboardSnapshot(address, forgeState.signer);
      if (snap.isV1) { await openV1LaunchedCollection(snap); return; }
      forgeState.launchedSelected = snap.address;
      $('launchedCollectionList')?.querySelectorAll('[data-launched-address]').forEach(button => button.classList.toggle('selected', button.dataset.launchedAddress.toLowerCase() === snap.address.toLowerCase()));
      const isOwner = String(snap.owner).toLowerCase() === String(forgeState.wallet).toLowerCase();
      const mutableDisabled = snap.sealed || !isOwner;
      const creatorRevealReady = snap.revealMode === 1 && snap.creatorRevealSeed === 0n && snap.totalMinted > 0 && isOwner;
      const dashboardMintConfig = { ...readMintPageConfig(snap.address), ...(await publishedMintPageConfig(snap.address)) };
      forgeState.dashboardMintPageImageFile = null;
      forgeState.dashboardMintPageBannerFile = null;
      const dashboardMintImage = dashboardMintConfig.collectionImage || '';
      const dashboardMintBanner = dashboardMintConfig.bannerImage || '';
      const detail = $('launchedCollectionDetail');
      if (!detail) return;
      detail.innerHTML = `
        <div class="launched-detail-head">
          <div><span class="eyebrow">DEPLOYED COLLECTION</span><h3>${esc(snap.name)}</h3><p>${esc(snap.address)}</p></div>
          <span class="launched-badge ${snap.sealed ? 'warn' : 'good'}">${snap.sealed ? 'SEALED' : 'CREATOR CONTROL ACTIVE'}</span>
        </div>
        ${isOwner ? '' : '<div class="launched-owner-warning">The connected wallet is not the owner of this collection. Creator actions are disabled.</div>'}
        <div class="launched-stats">
          <div><span>Supply</span><strong>${snap.totalMinted.toLocaleString()} / ${snap.maxSupply.toLocaleString()}</strong></div>
          <div><span>Public price</span><strong>${esc(window.ethers.formatEther(snap.mintPrice))} ETH</strong></div>
          <div><span>Reveal</span><strong>${snap.revealMode === 0 ? 'Forge Reveal' : (snap.creatorRevealSeed !== 0n ? 'Creator Revealed' : 'Creator Reveal')}</strong></div>
          <div><span>Wallet limit</span><strong>${snap.maxPerWallet || 'Unlimited'}</strong></div>
        </div>
        <div class="launched-actions">
          <button class="ghost-btn" data-dashboard-action="mintpage" type="button">Open Public Mint Page</button>
          <button class="ghost-btn" data-dashboard-action="viewer" type="button">Open Testnet Viewer</button>
          <a class="ghost-btn link-btn" href="https://sepolia.etherscan.io/address/${esc(snap.address)}" rel="noreferrer" target="_blank">View on Etherscan</a>
        </div>

        <div class="launched-section">
          <h4>Public Mint Page</h4>
          <p class="forge-footnote">Update the collection image and banner for this launched collection. These page assets are offchain presentation settings and do not change the NFT artwork or metadata.</p>
          <div class="mint-page-builder-grid dashboard-mint-page-builder">
            <div class="mint-page-media-settings">
              <label class="compact-upload" for="dashboardMintPageImageInput"><strong>Collection image</strong><span id="dashboardMintPageImageName">${dashboardMintImage ? 'Current image saved · choose a file to replace it' : '2 MB max · any image format · animated GIF supported'}</span><input accept="image/*,.svg" id="dashboardMintPageImageInput" type="file"/></label>
              <label class="compact-upload" for="dashboardMintPageBannerInput"><strong>Collection banner</strong><span id="dashboardMintPageBannerName">${dashboardMintBanner ? 'Current banner saved · choose a file to replace it' : '2 MB max · any image format · animated GIF supported'}</span><input accept="image/*,.svg" id="dashboardMintPageBannerInput" type="file"/></label>
              <div class="launched-actions">
                <button class="primary-btn" data-dashboard-action="savemintpage" ${!isOwner ? 'disabled' : ''} type="button">Save Mint Page</button>
                <button class="ghost-btn" data-dashboard-action="downloadmintpage" type="button">Download Updated Page</button>
              </div>
              <small class="forge-footnote">With RelicForge Cloud configured, Save Mint Page publishes these aesthetics globally so every device sees the same page. Standalone export remains available as a backup.</small>
            </div>
            <div class="mint-page-studio-preview">
              <div class="mint-page-preview-banner" id="dashboardMintPagePreviewBanner">${dashboardMintBanner ? `<img src="${esc(dashboardMintBanner)}" alt=""/>` : '<span>BANNER</span>'}</div>
              <div class="mint-page-preview-content">
                <div class="mint-page-preview-avatar" id="dashboardMintPagePreviewImage">${dashboardMintImage ? `<img src="${esc(dashboardMintImage)}" alt=""/>` : '<span>RF</span>'}</div>
                <div><small>ONCHAIN COLLECTION</small><strong>${esc(snap.name)}</strong><p>${esc(snap.description || 'A fully onchain collection forged with Relic Forge.')}</p></div>
                <div class="mint-page-preview-action"><span>Mint</span><button type="button" disabled>Connect Wallet</button></div>
              </div>
            </div>
          </div>
        </div>

        <div class="launched-section">
          <h4>Creator Mint</h4>
          <div class="inline-actions">
            <label class="field"><span>Quantity</span><input id="dashboardCreatorMintQty" min="1" max="${Math.max(1, snap.maxSupply - snap.totalMinted)}" type="number" value="1"/></label>
            <button class="primary-btn" data-dashboard-action="creatormint" ${!isOwner || snap.totalMinted >= snap.maxSupply ? 'disabled' : ''} type="button">Creator Mint</button>
          </div>
          <small class="forge-footnote">Creator Mint remains available only inside Relic Forge Studio and bypasses public mint price / wallet limits while respecting remaining supply.</small>
        </div>

        <div class="launched-section">
          <h4>Mint Settings</h4>
          ${snap.sealed ? '<div class="forge-check warn">This collection is sealed. Mutable mint and royalty settings are locked.</div>' : ''}
          <div class="launched-controls-grid">
            <label class="field"><span>Public mint price</span><div class="input-suffix"><input id="dashboardMintPrice" type="number" min="0" step="0.001" value="${esc(window.ethers.formatEther(snap.mintPrice))}" ${mutableDisabled ? 'disabled' : ''}/><span>ETH</span></div></label>
            <label class="field"><span>Max per wallet</span><input id="dashboardMaxPerWallet" type="number" min="0" value="${snap.maxPerWallet}" ${mutableDisabled ? 'disabled' : ''}/><small>0 = unlimited</small></label>
            <label class="field"><span>Whitelist price</span><div class="input-suffix"><input id="dashboardWhitelistPrice" type="number" min="0" step="0.001" value="${esc(window.ethers.formatEther(snap.whitelistPrice))}" ${mutableDisabled ? 'disabled' : ''}/><span>ETH</span></div></label>
            <label class="field"><span>Royalty</span><div class="input-suffix"><input id="dashboardRoyalty" type="number" min="0" max="10" step="0.5" value="${(snap.royaltyBps / 100).toFixed(2).replace(/\.00$/, '')}" ${mutableDisabled ? 'disabled' : ''}/><span>%</span></div></label>
            <label class="field"><span>Royalty wallet</span><input id="dashboardRoyaltyWallet" type="text" value="${esc(snap.royaltyReceiver)}" ${mutableDisabled ? 'disabled' : ''}/></label>
          </div>
          <div class="launched-access-row">
            <label><input id="dashboardPublicEnabled" type="checkbox" ${snap.publicEnabled ? 'checked' : ''} ${mutableDisabled ? 'disabled' : ''}/> Public mint enabled</label>
            <label><input id="dashboardWhitelistEnabled" type="checkbox" ${snap.whitelistEnabled ? 'checked' : ''} ${mutableDisabled || snap.root === window.ethers.ZeroHash ? 'disabled' : ''}/> Whitelist mint enabled</label>
          </div>
          <div class="launched-actions">
            <button class="primary-btn" data-dashboard-action="savesettings" ${mutableDisabled ? 'disabled' : ''} type="button">Save Onchain Settings</button>
          </div>
        </div>

        ${snap.revealMode === 1 ? `<div class="launched-section"><h4>Creator Reveal</h4><p class="forge-footnote">${snap.creatorRevealSeed !== 0n ? 'This collection has already been revealed.' : 'Trigger the collection-wide reveal when you are ready.'}</p><button class="ghost-btn" data-dashboard-action="reveal" ${creatorRevealReady ? '' : 'disabled'} type="button">Trigger Creator Reveal</button></div>` : ''}

        <div class="launched-section">
          <h4>Rendering</h4>
          <p class="forge-footnote">The canonical onchain SVG is always available. Offchain Render serves a cached presentation copy while preserving renderToken() onchain. Animated GIF artwork remains animated through the adaptive offchain renderer.</p>
          <div class="launched-controls-grid">
            <label class="field"><span>Default display</span><select id="dashboardDefaultRenderMode" ${mutableDisabled ? 'disabled' : ''}><option value="0" ${snap.defaultRenderMode === 0 ? 'selected' : ''}>Fully Onchain SVG</option><option value="1" ${snap.defaultRenderMode === 1 ? 'selected' : ''}>Offchain Render</option></select></label>
            <label class="field"><span>Renderer base URI</span><input id="dashboardRenderBaseURI" type="url" value="${esc(snap.flattenedRenderBaseURI || '')}" ${mutableDisabled ? 'disabled' : ''}/></label>
          </div>
          <label class="project-toggle-row"><span><strong>Allow holder switching</strong><small>Owners can choose Onchain SVG or Offchain Render for their token.</small></span><input id="dashboardHolderRenderEnabled" type="checkbox" ${snap.holderRenderEnabled ? 'checked' : ''} ${mutableDisabled ? 'disabled' : ''}/></label>
          <div class="launched-actions"><button class="primary-btn" data-dashboard-action="saverendering" ${mutableDisabled ? 'disabled' : ''} type="button">Save Render Settings</button></div>
        </div>

        <div class="launched-section">
          <h4>Collection Integrity</h4>
          <div class="forge-rows">
            <div class="forge-row"><span>Finalized</span><strong>${snap.finalized ? 'Yes' : 'No'}</strong></div>
            <div class="forge-row"><span>Provenance</span><strong>${esc(shortAddr(snap.provenance))}</strong></div>
            <div class="forge-row"><span>Whitelist root</span><strong>${snap.root === window.ethers.ZeroHash ? 'None' : esc(shortAddr(snap.root))}</strong></div>
          </div>
          ${!snap.sealed && isOwner ? '<div class="launched-actions"><button class="ghost-btn danger-btn" data-dashboard-action="seal" type="button">Seal Collection Permanently</button></div>' : ''}
        </div>
        <div class="launched-tx-status" id="launchedTxStatus">Ready.</div>`;
      detail.querySelectorAll('[data-dashboard-action]').forEach(button => button.addEventListener('click', () => handleLaunchedAction(button.dataset.dashboardAction, snap)));
      $('dashboardMintPageImageInput')?.addEventListener('change', async event => {
        try {
          forgeState.dashboardMintPageImageFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection image');
          if ($('dashboardMintPageImageName')) $('dashboardMintPageImageName').textContent = forgeState.dashboardMintPageImageFile ? `${forgeState.dashboardMintPageImageFile.name} · ${(forgeState.dashboardMintPageImageFile.size / 1024 / 1024).toFixed(2)} MB` : (dashboardMintImage ? 'Current image saved · choose a file to replace it' : '2 MB max · any image format · animated GIF supported');
          const preview = forgeState.dashboardMintPageImageFile ? await fileToDataUrl(forgeState.dashboardMintPageImageFile) : dashboardMintImage;
          setPreviewImage('dashboardMintPagePreviewImage', preview, 'RF');
        } catch (error) {
          event.target.value = ''; forgeState.dashboardMintPageImageFile = null;
          if ($('dashboardMintPageImageName')) $('dashboardMintPageImageName').textContent = `Image rejected: ${error.message}`;
        }
      });
      $('dashboardMintPageBannerInput')?.addEventListener('change', async event => {
        try {
          forgeState.dashboardMintPageBannerFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection banner');
          if ($('dashboardMintPageBannerName')) $('dashboardMintPageBannerName').textContent = forgeState.dashboardMintPageBannerFile ? `${forgeState.dashboardMintPageBannerFile.name} · ${(forgeState.dashboardMintPageBannerFile.size / 1024 / 1024).toFixed(2)} MB` : (dashboardMintBanner ? 'Current banner saved · choose a file to replace it' : '2 MB max · any image format · animated GIF supported');
          const preview = forgeState.dashboardMintPageBannerFile ? await fileToDataUrl(forgeState.dashboardMintPageBannerFile) : dashboardMintBanner;
          setPreviewImage('dashboardMintPagePreviewBanner', preview, 'BANNER');
        } catch (error) {
          event.target.value = ''; forgeState.dashboardMintPageBannerFile = null;
          if ($('dashboardMintPageBannerName')) $('dashboardMintPageBannerName').textContent = `Banner rejected: ${error.message}`;
        }
      });
    } catch (error) {
      if ($('launchedCollectionDetail')) $('launchedCollectionDetail').innerHTML = `<div class="forge-market-empty">Unable to load collection: ${esc(error.message)}</div>`;
    }
  }

  function launchedStatus(message) {
    if ($('launchedTxStatus')) $('launchedTxStatus').textContent = message;
  }

  async function handleLaunchedAction(action, snap) {
    try {
      if (!forgeState.signer) await connectWallet();
      const contract = new window.ethers.Contract(snap.address, COLLECTION_DASHBOARD_ABI, forgeState.signer);
      if (action === 'mintpage') {
        window.open(`./mint.html?contract=${encodeURIComponent(snap.address)}&chain=11155111`, '_blank', 'noopener');
        return;
      }
      if (action === 'savemintpage') {
        if (String(snap.owner).toLowerCase() !== String(forgeState.wallet).toLowerCase()) throw new Error('Connected wallet is not the collection owner.');
        const existing = readMintPageConfig(snap.address);
        const [newImage, newBanner] = await Promise.all([fileToDataUrl(forgeState.dashboardMintPageImageFile), fileToDataUrl(forgeState.dashboardMintPageBannerFile)]);
        const config = writeMintPageConfig({
          ...existing,
          schema: 'relic-forge/mint-page@1',
          chainId: 11155111,
          contract: snap.address,
          collectionImage: newImage || existing.collectionImage || null,
          bannerImage: newBanner || existing.bannerImage || null,
          updatedAt: new Date().toISOString(),
        });
        if (window.RelicForgeCloud?.enabled?.()) {
          launchedStatus('Publishing mint page appearance to RelicForge Cloud…');
          await publishMintPageCloud(snap.address, true);
        }
        forgeState.dashboardMintPageImageFile = null;
        forgeState.dashboardMintPageBannerFile = null;
        launchedStatus(window.RelicForgeCloud?.enabled?.() ? 'Mint page appearance saved + published.' : 'Mint page appearance saved locally.');
        await openLaunchedCollection(snap.address);
        return;
      }
      if (action === 'downloadmintpage') {
        const existing = readMintPageConfig(snap.address);
        const [newImage, newBanner] = await Promise.all([fileToDataUrl(forgeState.dashboardMintPageImageFile), fileToDataUrl(forgeState.dashboardMintPageBannerFile)]);
        const config = {
          ...existing,
          schema: 'relic-forge/mint-page@1',
          chainId: 11155111,
          contract: snap.address,
          collectionImage: newImage || existing.collectionImage || null,
          bannerImage: newBanner || existing.bannerImage || null,
          updatedAt: new Date().toISOString(),
        };
        await downloadMintPageFromConfig(config, snap.name || 'relicforge');
        launchedStatus('Updated standalone mint page downloaded.');
        return;
      }
      if (action === 'viewer') {
        if (document.body.classList.contains('dashboard-page-body')) {
          window.open(`./studio.html?viewer=${encodeURIComponent(snap.address)}`, '_blank', 'noopener');
          return;
        }
        if ($('viewerCollectionAddress')) $('viewerCollectionAddress').value = snap.address;
        launchedModal(false);
        await loadViewerCollection(true);
        $('viewerCollectionAddress')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (String(snap.owner).toLowerCase() !== String(forgeState.wallet).toLowerCase()) throw new Error('Connected wallet is not the collection owner.');
      if (action === 'saverendering') {
        const baseURI = String($('dashboardRenderBaseURI')?.value || '').trim();
        const enabled = !!$('dashboardHolderRenderEnabled')?.checked;
        const defaultMode = Number($('dashboardDefaultRenderMode')?.value || 0);
        if (defaultMode === 1 && !baseURI) throw new Error('Offchain Render default requires a renderer base URI.');
        launchedStatus('Updating onchain render settings…');
        const tx = await contract.setRenderConfig(baseURI, enabled, defaultMode);
        await tx.wait();
        launchedStatus('Render settings updated.');
      } else if (action === 'creatormint') {
        const quantity = Math.max(1, Math.floor(Number($('dashboardCreatorMintQty')?.value || 1)));
        launchedStatus(`Creator minting ${quantity} NFT${quantity === 1 ? '' : 's'}…`);
        const tx = await contract.creatorMint(quantity);
        launchedStatus(`Creator Mint submitted · ${tx.hash.slice(0, 12)}…`);
        await tx.wait();
        launchedStatus('Creator Mint confirmed.');
      } else if (action === 'savesettings') {
        if (snap.sealed) throw new Error('Collection is sealed.');
        const newMintPrice = window.ethers.parseEther(String(Math.max(0, Number($('dashboardMintPrice')?.value || 0))));
        const newLimit = Math.max(0, Math.floor(Number($('dashboardMaxPerWallet')?.value || 0)));
        const newWhitelistPrice = window.ethers.parseEther(String(Math.max(0, Number($('dashboardWhitelistPrice')?.value || 0))));
        const royaltyWallet = $('dashboardRoyaltyWallet')?.value.trim() || forgeState.wallet;
        if (!window.ethers.isAddress(royaltyWallet)) throw new Error('Royalty wallet is invalid.');
        const royaltyBps = Math.round(Math.max(0, Math.min(10, Number($('dashboardRoyalty')?.value || 0))) * 100);
        const publicEnabled = !!$('dashboardPublicEnabled')?.checked;
        const whitelistEnabled = !!$('dashboardWhitelistEnabled')?.checked;
        if (whitelistEnabled && snap.root === window.ethers.ZeroHash) throw new Error('This collection does not have a whitelist root. Reopen its saved Studio project to build one.');
        const calls = [];
        if (newMintPrice !== snap.mintPrice) calls.push(['mint price', () => contract.setMintPrice(newMintPrice)]);
        if (newLimit !== snap.maxPerWallet) calls.push(['wallet limit', () => contract.setMaxPerWallet(newLimit)]);
        if (window.ethers.getAddress(royaltyWallet) !== window.ethers.getAddress(snap.royaltyReceiver) || royaltyBps !== snap.royaltyBps) calls.push(['royalty', () => contract.setRoyalty(royaltyWallet, royaltyBps)]);
        if (publicEnabled !== snap.publicEnabled || whitelistEnabled !== snap.whitelistEnabled || newWhitelistPrice !== snap.whitelistPrice) {
          calls.push(['mint access', () => contract.setMintAccess(publicEnabled, whitelistEnabled, snap.root, newWhitelistPrice, snap.sourceContract, snap.sourceChainId, snap.snapshotBlock, snap.sourceType)]);
        }
        if (!calls.length) { launchedStatus('No onchain settings changed.'); return; }
        for (let i = 0; i < calls.length; i++) {
          launchedStatus(`Updating ${calls[i][0]} · ${i + 1}/${calls.length}…`);
          const tx = await calls[i][1]();
          await tx.wait();
        }
        launchedStatus('Onchain settings updated.');
      } else if (action === 'reveal') {
        launchedStatus('Requesting Creator Reveal…');
        const tx = await contract.requestCreatorReveal();
        await tx.wait();
        launchedStatus('Creator Reveal request confirmed.');
      } else if (action === 'seal') {
        const ok = window.confirm('Seal this collection permanently? Mint price, wallet limit, mint access, and royalty settings will become immutable. This cannot be undone.');
        if (!ok) return;
        launchedStatus('Sealing collection…');
        const tx = await contract.sealCollection();
        await tx.wait();
        launchedStatus('Collection sealed permanently.');
      }
      await loadLaunchedProjects();
      await openLaunchedCollection(snap.address);
    } catch (error) {
      launchedStatus(`Dashboard error: ${error.shortMessage || error.message}`);
    }
  }

  async function addManualLaunchedCollection() {
    try {
      if (!forgeState.signer) await connectWallet();
      const address = $('launchedManualCollection')?.value.trim() || '';
      if (!window.ethers.isAddress(address)) throw new Error('Collection address is invalid.');
      const snap = await collectionDashboardSnapshot(address);
      if (String(snap.owner).toLowerCase() !== String(forgeState.wallet).toLowerCase()) throw new Error('Connected wallet is not the owner of this collection.');
      rememberManualLaunch(address);
      if ($('launchedManualCollection')) $('launchedManualCollection').value = '';
      await loadLaunchedProjects();
      await openLaunchedCollection(address);
    } catch (error) {
      if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Add collection: ${error.message}`;
    }
  }

  function getForgeProjectState() {
    const wl = forgeState.whitelist;
    return {
      schema: 'relic-forge/forge-settings@5',
      launchName: $('launchName')?.value || '',
      launchSymbol: $('launchSymbol')?.value || '',
      launchDescription: $('launchDescription')?.value || '',
      mintPrice: $('mintPrice')?.value || '0',
      maxPerWallet: $('maxPerWallet')?.value || '0',
      royalty: $('royalty')?.value || '0',
      royaltyWallet: $('royaltyWallet')?.value || '',
      payoutWallet: $('payoutWallet')?.value || '',
      vrfFundingRequests: $('vrfFundingRequests')?.value || '5',
      revealMode: currentRevealMode(),
      platformFeeMode: currentPlatformFeeMode(),
      holderRenderModeEnabled: !!$('holderRenderModeEnabled')?.checked,
      defaultRenderMode: Number($('defaultRenderMode')?.value || 0),
      placeholderFile: forgeState.placeholderFile || null,
      publicMintEnabled: !!$('publicMintEnabled')?.checked,
      publicMintStart: $('publicMintStart')?.value || '',
      publicMintEnd: $('publicMintEnd')?.value || '',
      whitelistEnabled: !!$('whitelistEnabled')?.checked,
      whitelistMintPrice: $('whitelistMintPrice')?.value || '0',
      whitelistMintStart: $('whitelistMintStart')?.value || '',
      whitelistMintEnd: $('whitelistMintEnd')?.value || '',
      whitelistDefaultAllowance: $('whitelistDefaultAllowance')?.value || '1',
      whitelistSourceMode: currentWhitelistSourceMode(),
      whitelistSourceChain: $('whitelistSourceChain')?.value || '1',
      whitelistCollectionAddress: $('whitelistCollectionAddress')?.value || '',
      whitelistSnapshotRpc: $('whitelistSnapshotRpc')?.value || '',
      whitelistCustomText: $('whitelistCustomText')?.value || '',
      mintPageImageFile: forgeState.mintPageImageFile || null,
      mintPageBannerFile: forgeState.mintPageBannerFile || null,
      collectionAddress: forgeState.collectionAddress || null,
      dataAddress: forgeState.dataAddress || null,
      publicPhaseId: forgeState.publicPhaseId,
      whitelistPhaseId: forgeState.whitelistPhaseId,
      whitelist: wl ? {
        entries: wl.entries,
        sourceType: wl.sourceType,
        sourceContract: wl.sourceContract,
        sourceChainId: wl.sourceChainId || 0,
        sourceChainLabel: wl.sourceChainLabel || '',
        snapshotBlock: wl.snapshotBlock,
        tokenStandard: wl.tokenStandard,
        uniformAllowance: wl.uniformAllowance,
      } : null,
    };
  }

  function restoreForgeProjectState(saved) {
    if (!saved || !['relic-forge/forge-settings@1', 'relic-forge/forge-settings@2', 'relic-forge/forge-settings@3', 'relic-forge/forge-settings@4', 'relic-forge/forge-settings@5'].includes(saved.schema)) return;
    const values = {
      launchName: saved.launchName,
      launchSymbol: saved.launchSymbol,
      launchDescription: saved.launchDescription,
      mintPrice: saved.mintPrice,
      maxPerWallet: saved.maxPerWallet,
      publicMintStart: saved.publicMintStart || '',
      publicMintEnd: saved.publicMintEnd || '',
      royalty: saved.royalty,
      royaltyWallet: saved.royaltyWallet,
      payoutWallet: saved.payoutWallet,
      vrfFundingRequests: saved.vrfFundingRequests || '5',
      whitelistMintPrice: saved.whitelistMintPrice,
      whitelistMintStart: saved.whitelistMintStart || '',
      whitelistMintEnd: saved.whitelistMintEnd || '',
      whitelistDefaultAllowance: saved.whitelistDefaultAllowance,
      whitelistSourceChain: saved.whitelistSourceChain || String(saved.whitelist?.sourceChainId || 1),
      whitelistCollectionAddress: saved.whitelistCollectionAddress,
      whitelistSnapshotRpc: saved.whitelistSnapshotRpc || '',
      whitelistCustomText: saved.whitelistCustomText,
    };
    for (const [id, value] of Object.entries(values)) {
      const node = $(id);
      if (node && value != null) node.value = value;
    }
    const savedFeeMode = Number(saved.platformFeeMode || V1_FEE_MODE_MINTER_SUPPORTED);
    const savedFeeRadio = document.querySelector('input[name="platformFeeMode"][value="' + savedFeeMode + '"]');
    if (savedFeeRadio) savedFeeRadio.checked = true;
    refreshPlatformFeeQuote().catch(() => {});
    const reveal = Number(saved.revealMode || 0);
    if ($('holderRenderModeEnabled')) $('holderRenderModeEnabled').checked = saved.holderRenderModeEnabled !== false;
    if ($('defaultRenderMode')) $('defaultRenderMode').value = String(saved.defaultRenderMode || 0);
    const radio = document.querySelector(`input[name="revealMode"][value="${reveal}"]`);
    if (radio) radio.checked = true;
    if ($('publicMintEnabled')) $('publicMintEnabled').checked = saved.publicMintEnabled !== false;
    if ($('whitelistEnabled')) $('whitelistEnabled').checked = !!saved.whitelistEnabled;
    const sourceMode = saved.whitelistSourceMode || (saved.whitelist?.sourceType === 2 ? 'custom' : 'snapshot');
    const sourceRadio = document.querySelector(`input[name="whitelistSourceMode"][value="${sourceMode}"]`);
    if (sourceRadio) sourceRadio.checked = true;
    forgeState.placeholderFile = saved.placeholderFile || null;
    if ($('creatorPlaceholderName')) $('creatorPlaceholderName').textContent = forgeState.placeholderFile ? forgeState.placeholderFile.name : 'PNG, WEBP, JPG, GIF, or SVG';
    forgeState.mintPageImageFile = saved.mintPageImageFile || null;
    forgeState.mintPageBannerFile = saved.mintPageBannerFile || null;
    if ($('mintPageImageName')) $('mintPageImageName').textContent = forgeState.mintPageImageFile ? forgeState.mintPageImageFile.name : '2 MB max · any image format · animated GIF supported';
    if ($('mintPageBannerName')) $('mintPageBannerName').textContent = forgeState.mintPageBannerFile ? forgeState.mintPageBannerFile.name : '2 MB max · any image format · animated GIF supported';
    if (saved.collectionAddress && window.ethers?.isAddress(saved.collectionAddress)) {
      forgeState.collectionAddress = saved.collectionAddress;
      forgeState.dataAddress = saved.dataAddress && window.ethers?.isAddress(saved.dataAddress) ? saved.dataAddress : null;
      forgeState.publicPhaseId = saved.publicPhaseId ? Number(saved.publicPhaseId) : null;
      forgeState.whitelistPhaseId = saved.whitelistPhaseId ? Number(saved.whitelistPhaseId) : null;
      if ($('forgedCollectionAddress')) $('forgedCollectionAddress').textContent = saved.collectionAddress;
      if ($('forgedEtherscanLink')) $('forgedEtherscanLink').href = `https://sepolia.etherscan.io/address/${saved.collectionAddress}`;
      $('forgeResult')?.classList.remove('hidden');
      if ($('viewerCollectionAddress')) $('viewerCollectionAddress').value = saved.collectionAddress;
      if ($('openMintPageBtn')) $('openMintPageBtn').disabled = false;
      if ($('downloadMintPageBtn')) $('downloadMintPageBtn').disabled = false;
      if ($('publishMintPageBtn')) $('publishMintPageBtn').disabled = !window.RelicForgeCloud?.enabled?.();
    }
    updateMintPagePreview().catch(() => {});
    forgeState.whitelist = null;
    if (saved.whitelist?.entries?.length) {
      try {
        const entries = normalizeWhitelistEntries(saved.whitelist.entries, 1);
        const tree = forgeState.collectionAddress && forgeState.whitelistPhaseId
          ? buildMerkleWhitelistV1(entries, forgeState.collectionAddress, forgeState.whitelistPhaseId)
          : buildMerkleWhitelist(entries);
        forgeState.whitelist = { ...saved.whitelist, ...tree, entries };
        if ($('whitelistStatus')) $('whitelistStatus').textContent = `✓ Restored ${entries.length.toLocaleString()} eligible wallets · root ${tree.root.slice(0, 10)}…`;
        renderWhitelistSummary();
        $('downloadWhitelistBtn')?.classList.remove('hidden');
      } catch (_) {}
    }
    forgeState.compiled = null;
    updateRevealUi();
    updateWhitelistUi();
    bridge().updateLaunchSummary?.();
  }

  function getWhitelistSummary() {
    const enabled = !!$('whitelistEnabled')?.checked;
    const wl = forgeState.whitelist;
    return {
      publicMintEnabled: !!$('publicMintEnabled')?.checked,
      whitelistEnabled: enabled,
      whitelistMintPrice: $('whitelistMintPrice')?.value || '0',
      root: enabled && wl ? wl.root : null,
      eligibleWallets: enabled && wl ? wl.entries.length : 0,
      sourceType: enabled && wl ? wl.sourceType : 0,
      sourceContract: enabled && wl ? wl.sourceContract : null,
      sourceChainId: enabled && wl ? (wl.sourceChainId || 0) : 0,
      snapshotBlock: enabled && wl ? wl.snapshotBlock : 0,
      defaultAllowance: $('whitelistDefaultAllowance')?.value || '1',
    };
  }

  function getCompiledSummary() {
    const c = forgeState.compiled;
    if (!c) return null;
    return {
      provenance: c.provenance,
      sourceBytes: c.sourceBytes,
      artBytes: c.artBytes,
      dnaBytes: c.dnaBytes,
      placeholderBytes: c.placeholderBytes.length,
      totalCompiledBytes: c.totalCompiledBytes,
      artShards: c.artShards.length,
      dnaShards: c.dnaShards.length,
      recipeCount: c.recipeCount,
      revealMode: c.core.revealMode === 0 ? 'forge' : 'creator',
    };
  }

  function bind() {
    document.querySelectorAll('input[name="platformFeeMode"]').forEach(input => input.addEventListener('change', () => refreshPlatformFeeQuote().catch(() => {})));
    document.querySelectorAll('input[name="revealMode"]').forEach(input => input.addEventListener('change', () => { updateRevealUi(); refreshVrfQuote().catch(() => {}); }));
    $('creatorPlaceholderInput')?.addEventListener('change', event => {
      forgeState.placeholderFile = event.target.files?.[0] || null;
      $('creatorPlaceholderName').textContent = forgeState.placeholderFile ? forgeState.placeholderFile.name : 'PNG, WEBP, JPG, GIF, or SVG';
      invalidateCompile('Placeholder changed — recompile for onchain.');
    });
    $('compileOnchainBtn')?.addEventListener('click', compileForOnchain);
    $('refreshForgeCostBtn')?.addEventListener('click', refreshCostEstimate);
    $('vrfFundingRequests')?.addEventListener('input', () => refreshVrfQuote().catch(() => {}));
    $('connectForgeWalletBtn')?.addEventListener('click', () => connectWallet().catch(() => {}));
    window.addEventListener('relicforge:wallet-disconnected', () => resetWalletSessionUi('No wallet connected.'));
    $('forgeCollectionBtn')?.addEventListener('click', forgeCollection);
    $('forgeArmMintBtn')?.addEventListener('click', armMasterMint);
    $('forgeMintTestBtn')?.addEventListener('click', mintTest);
    $('forgeWhitelistMintBtn')?.addEventListener('click', whitelistMintTest);
    $('forgeCreatorMintBtn')?.addEventListener('click', creatorMintTest);
    $('forgeDeferredRevealBtn')?.addEventListener('click', requestDeferredReveal);
    $('forgeProcessRevealBtn')?.addEventListener('click', processReadyReveal);
    $('forgeInspectBtn')?.addEventListener('click', inspectToken);
    $('previewMintPageBtn')?.addEventListener('click', () => updateMintPagePreview().catch(() => {}));
    $('publishMintPageBtn')?.addEventListener('click', async () => { try { if ($('mintPageStatus')) $('mintPageStatus').textContent = 'Publishing mint page + whitelist proofs to RelicForge Cloud…'; await publishMintPageCloud(); if ($('mintPageStatus')) $('mintPageStatus').textContent = '✓ Published. Mint aesthetics and whitelist proofs are now available cross-device.'; } catch (error) { if ($('mintPageStatus')) $('mintPageStatus').textContent = `Publish: ${error.message}`; } });
    $('openMintPageBtn')?.addEventListener('click', openMintPage);
    $('downloadMintPageBtn')?.addEventListener('click', downloadStandaloneMintPage);
    $('mintPageImageInput')?.addEventListener('change', event => {
      try {
        forgeState.mintPageImageFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection image');
        if ($('mintPageImageName')) $('mintPageImageName').textContent = forgeState.mintPageImageFile ? `${forgeState.mintPageImageFile.name} · ${(forgeState.mintPageImageFile.size / 1024 / 1024).toFixed(2)} MB` : '2 MB max · any image format · animated GIF supported';
        updateMintPagePreview().catch(() => {});
      } catch (error) {
        event.target.value = ''; forgeState.mintPageImageFile = null;
        if ($('mintPageImageName')) $('mintPageImageName').textContent = `Image rejected: ${error.message}`;
      }
    });
    $('mintPageBannerInput')?.addEventListener('change', event => {
      try {
        forgeState.mintPageBannerFile = validateMintPageMedia(event.target.files?.[0] || null, 'Collection banner');
        if ($('mintPageBannerName')) $('mintPageBannerName').textContent = forgeState.mintPageBannerFile ? `${forgeState.mintPageBannerFile.name} · ${(forgeState.mintPageBannerFile.size / 1024 / 1024).toFixed(2)} MB` : '2 MB max · any image format · animated GIF supported';
        updateMintPagePreview().catch(() => {});
      } catch (error) {
        event.target.value = ''; forgeState.mintPageBannerFile = null;
        if ($('mintPageBannerName')) $('mintPageBannerName').textContent = `Banner rejected: ${error.message}`;
      }
    });
    $('viewerUseForgedBtn')?.addEventListener('click', () => { if (forgeState.collectionAddress && $('viewerCollectionAddress')) $('viewerCollectionAddress').value = forgeState.collectionAddress; });
    $('viewerLoadBtn')?.addEventListener('click', () => loadViewerCollection(true).catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }));
    $('viewerPrevBtn')?.addEventListener('click', () => { forgeState.viewerPage = Math.max(1, forgeState.viewerPage - 1); renderViewerPage().catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }); });
    $('viewerNextBtn')?.addEventListener('click', () => { forgeState.viewerPage += 1; renderViewerPage().catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }); });
    $('viewerContractUriBtn')?.addEventListener('click', readViewerContractUri);
    $('launchedProjectsBtn')?.addEventListener('click', openLaunchedDashboard);
    $('launchedDashboardCloseBtn')?.addEventListener('click', () => launchedModal(false));
    $('launchedDashboardBackdrop')?.addEventListener('click', () => launchedModal(false));
    $('launchedConnectBtn')?.addEventListener('click', () => connectWallet().then(loadLaunchedProjects).catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedRefreshBtn')?.addEventListener('click', () => loadLaunchedProjects().catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedManualAddBtn')?.addEventListener('click', addManualLaunchedCollection);
    $('whitelistEnabled')?.addEventListener('change', updateWhitelistUi);
    $('publicMintEnabled')?.addEventListener('change', updateWhitelistUi);
    document.querySelectorAll('input[name="whitelistSourceMode"]').forEach(input => input.addEventListener('change', () => {
      forgeState.whitelist = null;
      if ($('whitelistStatus')) $('whitelistStatus').textContent = 'Whitelist source changed — rebuild the whitelist.';
      renderWhitelistSummary();
      $('downloadWhitelistBtn')?.classList.add('hidden');
      updateWhitelistUi();
    }));
    $('snapshotWhitelistBtn')?.addEventListener('click', snapshotCollectionHolders);
    $('buildCustomWhitelistBtn')?.addEventListener('click', buildCustomWhitelist);
    $('downloadWhitelistBtn')?.addEventListener('click', () => { try { exportWhitelistProofs(); } catch (error) { $('whitelistStatus').textContent = error.message; } });
    $('whitelistFileInput')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if ($('whitelistFileName')) $('whitelistFileName').textContent = file ? file.name : 'CSV, TXT, or JSON';
      forgeState.whitelist = null;
      if ($('whitelistStatus')) $('whitelistStatus').textContent = 'Whitelist file changed — rebuild the whitelist.';
      renderWhitelistSummary();
      $('downloadWhitelistBtn')?.classList.add('hidden');
    });
    ['whitelistDefaultAllowance', 'whitelistSourceChain', 'whitelistCollectionAddress', 'whitelistCustomText'].forEach(id => $(id)?.addEventListener('input', () => {
      if (!forgeState.whitelist) return;
      forgeState.whitelist = null;
      if ($('whitelistStatus')) $('whitelistStatus').textContent = 'Whitelist settings changed — rebuild the whitelist.';
      renderWhitelistSummary();
      $('downloadWhitelistBtn')?.classList.add('hidden');
    }));
    document.querySelectorAll('input[name="gweiMode"]').forEach(input => input.addEventListener('change', updateGweiUi));
    $('forgeCustomGwei')?.addEventListener('input', () => refreshCostEstimate().catch(() => {}));
    ['launchName', 'launchSymbol', 'launchDescription', 'mintPrice', 'maxPerWallet', 'royalty', 'royaltyWallet'].forEach(id => $(id)?.addEventListener('input', () => {
      if (forgeState.compiled && ['launchName', 'launchSymbol', 'launchDescription'].includes(id)) invalidateCompile('Collection metadata changed — recompile for onchain.');
    }));
    ['launchName', 'launchDescription'].forEach(id => $(id)?.addEventListener('input', () => updateMintPagePreview().catch(() => {})));
    renderCanonicalV1();
    refreshPlatformFeeQuote().catch(() => {});
    refreshVrfQuote().catch(() => {});
    const cloudReady = !!window.RelicForgeCloud?.enabled?.();
    if (cloudReady) loadCloudNetworkCatalog().catch(error => console.warn('RelicForge Alchemy network catalog unavailable:', error.message));
    const renderHost = String(window.RELICFORGE_CONFIG?.renderBase || window.RelicForgeCloud?.apiBase?.() || '').replace(/\/$/, '');
    if ($('rendererCloudStatus')) $('rendererCloudStatus').textContent = cloudReady
      ? `Cloud renderer ready at ${renderHost || window.RelicForgeCloud.apiBase()}. Offchain images are generated from the contract's canonical renderToken() output and cached in Railway object storage. Animated renders are preserved as SVG; static renders may be cached as PNG.`
      : 'Cloud renderer is not configured yet. Set apiBase/renderBase in relicforge-config.js after the Railway API is deployed. Fully-onchain SVG rendering still works without Cloud.';
    if ($('publishMintPageBtn')) $('publishMintPageBtn').disabled = !cloudReady || !forgeState.collectionAddress;
    updateRevealUi();
    updateMintPagePreview().catch(() => {});
    updateWhitelistUi();
    updateGweiUi();
    const viewerFromQuery = new URLSearchParams(window.location.search).get('viewer');
    if (viewerFromQuery && window.ethers?.isAddress(viewerFromQuery) && $('viewerCollectionAddress')) {
      $('viewerCollectionAddress').value = viewerFromQuery;
      setTimeout(() => loadViewerCollection(true).catch(() => {}), 0);
    }
  }

  async function bindCreatorDashboardPage() {
    $('launchedConnectBtn')?.addEventListener('click', () => connectWallet().then(loadLaunchedProjects).catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedChangeWalletBtn')?.addEventListener('click', () => changeForgeWallet().then(loadLaunchedProjects).catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedDisconnectBtn')?.addEventListener('click', () => disconnectForgeWallet().catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedRefreshBtn')?.addEventListener('click', () => loadLaunchedProjects().catch(error => { if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`; }));
    $('launchedManualAddBtn')?.addEventListener('click', addManualLaunchedCollection);
    const onAccountsChanged = accounts => {
      window.RelicForgeCloud?.clearSession?.();
      const next = accounts?.[0] || null;
      resetWalletSessionUi(next ? 'Wallet account changed.' : 'Wallet disconnected.');
      if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = next
        ? 'Wallet account changed in your extension. Click Connect Wallet to sign in and load this account’s launched projects.'
        : 'Wallet disconnected. Connect a creator wallet to rediscover launched collections.';
    };
    if (window.RelicForgeWallets?.ready) {
      window.addEventListener('relicforge:wallet-accounts-changed', event => onAccountsChanged(event.detail?.accounts || []));
      window.addEventListener('relicforge:wallet-provider-changed', event => {
        if (!event.detail?.provider) onAccountsChanged([]);
      });
      try { await window.RelicForgeWallets.ready(); } catch {}
    } else {
      window.ethereum?.on?.('accountsChanged', onAccountsChanged);
    }
    restoreInfra();
    if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = 'Connect your creator wallet to rediscover launched collections.';
    try {
      const injected = activeInjectedWallet();
      const accounts = await injected?.request?.({ method: 'eth_accounts' });
      if (accounts?.[0]) { await connectWallet(); await loadLaunchedProjects(); }
    } catch (error) {
      if ($('launchedDashboardStatus')) $('launchedDashboardStatus').textContent = `Dashboard: ${error.message}`;
    }
  }

  window.RelicForgeForge = { version: '11.1.6', getCompiledSummary, getWhitelistSummary, compileForOnchain, refreshCostEstimate, getForgeProjectState, restoreForgeProjectState, connectWallet, changeWallet: changeForgeWallet, disconnectWallet: disconnectForgeWallet };
  if (document.body.classList.contains('dashboard-page-body')) bindCreatorDashboardPage();
  else bind();
})();
