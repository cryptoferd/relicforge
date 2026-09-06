(() => {
  'use strict';

  if (!document.body?.classList.contains('studio-page-body')) return;
  const $=id=>document.getElementById(id);
  const CHAIN_ID=11155111;

  function mintUrl(collection) {
    const url=new URL('./mint.html',location.href);
    url.searchParams.set('contract',collection);
    url.searchParams.set('chain',String(CHAIN_ID));
    return url.toString();
  }
  function dashboardUrl(collection) {
    const url=new URL('./dashboard.html',location.href);
    url.searchParams.set('collection',collection);
    return url.toString();
  }
  function etherscanUrl(collection) {
    return `https://sepolia.etherscan.io/address/${collection}`;
  }

  function ensurePermanentLinks(collection) {
    if (!window.ethers?.isAddress(collection)) return;
    const result=$('forgeResult');
    if (!result) return;
    let row=$('r2PermanentMintLinks');
    if(!row){
      row=document.createElement('div');
      row.id='r2PermanentMintLinks';
      row.className='r2-permanent-mint-links';
      result.appendChild(row);
    }
    row.innerHTML=`<a class="primary-btn link-btn" href="${mintUrl(collection)}" target="_blank" rel="noreferrer">Open Mint Page</a>
      <a class="ghost-btn link-btn" href="${etherscanUrl(collection)}" target="_blank" rel="noreferrer">View Contract</a>
      <button class="ghost-btn" id="r2SyncMintPageBtn" type="button">Repair / Sync Mint Proofs</button>`;
    $('r2SyncMintPageBtn')?.addEventListener('click',()=>syncCurrentProject().catch(error=>setSyncStatus(`Mint page sync failed: ${error.message}`,true)));
  }

  function setSyncStatus(message,bad=false){
    const node=$('mintPageStatus');
    if(node){node.textContent=message;node.style.color=bad?'#d9a1a1':'';}
    const popup=$('r2LaunchSyncStatus');
    if(popup){popup.textContent=message;popup.classList.toggle('bad',!!bad);}
  }

  async function currentWallet(){
    const provider=window.RelicForgeWallets?.getProvider?.()||window.ethereum;
    if(!provider?.request)throw new Error('Creator wallet provider is unavailable.');
    let accounts=await provider.request({method:'eth_accounts'});
    if(!accounts?.[0]&&window.RelicForgeWallets?.requestAccount) {
      const account=await window.RelicForgeWallets.requestAccount({forceChooser:false});
      accounts=account?[account]:[];
    }
    if(!accounts?.[0])throw new Error('Connect the creator wallet before syncing the mint page.');
    return window.ethers.getAddress(accounts[0]);
  }

  async function uploadMintMedia(state,existing,projectId){
    let imageId=existing?.collectionImageAssetId||null;
    let bannerId=existing?.bannerImageAssetId||null;
    if(state?.mintPageImageFile instanceof Blob){
      const asset=await window.RelicForgeCloud.uploadAsset(state.mintPageImageFile,{projectId,purpose:'mint-page'});
      imageId=asset?.id||imageId;
    }
    if(state?.mintPageBannerFile instanceof Blob){
      const asset=await window.RelicForgeCloud.uploadAsset(state.mintPageBannerFile,{projectId,purpose:'mint-page'});
      bannerId=asset?.id||bannerId;
    }
    return {imageId,bannerId};
  }

  async function publish(detail) {
    if(!window.RelicForgeCloud?.enabled?.())throw new Error('RelicForge Cloud is not configured. Public stages still work from the onchain mint page, but Approved Wallet proofs require Cloud sync.');
    const collection=detail?.collectionAddress;
    if(!window.ethers?.isAddress(collection))throw new Error('Collection address is unavailable.');
    const wallet=await currentWallet();
    await window.RelicForgeCloud.ensureSignedIn(wallet);
    const projectId=window.RelicForgeProjects?.getCurrentProjectId?.()||null;
    const state=window.RelicForgeForge?.getForgeProjectState?.()||{};
    let existing={};
    try {
      const response=await window.RelicForgeCloud.json(`/api/public/mint/${CHAIN_ID}/${encodeURIComponent(collection)}/config`);
      existing=response?.config||{};
    } catch (_) {}
    const media=await uploadMintMedia(state,existing,projectId);
    const publicPhaseId=Number(detail.publicPhaseId||state.publicPhaseId||0)||null;
    const allowlists=Array.isArray(detail.allowlists)?detail.allowlists:[];
    const config={
      schema:'relic-forge/mint-page@3',
      protocol:'r12-v2',
      chainId:CHAIN_ID,
      contract:collection,
      title:String(state.launchName||existing.title||'Relic Forge Collection').slice(0,180),
      description:String(state.launchDescription||existing.description||'').slice(0,3000),
      mintPhasesAddress:detail.mintPhasesAddress||state.mintPhasesAddress||null,
      publicPhaseId,
      allowlistPhaseIds:allowlists.map(row=>Number(row.phaseId)).filter(Boolean),
      collectionImageAssetId:media.imageId,
      bannerImageAssetId:media.bannerId,
      showcaseEnabled:Boolean(existing.showcaseEnabled),
      showcaseStart:existing.showcaseStart||null,
      updatedAt:new Date().toISOString(),
    };
    await window.RelicForgeCloud.json(`/api/collections/${CHAIN_ID}/${encodeURIComponent(collection)}/mint-page`,{
      method:'PUT',body:JSON.stringify({projectId,config})
    },true);
    for(const row of allowlists){
      if(!Number(row.phaseId)||!row.root||!Array.isArray(row.entries))continue;
      await window.RelicForgeCloud.json(`/api/collections/${CHAIN_ID}/${encodeURIComponent(collection)}/v2/whitelist/${Number(row.phaseId)}`,{
        method:'PUT',
        body:JSON.stringify({
          projectId,
          merkleRoot:row.root,
          sourceType:Number(row.sourceType||0),
          sourceChainId:Number(row.sourceChainId||0),
          sourceContract:row.sourceContract||null,
          snapshotBlock:Number(row.snapshotBlock||0),
          entries:row.entries
        })
      },true);
    }
    return config;
  }

  async function syncCurrentProject() {
    const detail=window.RelicForgeStudioR13?.getPublicationDetail?.();
    if(!detail?.collectionAddress)throw new Error('No launched R12-v2 collection is loaded in this Studio project.');
    setSyncStatus('Repairing / syncing R12-v2 mint page and Approved Wallet proofs…');
    await publish(detail);
    setSyncStatus('Mint page + Approved Wallet proofs synced. Eligibility is ready for the collector page.');
    window.dispatchEvent(new CustomEvent('relicforge:v2-proof-sync-complete',{detail:{collectionAddress:detail.collectionAddress}}));
    ensurePermanentLinks(detail.collectionAddress);
  }

  function showLaunchPopup(detail) {
    const collection=detail.collectionAddress;
    let overlay=$('r2LaunchCompleteOverlay');
    if(overlay)overlay.remove();
    overlay=document.createElement('div');
    overlay.id='r2LaunchCompleteOverlay';
    overlay.className='r2-launch-overlay';
    overlay.innerHTML=`<div class="r2-launch-modal" role="dialog" aria-modal="true" aria-labelledby="r2LaunchTitle">
      <div class="eyebrow">R12-v2 LAUNCH COMPLETE</div>
      <h2 id="r2LaunchTitle">Collection forged on Sepolia</h2>
      <p>Every required launch transaction and configured MintPhases stage has confirmed.</p>
      <code>${collection}</code>
      <div class="r2-launch-actions">
        <a class="primary-btn link-btn" href="${mintUrl(collection)}" target="_blank" rel="noreferrer">Open Mint Page</a>
        <a class="ghost-btn link-btn" href="${etherscanUrl(collection)}" target="_blank" rel="noreferrer">View on Etherscan</a>
        <a class="ghost-btn link-btn" href="${dashboardUrl(collection)}" target="_blank" rel="noreferrer">Open Creator Dashboard</a>
      </div>
      <div class="r2-launch-sync" id="r2LaunchSyncStatus">Syncing mint-page metadata and Approved Wallet proofs…</div>
      <button class="ghost-btn r2-launch-close" id="r2LaunchCloseBtn" type="button">Close</button>
    </div>`;
    document.body.appendChild(overlay);
    $('r2LaunchCloseBtn')?.addEventListener('click',()=>overlay.remove());
    overlay.addEventListener('click',event=>{if(event.target===overlay)overlay.remove();});
  }

  async function onLaunchComplete(event) {
    const detail=event.detail||{};
    if(!window.ethers?.isAddress(detail.collectionAddress))return;
    ensurePermanentLinks(detail.collectionAddress);
    if($('openMintPageBtn')){$('openMintPageBtn').disabled=false;$('openMintPageBtn').textContent='Open Mint Page';}
    if($('publishMintPageBtn')){$('publishMintPageBtn').disabled=!window.RelicForgeCloud?.enabled?.();$('publishMintPageBtn').textContent='Sync Mint Page';}
    showLaunchPopup(detail);
    try {
      await publish(detail);
      setSyncStatus('Mint page synced. Public and Approved Wallet stages are ready.');
      window.dispatchEvent(new CustomEvent('relicforge:v2-proof-sync-complete',{detail:{collectionAddress:detail.collectionAddress}}));
    } catch(error) {
      setSyncStatus(`Launch is confirmed. Mint-page sync needs attention: ${error.message}`,true);
      window.dispatchEvent(new CustomEvent('relicforge:v2-proof-sync-failed',{detail:{collectionAddress:detail.collectionAddress,error:error.message}}));
    }
  }

  function installSyncButtonGuard(){
    const button=$('publishMintPageBtn');
    if(!button||button.dataset.r2Bound==='1')return;
    button.dataset.r2Bound='1';
    button.addEventListener('click',event=>{
      event.preventDefault();
      event.stopImmediatePropagation();
      syncCurrentProject().catch(error=>setSyncStatus(`Mint page sync failed: ${error.message}`,true));
    },true);
  }

  function install(){
    installSyncButtonGuard();
    window.addEventListener('relicforge:v2-launch-complete',onLaunchComplete);
    const state=window.RelicForgeForge?.getForgeProjectState?.();
    if(state?.collectionAddress&&window.ethers?.isAddress(state.collectionAddress)){
      ensurePermanentLinks(state.collectionAddress);
      if($('openMintPageBtn')){$('openMintPageBtn').disabled=false;$('openMintPageBtn').textContent='Open Mint Page';}
      if($('publishMintPageBtn')){$('publishMintPageBtn').disabled=!window.RelicForgeCloud?.enabled?.();$('publishMintPageBtn').textContent='Repair / Sync Proofs';}
      setSyncStatus('Existing R12-v2 launch detected. If this collection was forged before Collector R2, use Repair / Sync Proofs once to publish its Approved Wallet proof tables.');
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0));
  else setTimeout(install,0);
})();