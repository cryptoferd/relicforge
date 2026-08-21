(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  const MAX_TRAIT_BYTES = 22000;
  const MAX_SHARD_BYTES = 22000;
  const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
  const INFRA_KEY = 'relicforge_sepolia_test_infra_v10_5_1';

  const WHITELIST_SOURCE_CHAINS = {
    1: { chainId: 1, label: 'Ethereum Mainnet', rpc: 'https://ethereum-rpc.publicnode.com' },
    11155111: { chainId: 11155111, label: 'Ethereum Sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
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

  function whitelistSourceChainConfig() {
    const chainId = Number($('whitelistSourceChain')?.value || 1);
    return WHITELIST_SOURCE_CHAINS[chainId] || WHITELIST_SOURCE_CHAINS[1];
  }

  function whitelistSourceProvider() {
    const config = whitelistSourceChainConfig();
    return new window.ethers.JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true });
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

  async function findDeploymentBlock(provider, address, latestBlock) {
    let lo = 0, hi = latestBlock;
    try {
      const currentCode = await provider.getCode(address, latestBlock);
      if (!currentCode || currentCode === '0x') throw new Error('No contract code at that address.');
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const code = await provider.getCode(address, mid);
        if (code && code !== '0x') hi = mid; else lo = mid + 1;
      }
      return lo;
    } catch (_) {
      return 0;
    }
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
      const provider = whitelistSourceProvider();
      $('whitelistStatus').textContent = `Connecting to ${chain.label}…`;
      const snapshotBlock = await provider.getBlockNumber();
      const code = await provider.getCode(source, snapshotBlock);
      if (!code || code === '0x') throw new Error(`No contract exists at this address on ${chain.label}. Check the Source network selection.`);
      const contract = new window.ethers.Contract(source, ['function supportsInterface(bytes4) view returns(bool)'], provider);
      let is1155 = false, is721 = false;
      try { is1155 = await contract.supportsInterface('0xd9b67a26'); } catch (_) {}
      try { is721 = await contract.supportsInterface('0x80ac58cd'); } catch (_) {}
      if (!is721 && !is1155) throw new Error(`A contract exists on ${chain.label}, but it does not report ERC-721 or ERC-1155 support through ERC-165.`);
      const deploymentBlock = await findDeploymentBlock(provider, source, snapshotBlock);
      $('whitelistStatus').textContent = `Scanning ${is1155 ? 'ERC-1155' : 'ERC-721'} on ${chain.label} · blocks ${deploymentBlock.toLocaleString()}-${snapshotBlock.toLocaleString()}…`;
      const zero = window.ethers.ZeroAddress.toLowerCase();
      let addresses = [];
      if (is1155) {
        const singleTopic = window.ethers.id('TransferSingle(address,address,address,uint256,uint256)');
        const batchTopic = window.ethers.id('TransferBatch(address,address,address,uint256[],uint256[])');
        const logs = await getLogsChunked(provider, { address: source, topics: [[singleTopic, batchTopic]] }, deploymentBlock, snapshotBlock, (cursor, end, count) => {
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
        const topic = window.ethers.id('Transfer(address,address,uint256)');
        const logs = await getLogsChunked(provider, { address: source, topics: [topic] }, deploymentBlock, snapshotBlock, (cursor, end, count) => {
          $('whitelistStatus').textContent = `Scanning ERC-721 · block ${Math.min(cursor, end).toLocaleString()} / ${end.toLocaleString()} · ${count.toLocaleString()} transfers`;
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
      const entries = normalizeWhitelistEntries(addresses, allowance);
      const tree = buildMerkleWhitelist(entries);
      setWhitelistResult({ ...tree, sourceType: 1, sourceContract: window.ethers.getAddress(source), sourceChainId: chain.chainId, sourceChainLabel: chain.label, snapshotBlock, tokenStandard: is1155 ? 'ERC-1155' : 'ERC-721', uniformAllowance: allowance });
    } catch (error) {
      $('whitelistStatus').textContent = `Snapshot error: ${error.message}`;
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
    let chosenData = sourceData;
    let encodingCode = raster?.code ?? 0;
    let encoding = raster ? `raw-${raster.label}` : 'svg-fragment';

    // PNG is already highly compressed. Vectorizing every pixel can be much larger,
    // so compare lossless representations and store whichever is smallest.
    if (raster?.code === 1) {
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
      const bytes = trait.data;
      if (!(bytes instanceof Uint8Array)) throw new Error(`Missing compiled bytes for ${trait.layerName} / ${trait.name}.`);
      if (bytes.length > MAX_TRAIT_BYTES) throw new Error(`${trait.layerName} / ${trait.name} needs ${fmtBytes(bytes.length)} after lossless optimization, above the ${fmtBytes(MAX_TRAIT_BYTES)} v10 test limit.`);
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
    const mintAccess = 125000;
    return { clone, art, dna, placeholder, traits, layerNames, finalize, mintAccess, total: clone + art + dna + placeholder + traits + layerNames + finalize + mintAccess };
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
    let feeText = 'Connect wallet for live Sepolia fee data';
    let liveGwei = null;
    try {
      if (forgeState.provider && window.ethers) {
        const fee = await forgeState.provider.getFeeData();
        forgeState.gasPrice = fee.gasPrice || fee.maxFeePerGas;
        if (forgeState.gasPrice) liveGwei = Number(window.ethers.formatUnits(forgeState.gasPrice, 'gwei'));
      }
    } catch (_) {}
    if ($('forgeCurrentGwei')) $('forgeCurrentGwei').textContent = liveGwei == null ? 'Current: unavailable' : `Current: ${liveGwei.toFixed(2)} gwei`;

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
      ['DNA shard writes', b.dna], ['Placeholder storage', b.placeholder],
      ['Finalize + provenance', b.finalize], ['Mint access / whitelist root', b.mintAccess],
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
      const worker = new Worker('./js/solc-worker.js?v=10.5.1');
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
      const factory = await deployOne('RelicForgeFactory', [implementation, randomness, true]);
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
      const maxPerWallet = Math.max(0, Math.floor(Number($('maxPerWallet')?.value || 0)));
      if (maxPerWallet > 4294967295) throw new Error('Max per wallet is too large.');
      const publicMintEnabled = !!$('publicMintEnabled')?.checked;
      const whitelistEnabled = !!$('whitelistEnabled')?.checked;
      if (!publicMintEnabled && !whitelistEnabled) throw new Error('Enable public mint, whitelist mint, or both.');
      if (whitelistEnabled && !forgeState.whitelist) throw new Error('Build or snapshot the whitelist before forging.');
      const whitelistMintPrice = window.ethers.parseEther(String(Number($('whitelistMintPrice')?.value || 0)));
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
        { label: 'Configure mint access', status: 'pending' },
      ];
      renderDeployProgress(steps);
      let si = 0;
      steps[0].status = 'active'; renderDeployProgress(steps);
      const tx = await factory.createCollection(c.core.name, c.core.symbol, c.core.description, c.recipeCount, c.core.canvas[0], c.core.canvas[1], c.layerDefs.length, c.core.revealMode, mintPrice, maxPerWallet, royaltyWallet, royaltyBps);
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
      if ($('viewerCollectionAddress')) $('viewerCollectionAddress').value = collectionAddress;

      const collection = new window.ethers.Contract(collectionAddress, forgeState.contractArtifacts.RelicCollectionV1.abi, forgeState.signer);
      for (let i = 0; i < c.artShards.length; i++, si++) await sendStep(`Write artwork shard ${i + 1}/${c.artShards.length}`, () => collection.addArtShard(window.ethers.hexlify(c.artShards[i])), steps, si);
      await sendStep('Register layer names', () => collection.setLayerNames(c.layerDefs.map(layer => layer.name)), steps, si++);
      for (let start = 0, batch = 1; start < c.traits.length; start += 30, batch++, si++) {
        const items = c.traits.slice(start, start + 30);
        const traitInputs = items.map(t => [t.layerIndex, t.traitIndex, t.name, t.shard, t.offset, t.length, t.encodingCode]);
        await sendStep(`Register trait batch ${batch}/${traitBatches}`, () => collection.addTraits(traitInputs), steps, si);
      }
      for (let i = 0; i < c.dnaShards.length; i++, si++) await sendStep(`Write DNA shard ${i + 1}/${c.dnaShards.length}`, () => collection.addDnaShard(window.ethers.hexlify(c.dnaShards[i])), steps, si);
      await sendStep('Configure DNA', () => collection.setDNAConfig(c.recipeCount, c.recipesPerShard), steps, si++);
      await sendStep('Store reveal placeholder', () => collection.setPlaceholder(window.ethers.hexlify(c.placeholderBytes)), steps, si++);
      await sendStep('Finalize provenance', () => collection.finalizeData(c.provenance), steps, si++);
      const wl = forgeState.whitelist;
      await sendStep('Configure mint access', () => collection.setMintAccess(
        publicMintEnabled,
        whitelistEnabled,
        whitelistEnabled ? wl.root : window.ethers.ZeroHash,
        whitelistMintPrice,
        whitelistEnabled ? wl.sourceContract : window.ethers.ZeroAddress,
        whitelistEnabled ? BigInt(wl.sourceChainId || 0) : 0n,
        whitelistEnabled ? BigInt(wl.snapshotBlock || 0) : 0n,
        whitelistEnabled ? wl.sourceType : 0
      ), steps, si++);

      $('forgeMintTestBtn').disabled = !publicMintEnabled;
      $('forgeWhitelistMintBtn').disabled = !whitelistEnabled;
      $('forgeCreatorMintBtn').disabled = false;
      $('forgeInspectBtn').disabled = false;
      $('forgeCreatorRevealBtn').disabled = c.core.revealMode !== 1;
      log('forgeTestStatus', `Collection ready: ${collectionAddress}`, true);
      bridge().showStatus?.('Collection forged on Sepolia.', 'success');
      loadViewerCollection(true).catch(() => {});
    } catch (error) {
      log('forgeTestStatus', `FORGE ERROR: ${error.message}`, true);
    }
  }

  function collectionContract() {
    if (!forgeState.collectionAddress) throw new Error('No forged collection loaded.');
    if (!forgeState.signer) throw new Error('Connect the creator wallet first.');
    return new window.ethers.Contract(forgeState.collectionAddress, forgeState.contractArtifacts.RelicCollectionV1.abi, forgeState.signer);
  }

  function requestedMintQuantity() {
    const quantity = Math.floor(Number($('forgeMintQuantity')?.value || 1));
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error('Mint quantity must be at least 1.');
    return quantity;
  }

  async function mintTest() {
    try {
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      const price = await collection.mintPrice();
      log('forgeTestStatus', `Public minting ${quantity} NFT${quantity === 1 ? '' : 's'}…`, true);
      const tx = await collection['mint(uint32)'](quantity, { value: price * BigInt(quantity) });
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      forgeState.latestTokenId = tokenIds.length ? tokenIds[0] : null;
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      const revealNote = currentRevealMode() === 0 ? 'Forge Reveal test randomness auto-fulfilled during mint.' : 'Creator Reveal placeholder remains active until the creator triggers reveal.';
      log('forgeTestStatus', `✓ Minted ${tokenIds.length || quantity} token${(tokenIds.length || quantity) === 1 ? '' : 's'} in one transaction.\n${revealNote}`);
      await inspectToken();
      loadViewerCollection(false).catch(() => {});
    } catch (error) {
      log('forgeTestStatus', `MINT ERROR: ${error.message}`, true);
    }
  }

  async function whitelistMintTest() {
    try {
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      if (!forgeState.wallet) await connectWallet();
      if (!forgeState.whitelist) throw new Error('No whitelist is loaded in this Studio project.');
      const entry = forgeState.whitelist.proofByAddress?.[forgeState.wallet.toLowerCase()];
      if (!entry) throw new Error('Connected wallet is not on this whitelist. Add it to a custom list or test with an eligible snapshot holder.');
      const price = await collection.whitelistMintPrice();
      log('forgeTestStatus', `Whitelist minting ${quantity} NFT${quantity === 1 ? '' : 's'} with allowance ${entry.allowance}…`, true);
      const tx = await collection.whitelistMint(quantity, entry.allowance, entry.proof, { value: price * BigInt(quantity) });
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const logEntry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(logEntry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      log('forgeTestStatus', `✓ Whitelist minted ${tokenIds.length || quantity} token${(tokenIds.length || quantity) === 1 ? '' : 's'} in one transaction.`);
      await inspectToken();
      loadViewerCollection(false).catch(() => {});
    } catch (error) {
      log('forgeTestStatus', `WHITELIST MINT ERROR: ${error.message}`, true);
    }
  }

  async function creatorMintTest() {
    try {
      const collection = collectionContract();
      const quantity = requestedMintQuantity();
      log('forgeTestStatus', `Creator minting ${quantity} NFT${quantity === 1 ? '' : 's'}…`, true);
      const tx = await collection.creatorMint(quantity);
      const receipt = await tx.wait();
      const tokenIds = [];
      for (const entry of receipt.logs) {
        try {
          const parsed = collection.interface.parseLog(entry);
          if (parsed?.name === 'Transfer' && parsed.args.from === window.ethers.ZeroAddress) tokenIds.push(BigInt(parsed.args.tokenId));
        } catch (_) {}
      }
      if (tokenIds.length) $('forgeInspectTokenId').value = tokenIds[0].toString();
      const revealNote = currentRevealMode() === 0 ? ' Forge Reveal test randomness auto-fulfilled.' : ' Creator Reveal placeholder remains active.';
      log('forgeTestStatus', `✓ Creator minted ${tokenIds.length || quantity} token${(tokenIds.length || quantity) === 1 ? '' : 's'} in one transaction. Wallet limit and mint price were bypassed.${revealNote}`);
      await inspectToken();
      loadViewerCollection(false).catch(() => {});
    } catch (error) {
      log('forgeTestStatus', `CREATOR MINT ERROR: ${error.message}`, true);
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
      log('forgeTestStatus', `✓ Creator reveal completed in the Sepolia auto-fulfill test flow${requestId != null ? ` · request #${requestId}` : ''}`);
      loadViewerCollection(false).catch(() => {});
    } catch (error) {
      log('forgeTestStatus', `REVEAL ERROR: ${error.message}`, true);
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
    if (!forgeState.signer) await connectWallet();
    const address = viewerAddressInput();
    if (!window.ethers.isAddress(address)) throw new Error('Enter a valid Sepolia collection address.');
    forgeState.viewerAddress = address;
    return new window.ethers.Contract(address, forgeState.contractArtifacts.RelicCollectionV1.abi, forgeState.signer);
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

  function getForgeProjectState() {
    const wl = forgeState.whitelist;
    return {
      schema: 'relic-forge/forge-settings@2',
      launchName: $('launchName')?.value || '',
      launchSymbol: $('launchSymbol')?.value || '',
      launchDescription: $('launchDescription')?.value || '',
      mintPrice: $('mintPrice')?.value || '0',
      maxPerWallet: $('maxPerWallet')?.value || '0',
      royalty: $('royalty')?.value || '0',
      royaltyWallet: $('royaltyWallet')?.value || '',
      revealMode: currentRevealMode(),
      placeholderFile: forgeState.placeholderFile || null,
      publicMintEnabled: !!$('publicMintEnabled')?.checked,
      whitelistEnabled: !!$('whitelistEnabled')?.checked,
      whitelistMintPrice: $('whitelistMintPrice')?.value || '0',
      whitelistDefaultAllowance: $('whitelistDefaultAllowance')?.value || '1',
      whitelistSourceMode: currentWhitelistSourceMode(),
      whitelistSourceChain: $('whitelistSourceChain')?.value || '1',
      whitelistCollectionAddress: $('whitelistCollectionAddress')?.value || '',
      whitelistCustomText: $('whitelistCustomText')?.value || '',
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
    if (!saved || !['relic-forge/forge-settings@1', 'relic-forge/forge-settings@2'].includes(saved.schema)) return;
    const values = {
      launchName: saved.launchName,
      launchSymbol: saved.launchSymbol,
      launchDescription: saved.launchDescription,
      mintPrice: saved.mintPrice,
      maxPerWallet: saved.maxPerWallet,
      royalty: saved.royalty,
      royaltyWallet: saved.royaltyWallet,
      whitelistMintPrice: saved.whitelistMintPrice,
      whitelistDefaultAllowance: saved.whitelistDefaultAllowance,
      whitelistSourceChain: saved.whitelistSourceChain || String(saved.whitelist?.sourceChainId || 1),
      whitelistCollectionAddress: saved.whitelistCollectionAddress,
      whitelistCustomText: saved.whitelistCustomText,
    };
    for (const [id, value] of Object.entries(values)) {
      const node = $(id);
      if (node && value != null) node.value = value;
    }
    const reveal = Number(saved.revealMode || 0);
    const radio = document.querySelector(`input[name="revealMode"][value="${reveal}"]`);
    if (radio) radio.checked = true;
    if ($('publicMintEnabled')) $('publicMintEnabled').checked = saved.publicMintEnabled !== false;
    if ($('whitelistEnabled')) $('whitelistEnabled').checked = !!saved.whitelistEnabled;
    const sourceMode = saved.whitelistSourceMode || (saved.whitelist?.sourceType === 2 ? 'custom' : 'snapshot');
    const sourceRadio = document.querySelector(`input[name="whitelistSourceMode"][value="${sourceMode}"]`);
    if (sourceRadio) sourceRadio.checked = true;
    forgeState.placeholderFile = saved.placeholderFile || null;
    if ($('creatorPlaceholderName')) $('creatorPlaceholderName').textContent = forgeState.placeholderFile ? forgeState.placeholderFile.name : 'PNG, WEBP, JPG, or SVG';
    forgeState.whitelist = null;
    if (saved.whitelist?.entries?.length) {
      try {
        const entries = normalizeWhitelistEntries(saved.whitelist.entries, 1);
        const tree = buildMerkleWhitelist(entries);
        forgeState.whitelist = { ...tree, ...saved.whitelist, entries };
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
    $('forgeWhitelistMintBtn')?.addEventListener('click', whitelistMintTest);
    $('forgeCreatorMintBtn')?.addEventListener('click', creatorMintTest);
    $('forgeCreatorRevealBtn')?.addEventListener('click', requestCreatorReveal);
    $('forgeInspectBtn')?.addEventListener('click', inspectToken);
    $('viewerUseForgedBtn')?.addEventListener('click', () => { if (forgeState.collectionAddress && $('viewerCollectionAddress')) $('viewerCollectionAddress').value = forgeState.collectionAddress; });
    $('viewerLoadBtn')?.addEventListener('click', () => loadViewerCollection(true).catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }));
    $('viewerPrevBtn')?.addEventListener('click', () => { forgeState.viewerPage = Math.max(1, forgeState.viewerPage - 1); renderViewerPage().catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }); });
    $('viewerNextBtn')?.addEventListener('click', () => { forgeState.viewerPage += 1; renderViewerPage().catch(error => { $('viewerStatus').textContent = `Viewer error: ${error.message}`; }); });
    $('viewerContractUriBtn')?.addEventListener('click', readViewerContractUri);
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
    restoreInfra();
    updateRevealUi();
    updateWhitelistUi();
    updateGweiUi();
  }

  window.RelicForgeForge = { getCompiledSummary, getWhitelistSummary, compileForOnchain, refreshCostEstimate, getForgeProjectState, restoreForgeProjectState };
  bind();
})();
