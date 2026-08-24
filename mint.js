(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_BASE = String(window.RELICFORGE_CONFIG?.apiBase || '').replace(/\/$/, '');
  const apiUrl = path => `${API_BASE}${path}`;
  const ABI = [
    'function name() view returns (string)','function symbol() view returns (string)','function description() view returns (string)',
    'function maxSupply() view returns (uint32)','function totalMinted() view returns (uint32)','function maxPerWallet() view returns (uint32)',
    'function mintPrice() view returns (uint256)','function whitelistMintPrice() view returns (uint256)','function publicMintEnabled() view returns (bool)',
    'function whitelistMintEnabled() view returns (bool)','function whitelistRoot() view returns (bytes32)','function revealMode() view returns (uint8)',
    'function mintedByWallet(address) view returns (uint32)','function whitelistMintedByWallet(address) view returns (uint32)',
    'function ownerOf(uint256 tokenId) view returns (address)','function tokenURI(uint256 tokenId) view returns (string)','function balanceOf(address) view returns (uint256)',
    'function renderMode(uint256 tokenId) view returns (uint8)','function holderRenderModeEnabled() view returns (bool)','function setRenderMode(uint256 tokenId,uint8 mode)',
    'function mint(uint32 quantity) payable returns (uint256)','function whitelistMint(uint32 quantity,uint32 allowance,bytes32[] proof) payable returns (uint256)'
  ];
  const PUBLIC_RPC_FALLBACKS = {
    11155111: ['https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org','https://rpc.sepolia.org'],
    1: ['https://ethereum-rpc.publicnode.com','https://eth.drpc.org']
  };
  const MINT_RPC_MODE = String(window.RELICFORGE_CONFIG?.mintRpcMode || 'public-first').toLowerCase();
  function rpcCandidates(chainId){
    const id=Number(chainId);
    const publicList=[...(PUBLIC_RPC_FALLBACKS[id]||[])];
    const cloudList=API_BASE?[apiUrl(`/api/public/rpc/${id}`)]:[];
    // Public mint pages default to direct public RPCs so normal visitors do not
    // consume the creator's private Alchemy quota. Keep the Railway/Alchemy relay
    // available as a fallback and as a one-line future switch once PAYG is enabled.
    if(MINT_RPC_MODE==='alchemy-first'||MINT_RPC_MODE==='cloud-first')return [...cloudList,...publicList];
    if(MINT_RPC_MODE==='public-only')return publicList;
    return [...publicList,...cloudList];
  }
  const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
  const ZERO = ethers.ZeroAddress.toLowerCase();
  const params = new URLSearchParams(location.search);
  const embedded = window.RELICFORGE_MINT_CONFIG || {};
  const requestedContract = embedded.contract || params.get('contract') || '';
  const requestedChain = Number(embedded.chainId || params.get('chain') || 11155111);
  const localKey = requestedContract ? `relicforge_mint_page_${requestedChain}_${requestedContract.toLowerCase()}` : '';
  let localConfig = {};
  try { if (localKey) localConfig = JSON.parse(localStorage.getItem(localKey) || '{}'); } catch (_) {}
  let config = { ...localConfig, ...embedded, contract: requestedContract || localConfig.contract, chainId: requestedChain || localConfig.chainId || 11155111 };

  let browserProvider = null, publicProvider = null, signer = null, wallet = null, contract = null, contractState = null, whitelistData = null;
  let activeReadRpc = null;
  let mintedPage = 1, mintedSearchToken = null;
  const mintedPageSize = 10;
  let holders = [], holderPage = 1, holdersLoadedForMintCount = -1;
  const holderPageSize = 20;
  let currentTokenOwners = new Map(), myNftIds = [], myNftPage = 1;
  const tokenImageViewUris = new Map();
  const myNftPageSize = 10;
  let refreshSerial = 0;

  function shortAddr(v){return v && v.length>12?`${v.slice(0,6)}…${v.slice(-4)}`:(v||'—')}
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function status(msg){$('mintStatus').textContent=msg}
  function fmtEth(v){try{return `${Number(ethers.formatEther(v)).toLocaleString(undefined,{maximumFractionDigits:6})} ETH`}catch(_){return '—'}}
  function setQtyLimit(id,max){
    const input=$(id); if(!input)return;
    const limit=Math.max(0,Math.floor(Number(max)||0));
    input.max=String(limit); input.dataset.limit=String(limit); input.disabled=limit<1;
    if(limit<1){input.value='0';return}
    const current=Math.max(1,Math.floor(Number(input.value)||1));
    input.value=String(Math.min(current,limit));
  }
  function clampQty(id){
    const input=$(id); if(!input||input.disabled)return 0;
    const max=Math.max(1,Math.floor(Number(input.dataset.limit||input.max)||1));
    const value=Math.max(1,Math.floor(Number(input.value)||1));
    const clamped=Math.min(value,max); input.value=String(clamped); return clamped;
  }
  function bindStrictQty(id){
    const input=$(id); if(!input)return;
    ['input','change','blur','keyup'].forEach(eventName=>input.addEventListener(eventName,()=>clampQty(id)));
    input.addEventListener('keydown',event=>{if(event.key==='ArrowUp'&&Number(input.value)>=Number(input.max)){event.preventDefault();input.value=input.max}});
    input.addEventListener('wheel',()=>{if(document.activeElement===input)input.blur()},{passive:true});
  }
  function imageInto(id,src){if(!src)return;const host=$(id);host.innerHTML='';const img=document.createElement('img');img.src=src;img.alt='';host.appendChild(img)}
  function leaf(entry){return ethers.keccak256(ethers.solidityPacked(['address','uint32'],[entry.address,entry.allowance]))}
  function hashPair(a,b){if(!b)return a;return BigInt(a)<=BigInt(b)?ethers.keccak256(ethers.concat([a,b])):ethers.keccak256(ethers.concat([b,a]))}
  function buildWhitelist(entries){
    const valid=(entries||[]).filter(e=>e&&ethers.isAddress(e.address)&&Number(e.allowance)>0).map(e=>({address:ethers.getAddress(e.address),allowance:Number(e.allowance)})).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    if(!valid.length)return null; const leaves=valid.map(leaf),layers=[leaves];
    while(layers.at(-1).length>1){const c=layers.at(-1),n=[];for(let i=0;i<c.length;i+=2)n.push(i+1<c.length?hashPair(c[i],c[i+1]):c[i]);layers.push(n)}
    const by={};valid.forEach((e,index)=>{let cursor=index,proof=[];for(let level=0;level<layers.length-1;level++){const layer=layers[level],sib=cursor%2===0?cursor+1:cursor-1;if(sib<layer.length)proof.push(layer[sib]);cursor=Math.floor(cursor/2)}by[e.address.toLowerCase()]={...e,proof}});return{root:layers.at(-1)[0],by};
  }
  async function readConfigWhitelist(){
    if(Array.isArray(config.whitelistEntries)&&config.whitelistEntries.length)return buildWhitelist(config.whitelistEntries);
    if(config.whitelistUrl){try{const res=await fetch(config.whitelistUrl,{cache:'no-store'});if(res.ok){const data=await res.json();return buildWhitelist(data.entries||data.whitelist||data)}}catch(_) {}}
    return null;
  }
  async function apiJson(path){
    const res=await fetch(apiUrl(path),{headers:{accept:'application/json'}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`RelicForge API ${res.status}`);
    return data;
  }
  async function hydratePublishedConfig(){
    if(!API_BASE||!requestedContract||!ethers.isAddress(requestedContract))return;
    try{
      const res=await fetch(apiUrl(`/api/public/mint/${requestedChain}/${requestedContract}/config`),{headers:{accept:'application/json'},cache:'no-store'});
      const published=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(published.error||`RelicForge API ${res.status}`);
      config={...localConfig,...(published.config||{}),...embedded,contract:requestedContract,chainId:requestedChain};
    }catch(error){console.warn('RelicForge cloud mint config unavailable:',error.message)}
  }

  function walletErrorMessage(error){
    return error?.info?.error?.message || error?.error?.message || error?.data?.message || error?.shortMessage || error?.reason || error?.message || 'Unknown wallet error';
  }
  function activeInjectedWallet(){
    if(window.RelicForgeWallets)return window.RelicForgeWallets.getProvider?.()||null;
    return window.ethereum||null;
  }
  async function requestMintWalletAccount(){
    if(window.RelicForgeWallets?.requestAccount)return window.RelicForgeWallets.requestAccount();
    const provider=activeInjectedWallet();
    if(!provider?.request)throw new Error('No EVM wallet provider detected.');
    const accounts=await provider.request({method:'eth_requestAccounts'});
    if(!accounts?.[0])throw new Error('Wallet did not return an account.');
    return accounts[0];
  }
  async function ensureNetwork(){
    const provider=activeInjectedWallet();
    if(!provider?.request)throw new Error('No selected EVM wallet provider detected.');
    const chainId=Number(config.chainId||11155111);
    const hex='0x'+chainId.toString(16);
    const current=String(await provider.request({method:'eth_chainId'}));
    if(current.toLowerCase()===hex.toLowerCase())return;
    try{
      await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]});
    }catch(error){
      const code=error?.code ?? error?.info?.error?.code ?? error?.error?.code;
      if(Number(code)===4902 && chainId===11155111){
        await provider.request({method:'wallet_addEthereumChain',params:[{
          chainId:hex,
          chainName:'Ethereum Sepolia',
          nativeCurrency:{name:'Sepolia Ether',symbol:'ETH',decimals:18},
          rpcUrls:['https://ethereum-sepolia-rpc.publicnode.com'],
          blockExplorerUrls:['https://sepolia.etherscan.io']
        }]});
        return;
      }
      throw new Error(`Switch to Ethereum Sepolia failed: ${walletErrorMessage(error)}`);
    }
  }
  async function connect(){
    try{
      ++refreshSerial; // invalidate any slower anonymous refresh
      // Wallet connection is intentionally kept independent from collection/RPC
      // validation. A bad collection read must never make wallet connection fail.
      await requestMintWalletAccount();
      await ensureNetwork();

      // Recreate the BrowserProvider after a possible chain switch using the exact
      // injected wallet selected by the user (EIP-6963 when available).
      const injected=activeInjectedWallet();
      if(!injected)throw new Error('Selected wallet provider is unavailable.');
      browserProvider=new ethers.BrowserProvider(injected);
      signer=await browserProvider.getSigner();
      wallet=ethers.getAddress(await signer.getAddress());
      contract=new ethers.Contract(config.contract,ABI,signer);
      $('connectBtn').textContent=shortAddr(wallet);
      status(`Wallet connected: ${shortAddr(wallet)}. Loading collection…`);

      // Collection validation happens separately. refresh() reports contract/RPC
      // errors without undoing the connected wallet state.
      await refresh();
    }catch(error){
      signer=null; wallet=null; contract=null; browserProvider=null;
      $('connectBtn').textContent='Connect Wallet';
      status(`Wallet error: ${walletErrorMessage(error)}`);
    }
  }
  function getReadProvider(){
    // Mint-page reads are deliberately independent from the signing wallet.
    // V11.1.5 defaults to public RPC first; Railway/Alchemy remains a fallback.
    if(publicProvider)return publicProvider;
    const list=rpcCandidates(config.chainId);
    if(list.length){activeReadRpc=list[0];publicProvider=new ethers.JsonRpcProvider(list[0],Number(config.chainId),{staticNetwork:true,batchMaxCount:20});return publicProvider}
    if(browserProvider)return browserProvider;
    const injected=activeInjectedWallet();if(injected){browserProvider=new ethers.BrowserProvider(injected);return browserProvider}
    throw new Error('Connect a wallet to read this collection.');
  }
  async function readOnlyContract(){
    if(contract&&!API_BASE)return contract;
    const provider=await resolveAnonymousReadProvider();
    return new ethers.Contract(config.contract,ABI,provider);
  }
  function minimalProxyImplementation(code){
    const clean=String(code||'').toLowerCase();
    const match=clean.match(/^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/);
    return match?ethers.getAddress(`0x${match[1]}`):null;
  }
  async function probeCollectionProvider(provider){
    const code=await provider.getCode(config.contract);
    if(!code||code==='0x')throw new Error(`No contract exists at ${shortAddr(config.contract)} on chain ${config.chainId}.`);
    const implementation=minimalProxyImplementation(code);
    if(implementation){
      const implementationCode=await provider.getCode(implementation);
      if(!implementationCode||implementationCode==='0x')throw new Error(`Collection clone points to implementation ${shortAddr(implementation)}, but no implementation code exists on chain ${config.chainId}.`);
    }
    const c=new ethers.Contract(config.contract,ABI,provider);
    try{
      const name=await c.name();
      return {provider,contract:c,name,implementation};
    }catch(error){
      const reason=error?.shortMessage||error?.reason||error?.message||'call failed';
      const proxyNote=implementation?` Proxy implementation: ${implementation}.`:'';
      throw new Error(`Address ${config.contract} has contract code but name() reverted (${reason}).${proxyNote} Verify this is the collection clone, not the Factory, implementation, randomness, or storage address.`);
    }
  }
  async function resolveAnonymousReadProvider(){
    if(publicProvider)return publicProvider;
    if(!API_BASE&&browserProvider)return browserProvider;
    const candidates=rpcCandidates(config.chainId);
    let lastError=null;
    for(const rpc of candidates){
      try{
        const provider=new ethers.JsonRpcProvider(rpc,Number(config.chainId),{staticNetwork:true,batchMaxCount:20});
        await probeCollectionProvider(provider);
        publicProvider=provider;activeReadRpc=rpc;return provider;
      }catch(error){lastError=error}
    }
    {const injected=activeInjectedWallet();if(injected){
      try{browserProvider=new ethers.BrowserProvider(injected);await probeCollectionProvider(browserProvider);return browserProvider}catch(error){lastError=error}
    }}
    throw lastError||new Error('Unable to reach the collection through the available RPC providers.');
  }
  function decodeDataUri(uri){
    const comma=String(uri||'').indexOf(','); if(comma<0)return String(uri||'');
    const header=uri.slice(0,comma),payload=uri.slice(comma+1);
    try{return /;base64/i.test(header)?atob(payload):decodeURIComponent(payload)}catch(_){return payload}
  }
  function imageMarkup(src,name){
    if(!src)return '<div class="minted-thumb-empty">No image</div>';
    return `<img src="${esc(src)}" alt="${esc(name||'NFT')}" loading="lazy"/>`;
  }
  function browserViewUri(uri){
    const value=String(uri||'').trim();
    if(/^ipfs:\/\//i.test(value))return `https://ipfs.io/ipfs/${value.replace(/^ipfs:\/\/(?:ipfs\/)?/i,'')}`;
    if(/^ar:\/\//i.test(value))return `https://arweave.net/${value.replace(/^ar:\/\//i,'')}`;
    return value;
  }
  function dataUriBlobUrl(uri){
    const value=String(uri||'');
    const comma=value.indexOf(',');
    if(comma<0||!/^data:/i.test(value))throw new Error('Invalid data image URI.');
    const meta=value.slice(5,comma);
    const payload=value.slice(comma+1);
    const mime=(meta.split(';')[0]||'application/octet-stream').trim();
    let bytes;
    if(/(?:^|;)base64(?:;|$)/i.test(meta)){
      const binary=atob(payload.replace(/\s/g,''));
      bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    }else{
      bytes=new TextEncoder().encode(decodeURIComponent(payload));
    }
    return URL.createObjectURL(new Blob([bytes],{type:mime}));
  }
  function openTokenImage(tokenId){
    const raw=tokenImageViewUris.get(Number(tokenId));
    if(!raw){status(`Image for token #${tokenId} is not available yet.`);return}
    let target=browserViewUri(raw),objectUrl='';
    try{
      if(/^data:/i.test(target)){
        objectUrl=dataUriBlobUrl(target);
        target=objectUrl;
      }
      const tab=window.open(target,'_blank');
      if(!tab){
        if(objectUrl)URL.revokeObjectURL(objectUrl);
        status('Your browser blocked the image tab. Allow pop-ups for this mint page and try again.');
        return;
      }
      try{tab.opener=null}catch(_){}
      // The new tab has already loaded the Blob by the time this expires. Keeping
      // it alive for a few minutes is generous for slower/mobile browsers.
      if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),300000);
    }catch(error){
      if(objectUrl)URL.revokeObjectURL(objectUrl);
      status(`Unable to open image: ${error.message}`);
    }
  }
  function handleTokenCardAction(event){
    const renderButton=event.target.closest('[data-render-token]');
    if(renderButton){setTokenRenderMode(renderButton.dataset.renderToken,renderButton.dataset.renderMode);return}
    const imageButton=event.target.closest('[data-view-image-token]');
    if(imageButton)openTokenImage(imageButton.dataset.viewImageToken);
  }
  function renderWalletAllotment(walletMints,maxPerWallet,remaining){
    const box=$('walletAllotment'); if(!box)return;
    box.classList.remove('hidden');
    const finite=Number(maxPerWallet)>0;
    $('walletAllotmentText').textContent=finite?`${walletMints} of ${maxPerWallet} minted · ${remaining} remaining`:`${walletMints} minted · no wallet cap`;
    const fill=$('walletAllotmentFill');
    if(fill)fill.style.width=finite?`${Math.min(100,(walletMints/Math.max(1,maxPerWallet))*100)}%`:'0%';
  }

  async function safeRead(label, fn, fallback, diagnostics, required=false){
    try{return await fn()}
    catch(error){
      const message=error?.shortMessage||error?.reason||error?.message||'read failed';
      diagnostics.push(`${label}: ${message}`);
      if(required)throw new Error(`${label} failed: ${message}`);
      return fallback;
    }
  }
  async function hasContractCode(provider,address){
    try{return (await provider.getCode(address))!=='0x'}catch(_){return true}
  }

  async function refreshCloud(serial){
    const state=await apiJson(`/api/public/collection/${config.chainId}/${config.contract}/state`);
    if(serial!==refreshSerial)return;
    const name=state.name||'Relic Forge Collection',desc=state.description||'',maxSupply=Number(state.maxSupply||0),totalMinted=Number(state.totalMinted||0),maxPerWallet=Number(state.maxPerWallet||0);
    const mintPrice=BigInt(state.mintPrice||0),wlPrice=BigInt(state.whitelistMintPrice||0),pub=!!state.publicMintEnabled,wlEnabled=!!state.whitelistMintEnabled,root=state.whitelistRoot||ethers.ZeroHash,reveal=Number(state.revealMode||0);
    contractState={name,desc,maxSupply,totalMinted,maxPerWallet,mintPrice,wlPrice,pub,wlEnabled,root,reveal,diagnostics:[]};
    document.title=`${name} — Mint`;$('collectionName').textContent=name;$('collectionDescription').textContent=desc||'Fully onchain collection forged with Relic Forge.';
    $('mintedStat').textContent=`${totalMinted.toLocaleString()} / ${maxSupply.toLocaleString()}`;$('priceStat').textContent=fmtEth(mintPrice);$('limitStat').textContent=maxPerWallet?maxPerWallet.toLocaleString():'Unlimited';$('revealStat').textContent=reveal===0?'Forge Reveal':'Creator Reveal';$('publicPrice').textContent=fmtEth(mintPrice);$('publicCard').classList.toggle('disabled',!pub);
    const explorer=Number(config.chainId)===11155111?'https://sepolia.etherscan.io':'https://etherscan.io';
    $('contractInfo').innerHTML=`Contract: <a target="_blank" rel="noreferrer" href="${explorer}/address/${config.contract}">${config.contract}</a> · RelicForge Cloud state`;
    const supplyRemaining=Math.max(0,maxSupply-totalMinted);
    if(wallet){
      const activeWallet=wallet;const ws=await apiJson(`/api/public/collection/${config.chainId}/${config.contract}/wallet/${activeWallet}`);if(serial!==refreshSerial||wallet?.toLowerCase()!==activeWallet.toLowerCase())return;
      const walletMints=Number(ws.mintedByWallet||0),whitelistMints=Number(ws.whitelistMintedByWallet||0);const globalRemaining=maxPerWallet>0?Math.max(0,maxPerWallet-walletMints):supplyRemaining;const publicRemaining=Math.min(supplyRemaining,globalRemaining);
      $('walletMintsStat').textContent=maxPerWallet>0?`${walletMints} / ${maxPerWallet}`:`${walletMints} / ∞`;renderWalletAllotment(walletMints,maxPerWallet,publicRemaining);setQtyLimit('publicQty',publicRemaining);
      $('publicQtyHint').textContent=!pub?'Public mint is currently disabled by the creator.':supplyRemaining<1?'Collection is sold out.':publicRemaining>0?`You can mint up to ${publicRemaining} more from your wallet allotment.`:'This wallet has no public mint allowance remaining.';$('publicMintBtn').disabled=!pub||publicRemaining<1;$('publicMintBtn').dataset.ready=(!$('publicMintBtn').disabled).toString();
      let proof=null;try{proof=await apiJson(`/api/public/whitelist/${config.chainId}/${config.contract}/${activeWallet}`)}catch(_){};
      if(proof?.eligible){const entry={address:activeWallet,allowance:Number(proof.allowance||0),proof:proof.proof||[]};whitelistData={root,by:{[activeWallet.toLowerCase()]:entry}};const allowanceRemaining=Math.max(0,entry.allowance-whitelistMints),whitelistRemaining=Math.min(supplyRemaining,globalRemaining,allowanceRemaining);setQtyLimit('whitelistQty',whitelistRemaining);$('whitelistQtyHint').textContent=whitelistRemaining>0?`You can whitelist mint up to ${whitelistRemaining} more right now.`:'No whitelist allowance remains for this wallet.';$('whitelistState').textContent=`Eligible · ${whitelistMints}/${entry.allowance} used · ${whitelistRemaining} remaining`;$('whitelistState').className='eligible';$('whitelistMintBtn').disabled=!wlEnabled||whitelistRemaining<1}
      else{whitelistData=null;setQtyLimit('whitelistQty',0);$('whitelistQtyHint').textContent=wlEnabled?'No whitelist mint available for this wallet.':'Whitelist mint is disabled.';$('whitelistState').textContent=wlEnabled?'Not eligible':'Disabled';$('whitelistState').className='not-eligible';$('whitelistMintBtn').disabled=true}
    }else{
      $('walletMintsStat').textContent='Connect wallet';$('walletAllotment')?.classList.add('hidden');const publicMax=maxPerWallet>0?Math.min(supplyRemaining,maxPerWallet):supplyRemaining;setQtyLimit('publicQty',publicMax);$('publicQtyHint').textContent=!pub?'Public mint is currently disabled by the creator.':maxPerWallet>0?`Wallet limit: ${maxPerWallet}. Connect to calculate what remains for you.`:`Up to ${publicMax} remaining in the collection. Connect to mint.`;$('publicMintBtn').disabled=true;$('publicMintBtn').dataset.ready='false';setQtyLimit('whitelistQty',0);$('whitelistQtyHint').textContent=wlEnabled?'Connect wallet to calculate whitelist allowance.':'Whitelist mint is disabled.';$('whitelistState').textContent=wlEnabled?'Connect to check':'Disabled';$('whitelistMintBtn').disabled=true;
    }
    $('whitelistCard').classList.toggle('disabled',!wlEnabled);$('mintIntro').textContent=reveal===0?'Mint once, then your token forges automatically when randomness resolves.':'Minted tokens display the creator placeholder until the collection reveal.';status(wallet?($('publicMintBtn').disabled?'Wallet connected. Check mint availability above.':'Wallet connected. Ready to mint.'):'Collection loaded. Connect a wallet to mint.');updateExplorerControls();loadMintedGallery().catch(()=>{});if(holdersLoadedForMintCount!==totalMinted)loadHolders().catch(()=>{});else{renderHolders();renderMyNfts().catch(()=>{})}
  }

  async function refresh(){
    const serial=++refreshSerial;
    if(!config.contract||!ethers.isAddress(config.contract)){status('Mint page is missing a valid collection contract address.');return}
    if(API_BASE&&(MINT_RPC_MODE==='alchemy-first'||MINT_RPC_MODE==='cloud-first')){
      try{return await refreshCloud(serial)}catch(error){console.warn('RelicForge Cloud state read failed; falling back to direct RPC:',error.message)}
    }
    const diagnostics=[];
    try{
      const c=await readOnlyContract();
      const readProvider=c.runner?.provider||c.runner||getReadProvider();
      const deployedCode=await readProvider.getCode(config.contract);
      if(!deployedCode||deployedCode==='0x'){
        throw new Error(`No contract exists at ${shortAddr(config.contract)} on chain ${config.chainId}.`);
      }
      const proxyImplementation=minimalProxyImplementation(deployedCode);
      if(proxyImplementation){
        const implCode=await readProvider.getCode(proxyImplementation);
        if(!implCode||implCode==='0x')throw new Error(`Collection proxy implementation ${proxyImplementation} is missing on chain ${config.chainId}.`);
      }

      // Read each field independently. A missing optional method from an older
      // Relic Forge implementation must never make public mint unusable.
      const name=await safeRead('name()',()=>c.name(),'Relic Forge Collection',diagnostics,true);
      const desc=await safeRead('description()',()=>c.description(),'',diagnostics,false);
      const maxSupply=await safeRead('maxSupply()',()=>c.maxSupply(),0n,diagnostics,true);
      const totalMinted=await safeRead('totalMinted()',()=>c.totalMinted(),0n,diagnostics,true);
      const maxPerWallet=await safeRead('maxPerWallet()',()=>c.maxPerWallet(),0n,diagnostics,false);
      const mintPrice=await safeRead('mintPrice()',()=>c.mintPrice(),0n,diagnostics,true);
      const wlPrice=await safeRead('whitelistMintPrice()',()=>c.whitelistMintPrice(),0n,diagnostics,false);
      const pub=await safeRead('publicMintEnabled()',()=>c.publicMintEnabled(),true,diagnostics,false);
      const wlEnabled=await safeRead('whitelistMintEnabled()',()=>c.whitelistMintEnabled(),false,diagnostics,false);
      const root=await safeRead('whitelistRoot()',()=>c.whitelistRoot(),ethers.ZeroHash,diagnostics,false);
      const reveal=await safeRead('revealMode()',()=>c.revealMode(),0n,diagnostics,false);
      if(serial!==refreshSerial)return;

      contractState={name,desc,maxSupply:Number(maxSupply),totalMinted:Number(totalMinted),maxPerWallet:Number(maxPerWallet),mintPrice,wlPrice,pub:Boolean(pub),wlEnabled:Boolean(wlEnabled),root,reveal:Number(reveal),diagnostics};
      document.title=`${name} — Mint`;
      $('collectionName').textContent=name;
      $('collectionDescription').textContent=desc||'Fully onchain collection forged with Relic Forge.';
      $('mintedStat').textContent=`${Number(totalMinted).toLocaleString()} / ${Number(maxSupply).toLocaleString()}`;
      $('priceStat').textContent=fmtEth(mintPrice);
      $('limitStat').textContent=Number(maxPerWallet)?Number(maxPerWallet).toLocaleString():'Unlimited';
      $('revealStat').textContent=Number(reveal)===0?'Forge Reveal':'Creator Reveal';
      $('publicPrice').textContent=fmtEth(mintPrice);
      $('publicCard').classList.toggle('disabled',!pub);
      const explorer=Number(config.chainId)===11155111?'https://sepolia.etherscan.io':'https://etherscan.io';
      const proxyText=proxyImplementation?` · Proxy → ${shortAddr(proxyImplementation)}`:'';
      const rpcText=wallet?' · Wallet RPC':(activeReadRpc?` · Read RPC: ${esc(new URL(activeReadRpc).hostname)}`:'');
      $('contractInfo').innerHTML=`Contract: <a target="_blank" rel="noreferrer" href="${explorer}/address/${config.contract}">${config.contract}</a>${proxyText}${rpcText}`;
      const supplyRemaining=Math.max(0,Number(maxSupply)-Number(totalMinted));

      if(wallet){
        const activeWallet=wallet;
        // mintedByWallet was added with wallet-limit support. If an older test
        // collection lacks it, fall back to 0 rather than disabling public mint.
        const m=await safeRead('mintedByWallet()',()=>c.mintedByWallet(activeWallet),0n,diagnostics,false);
        if(serial!==refreshSerial||wallet?.toLowerCase()!==activeWallet.toLowerCase())return;
        const walletMints=Number(m);
        const globalRemaining=Number(maxPerWallet)>0?Math.max(0,Number(maxPerWallet)-walletMints):supplyRemaining;
        const publicRemaining=Math.min(supplyRemaining,globalRemaining);
        $('walletMintsStat').textContent=Number(maxPerWallet)>0?`${walletMints} / ${Number(maxPerWallet)}`:`${walletMints} / ∞`;
        renderWalletAllotment(walletMints,Number(maxPerWallet),publicRemaining);
        setQtyLimit('publicQty',publicRemaining);
        $('publicQtyHint').textContent=!pub?'Public mint is currently disabled by the creator.':supplyRemaining<1?'Collection is sold out.':publicRemaining>0?`You can mint up to ${publicRemaining} more from your wallet allotment.`:'This wallet has no public mint allowance remaining.';
        $('publicMintBtn').disabled=!pub||publicRemaining<1;
        $('publicMintBtn').dataset.ready=(!$('publicMintBtn').disabled).toString();

        if(API_BASE){
          try{
            const proof=await apiJson(`/api/public/whitelist/${config.chainId}/${config.contract}/${activeWallet}`);
            whitelistData=proof?.eligible?{root,by:{[activeWallet.toLowerCase()]:{address:activeWallet,allowance:Number(proof.allowance||0),proof:proof.proof||[]}}}:null;
          }catch(_){whitelistData=await readConfigWhitelist()}
        }else whitelistData=await readConfigWhitelist();
        if(serial!==refreshSerial||wallet?.toLowerCase()!==activeWallet.toLowerCase())return;
        let whitelistMints=Number(await safeRead('whitelistMintedByWallet()',()=>c.whitelistMintedByWallet(activeWallet),0n,diagnostics,false));
        if(serial!==refreshSerial)return;
        const entry=whitelistData?.by?.[activeWallet.toLowerCase()];
        if(wlEnabled&&entry&&(!root||root===ethers.ZeroHash||root.toLowerCase()===whitelistData.root.toLowerCase())){
          const allowanceRemaining=Math.max(0,Number(entry.allowance)-whitelistMints);
          const whitelistRemaining=Math.min(supplyRemaining,globalRemaining,allowanceRemaining);
          setQtyLimit('whitelistQty',whitelistRemaining);
          $('whitelistQtyHint').textContent=whitelistRemaining>0?`You can whitelist mint up to ${whitelistRemaining} more right now.`:'No whitelist allowance remains for this wallet.';
          $('whitelistState').textContent=`Eligible · ${whitelistMints}/${entry.allowance} used · ${whitelistRemaining} remaining`;
          $('whitelistState').className='eligible';
          $('whitelistMintBtn').disabled=whitelistRemaining<1;
        }else{
          setQtyLimit('whitelistQty',0);
          $('whitelistQtyHint').textContent=wlEnabled?'No whitelist mint available for this wallet.':'Whitelist mint is disabled.';
          $('whitelistState').textContent=wlEnabled?(whitelistData?'Not eligible':'Proof list unavailable'):'Disabled';
          $('whitelistState').className='not-eligible';
          $('whitelistMintBtn').disabled=true;
        }
      }else{
        $('walletMintsStat').textContent='Connect wallet';
        $('walletAllotment')?.classList.add('hidden');
        const publicMax=Number(maxPerWallet)>0?Math.min(supplyRemaining,Number(maxPerWallet)):supplyRemaining;
        setQtyLimit('publicQty',publicMax);
        $('publicQtyHint').textContent=!pub?'Public mint is currently disabled by the creator.':Number(maxPerWallet)>0?`Wallet limit: ${Number(maxPerWallet)}. Connect to calculate what remains for you.`:`Up to ${publicMax} remaining in the collection. Connect to mint.`;
        $('publicMintBtn').disabled=true;
        $('publicMintBtn').dataset.ready='false';
        setQtyLimit('whitelistQty',0);
        $('whitelistQtyHint').textContent=wlEnabled?'Connect wallet to calculate whitelist allowance.':'Whitelist mint is disabled.';
        $('whitelistState').textContent=wlEnabled?'Connect to check':'Disabled';
        $('whitelistMintBtn').disabled=true;
        readConfigWhitelist().then(data=>{if(serial===refreshSerial)whitelistData=data}).catch(()=>{});
      }
      if(serial!==refreshSerial)return;
      $('whitelistCard').classList.toggle('disabled',!wlEnabled);
      $('mintIntro').textContent=Number(reveal)===0?'Mint once, then your token forges automatically when randomness resolves.':'Minted tokens display the creator placeholder until the collection reveal.';
      const diagText=diagnostics.length?` · Compatibility fallback: ${diagnostics.map(v=>v.split(':')[0]).join(', ')}`:'';
      status(wallet?($('publicMintBtn').disabled?`Wallet connected. Check the mint availability message above.${diagText}`:`Wallet connected. Ready to mint.${diagText}`):`Collection loaded. Connect a wallet to mint.${diagText}`);
      updateExplorerControls();
      loadMintedGallery().catch(()=>{});
      if(holdersLoadedForMintCount!==Number(totalMinted))loadHolders().catch(()=>{}); else {renderHolders();renderMyNfts().catch(()=>{});}
    }catch(e){
      if(API_BASE&&MINT_RPC_MODE!=='public-only'&&MINT_RPC_MODE!=='alchemy-first'&&MINT_RPC_MODE!=='cloud-first'){
        try{
          publicProvider=null;activeReadRpc=null;
          return await refreshCloud(serial);
        }catch(cloudError){
          console.warn('Public RPC and RelicForge Cloud state reads both failed:',cloudError.message);
        }
      }
      if(serial===refreshSerial){
        const extra=diagnostics.length?` Failed reads: ${diagnostics.join(' | ')}`:'';
        status(`Contract error: ${e.shortMessage||e.message}.${extra}`);
      }
    }
  }

  function captureReceiptOwnership(receipt){
    for(const log of receipt?.logs||[]){
      try{
        if(String(log.address||'').toLowerCase()!==String(config.contract||'').toLowerCase())continue;
        if(String(log.topics?.[0]||'').toLowerCase()!==TRANSFER_TOPIC.toLowerCase())continue;
        const tokenId=topicTokenId(log.topics[3]),to=topicAddress(log.topics[2]);
        if(tokenId>0)currentTokenOwners.set(tokenId,to);
      }catch(_){}
    }
  }

  async function publicMint(){
    try{if(!wallet)await connect();const q=clampQty('publicQty');if(q<1)throw new Error('No public mint allowance remains for this wallet.');status(`Submitting public mint for ${q} NFT${q===1?'':'s'}…`);const tx=await contract.mint(q,{value:contractState.mintPrice*BigInt(q)});status(`Mint submitted: ${tx.hash.slice(0,12)}… Waiting for confirmation…`);const receipt=await tx.wait();captureReceiptOwnership(receipt);await renderMyNfts().catch(()=>{});status(`Mint confirmed. ${contractState.reveal===0?'Your relic is forging.':'Your placeholder NFT is minted.'}`);holdersLoadedForMintCount=-1;await refresh()}catch(e){status(`Mint error: ${e.shortMessage||e.message}`)}
  }
  async function whitelistMint(){
    try{if(!wallet)await connect();const entry=whitelistData?.by?.[wallet.toLowerCase()];if(!entry)throw new Error('This wallet does not have a whitelist proof on this mint page.');const q=clampQty('whitelistQty');if(q<1)throw new Error('No whitelist mint allowance remains for this wallet.');status(`Submitting whitelist mint for ${q}…`);const tx=await contract.whitelistMint(q,entry.allowance,entry.proof,{value:contractState.wlPrice*BigInt(q)});status(`Whitelist mint submitted: ${tx.hash.slice(0,12)}…`);const receipt=await tx.wait();captureReceiptOwnership(receipt);await renderMyNfts().catch(()=>{});status('Whitelist mint confirmed.');holdersLoadedForMintCount=-1;await refresh()}catch(e){status(`Whitelist mint error: ${e.shortMessage||e.message}`)}
  }

  function updateExplorerControls(){
    const total=contractState?.totalMinted||0;
    const pages=Math.max(1,Math.ceil(total/mintedPageSize)); if(mintedPage>pages)mintedPage=pages;
    $('mintedSearchInput').max=String(Math.max(1,total));
    $('mintedPrevBtn').disabled=!!mintedSearchToken||mintedPage<=1;
    $('mintedNextBtn').disabled=!!mintedSearchToken||mintedPage>=pages;
  }
  async function tokenCard(c,tokenId){
    try{
      const [uri,owner]=await Promise.all([c.tokenURI(tokenId),c.ownerOf(tokenId)]);
      const meta=JSON.parse(decodeDataUri(uri));
      const revealed=Array.isArray(meta.attributes)&&meta.attributes.length>0;
      let ownerActions='';
      if(wallet&&String(owner).toLowerCase()===wallet.toLowerCase()&&revealed){
        const mode=Number(await c.renderMode(tokenId).catch(()=>0));
        const viewImage=String(meta.image||'');
        if(viewImage)tokenImageViewUris.set(Number(tokenId),viewImage); else tokenImageViewUris.delete(Number(tokenId));
        ownerActions=`<div class="token-owner-actions"><button class="small-btn render-toggle-btn" data-render-token="${tokenId}" data-render-mode="${mode===1?0:1}" type="button">${mode===1?'Render Onchain':'Render Offchain'}</button>${viewImage?`<button class="small-btn link-btn view-image-btn" data-view-image-token="${tokenId}" type="button">View Image</button>`:''}</div>`;
      }
      return `<article class="minted-token-card" data-token-id="${tokenId}"><div class="minted-token-thumb">${imageMarkup(meta.image,meta.name)}</div><div class="minted-token-info"><div><strong>${esc(meta.name||`Token #${tokenId}`)}</strong><span>#${tokenId}</span></div><small>${revealed?'Revealed':'Unrevealed'} · ${esc(shortAddr(owner))}</small>${ownerActions}</div></article>`;
    }catch(e){return `<article class="minted-token-card"><div class="minted-token-thumb"><div class="minted-thumb-empty">#${tokenId}</div></div><div class="minted-token-info"><div><strong>Token #${tokenId}</strong></div><small>${esc(e.shortMessage||e.message)}</small></div></article>`}
  }
  async function loadMintedGallery(){
    const grid=$('mintedGrid'),info=$('mintedPageInfo'); if(!grid||!contractState)return;
    const total=contractState.totalMinted;
    if(!total){grid.innerHTML='<div class="minted-empty">Nothing has been minted yet.</div>';info.textContent='0 minted';return}
    const c=await readOnlyContract();
    let ids=[];
    if(mintedSearchToken){ids=[mintedSearchToken];info.textContent=`Token #${mintedSearchToken}`}
    else{const pages=Math.max(1,Math.ceil(total/mintedPageSize));mintedPage=Math.min(Math.max(1,mintedPage),pages);const start=(mintedPage-1)*mintedPageSize+1,end=Math.min(total,start+mintedPageSize-1);for(let i=start;i<=end;i++)ids.push(i);info.textContent=`${start}-${end} of ${total.toLocaleString()} · Page ${mintedPage} of ${pages}`}
    grid.innerHTML='<div class="minted-empty">Loading minted tokens…</div>';
    const cards=await Promise.all(ids.map(id=>tokenCard(c,id))); grid.innerHTML=cards.join(''); updateExplorerControls();
  }
  function searchToken(){
    const total=contractState?.totalMinted||0;const value=Math.floor(Number($('mintedSearchInput').value||0));
    if(!value){mintedSearchToken=null;$('mintedSearchInput').value='';loadMintedGallery();return}
    if(value<1||value>total){$('mintedPageInfo').textContent=`Token must be between 1 and ${total}.`;return}
    mintedSearchToken=value;loadMintedGallery();
  }
  function clearTokenSearch(){mintedSearchToken=null;$('mintedSearchInput').value='';loadMintedGallery()}

  function topicAddress(topic){try{return ethers.getAddress(`0x${String(topic).slice(-40)}`)}catch(_){return ethers.ZeroAddress}}
  function topicTokenId(topic){try{return Number(BigInt(topic))}catch(_){return 0}}
  function transferOrder(log){return [Number(log.blockNumber||0),Number(log.index??log.logIndex??0)]}
  function isLaterTransfer(a,b){return !b||a[0]>b[0]||(a[0]===b[0]&&a[1]>b[1])}

  async function renderMyNfts(){
    const section=$('myNftsSection'),grid=$('myNftsGrid'),summary=$('myNftsSummary'),pager=$('myNftsPagination');
    if(!section||!grid)return;
    if(!wallet){section.classList.add('hidden');myNftIds=[];return}
    section.classList.remove('hidden');
    const lower=wallet.toLowerCase();
    myNftIds=[...currentTokenOwners.entries()].filter(([,owner])=>String(owner||'').toLowerCase()===lower).map(([tokenId])=>Number(tokenId)).sort((a,b)=>a-b);
    const expectedBalance=contractState?await (await readOnlyContract()).balanceOf(wallet).then(v=>Number(v)).catch(()=>myNftIds.length):myNftIds.length;
    if(summary)summary.textContent=`${expectedBalance.toLocaleString()} NFT${expectedBalance===1?'':'s'} currently owned from this collection.`;
    if(!myNftIds.length){
      grid.innerHTML=`<div class="minted-empty">${expectedBalance>0?'Ownership token IDs are still loading. Use Refresh to rescan the collection.':'You do not currently own any NFTs from this collection.'}</div>`;
      pager?.classList.add('hidden');
      return;
    }
    const pages=Math.max(1,Math.ceil(myNftIds.length/myNftPageSize));myNftPage=Math.min(Math.max(1,myNftPage),pages);
    const start=(myNftPage-1)*myNftPageSize,end=Math.min(myNftIds.length,start+myNftPageSize);
    if($('myNftsPageInfo'))$('myNftsPageInfo').textContent=`${start+1}-${end} of ${myNftIds.length.toLocaleString()} · Page ${myNftPage} of ${pages}`;
    if($('myNftsPrevBtn'))$('myNftsPrevBtn').disabled=myNftPage<=1;if($('myNftsNextBtn'))$('myNftsNextBtn').disabled=myNftPage>=pages;
    pager?.classList.toggle('hidden',pages<=1);
    grid.innerHTML='<div class="minted-empty">Loading your NFTs…</div>';
    const c=await readOnlyContract();const cards=await Promise.all(myNftIds.slice(start,end).map(id=>tokenCard(c,id)));grid.innerHTML=cards.join('');
  }
  async function getTransferHistory(totalMinted){
    if(totalMinted<1)return[];
    const chainId=Number(config.chainId);
    // Holder reconstruction can require wide eth_getLogs scans. Keep this request
    // completely off the creator's Alchemy Free-tier quota. Try the direct public
    // RPC pool one endpoint at a time; only non-log mint reads may fall back to Cloud.
    const directRpcs=[...(PUBLIC_RPC_FALLBACKS[chainId]||[])];
    if(!directRpcs.length)throw new Error(`No public holder-history RPC is configured for chain ${chainId}.`);
    let lastError=null;
    for(const rpc of directRpcs){
      try{
        const provider=new ethers.JsonRpcProvider(rpc,chainId,{staticNetwork:true,batchMaxCount:20});
        const latest=await provider.getBlockNumber();let to=latest,chunk=20000,logs=[],mintsFound=0,attempts=0;
        while(to>=0&&mintsFound<totalMinted&&attempts<5000){
          const from=Math.max(0,to-chunk+1);$('holdersStatus').textContent=`Scanning holder history via public RPC… block ${from.toLocaleString()}-${to.toLocaleString()}`;
          try{
            const part=await provider.getLogs({address:config.contract,fromBlock:from,toBlock:to,topics:[TRANSFER_TOPIC]});
            logs.push(...part);mintsFound+=part.filter(log=>topicAddress(log.topics[1]).toLowerCase()===ZERO).length;to=from-1;attempts++;
            if(part.length<50&&chunk<100000)chunk=Math.min(100000,chunk*2);
          }catch(error){
            if(chunk>250){chunk=Math.max(250,Math.floor(chunk/4));continue}
            throw error;
          }
        }
        return logs;
      }catch(error){lastError=error;console.warn(`Holder history RPC failed (${rpc}); trying next public RPC.`,error?.message||error)}
    }
    throw lastError||new Error('Unable to load holder history from the public RPC pool.');
  }
  async function loadHolders(force=false){
    if(!contractState)return;const total=contractState.totalMinted;
    if(!force&&holdersLoadedForMintCount===total){renderHolders();await renderMyNfts();return}
    if(!total){holders=[];currentTokenOwners=new Map();holdersLoadedForMintCount=0;renderHolders();await renderMyNfts();return}
    try{
      $('holdersStatus').textContent='Building current holder balances from onchain Transfer events…';
      const logs=await getTransferHistory(total);const balances=new Map(),latestOwners=new Map();
      for(const log of logs){
        const from=topicAddress(log.topics[1]).toLowerCase(),to=topicAddress(log.topics[2]).toLowerCase();
        if(from!==ZERO)balances.set(from,(balances.get(from)||0)-1);if(to!==ZERO)balances.set(to,(balances.get(to)||0)+1);
        const tokenId=topicTokenId(log.topics[3]),order=transferOrder(log),previous=latestOwners.get(tokenId);
        if(tokenId>0&&isLaterTransfer(order,previous?.order))latestOwners.set(tokenId,{owner:to===ZERO?null:ethers.getAddress(to),order});
      }
      currentTokenOwners=new Map([...latestOwners.entries()].filter(([,state])=>state.owner).map(([tokenId,state])=>[tokenId,state.owner]));
      holders=[...balances.entries()].filter(([,count])=>count>0).map(([address,count])=>({address:ethers.getAddress(address),count})).sort((a,b)=>b.count-a.count||a.address.localeCompare(b.address));
      holdersLoadedForMintCount=total;holderPage=1;myNftPage=1;renderHolders();await renderMyNfts();
    }catch(e){$('holdersStatus').textContent=`Unable to load holders: ${e.shortMessage||e.message}`;await renderMyNfts().catch(()=>{})}
  }
  function renderHolders(){
    const list=$('holdersList'),statusNode=$('holdersStatus');if(!list)return;
    if(!holders.length){list.innerHTML='<div class="holders-empty">No current holders yet.</div>';statusNode.textContent=contractState?.totalMinted?'Holder list unavailable.':'0 holders';$('holderPagination').classList.add('hidden');return}
    const pages=Math.max(1,Math.ceil(holders.length/holderPageSize));holderPage=Math.min(Math.max(1,holderPage),pages);const start=(holderPage-1)*holderPageSize,end=Math.min(holders.length,start+holderPageSize);const explorer=Number(config.chainId)===11155111?'https://sepolia.etherscan.io':'https://etherscan.io';
    list.innerHTML=holders.slice(start,end).map((holder,index)=>`<div class="holder-row"><span>${start+index+1}</span><a target="_blank" rel="noreferrer" href="${explorer}/address/${holder.address}">${esc(shortAddr(holder.address))}</a><strong>${holder.count}</strong></div>`).join('');
    statusNode.textContent=`${holders.length.toLocaleString()} current holder${holders.length===1?'':'s'} · ${contractState.totalMinted.toLocaleString()} NFTs`;$('holderPagination').classList.toggle('hidden',pages<=1);$('holderPageInfo').textContent=`Page ${holderPage} of ${pages}`;$('holderPrevBtn').disabled=holderPage<=1;$('holderNextBtn').disabled=holderPage>=pages;
  }

  async function setTokenRenderMode(tokenId,mode){
    try{
      if(!wallet)await connect();
      status(`${Number(mode)===1?'Switching to offchain render':'Switching to fully onchain SVG'} for token #${tokenId}…`);
      const tx=await contract.setRenderMode(Number(tokenId),Number(mode));await tx.wait();
      status(`Token #${tokenId} display updated. Marketplaces can refresh from the ERC-4906 MetadataUpdate event.`);
      await renderMyNfts();
    }catch(error){status(`Render mode error: ${error.shortMessage||error.message}`)}
  }

  async function init(){
    await hydratePublishedConfig();
    if(config.collectionImage)imageInto('mintAvatar',config.collectionImage);if(config.bannerImage)imageInto('mintBanner',config.bannerImage);
    $('networkStat').textContent=Number(config.chainId)===11155111?'Sepolia':Number(config.chainId)===1?'Ethereum':`Chain ${config.chainId}`;
    $('connectBtn').addEventListener('click',connect);$('publicMintBtn').addEventListener('click',publicMint);$('whitelistMintBtn').addEventListener('click',whitelistMint);bindStrictQty('publicQty');bindStrictQty('whitelistQty');
    $('mintedPrevBtn').addEventListener('click',()=>{mintedPage=Math.max(1,mintedPage-1);loadMintedGallery()});$('mintedNextBtn').addEventListener('click',()=>{mintedPage+=1;loadMintedGallery()});$('mintedSearchBtn').addEventListener('click',searchToken);$('mintedClearBtn').addEventListener('click',clearTokenSearch);$('mintedSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchToken()}});
    $('holdersRefreshBtn').addEventListener('click',()=>loadHolders(true));$('holderPrevBtn').addEventListener('click',()=>{holderPage=Math.max(1,holderPage-1);renderHolders()});$('holderNextBtn').addEventListener('click',()=>{holderPage+=1;renderHolders()});
    $('myNftsRefreshBtn').addEventListener('click',()=>loadHolders(true));$('myNftsGrid')?.addEventListener('click',handleTokenCardAction);$('mintedGrid')?.addEventListener('click',handleTokenCardAction);$('myNftsPrevBtn').addEventListener('click',()=>{myNftPage=Math.max(1,myNftPage-1);renderMyNfts()});$('myNftsNextBtn').addEventListener('click',()=>{myNftPage+=1;renderMyNfts()});
    const handleAccountsChanged=async a=>{++refreshSerial;wallet=a?.[0]?ethers.getAddress(a[0]):null;signer=null;contract=null;myNftPage=1;$('connectBtn').textContent=wallet?shortAddr(wallet):'Connect Wallet';if(wallet){try{const injected=activeInjectedWallet();if(!injected)throw new Error('Selected wallet provider is unavailable.');browserProvider=new ethers.BrowserProvider(injected);signer=await browserProvider.getSigner();contract=new ethers.Contract(config.contract,ABI,signer)}catch(error){status(`Wallet error: ${walletErrorMessage(error)}`);return}}else{$('myNftsSection')?.classList.add('hidden')}await refresh()};
    if(window.RelicForgeWallets?.ready){window.addEventListener('relicforge:wallet-accounts-changed',e=>handleAccountsChanged(e.detail?.accounts||[]));window.addEventListener('relicforge:wallet-chain-changed',()=>location.reload());await window.RelicForgeWallets.ready().catch(()=>{})}else if(window.ethereum){window.ethereum.on?.('accountsChanged',handleAccountsChanged);window.ethereum.on?.('chainChanged',()=>location.reload())}
    await refresh();
  }
  init();
})();
