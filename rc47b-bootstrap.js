(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const collabProjectId = () => new URLSearchParams(location.search).get('collab') || null;

  function injectShowcaseControls() {
    const host = document.querySelector('.mint-page-media-settings');
    if (!host || $('rc47bShowcaseEnabled')) return;
    const wrap = document.createElement('div');
    wrap.className = 'rc47b-showcase-controls';
    wrap.innerHTML = `
      <label class="rc47b-showcase-toggle"><input id="rc47bShowcaseEnabled" type="checkbox"/><span><strong>Show on Upcoming Mints</strong><br/><small>Opt this published mint page into Relic Forge discovery.</small></span></label>
      <label class="field"><span>Upcoming start fallback</span><input id="rc47bShowcaseStart" type="datetime-local"/><small>The earliest enabled phase start is used automatically when scheduled. This fallback is only for phases without a start time.</small></label>`;
    const status = $('mintPageStatus');
    if (status) host.insertBefore(wrap, status);
    else host.appendChild(wrap);
  }

  function scheduledShowcaseStartFromControls() {
    const candidates = [
      [$('publicMintEnabled')?.checked, $('publicMintStart')?.value],
      [$('whitelistEnabled')?.checked, $('whitelistMintStart')?.value],
    ].filter(([enabled, value]) => enabled && value).map(([, value]) => new Date(value)).filter(date => Number.isFinite(date.getTime()));
    if (!candidates.length) return null;
    return new Date(Math.min(...candidates.map(date => date.getTime()))).toISOString();
  }

  function showcaseState() {
    return {
      showcaseEnabled: !!$('rc47bShowcaseEnabled')?.checked,
      showcaseStart: scheduledShowcaseStartFromControls() || $('rc47bShowcaseStart')?.value || null,
    };
  }

  function setShowcaseState(value = {}) {
    if ($('rc47bShowcaseEnabled')) $('rc47bShowcaseEnabled').checked = !!value.showcaseEnabled;
    if ($('rc47bShowcaseStart')) {
      const raw = value.showcaseStart || value.showcaseStartAt || '';
      if (!raw) $('rc47bShowcaseStart').value = '';
      else {
        const d = new Date(raw);
        if (Number.isFinite(d.getTime())) {
          const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16);
          $('rc47bShowcaseStart').value = local;
        } else $('rc47bShowcaseStart').value = String(raw).slice(0,16);
      }
    }
  }

  function wrapForgeState() {
    const forge = window.RelicForgeForge;
    if (!forge || forge.__rc47bWrapped) return;
    const originalGet = forge.getForgeProjectState?.bind(forge);
    const originalRestore = forge.restoreForgeProjectState?.bind(forge);
    // Replace the exported facade instead of mutating it in place. This remains
    // safe if a future Forge build freezes its public API object.
    const wrapped = { ...forge, __rc47bWrapped:true };
    if (originalGet) wrapped.getForgeProjectState = (...args) => ({ ...originalGet(...args), ...showcaseState() });
    if (originalRestore) wrapped.restoreForgeProjectState = async (value, ...args) => {
      const result = await originalRestore(value, ...args);
      setShowcaseState(value || {});
      return result;
    };
    window.RelicForgeForge = wrapped;
  }

  async function sharedMintPageAsset(file, projectId) {
    const ctx = window.RelicForgeCollabContext;
    if (ctx?.active && ctx.uploadAsset) return ctx.uploadAsset(file, 'mint_page');
    return window.RelicForgeCloud.uploadAsset(file, { projectId, purpose:'mint-page' });
  }

  async function publishV1(args) {
    const cloud = window.RelicForgeCloud;
    const forgeState = window.RelicForgeForge?.getForgeProjectState?.() || {};
    const chainId = Number(args.chainId || 11155111);
    const contract = String(args.contract || forgeState.collectionAddress || '');
    const projectId = args.projectId || collabProjectId() || null;
    if (!contract || !forgeState.collectionAddress || contract.toLowerCase() !== String(forgeState.collectionAddress).toLowerCase()) {
      throw new Error('The V1 mint page is not bound to the currently forged collection.');
    }
    const collectionImage = args.collectionImageFile ? await sharedMintPageAsset(args.collectionImageFile, projectId) : null;
    const bannerImage = args.bannerImageFile ? await sharedMintPageAsset(args.bannerImageFile, projectId) : null;
    const show = showcaseState();
    if (show.showcaseEnabled && !show.showcaseStart) throw new Error('Choose a mint start date/time before enabling Upcoming Mints.');
    const publishedConfig = {
      ...(args.config || {}),
      schema: 'relic-forge/mint-page@2',
      chainId,
      contract,
      title: $('launchName')?.value?.trim() || args.config?.title || args.config?.collectionTitle || 'Relic Forge Collection',
      description: $('launchDescription')?.value?.trim() || args.config?.description || '',
      publicPhaseId: Number(forgeState.publicPhaseId || 0) || null,
      whitelistPhaseId: Number(forgeState.whitelistPhaseId || 0) || null,
      collectionImageAssetId: collectionImage?.id || args.config?.collectionImageAssetId || null,
      bannerImageAssetId: bannerImage?.id || args.config?.bannerImageAssetId || null,
      showcaseEnabled: show.showcaseEnabled,
      showcaseStart: show.showcaseStart ? new Date(show.showcaseStart).toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    delete publishedConfig.collectionImage;
    delete publishedConfig.bannerImage;
    delete publishedConfig.whitelistEntries;
    await cloud.json(`/api/rc47b/collections/${chainId}/${encodeURIComponent(contract)}/mint-page`, {
      method:'PUT', body:JSON.stringify({ projectId, config:publishedConfig })
    }, true);

    const whitelist = args.whitelist;
    const collab = window.RelicForgeCollabContext;
    const mayPublishWhitelist = !collab?.active || collab.role === 'owner' || collab.permissions?.includes('launch');
    if (mayPublishWhitelist && whitelist?.entries?.length && whitelist?.root && publishedConfig.whitelistPhaseId) {
      const rows = whitelist.entries.map(entry => ({
        address: entry.address,
        allowance: Number(entry.allowance || 0),
        proof: whitelist.proofByAddress?.[String(entry.address).toLowerCase()]?.proof || []
      }));
      await cloud.json(`/api/rc47b/collections/${chainId}/${encodeURIComponent(contract)}/whitelist/${publishedConfig.whitelistPhaseId}`, {
        method:'PUT', body:JSON.stringify({
          projectId,
          merkleRoot: whitelist.root,
          sourceType: whitelist.sourceType || 0,
          sourceChainId: whitelist.sourceChainId || 0,
          sourceContract: whitelist.sourceContract || null,
          snapshotBlock: whitelist.snapshotBlock || 0,
          entries: rows
        })
      }, true);
    }
    return publishedConfig;
  }

  function wrapCloudPublish() {
    const cloud = window.RelicForgeCloud;
    if (!cloud || cloud.__rc47bPublishWrapped) return;
    const original = cloud.publishMintPage?.bind(cloud);
    const wrapped = { ...cloud, __rc47bPublishWrapped:true };
    wrapped.publishMintPage = async args => {
      const forgeState = window.RelicForgeForge?.getForgeProjectState?.() || {};
      if (forgeState.collectionAddress && (forgeState.publicPhaseId || forgeState.whitelistPhaseId)) return publishV1(args || {});
      if (!original) throw new Error('Legacy mint-page publisher is unavailable.');
      return original(args);
    };
    window.RelicForgeCloud = wrapped;
  }

  function enableV1MintPageButtons() {
    const state = window.RelicForgeForge?.getForgeProjectState?.() || {};
    const hasV1 = !!state.collectionAddress && !!(state.publicPhaseId || state.whitelistPhaseId);
    if (!hasV1) return;
    ['openMintPageBtn','publishMintPageBtn','downloadMintPageBtn'].forEach(id => { const btn=$(id); if (btn) btn.disabled=false; });
    const status = $('mintPageStatus');
    if (status && /next UI patch|intentionally disabled/i.test(status.textContent || '')) {
      status.textContent = 'Canonical V1 mint-page adapter ready. Publish to bind the configured phase IDs and current quoteMint fee behavior.';
    }
  }

  async function buildV1Standalone() {
    const state = window.RelicForgeForge?.getForgeProjectState?.() || {};
    if (!state.collectionAddress) throw new Error('Forge a V1 collection before downloading its mint page.');
    const show = showcaseState();
    const config = {
      schema:'relic-forge/mint-page@2', chainId:11155111, contract:state.collectionAddress,
      title:$('launchName')?.value?.trim() || 'Relic Forge Collection',
      description:$('launchDescription')?.value?.trim() || '',
      publicPhaseId:Number(state.publicPhaseId||0)||null,
      whitelistPhaseId:Number(state.whitelistPhaseId||0)||null,
      showcaseEnabled:show.showcaseEnabled,
      showcaseStart:show.showcaseStart ? new Date(show.showcaseStart).toISOString() : null,
    };
    const cloud = window.RelicForgeCloud;
    const projectId = collabProjectId();
    const image = state.mintPageImageFile ? await sharedMintPageAsset(state.mintPageImageFile, projectId) : null;
    const banner = state.mintPageBannerFile ? await sharedMintPageAsset(state.mintPageBannerFile, projectId) : null;
    config.collectionImageAssetId = image?.id || null;
    config.bannerImageAssetId = banner?.id || null;

    const [template, walletJs, adapterJs, timingJs, mintJs] = await Promise.all([
      fetch('./mint.html').then(r=>r.text()), fetch('./wallet.js').then(r=>r.text()), fetch('./mint-v1-adapter.js').then(r=>r.text()), fetch('./rc47c-mint-timing.js').then(r=>r.text()), fetch('./mint.js').then(r=>r.text())
    ]);
    const runtime = `window.RELICFORGE_CONFIG=${JSON.stringify({
      apiBase: window.RELICFORGE_CONFIG?.apiBase || '', cloudEnabled:true, mintRpcMode:window.RELICFORGE_CONFIG?.mintRpcMode || 'public-first'
    })};window.RELICFORGE_MINT_CONFIG=${JSON.stringify(config)};`;
    // In the normal hosted page ethers/wallet/adapter/mint are all deferred and
    // preserve order. A standalone export inlines the local scripts, so execute the
    // combined runtime at DOMContentLoaded; deferred ethers.js is guaranteed to have
    // executed before that event fires.
    const combinedRuntime = `${walletJs}\n${adapterJs}\n${timingJs}\n${mintJs}`;
    let html = template
      .replace(/<script src="\.\/relicforge-config\.js[^>]*><\/script>/, `<script>${runtime}<\/script>`)
      .replace(/<script src="\.\/wallet\.js[^>]*><\/script>/, '')
      .replace(/<script src="\.\/mint-v1-adapter\.js[^>]*><\/script>/, '')
      .replace(/<script src="\.\/rc47c-mint-timing\.js[^>]*><\/script>/, '')
      .replace(/<script src="\.\/mint\.js[^>]*><\/script>/, `<script>window.addEventListener('DOMContentLoaded',()=>{${combinedRuntime}});<\/script>`)
      .replace(/href="\.\/rc47b\.css[^"]*"/g, 'href="https://cryptoferd.github.io/relicforge/rc47b.css"')
      .replace(/href="\.\/rc47c\.css[^"]*"/g, 'href="https://cryptoferd.github.io/relicforge/rc47c.css"')
      .replace(/href="\.\/relic-forge-logo\.svg"/g, 'href="https://cryptoferd.github.io/relicforge/relic-forge-logo.svg"')
      .replace(/src="\.\/relic-forge-logo\.svg"/g, 'src="https://cryptoferd.github.io/relicforge/relic-forge-logo.svg"');
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download=`${(config.title||'relic-forge').replace(/[^a-z0-9_-]+/gi,'-').toLowerCase()}-mint.html`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function interceptV1Standalone() {
    const btn = $('downloadMintPageBtn');
    if (!btn || btn.dataset.rc47bBound) return;
    btn.dataset.rc47bBound='1';
    btn.addEventListener('click', event => {
      const state = window.RelicForgeForge?.getForgeProjectState?.() || {};
      if (!state.collectionAddress || !(state.publicPhaseId || state.whitelistPhaseId)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      buildV1Standalone().catch(error => { const status=$('mintPageStatus'); if(status)status.textContent=`Standalone mint page error: ${error.message}`; });
    }, true);
  }

  function init() {
    injectShowcaseControls();
    wrapForgeState();
    wrapCloudPublish();
    interceptV1Standalone();
    enableV1MintPageButtons();
    const target = $('forgedCollectionAddress') || $('forgeResult');
    if (target) new MutationObserver(() => setTimeout(enableV1MintPageButtons, 0)).observe(target, {childList:true,subtree:true,characterData:true,attributes:true});
    setInterval(enableV1MintPageButtons, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init,0));
  else setTimeout(init,0);
})();
