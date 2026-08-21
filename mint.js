(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ABI = [
    'function name() view returns (string)','function symbol() view returns (string)','function description() view returns (string)',
    'function maxSupply() view returns (uint32)','function totalMinted() view returns (uint32)','function maxPerWallet() view returns (uint32)',
    'function mintPrice() view returns (uint256)','function whitelistMintPrice() view returns (uint256)','function publicMintEnabled() view returns (bool)',
    'function whitelistMintEnabled() view returns (bool)','function whitelistRoot() view returns (bytes32)','function revealMode() view returns (uint8)',
    'function mintedByWallet(address) view returns (uint32)','function whitelistMintedByWallet(address) view returns (uint32)',
    'function ownerOf(uint256 tokenId) view returns (address)','function tokenURI(uint256 tokenId) view returns (string)','function balanceOf(address) view returns (uint256)',
    'function mint(uint32 quantity) payable returns (uint256)','function whitelistMint(uint32 quantity,uint32 allowance,bytes32[] proof) payable returns (uint256)'
  ];
  const RPC_BY_CHAIN = {
    11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
    1: 'https://ethereum-rpc.publicnode.com'
  };
  const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
  const ZERO = ethers.ZeroAddress.toLowerCase();
  const params = new URLSearchParams(location.search);
  const embedded = window.RELICFORGE_MINT_CONFIG || {};
  const requestedContract = embedded.contract || params.get('contract') || '';
  const requestedChain = Number(embedded.chainId || params.get('chain') || 11155111);
  const localKey = requestedContract ? `relicforge_mint_page_${requestedChain}_${requestedContract.toLowerCase()}` : '';
  let localConfig = {};
  try { if (localKey) localConfig = JSON.parse(localStorage.getItem(localKey) || '{}'); } catch (_) {}
  const config = { ...localConfig, ...embedded, contract: requestedContract || localConfig.contract, chainId: requestedChain || localConfig.chainId || 11155111 };

  let browserProvider = null, publicProvider = null, signer = null, wallet = null, contract = null, contractState = null, whitelistData = null;
  let mintedPage = 1, mintedSearchToken = null;
  const mintedPageSize = 10;
  let holders = [], holderPage = 1, holdersLoadedForMintCount = -1;
  const holderPageSize = 20;
  let currentTokenOwners = new Map(), myNftIds = [], myNftPage = 1;
  const myNftPageSize = 10;

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
  async function ensureNetwork(){
    if(!window.ethereum)throw new Error('No EVM wallet provider detected.');
    const hex='0x'+Number(config.chainId||11155111).toString(16);
    const current=await ethereum.request({method:'eth_chainId'});
    if(current.toLowerCase()!==hex.toLowerCase())await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]});
  }
  async function connect(){
    try{await ensureNetwork();await ethereum.request({method:'eth_requestAccounts'});browserProvider=new ethers.BrowserProvider(window.ethereum);signer=await browserProvider.getSigner();wallet=await signer.getAddress();contract=new ethers.Contract(config.contract,ABI,signer);$('connectBtn').textContent=shortAddr(wallet);await refresh();status('Wallet connected. Ready to mint.')}catch(e){status(`Wallet error: ${e.message}`)}
  }
  function getReadProvider(){
    if(!publicProvider){const rpc=RPC_BY_CHAIN[Number(config.chainId)];if(rpc)publicProvider=new ethers.JsonRpcProvider(rpc)}
    if(publicProvider)return publicProvider;
    if(browserProvider)return browserProvider;
    if(window.ethereum){browserProvider=new ethers.BrowserProvider(window.ethereum);return browserProvider}
    throw new Error('Connect a wallet to read this collection.');
  }
  async function readOnlyContract(){
    if(contract)return contract;
    return new ethers.Contract(config.contract,ABI,getReadProvider());
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
  function renderWalletAllotment(walletMints,maxPerWallet,remaining){
    const box=$('walletAllotment'); if(!box)return;
    box.classList.remove('hidden');
    const finite=Number(maxPerWallet)>0;
    $('walletAllotmentText').textContent=finite?`${walletMints} of ${maxPerWallet} minted · ${remaining} remaining`:`${walletMints} minted · no wallet cap`;
    const fill=$('walletAllotmentFill');
    if(fill)fill.style.width=finite?`${Math.min(100,(walletMints/Math.max(1,maxPerWallet))*100)}%`:'0%';
  }

  async function refresh(){
    if(!config.contract||!ethers.isAddress(config.contract)){status('Mint page is missing a valid collection contract address.');return}
    try{
      const c=await readOnlyContract();
      const [name,desc,maxSupply,totalMinted,maxPerWallet,mintPrice,wlPrice,pub,wlEnabled,root,reveal]=await Promise.all([c.name(),c.description(),c.maxSupply(),c.totalMinted(),c.maxPerWallet(),c.mintPrice(),c.whitelistMintPrice(),c.publicMintEnabled(),c.whitelistMintEnabled(),c.whitelistRoot(),c.revealMode()]);
      contractState={name,desc,maxSupply:Number(maxSupply),totalMinted:Number(totalMinted),maxPerWallet:Number(maxPerWallet),mintPrice,wlPrice,pub,wlEnabled,root,reveal:Number(reveal)};
      document.title=`${name} — Mint`; $('collectionName').textContent=name; $('collectionDescription').textContent=desc; $('mintedStat').textContent=`${Number(totalMinted).toLocaleString()} / ${Number(maxSupply).toLocaleString()}`; $('priceStat').textContent=fmtEth(mintPrice); $('limitStat').textContent=Number(maxPerWallet)?Number(maxPerWallet).toLocaleString():'Unlimited'; $('revealStat').textContent=Number(reveal)===0?'Forge Reveal':'Creator Reveal'; $('publicPrice').textContent=fmtEth(mintPrice); $('publicCard').classList.toggle('disabled',!pub); $('publicMintBtn').disabled=!pub||!wallet;
      const explorer=Number(config.chainId)===11155111?'https://sepolia.etherscan.io':'https://etherscan.io';
      $('contractInfo').innerHTML=`Contract: <a target="_blank" rel="noreferrer" href="${explorer}/address/${config.contract}">${config.contract}</a>`;
      whitelistData=await readConfigWhitelist();
      const supplyRemaining=Math.max(0,Number(maxSupply)-Number(totalMinted));
      if(wallet){
        const [m,wm]=await Promise.all([c.mintedByWallet(wallet),c.whitelistMintedByWallet(wallet)]);
        const walletMints=Number(m),whitelistMints=Number(wm);
        const globalRemaining=Number(maxPerWallet)>0?Math.max(0,Number(maxPerWallet)-walletMints):supplyRemaining;
        const publicRemaining=Math.min(supplyRemaining,globalRemaining);
        $('walletMintsStat').textContent=Number(maxPerWallet)>0?`${walletMints} / ${Number(maxPerWallet)}`:`${walletMints} / ∞`;
        renderWalletAllotment(walletMints,Number(maxPerWallet),publicRemaining);
        setQtyLimit('publicQty',publicRemaining);
        $('publicQtyHint').textContent=publicRemaining>0?`You can mint up to ${publicRemaining} more from your wallet allotment.`:'This wallet has no public mint allowance remaining.';
        $('publicMintBtn').disabled=!pub||publicRemaining<1;
        const entry=whitelistData?.by?.[wallet.toLowerCase()];
        if(wlEnabled&&entry&&(!root||root.toLowerCase()===whitelistData.root.toLowerCase())){
          const allowanceRemaining=Math.max(0,Number(entry.allowance)-whitelistMints);
          const whitelistRemaining=Math.min(supplyRemaining,globalRemaining,allowanceRemaining);
          setQtyLimit('whitelistQty',whitelistRemaining);
          $('whitelistQtyHint').textContent=whitelistRemaining>0?`You can whitelist mint up to ${whitelistRemaining} more right now.`:'No whitelist allowance remains for this wallet.';
          $('whitelistState').textContent=`Eligible · ${whitelistMints}/${entry.allowance} used · ${whitelistRemaining} remaining`;
          $('whitelistState').className='eligible'; $('whitelistMintBtn').disabled=whitelistRemaining<1;
        }else{
          setQtyLimit('whitelistQty',0); $('whitelistQtyHint').textContent=wlEnabled?'No whitelist mint available for this wallet.':'Whitelist mint is disabled.'; $('whitelistState').textContent=wlEnabled?(whitelistData?'Not eligible':'Proof list unavailable'):'Disabled'; $('whitelistState').className='not-eligible'; $('whitelistMintBtn').disabled=true;
        }
      }else{
        $('walletMintsStat').textContent='Connect wallet'; $('walletAllotment')?.classList.add('hidden');
        const publicMax=Number(maxPerWallet)>0?Math.min(supplyRemaining,Number(maxPerWallet)):supplyRemaining;
        setQtyLimit('publicQty',publicMax); $('publicQtyHint').textContent=Number(maxPerWallet)>0?`Wallet limit: ${Number(maxPerWallet)}. Connect to calculate what remains for you.`:`Up to ${publicMax} remaining in the collection. Connect to mint.`; $('publicMintBtn').disabled=true;
        setQtyLimit('whitelistQty',0); $('whitelistQtyHint').textContent=wlEnabled?'Connect wallet to calculate whitelist allowance.':'Whitelist mint is disabled.'; $('whitelistState').textContent=wlEnabled?'Connect to check':'Disabled'; $('whitelistMintBtn').disabled=true;
      }
      $('whitelistCard').classList.toggle('disabled',!wlEnabled); $('mintIntro').textContent=Number(reveal)===0?'Mint once, then your token forges automatically when randomness resolves.':'Minted tokens display the creator placeholder until the collection reveal.'; status(wallet?'Ready to mint.':'Collection loaded. Connect a wallet to mint.');
      updateExplorerControls();
      loadMintedGallery().catch(()=>{});
      if(holdersLoadedForMintCount!==Number(totalMinted))loadHolders().catch(()=>{}); else {renderHolders();renderMyNfts().catch(()=>{});}
    }catch(e){status(`Contract error: ${e.message}`)}
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
      return `<article class="minted-token-card" data-token-id="${tokenId}"><div class="minted-token-thumb">${imageMarkup(meta.image,meta.name)}</div><div class="minted-token-info"><div><strong>${esc(meta.name||`Token #${tokenId}`)}</strong><span>#${tokenId}</span></div><small>${revealed?'Revealed':'Unrevealed'} · ${esc(shortAddr(owner))}</small></div></article>`;
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
    const provider=getReadProvider();const latest=await provider.getBlockNumber();let to=latest,chunk=100000,logs=[],mintsFound=0,attempts=0;
    while(to>=0&&mintsFound<totalMinted&&attempts<1000){
      const from=Math.max(0,to-chunk+1);$('holdersStatus').textContent=`Scanning holder history… block ${from.toLocaleString()}-${to.toLocaleString()}`;
      try{
        const part=await provider.getLogs({address:config.contract,fromBlock:from,toBlock:to,topics:[TRANSFER_TOPIC]});logs.push(...part);mintsFound+=part.filter(log=>topicAddress(log.topics[1]).toLowerCase()===ZERO).length;to=from-1;attempts++;
        if(part.length<50&&chunk<500000)chunk=Math.min(500000,chunk*2);
      }catch(e){if(chunk>2000){chunk=Math.max(2000,Math.floor(chunk/4));continue}throw e}
    }
    return logs;
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

  async function init(){
    if(config.collectionImage)imageInto('mintAvatar',config.collectionImage);if(config.bannerImage)imageInto('mintBanner',config.bannerImage);
    $('networkStat').textContent=Number(config.chainId)===11155111?'Sepolia':Number(config.chainId)===1?'Ethereum':`Chain ${config.chainId}`;
    $('connectBtn').addEventListener('click',connect);$('publicMintBtn').addEventListener('click',publicMint);$('whitelistMintBtn').addEventListener('click',whitelistMint);bindStrictQty('publicQty');bindStrictQty('whitelistQty');
    $('mintedPrevBtn').addEventListener('click',()=>{mintedPage=Math.max(1,mintedPage-1);loadMintedGallery()});$('mintedNextBtn').addEventListener('click',()=>{mintedPage+=1;loadMintedGallery()});$('mintedSearchBtn').addEventListener('click',searchToken);$('mintedClearBtn').addEventListener('click',clearTokenSearch);$('mintedSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchToken()}});
    $('holdersRefreshBtn').addEventListener('click',()=>loadHolders(true));$('holderPrevBtn').addEventListener('click',()=>{holderPage=Math.max(1,holderPage-1);renderHolders()});$('holderNextBtn').addEventListener('click',()=>{holderPage+=1;renderHolders()});
    $('myNftsRefreshBtn').addEventListener('click',()=>loadHolders(true));$('myNftsPrevBtn').addEventListener('click',()=>{myNftPage=Math.max(1,myNftPage-1);renderMyNfts()});$('myNftsNextBtn').addEventListener('click',()=>{myNftPage+=1;renderMyNfts()});
    if(window.ethereum){ethereum.on?.('accountsChanged',async a=>{wallet=a?.[0]?ethers.getAddress(a[0]):null;signer=null;contract=null;myNftPage=1;$('connectBtn').textContent=wallet?shortAddr(wallet):'Connect Wallet';if(wallet){browserProvider=new ethers.BrowserProvider(window.ethereum);signer=await browserProvider.getSigner();contract=new ethers.Contract(config.contract,ABI,signer)}else{$('myNftsSection')?.classList.add('hidden')}await refresh()});ethereum.on?.('chainChanged',()=>location.reload())}
    await refresh();
  }
  init();
})();
