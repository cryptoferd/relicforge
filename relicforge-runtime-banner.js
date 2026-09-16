(() => {
  'use strict';
  const apiBase=()=>String(window.RelicForgeCloud?.apiBase?.()||window.RELICFORGE_CONFIG?.apiBase||'').replace(/\/$/,'');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    const base=apiBase();if(!base)return;
    try{
      const res=await fetch(base+'/api/public/platform-runtime',{cache:'no-store'});if(!res.ok)return;
      const data=await res.json(),rows=[...(data.announcements||[])];
      if(data.maintenanceMode)rows.unshift({id:'maintenance',title:'Relic Forge maintenance',body:'Some website operations may be temporarily restricted. Deployed contracts remain onchain and are not implied to be paused.',severity:'warning'});
      if(!rows.length)return;
      const host=document.createElement('div');host.className='rf-runtime-banner-stack';
      for(const row of rows.slice(0,3)){
        const item=document.createElement('div');item.className=`rf-runtime-banner ${['critical','warning','success'].includes(row.severity)?row.severity:'info'}`;
        item.innerHTML=`<div><strong>${esc(row.title)}</strong><span>${esc(row.body)}</span></div><button type="button" aria-label="Dismiss notice">×</button>`;
        item.querySelector('button').addEventListener('click',()=>{item.remove();if(!host.children.length)host.remove();});host.appendChild(item);
      }
      document.body.prepend(host);
    }catch{}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();
