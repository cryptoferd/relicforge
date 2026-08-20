(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const MAX_TRAIT_BYTES = 22000;
  const MAX_SHARD_BYTES = 22000;
  const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
  const INFRA_KEY = 'relicforge_sepolia_test_infra_v10';

  const forgeState = {
    compiled: null,
    contractArtifacts: null,
    provider: null,
    signer: null,
    wallet: null,
    gasPrice: null,
    placeholderFile: null,
    collectionAddress: null,
    latestRequestId: null,
    latestTokenId: null,
    latestCreatorRevealRequestId: null,
    infra: null,
  };

  function bridge() {
    if (!window.RelicForgeStudioBridge) throw new Error('Studio bridge is unavailable. Reload the page.');
    return window.RelicForgeStudioBridge;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      const bytes = enc.encode(trait.fragment);
      if (bytes.length > MAX_TRAIT_BYTES) throw new Error(`${trait.layerName} / ${trait.name} compiles to ${fmtBytes(bytes.length)}, above the ${fmtBytes(MAX_TRAIT_BYTES)} v10 test limit.`);
      const prior = exactAssetIndex.get(trait.fragment);
      if (prior) {
        Object.assign(trait, prior, { deduped: true });
        continue;
      }
      if (currentLength + bytes.length > MAX_SHARD_BYTES) flush();
      trait.shard = shards.length;
      trait.offset = currentLength;
      trait.length = bytes.length;
      trait.deduped = false;
      exactAssetIndex.set(trait.fragment, { shard: trait.shard, offset: trait.offset, length: trait.length });
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
    const byLayer = new Map(layerDefs.map(layer => [layer.id, layer]));
    tokens.forEach((token, recipeIndex) => {
      for (let li = 0; li < layerDefs.length; li++) {
        const layer = layerDefs[li];
        const traitId = token.traits[layer.id];
        const index = layer.traits.findIndex(t => t.id === traitId);
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
      if (!studio.compilerReport || studio.compilerReport.ruleViolations || studio.compilerReport.exactIssues?.length) throw new Error('The Step 4 collection compiler still has rule or exact-count issues.');
      if (!studio.layers?.length) throw new Error('Upload artwork in Step 1 first.');
      const revealMode = currentRevealMode();
      if (revealMode === 1 && !forgeState.placeholderFile) throw new Error('Creator Reveal requires a creator-uploaded placeholder.');
      if (studio.layers.length > 255) throw new Error('The v1 DNA format supports at most 255 layers.');
      if (studio.imageWidth > 65535 || studio.imageHeight > 65535) throw new Error('Canvas dimensions exceed the v1 uint16 renderer limit.');

      setCompileProgress(2, 'Reading final Studio collection…');
      const layerDefs = studio.layers.map((layer, layerIndex) => {
        cleanMetadataString(layer.name, `Layer ${layerIndex + 1} name`);
        if (layer.traits.length > 256) throw new Error(`${layer.name} has more than 256 traits.`);
        return {
          id: layer.id,
          name: layer.name,
          index: layerIndex,
          traits: layer.traits.map((trait, traitIndex) => ({
            id: trait.id,
            name: cleanMetadataString(trait.name, `${layer.name} trait name`),
            trait,
            traitIndex,
          })),
        };
      });

      const compiledTraits = [];
      const totalTraits = layerDefs.reduce((n, layer) => n + layer.traits.length, 0);
      let done = 0;
      for (const layer of layerDefs) {
        for (const traitDef of layer.traits) {
          setCompileProgress(5 + 55 * (done / Math.max(1, totalTraits)), `Optimizing ${layer.name} / ${traitDef.name}…`);
          const source = traitDef.trait;
          const fragment = isNoneTrait(source) ? '<g/>' : await bridge().traitToSvgFragment(source);
          compiledTraits.push({
            ...traitDef,
            layerIndex: layer.index,
            layerName: layer.name,
            fragment: fragment || '<g/>',
            encoding: isNoneTrait(source) ? 'none' : 'pixel-rectangles',
            sourceBytes: source.file?.size || 0,
          });
          done++;
        }
      }

      setCompileProgress(64, 'Packing artwork into immutable bytecode shards…');
      const artShards = packTraitBytes(compiledTraits);
      setCompileProgress(73, 'Packing exact recipe DNA…');
      const dna = buildDna(studio, layerDefs);
      setCompileProgress(81, 'Compiling reveal placeholder…');
      const placeholder = forgeState.placeholderFile
        ? await compilePlaceholderFile(forgeState.placeholderFile, studio.imageWidth, studio.imageHeight)
        : { fragment: defaultForgePlaceholderFragment(studio.imageWidth, studio.imageHeight), encoding: 'relicforge-default' };
      const placeholderBytes = enc.encode(placeholder.fragment);
      if (placeholderBytes.length > MAX_TRAIT_BYTES) throw new Error(`Reveal placeholder compiles to ${fmtBytes(placeholderBytes.length)}, above the ${fmtBytes(MAX_TRAIT_BYTES)} test limit.`);

      setCompileProgress(88, 'Generating provenance commitment…');
      const core = {
        schema: 'relic-forge/onchain-compile@0.1',
        name: cleanMetadataString($('launchName').value, 'Collection name'),
        symbol: cleanMetadataString($('launchSymbol').value, 'Symbol'),
        description: cleanMetadataString($('launchDescription').value, 'Description'),
        maxSupply: studio.compiledTokens.length,
        canvas: [studio.imageWidth, studio.imageHeight],
        revealMode,
        layers: layerDefs.map(layer => ({ name: layer.name, traits: layer.traits.map(t => t.name) })),
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
    const vals = [
      fmtBytes(c.sourceBytes), fmtBytes(c.artBytes), fmtBytes(c.dnaBytes),
      String(c.artShards.length), String(c.dnaShards.length),
      `${Math.max(0, 100 - (c.totalCompiledBytes / Math.max(1, c.sourceBytes)) * 100).toFixed(1)}%`,
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
      `<div class="forge-check good">✓ ${c.artShards.length + c.dnaShards.length + 1} data shard(s) including placeholder</div>`,
      `<div class="forge-check good">✓ ${c.core.revealMode === 0 ? 'Forge Reveal' : 'Creator Reveal'} configured</div>`,
      ...warnings.map(w => `<div class="forge-check warn">⚠ ${esc(w)}</div>`),
    ].join('');
    $('forgeProvenance').innerHTML = `Collection provenance <code>${esc(c.provenance)}</code>`;
    $('forgeCompiledSummary').innerHTML = `<strong>${esc(c.core.name)}</strong> · ${c.recipeCount.toLocaleString()} NFTs · ${c.layerDefs.length} layers · ${c.traits.length} traits · ${fmtBytes(c.totalCompiledBytes)} compiled · ${c.artShards.length} art shard(s) + ${c.dnaShards.length} DNA shard(s).`;
  }

  function roughGasBreakdown(c) {
    const shardGas = bytes => 75000 + bytes * 225;
    const art = c.artShards.reduce((n, shard) => n + shardGas(shard.length), 0);
    const dna = c.dnaShards.reduce((n, shard) => n + shardGas(shard.length), 0);
    const placeholder = shardGas(c.placeholderBytes.length);
    const clone = 360000;
    const traits = 70000 + c.traits.length * 30000;
    const layerNames = 45000 + c.layerDefs.length * 22000;
    const finalize = 180000;
    return { clone, art, dna, placeholder, traits, layerNames, finalize, total: clone + art + dna + placeholder + traits + layerNames + finalize };
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
    let feeText = 'Connect wallet for live Sepolia fee data';
    try {
      if (forgeState.provider && window.ethers) {
        const fee = await forgeState.provider.getFeeData();
        forgeState.gasPrice = fee.gasPrice || fee.maxFeePerGas;
        if (forgeState.gasPrice) {
          const wei = BigInt(b.total) * forgeState.gasPrice;
          totalText = `~${Number(window.ethers.formatEther(wei)).toFixed(5)} Sepolia ETH`;
          feeText = `~${b.total.toLocaleString()} gas at ${Number(window.ethers.formatUnits(forgeState.gasPrice, 'gwei')).toFixed(2)} gwei`;
        }
      }
    } catch (error) {
      feeText = `Live fee unavailable: ${error.message}`;
    }
    $('forgeEstimatedCost').textContent = totalText;
    $('forgeEstimatedGas').textContent = feeText;
    const labels = [
      ['Collection clone + initialize', b.clone], ['Artwork shard writes', b.art],
      ['Trait index/name setup', b.traits], ['Layer names', b.layerNames],
      ['DNA shard writes', b.dna], ['Placeholder storage', b.placeholder],
      ['Finalize + provenance', b.finalize],
    ];
    $('forgeCostBreakdown').innerHTML = labels.map(([name, gas]) => `<div class="forge-row"><span>${esc(name)}</span><strong>~${gas.toLocaleString()} gas</strong></div>`).join('');
  }

  async function switchSepolia() {
    if (!window.ethereum) throw new Error('No injected EVM wallet found.');
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId.toLowerCase() === SEPOLIA_CHAIN_ID_HEX) return;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] }],
      });
    }
  }

  async function connectWallet() {
    try {
      if (!window.ethers) throw new Error('ethers.js did not load. Check the internet connection and reload.');
      await switchSepolia();
      forgeState.provider = new window.ethers.BrowserProvider(window.ethereum);
      await forgeState.provider.send('eth_requestAccounts', []);
      forgeState.signer = await forgeState.provider.getSigner();
      forgeState.wallet = await forgeState.signer.getAddress();
      window.dispatchEvent(new CustomEvent('relicforge:wallet-connected', { detail: { address: forgeState.wallet } }));
      $('forgeWalletStatus').textContent = `${forgeState.wallet.slice(0, 6)}…${forgeState.wallet.slice(-4)} · Sepolia`;
      $('connectForgeWalletBtn').textContent = 'Wallet Connected';
      if (!$('royaltyWallet').value.trim()) $('royaltyWallet').value = forgeState.wallet;
      restoreInfra();
      await refreshCostEstimate();
      return forgeState.wallet;
    } catch (error) {
      $('forgeWalletStatus').textContent = `Wallet error: ${error.message}`;
      throw error;
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
      const worker = new Worker('./js/solc-worker.js');
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
      RelicCollectionV1: pick('RelicCollectionV1'),
      RelicRandomnessMock: pick('RelicRandomnessMock'),
      RelicForgeFactory: pick('RelicForgeFactory'),
    };
    const runtimeSizes = Object.fromEntries(Object.entries(forgeState.contractArtifacts).map(([name, artifact]) => [name, (artifact.deployedBytecode.length - 2) / 2]));
    if (runtimeSizes.RelicCollectionV1 > 24576) throw new Error(`RelicCollectionV1 runtime is ${runtimeSizes.RelicCollectionV1} bytes, above the EIP-170 limit.`);
    log('forgeInfraStatus', `Compiled with ${result.version}.\nRelicCollectionV1: ${runtimeSizes.RelicCollectionV1} bytes runtime\nRelicRandomnessMock: ${runtimeSizes.RelicRandomnessMock} bytes runtime\nRelicForgeFactory: ${runtimeSizes.RelicForgeFactory} bytes runtime\n✓ Ready for Sepolia test deployment.`);
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
      const implementation = await deployOne('RelicCollectionV1');
      const randomness = await deployOne('RelicRandomnessMock');
      const factory = await deployOne('RelicForgeFactory', [implementation, randomness]);
      forgeState.infra = { implementation, randomness, factory };
      localStorage.setItem(INFRA_KEY, JSON.stringify(forgeState.infra));
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
      if (!$('factoryAddress').value.trim()) $('factoryAddress').value = infra.factory;
      if (!$('randomnessAddress').value.trim()) $('randomnessAddress').value = infra.randomness || '';
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

  async function forgeCollection() {
    try {
      if (!forgeState.compiled) throw new Error('Compile the collection for onchain first.');
      if (currentRevealMode() !== forgeState.compiled.core.revealMode) throw new Error('Reveal mode changed after compilation. Recompile first.');
      if (!forgeState.signer) await connectWallet();
      await compileContracts();
      const factoryAddress = $('factoryAddress').value.trim();
      if (!window.ethers.isAddress(factoryAddress)) throw new Error('Deploy or enter a valid Sepolia Factory address.');
      const royaltyWallet = $('royaltyWallet').value.trim() || forgeState.wallet;
      if (!window.ethers.isAddress(royaltyWallet)) throw new Error('Royalty wallet is invalid.');
      const royaltyBps = Math.round(Number($('royalty').value || 0) * 100);
      if (royaltyBps < 0 || royaltyBps > 1000) throw new Error('Royalty must be between 0% and 10% in Studio.');
      const mintPrice = window.ethers.parseEther(String(Number($('mintPrice').value || 0)));
      const c = forgeState.compiled;
      const factory = new window.ethers.Contract(factoryAddress, forgeState.contractArtifacts.RelicForgeFactory.abi, forgeState.signer);
      const traitBatches = Math.ceil(c.traits.length / 30);
      const steps = [
        { label: 'Create ERC-721 clone', status: 'pending' },
        ...c.artShards.map((_, i) => ({ label: `Write artwork shard ${i + 1}/${c.artShards.length}`, status: 'pending' })),
        { label: 'Register layer names', status: 'pending' },
        ...Array.from({ length: traitBatches }, (_, i) => ({ label: `Register trait batch ${i + 1}/${traitBatches}`, status: 'pending' })),
        ...c.dnaShards.map((_, i) => ({ label: `Write DNA shard ${i + 1}/${c.dnaShards.length}`, status: 'pending' })),
        { label: 'Configure DNA', status: 'pending' },
        { label: 'Store reveal placeholder', status: 'pending' },
        { label: 'Finalize provenance', status: 'pending' },
      ];
      renderDeployProgress(steps);
      let si = 0;
      steps[0].status = 'active'; renderDeployProgress(steps);
      const tx = await factory.createCollection(c.core.name, c.core.symbol, c.core.description, c.recipeCount, c.core.canvas[0], c.core.canvas[1], c.layerDefs.length, c.core.revealMode, mintPrice, royaltyWallet, royaltyBps);
      const receipt = await tx.wait();
      let collectionAddress = null;
      for (const entry of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(entry);
          if (parsed?.name === 'CollectionCreated') { collectionAddress = parsed.args.collection; break; }
        } catch (_) {}
      }
      if (!collectionAddress) throw new Error('CollectionCreated event was not found.');
      forgeState.collectionAddress = collectionAddress;
      steps[0].status = 'done'; si = 1; renderDeployProgress(steps);
      $('forgedCollectionAddress').textContent = collectionAddress;
      $('forgedEtherscanLink').href = `https://sepolia.etherscan.io/address/${collectionAddress}`;
      $('forgeResult').classList.remove('hidden');

      const collection = new window.ethers.Contract(collectionAddress, forgeState.contractArtifacts.RelicCollectionV1.abi, forgeState.signer);
      for (let i = 0; i < c.artShards.length; i++, si++) await sendStep(`Write artwork shard ${i + 1}/${c.artShards.length}`, () => collection.addArtShard(window.ethers.hexlify(c.artShards[i])), steps, si);
      await sendStep('Register layer names', () => collection.setLayerNames(c.layerDefs.map(layer => layer.name)), steps, si++);
      for (let start = 0, batch = 1; start < c.traits.length; start += 30, batch++, si++) {
        const items = c.traits.slice(start, start + 30);
        await sendStep(`Register trait batch ${batch}/${traitBatches}`, () => collection.addTraits(items.map(t => t.layerIndex), items.map(t => t.traitIndex), items.map(t => t.name), items.map(t => t.shard), items.map(t => t.offset), items.map(t => t.length)), steps, si);
      }
      for (let i = 0; i < c.dnaShards.length; i++, si++) await sendStep(`Write DNA shard ${i + 1}/${c.dnaShards.length}`, () => collection.addDnaShard(window.ethers.hexlify(c.dnaShards[i])), steps, si);
      await sendStep('Configure DNA', () => collection.setDNAConfig(c.recipeCount, c.recipesPerShard), steps, si++);
      await sendStep('Store reveal placeholder', () => collection.setPlaceholder(window.ethers.hexlify(c.placeholderBytes)), steps, si++);
      await sendStep('Finalize provenance', () => collection.finalizeData(c.provenance), steps, si++);

      $('forgeMintTestBtn').disabled = false;
      $('forgeInspectBtn').disabled = false;
      $('forgeCreatorRevealBtn').disabled = c.core.revealMode !== 1;
      $('forgeFulfillBtn').disabled = true;
      log('forgeTestStatus', `Collection ready: ${collectionAddress}`, true);
      bridge().showStatus?.('Collection forged on Sepolia.', 'success');
    } catch (error) {
      log('forgeTestStatus', `FORGE ERROR: ${error.message}`, true);
    }
  }

  function collectionContract() {
    if (!forgeState.collectionAddress) throw new Error('No forged collection loaded.');
    if (!forgeState.signer) throw new Error('Connect the creator wallet first.');
    return new window.ethers.Contract(forgeState.collectionAddress, forgeState.contractArtifacts.RelicCollectionV1.abi, forgeState.signer);
  }

  async function mintTest() {
    try {
      const collection = collectionContract();
      const price = await collection.mintPrice();
      log('forgeTestStatus', 'Minting test NFT…', true);
      const tx = await collection.mint({ value: price });
      const receipt = await tx.wait();
      let tokenId = null, requestId = null;
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenId = parsed.args.tokenId;
          if (parsed?.name === 'ForgeRequested') requestId = parsed.args.requestId;
        } catch (_) {}
      }
      forgeState.latestTokenId = tokenId != null ? BigInt(tokenId) : null;
      forgeState.latestRequestId = requestId != null ? BigInt(requestId) : null;
      if (tokenId != null) $('forgeInspectTokenId').value = tokenId.toString();
      log('forgeTestStatus', `✓ Minted token #${tokenId?.toString() || '?'}${requestId != null ? `\nForge randomness request #${requestId}` : '\nCreator Reveal placeholder active.'}`);
      $('forgeFulfillBtn').disabled = requestId == null;
      await inspectToken();
    } catch (error) {
      log('forgeTestStatus', `MINT ERROR: ${error.message}`, true);
    }
  }

  async function requestCreatorReveal() {
    try {
      const collection = collectionContract();
      log('forgeTestStatus', 'Requesting Creator Reveal randomness…', true);
      const tx = await collection.requestCreatorReveal();
      const receipt = await tx.wait();
      let requestId = null;
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'CreatorRevealRequested') requestId = parsed.args.requestId;
        } catch (_) {}
      }
      forgeState.latestCreatorRevealRequestId = requestId != null ? BigInt(requestId) : null;
      forgeState.latestRequestId = forgeState.latestCreatorRevealRequestId;
      $('forgeFulfillBtn').disabled = requestId == null;
      log('forgeTestStatus', `✓ Creator reveal requested${requestId != null ? ` · request #${requestId}` : ''}`);
    } catch (error) {
      log('forgeTestStatus', `REVEAL ERROR: ${error.message}`, true);
    }
  }

  async function fulfillLatest() {
    try {
      if (forgeState.latestRequestId == null) throw new Error('No pending test randomness request. Mint with Forge Reveal or request Creator Reveal first.');
      const randomnessAddress = $('randomnessAddress').value.trim() || forgeState.infra?.randomness || '';
      if (!window.ethers.isAddress(randomnessAddress)) throw new Error('Randomness mock address is missing.');
      const mock = new window.ethers.Contract(randomnessAddress, forgeState.contractArtifacts.RelicRandomnessMock.abi, forgeState.signer);
      log('forgeTestStatus', `Fulfilling TEST randomness request #${forgeState.latestRequestId}…`, true);
      const tx = await mock.fulfill(forgeState.latestRequestId);
      await tx.wait();
      log('forgeTestStatus', '✓ Test randomness fulfilled. Metadata is now revealable.');
      forgeState.latestRequestId = null;
      $('forgeFulfillBtn').disabled = true;
      await inspectToken();
    } catch (error) {
      log('forgeTestStatus', `RANDOMNESS ERROR: ${error.message}`, true);
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

  function getForgeProjectState() {
    return {
      schema: 'relic-forge/forge-settings@1',
      launchName: $('launchName')?.value || '',
      launchSymbol: $('launchSymbol')?.value || '',
      launchDescription: $('launchDescription')?.value || '',
      mintPrice: $('mintPrice')?.value || '0',
      royalty: $('royalty')?.value || '0',
      royaltyWallet: $('royaltyWallet')?.value || '',
      revealMode: currentRevealMode(),
      placeholderFile: forgeState.placeholderFile || null,
    };
  }

  function restoreForgeProjectState(saved) {
    if (!saved || saved.schema !== 'relic-forge/forge-settings@1') return;
    const values = {
      launchName: saved.launchName,
      launchSymbol: saved.launchSymbol,
      launchDescription: saved.launchDescription,
      mintPrice: saved.mintPrice,
      royalty: saved.royalty,
      royaltyWallet: saved.royaltyWallet,
    };
    for (const [id, value] of Object.entries(values)) {
      const node = $(id);
      if (node && value != null) node.value = value;
    }
    const reveal = Number(saved.revealMode || 0);
    const radio = document.querySelector(`input[name="revealMode"][value="${reveal}"]`);
    if (radio) radio.checked = true;
    forgeState.placeholderFile = saved.placeholderFile || null;
    if ($('creatorPlaceholderName')) $('creatorPlaceholderName').textContent = forgeState.placeholderFile ? forgeState.placeholderFile.name : 'PNG, WEBP, JPG, or SVG';
    forgeState.compiled = null;
    updateRevealUi();
    bridge().updateLaunchSummary?.();
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
    document.querySelectorAll('input[name="revealMode"]').forEach(input => input.addEventListener('change', updateRevealUi));
    $('creatorPlaceholderInput')?.addEventListener('change', event => {
      forgeState.placeholderFile = event.target.files?.[0] || null;
      $('creatorPlaceholderName').textContent = forgeState.placeholderFile ? forgeState.placeholderFile.name : 'PNG, WEBP, JPG, or SVG';
      invalidateCompile('Placeholder changed — recompile for onchain.');
    });
    $('compileOnchainBtn')?.addEventListener('click', compileForOnchain);
    $('refreshForgeCostBtn')?.addEventListener('click', refreshCostEstimate);
    $('connectForgeWalletBtn')?.addEventListener('click', () => connectWallet().catch(() => {}));
    $('compileForgeContractsBtn')?.addEventListener('click', () => compileContracts().catch(error => log('forgeInfraStatus', `ERROR: ${error.message}`)));
    $('deployForgeInfraBtn')?.addEventListener('click', deployInfrastructure);
    $('forgeCollectionBtn')?.addEventListener('click', forgeCollection);
    $('forgeMintTestBtn')?.addEventListener('click', mintTest);
    $('forgeFulfillBtn')?.addEventListener('click', fulfillLatest);
    $('forgeCreatorRevealBtn')?.addEventListener('click', requestCreatorReveal);
    $('forgeInspectBtn')?.addEventListener('click', inspectToken);
    ['launchName', 'launchSymbol', 'launchDescription', 'mintPrice', 'royalty', 'royaltyWallet'].forEach(id => $(id)?.addEventListener('input', () => {
      if (forgeState.compiled && ['launchName', 'launchSymbol', 'launchDescription'].includes(id)) invalidateCompile('Collection metadata changed — recompile for onchain.');
    }));
    restoreInfra();
    updateRevealUi();
  }

  window.RelicForgeForge = { getCompiledSummary, compileForOnchain, refreshCostEstimate, getForgeProjectState, restoreForgeProjectState };
  bind();
})();
