(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ABI = [
    'function name() view returns (string)','function symbol() view returns (string)','function description() view returns (string)',
    'function maxSupply() view returns (uint32)','function totalMinted() view returns (uint32)','function maxPerWallet() view returns (uint32)',
    'function mintPrice() view returns (uint256)','function whitelistMintPrice() view returns (uint256)','function publicMintEnabled() view returns (bool)',
    'function whitelistMintEnabled() view returns (bool)','function whitelistRoot() view returns (bytes32)','function revealMode() view returns (uint8)',
    'function mintedByWallet(address) view returns (uint32)','function whitelistMintedByWallet(address) view returns (uint32)',
    'function mint(uint32 quantity) payable returns (uint256)','function whitelistMint(uint32 quantity,uint32 allowance,bytes32[] proof) payable returns (uint256)'
  ];
  const params = new URLSearchParams(location.search);
  const embedded = window.RELICFORGE_MINT_CONFIG || {};
  const requestedContract = embedded.contract || params.get('contract') || '';
  const requestedChain = Number(embedded.chainId || params.get('chain') || 11155111);
  const localKey = requestedContract ? `relicforge_mint_page_${requestedChain}_${requestedContract.toLowerCase()}` : '';
  let localConfig = {};
  try { if (localKey) localConfig = JSON.parse(localStorage.getItem(localKey) || '{}'); } catch (_) {}
  const config = { ...localConfig, ...embedded, contract: requestedContract || localConfig.contract, chainId: requestedChain || localConfig.chainId || 11155111 };
  let browserProvider = null, signer = null, wallet = null, contract = null, contractState = null, whitelistData = null;

  function shortAddr(v){return v && v.length>12?`${v.slice(0,6)}…${v.slice(-4)}`:(v||'—')}
  function status(msg){$('mintStatus').textContent=msg}
  function fmtEth(v){try{return `${Number(ethers.formatEther(v)).toLocaleString(undefined,{maximumFractionDigits:6})} ETH`}catch(_){return '—'}}
  function imageInto(id, src){if(!src)return; const host=$(id); host.innerHTML=''; const img=document.createElement('img');img.src=src;img.alt='';host.appendChild(img)}
  function leaf(entry){return ethers.keccak256(ethers.solidityPacked(['address','uint32'],[entry.address,entry.allowance]))}
  function hashPair(a,b){if(!b)return a;return BigInt(a)<=BigInt(b)?ethers.keccak256(ethers.concat([a,b])):ethers.keccak256(ethers.concat([b,a]))}
  function buildWhitelist(entries){
    const valid=(entries||[]).filter(e=>e&&ethers.isAddress(e.address)&&Number(e.allowance)>0).map(e=>({address:ethers.getAddress(e.address),allowance:Number(e.allowance)})).sort((a,b)=>a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
    if(!valid.length)return null; const leaves=valid.map(leaf),layers=[leaves];
    while(layers.at(-1).length>1){const c=layers.at(-1),n=[];for(let i=0;i<c.length;i+=2)n.push(i+1<c.length?hashPair(c[i],c[i+1]):c[i]);layers.push(n)}
    const by={}; valid.forEach((e,index)=>{let cursor=index,proof=[];for(let level=0;level<layers.length-1;level++){const layer=layers[level],sib=cursor%2===0?cursor+1:cursor-1;if(sib<layer.length)proof.push(layer[sib]);cursor=Math.floor(cursor/2)}by[e.address.toLowerCase()]={...e,proof}});return {root:layers.at(-1)[0],by};
  }
  async function readConfigWhitelist(){
    if(Array.isArray(config.whitelistEntries)&&config.whitelistEntries.length) return buildWhitelist(config.whitelistEntries);
    if(config.whitelistUrl){try{const res=await fetch(config.whitelistUrl,{cache:'no-store'});if(res.ok){const data=await res.json();return buildWhitelist(data.entries||data.whitelist||data)}}catch(_) {}}
    return null;
  }
  async function ensureNetwork(){
    if(!window.ethereum) throw new Error('No EVM wallet provider detected.');
    const hex='0x'+Number(config.chainId||11155111).toString(16);
    const current=await ethereum.request({method:'eth_chainId'});
    if(current.toLowerCase()!==hex.toLowerCase()) await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:hex}]});
  }
  async function connect(){
    try{await ensureNetwork();await ethereum.request({method:'eth_requestAccounts'});browserProvider=new ethers.BrowserProvider(window.ethereum);signer=await browserProvider.getSigner();wallet=await signer.getAddress();contract=new ethers.Contract(config.contract,ABI,signer);$('connectBtn').textContent=shortAddr(wallet);await refresh();status('Wallet connected. Ready to mint.')}catch(e){status(`Wallet error: ${e.message}`)}
  }
  async function readOnlyContract(){
    if(contract)return contract;
    if(window.ethereum){browserProvider=new ethers.BrowserProvider(window.ethereum);return new ethers.Contract(config.contract,ABI,browserProvider)}
    throw new Error('Connect a wallet to read this collection.');
  }
  async function refresh(){
    if(!config.contract||!ethers.isAddress(config.contract)){status('Mint page is missing a valid collection contract address.');return}
    try{
      const c=await readOnlyContract();
      const [name,desc,maxSupply,totalMinted,maxPerWallet,mintPrice,wlPrice,pub,wlEnabled,root,reveal]=await Promise.all([c.name(),c.description(),c.maxSupply(),c.totalMinted(),c.maxPerWallet(),c.mintPrice(),c.whitelistMintPrice(),c.publicMintEnabled(),c.whitelistMintEnabled(),c.whitelistRoot(),c.revealMode()]);
      contractState={name,desc,maxSupply:Number(maxSupply),totalMinted:Number(totalMinted),maxPerWallet:Number(maxPerWallet),mintPrice,wlPrice,pub,wlEnabled,root,reveal:Number(reveal)};
      document.title=`${name} — Mint`; $('collectionName').textContent=name; $('collectionDescription').textContent=desc; $('mintedStat').textContent=`${Number(totalMinted).toLocaleString()} / ${Number(maxSupply).toLocaleString()}`; $('priceStat').textContent=fmtEth(mintPrice); $('limitStat').textContent=Number(maxPerWallet)?Number(maxPerWallet).toLocaleString():'Unlimited'; $('revealStat').textContent=Number(reveal)===0?'Forge Reveal':'Creator Reveal'; $('publicPrice').textContent=fmtEth(mintPrice); $('publicCard').classList.toggle('disabled',!pub); $('publicMintBtn').disabled=!pub||!wallet;
      $('contractInfo').innerHTML=`Contract: <a target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/address/${config.contract}">${config.contract}</a>`;
      whitelistData=await readConfigWhitelist();
      if(wallet){const [m,wm]=await Promise.all([c.mintedByWallet(wallet),c.whitelistMintedByWallet(wallet)]);$('walletMintsStat').textContent=Number(m).toLocaleString();const entry=whitelistData?.by?.[wallet.toLowerCase()];if(wlEnabled&&entry&&(!root||root.toLowerCase()===whitelistData.root.toLowerCase())){$('whitelistState').textContent=`Eligible · ${Number(wm)}/${entry.allowance} used`;$('whitelistState').className='eligible';$('whitelistMintBtn').disabled=false}else{$('whitelistState').textContent=wlEnabled?(whitelistData?'Not eligible':'Proof list unavailable'):'Disabled';$('whitelistState').className='not-eligible';$('whitelistMintBtn').disabled=true}}
      else{$('walletMintsStat').textContent='Connect wallet';$('whitelistState').textContent=wlEnabled?'Connect to check':'Disabled';$('whitelistMintBtn').disabled=true}
      $('whitelistCard').classList.toggle('disabled',!wlEnabled); $('mintIntro').textContent=Number(reveal)===0?'Mint once, then your token forges automatically when randomness resolves.':'Minted tokens display the creator placeholder until the collection reveal.';status(wallet?'Ready to mint.':'Collection loaded. Connect a wallet to mint.');
    }catch(e){status(`Contract error: ${e.message}`)}
  }
  async function publicMint(){
    try{if(!wallet)await connect();const q=Math.max(1,Math.floor(Number($('publicQty').value||1)));status(`Submitting public mint for ${q} NFT${q===1?'':'s'}…`);const tx=await contract.mint(q,{value:contractState.mintPrice*BigInt(q)});status(`Mint submitted: ${tx.hash.slice(0,12)}… Waiting for confirmation…`);await tx.wait();status(`Mint confirmed. ${contractState.reveal===0?'Your relic is forging.':'Your placeholder NFT is minted.'}`);await refresh()}catch(e){status(`Mint error: ${e.shortMessage||e.message}`)}
  }
  async function whitelistMint(){
    try{if(!wallet)await connect();const entry=whitelistData?.by?.[wallet.toLowerCase()];if(!entry)throw new Error('This wallet does not have a whitelist proof on this mint page.');const q=Math.max(1,Math.floor(Number($('whitelistQty').value||1)));status(`Submitting whitelist mint for ${q}…`);const tx=await contract.whitelistMint(q,entry.allowance,entry.proof,{value:contractState.wlPrice*BigInt(q)});status(`Whitelist mint submitted: ${tx.hash.slice(0,12)}…`);await tx.wait();status('Whitelist mint confirmed.');await refresh()}catch(e){status(`Whitelist mint error: ${e.shortMessage||e.message}`)}
  }
  async function init(){
    if(config.collectionImage)imageInto('mintAvatar',config.collectionImage);if(config.bannerImage)imageInto('mintBanner',config.bannerImage);
    $('networkStat').textContent=Number(config.chainId)===11155111?'Sepolia':`Chain ${config.chainId}`;
    $('connectBtn').addEventListener('click',connect);$('publicMintBtn').addEventListener('click',publicMint);$('whitelistMintBtn').addEventListener('click',whitelistMint);
    if(window.ethereum){ethereum.on?.('accountsChanged',async a=>{wallet=a?.[0]?ethers.getAddress(a[0]):null;signer=null;contract=null;$('connectBtn').textContent=wallet?shortAddr(wallet):'Connect Wallet';if(wallet){browserProvider=new ethers.BrowserProvider(window.ethereum);signer=await browserProvider.getSigner();contract=new ethers.Contract(config.contract,ABI,signer)}await refresh()});ethereum.on?.('chainChanged',()=>location.reload())}
    await refresh();
  }
  init();
})();
