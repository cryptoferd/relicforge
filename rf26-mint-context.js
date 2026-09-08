(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RelicForgeMintContext=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const ADDRESS=/^0x[0-9a-f]{40}$/i;
  function read(documentRef=typeof document!=='undefined'?document:null){
    const element=documentRef?.getElementById?.('rf26-mint-target');
    if(!element)return null;
    let value;
    try{value=JSON.parse(element.textContent);}catch{throw new Error('Invalid verified mint context.');}
    if(!value||typeof value!=='object'||Array.isArray(value)||
       value.chainId!==1||typeof value.contract!=='string'||
       !ADDRESS.test(value.contract)||/^0x0{40}$/i.test(value.contract)||
       typeof value.slug!=='string'||
       !/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(value.slug)||
       value.slug.includes('--'))
      throw new Error('Invalid verified mint context.');
    return Object.freeze({chainId:1,contract:value.contract.toLowerCase(),slug:value.slug});
  }
  return Object.freeze({read});
});
