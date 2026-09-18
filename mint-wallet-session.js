(() => {
  'use strict';

  const $=id=>document.getElementById(id);
  const short=value=>{
    const text=String(value||'');
    return text.length>13?`${text.slice(0,6)}…${text.slice(-4)}`:text;
  };
  const setMintStatus=message=>{
    const node=$('mintStatus');
    if(node)node.textContent=message;
  };

  async function snapshot(){
    const manager=window.RelicForgeWallets;
    if(!manager?.ready)return {provider:null,info:null,account:null};
    await manager.ready();
    const provider=manager.getProvider?.()||null;
    const info=manager.getInfo?.()||null;
    if(!provider?.request)return {provider:null,info:null,account:null};
    let accounts=[];
    try{accounts=await provider.request({method:'eth_accounts'});}catch{}
    return {provider,info,account:accounts?.[0]||null};
  }

  function render({info=null,account=null}={}){
    const connect=$('connectBtn');
    const switchBtn=$('mintSwitchWalletBtn');
    const disconnectBtn=$('mintDisconnectWalletBtn');
    const providerLabel=$('mintWalletProviderLabel');
    const connected=!!account;

    if(connect)connect.textContent=connected?short(account):'Connect Wallet';
    switchBtn?.classList.toggle('hidden',!connected);
    disconnectBtn?.classList.toggle('hidden',!connected);

    if(providerLabel){
      providerLabel.textContent=connected?(info?.name||'Selected wallet'):'';
      providerLabel.title=connected?`${info?.name||'Selected wallet'} · ${account}`:'';
      providerLabel.classList.toggle('hidden',!connected);
    }
  }

  async function refresh(){
    try{render(await snapshot());}
    catch{render({});}
  }

  async function switchWallet(){
    const manager=window.RelicForgeWallets;
    if(!manager?.requestAccount)throw new Error('Relic Forge wallet selector is unavailable.');
    const button=$('mintSwitchWalletBtn');
    if(button)button.disabled=true;
    try{
      const address=await manager.requestAccount({forceChooser:true});
      setMintStatus(`Selected ${short(address)}. Reloading mint state…`);
      location.reload();
    }catch(error){
      if(Number(error?.code)!==4001)setMintStatus(`Wallet switch error: ${error?.message||error}`);
    }finally{
      if(button)button.disabled=false;
    }
  }

  async function disconnectWallet(){
    const manager=window.RelicForgeWallets;
    const button=$('mintDisconnectWalletBtn');
    if(button)button.disabled=true;
    try{
      if(manager?.disconnect)await manager.disconnect({revoke:true,clearSelection:true});
      render({});
      setMintStatus('Wallet disconnected.');
      location.reload();
    }catch(error){
      setMintStatus(`Disconnect error: ${error?.message||error}`);
      if(button)button.disabled=false;
    }
  }

  async function init(){
    $('mintSwitchWalletBtn')?.addEventListener('click',event=>{
      event.preventDefault();
      switchWallet().catch(error=>setMintStatus(`Wallet switch error: ${error.message}`));
    });
    $('mintDisconnectWalletBtn')?.addEventListener('click',event=>{
      event.preventDefault();
      disconnectWallet().catch(error=>setMintStatus(`Disconnect error: ${error.message}`));
    });

    window.addEventListener('relicforge:wallet-provider-changed',()=>setTimeout(refresh,0));
    window.addEventListener('relicforge:wallet-accounts-changed',()=>setTimeout(refresh,0));
    await refresh();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(()=>{}));
  else init().catch(()=>{});
})();
