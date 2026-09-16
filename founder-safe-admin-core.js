(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RelicForgeSafeAdminCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const ACTIONS = Object.freeze([
    {
      id:'collection.batchWindow',
      group:'Platform Founder — Collection Emergency',
      label:'Set Forge batch window',
      target:'collection',
      authority:'reserveFounder',
      abi:'function setForgeBatchWindowSeconds(uint64 newWindowSeconds)',
      description:'Founder-only emergency tuning for this live collection. Normal production default is 30 seconds.',
      warning:'Changing this affects batching behavior for this collection. Use only for an operational reason.',
      inputs:[{name:'newWindowSeconds',label:'New batch window (seconds)',type:'uint64',kind:'uint',defaultValue:'30'}]
    },
    {
      id:'collection.randomnessCeiling',
      group:'Platform Founder — Collection Emergency',
      label:'Set maximum randomness cost / batch',
      target:'collection',
      authority:'reserveFounder',
      abi:'function setMaxRandomnessCostPerBatchWei(uint256 newCeilingWei)',
      description:'Founder-only emergency ceiling for randomness spending on this live collection.',
      warning:'Production default is 0.005 ETH. Raising this increases the maximum randomness spend allowed by the collection.',
      inputs:[{name:'newCeilingWei',label:'New randomness ceiling (ETH)',type:'uint256',kind:'eth',defaultValue:'0.005'}]
    },

    {
      id:'fees.collectionEnabled',
      group:'Platform FeePolicy',
      label:'Enable / disable collection platform fees',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function setCollectionFeesEnabled(address collection,bool enabled)',
      description:'Temporarily enables or disables collector-paid platform fees for the selected Minter Supported collection.',
      inputs:[
        {name:'collection',label:'Collection',type:'address',kind:'address',auto:'collection'},
        {name:'enabled',label:'Platform fee enabled',type:'bool',kind:'bool',defaultValue:'true'}
      ]
    },
    {
      id:'fees.collectionRate',
      group:'Platform FeePolicy',
      label:'Set collection fee override',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function setCollectionFeeCents(address collection,uint32 feeCents)',
      description:'Overrides the selected collection platform fee. Contract hard ceiling is $5.00/NFT.',
      inputs:[
        {name:'collection',label:'Collection',type:'address',kind:'address',auto:'collection'},
        {name:'feeCents',label:'Platform fee per NFT (USD)',type:'uint32',kind:'usd',defaultValue:'0.50'}
      ]
    },
    {
      id:'fees.clearCollectionRate',
      group:'Platform FeePolicy',
      label:'Clear collection fee override',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function clearCollectionFeeOverride(address collection)',
      description:'Returns this collection to its creation-time locked base fee.',
      inputs:[{name:'collection',label:'Collection',type:'address',kind:'address',auto:'collection'}]
    },
    {
      id:'fees.waiveCollection',
      group:'Platform FeePolicy',
      label:'PERMANENTLY waive collection fee',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function waiveCollection(address collection)',
      description:'Permanently waives the Relic Forge collector fee for this collection.',
      critical:true,
      warning:'IRREVERSIBLE: the FeePolicy intentionally has no unwaive function.',
      inputs:[{name:'collection',label:'Collection',type:'address',kind:'address',auto:'collection'}]
    },
    {
      id:'fees.defaults',
      group:'Platform FeePolicy',
      label:'Set future collection default fees',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function setDefaultFeeCents(uint32 sponsoredCents,uint32 minterCents)',
      description:'Changes defaults for collections created after this transaction. Existing locked base rates are not changed.',
      inputs:[
        {name:'sponsoredCents',label:'Creator-sponsored default / NFT (USD)',type:'uint32',kind:'usd',defaultValue:'0.25'},
        {name:'minterCents',label:'Collector-paid default / NFT (USD)',type:'uint32',kind:'usd',defaultValue:'0.50'}
      ]
    },
    {
      id:'fees.proposeTreasury',
      group:'Platform FeePolicy',
      label:'Propose FeePolicy treasury',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function setTreasury(address treasury_)',
      description:'Starts the two-step FeePolicy treasury transfer. The proposed treasury must separately accept.',
      inputs:[{name:'treasury_',label:'Proposed treasury',type:'address',kind:'address'}]
    },
    {
      id:'fees.acceptTreasury',
      group:'Platform FeePolicy',
      label:'Accept FeePolicy treasury',
      target:'feePolicy',
      authority:'pendingTreasury',
      abi:'function acceptTreasury()',
      description:'Second step of the FeePolicy treasury transfer. Must be executed by the pending treasury address.',
      inputs:[]
    },
    {
      id:'fees.transferAdmin',
      group:'Platform FeePolicy',
      label:'Propose new platform admin',
      target:'feePolicy',
      authority:'platformAdmin',
      abi:'function transferPlatformAdmin(address newAdmin)',
      description:'Starts the two-step FeePolicy platform-admin transfer.',
      warning:'This changes the address that controls all FeePolicy admin functions after acceptance.',
      inputs:[{name:'newAdmin',label:'Proposed platform admin',type:'address',kind:'address'}]
    },
    {
      id:'fees.acceptAdmin',
      group:'Platform FeePolicy',
      label:'Accept platform admin',
      target:'feePolicy',
      authority:'pendingPlatformAdmin',
      abi:'function acceptPlatformAdmin()',
      description:'Second step of the FeePolicy admin transfer. Must be executed by pendingPlatformAdmin.',
      inputs:[]
    },
    {
      id:'fees.withdraw',
      group:'Platform FeePolicy',
      label:'Forward accrued FeePolicy fees',
      target:'feePolicy',
      authority:'any',
      abi:'function withdrawFees()',
      description:'Permissionless trigger that forwards accrued FeePolicy ETH to the configured treasury.',
      inputs:[]
    },

    {
      id:'reserve.policy',
      group:'Reserve',
      label:'Set Reserve policy',
      target:'reserve',
      authority:'reserveFounder',
      abi:'function setReservePolicy(uint256 minimumReserveWei_,uint256 perActiveBatchBufferWei_,uint32 exposureSafetyBps_,uint256 maxSubsidyPerRequestWei_,uint256 maxSubsidyPerCollectionWei_)',
      description:'Updates the chain-local Reserve protection/subsidy policy.',
      critical:true,
      warning:'HIGH IMPACT: these values affect protected reserves and randomness subsidy limits for every canonical collection on this network.',
      inputs:[
        {name:'minimumReserveWei_',label:'Minimum reserve (ETH)',type:'uint256',kind:'eth',defaultValue:'0.20'},
        {name:'perActiveBatchBufferWei_',label:'Per active batch buffer (ETH)',type:'uint256',kind:'eth',defaultValue:'0.02'},
        {name:'exposureSafetyBps_',label:'Exposure safety (basis points)',type:'uint32',kind:'uint',defaultValue:'15000'},
        {name:'maxSubsidyPerRequestWei_',label:'Max subsidy / request (ETH)',type:'uint256',kind:'eth',defaultValue:'0.02'},
        {name:'maxSubsidyPerCollectionWei_',label:'Max lifetime subsidy / collection (ETH)',type:'uint256',kind:'eth',defaultValue:'0.20'}
      ]
    },
    {
      id:'reserve.releaseRevenue',
      group:'Reserve',
      label:'Release available Reserve revenue',
      target:'reserve',
      authority:'reserveFounder',
      abi:'function releaseRevenue()',
      description:'Releases only Reserve ETH above required protected reserves to the configured revenue treasury.',
      inputs:[]
    },
    {
      id:'reserve.proposeTreasury',
      group:'Reserve',
      label:'Propose Reserve revenue treasury',
      target:'reserve',
      authority:'reserveFounder',
      abi:'function proposeRevenueTreasury(address treasury_)',
      description:'Starts the two-step Reserve revenue-treasury transfer.',
      inputs:[{name:'treasury_',label:'Proposed revenue treasury',type:'address',kind:'address'}]
    },
    {
      id:'reserve.acceptTreasury',
      group:'Reserve',
      label:'Accept Reserve revenue treasury',
      target:'reserve',
      authority:'pendingRevenueTreasury',
      abi:'function acceptRevenueTreasury()',
      description:'Second step of the Reserve revenue-treasury transfer. Must be executed by pendingRevenueTreasury.',
      inputs:[]
    },
    {
      id:'reserve.proposeFounder',
      group:'Reserve',
      label:'Propose new platform founder',
      target:'reserve',
      authority:'reserveFounder',
      abi:'function proposeFounder(address newFounder)',
      description:'Starts the two-step Reserve founder handoff.',
      critical:true,
      warning:'After acceptance, the new founder controls Reserve policy and collection emergency platform settings.',
      inputs:[{name:'newFounder',label:'Proposed founder',type:'address',kind:'address'}]
    },
    {
      id:'reserve.acceptFounder',
      group:'Reserve',
      label:'Accept platform founder',
      target:'reserve',
      authority:'pendingFounder',
      abi:'function acceptFounder()',
      description:'Second step of the Reserve founder handoff. Must be executed by pendingFounder.',
      inputs:[]
    },

    {
      id:'creator.payout',
      group:'Collection Controller',
      label:'Set payout receiver',
      target:'collection',
      authority:'controller',
      abi:'function setPayoutReceiver(address receiver)',
      description:'Creator/controller call that changes where creator mint proceeds may be withdrawn.',
      inputs:[{name:'receiver',label:'Payout receiver',type:'address',kind:'address'}]
    },
    {
      id:'creator.royalty',
      group:'Collection Controller',
      label:'Set royalty',
      target:'collection',
      authority:'controller',
      abi:'function setRoyalty(address receiver,uint96 bps)',
      description:'Creator/controller call that updates royalty receiver and basis points.',
      inputs:[
        {name:'receiver',label:'Royalty receiver',type:'address',kind:'address'},
        {name:'bps',label:'Royalty basis points',type:'uint96',kind:'uint',defaultValue:'500'}
      ]
    },
    {
      id:'creator.futureReveal',
      group:'Collection Controller',
      label:'Set future reveal mode',
      target:'collection',
      authority:'controller',
      abi:'function setFutureRevealMode(uint8 mode)',
      description:'Creator/controller call available only before reveal/mint state makes the mode immutable.',
      inputs:[{name:'mode',label:'Reveal mode',type:'uint8',kind:'select',defaultValue:'1',options:[['0','Deferred Reveal'],['1','Forge Reveal']]}]
    },
    {
      id:'creator.renderConfig',
      group:'Collection Controller',
      label:'Set render configuration',
      target:'collection',
      authority:'controller',
      abi:'function setRenderConfig(string baseURI,bool holderEnabled,uint8 defaultMode)',
      description:'Creator/controller call available only before ProjectData content is sealed.',
      inputs:[
        {name:'baseURI',label:'Flattened render base URI',type:'string',kind:'string',defaultValue:''},
        {name:'holderEnabled',label:'Holder render switching enabled',type:'bool',kind:'bool',defaultValue:'true'},
        {name:'defaultMode',label:'Default render mode',type:'uint8',kind:'select',defaultValue:'0',options:[['0','Fully Onchain SVG'],['1','Offchain Render']]}
      ]
    },
    {
      id:'creator.transferOwnership',
      group:'Collection Controller',
      label:'Transfer collection controller',
      target:'collection',
      authority:'controller',
      abi:'function transferOwnership(address newOwner)',
      description:'Transfers collection control and the bound MintPhases controller together.',
      critical:true,
      warning:'HIGH IMPACT: after execution, the current controller loses collection admin authority.',
      inputs:[{name:'newOwner',label:'New controller',type:'address',kind:'address'}]
    },
    {
      id:'creator.renounce',
      group:'Collection Controller',
      label:'PERMANENTLY renounce collection control',
      target:'collection',
      authority:'controller',
      abi:'function renounceControl()',
      description:'Permanently removes creator/controller authority after the contract safety conditions are satisfied.',
      critical:true,
      warning:'IRREVERSIBLE: this permanently removes collection controller authority.',
      inputs:[]
    },
    {
      id:'creator.prepareReveal',
      group:'Collection Controller',
      label:'Prepare delayed reveal',
      target:'collection',
      authority:'controller',
      abi:'function prepareDelayedReveal()',
      description:'Delayed Reveal transaction #1: freezes/funds the currently minted set.',
      inputs:[]
    },
    {
      id:'creator.requestReveal',
      group:'Collection Controller',
      label:'Request delayed reveal',
      target:'collection',
      authority:'controller',
      abi:'function requestDelayedReveal()',
      description:'Delayed Reveal transaction #2: requests verified randomness after preparation.',
      inputs:[]
    },
    {
      id:'creator.cancelPreparedReveal',
      group:'Collection Controller',
      label:'Cancel prepared delayed reveal',
      target:'collection',
      authority:'controller',
      abi:'function cancelPreparedDelayedReveal()',
      description:'Advanced recovery call available only before delayed-reveal transaction #2.',
      inputs:[]
    },

    {
      id:'phases.masterMint',
      group:'Mint Stage Controller',
      label:'Enable / disable Master Mint',
      target:'mintPhases',
      authority:'controller',
      abi:'function setMasterMintEnabled(bool enabled)',
      description:'Creator/controller call that gates every configured mint stage.',
      inputs:[{name:'enabled',label:'Master Mint enabled',type:'bool',kind:'bool',defaultValue:'true'}]
    },
    {
      id:'phases.stageEnabled',
      group:'Mint Stage Controller',
      label:'Enable / disable a mint stage',
      target:'mintPhases',
      authority:'controller',
      abi:'function setPhaseEnabled(uint32 phaseId,bool enabled)',
      description:'Creator/controller call that toggles one existing MintPhases stage.',
      inputs:[
        {name:'phaseId',label:'Stage ID',type:'uint32',kind:'uint',defaultValue:'1'},
        {name:'enabled',label:'Stage enabled',type:'bool',kind:'bool',defaultValue:'true'}
      ]
    }
  ]);

  function byId(id){ return ACTIONS.find(action=>action.id===id)||null; }

  function parseUsdCents(value){
    const text=String(value??'').trim();
    if(!/^\d+(?:\.\d{0,2})?$/.test(text))throw new Error('USD values must have at most two decimal places.');
    const [whole='0',fraction='']=text.split('.');
    return BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));
  }

  function parseUnsigned(value,label='Value'){
    const text=String(value??'').trim();
    if(!/^\d+$/.test(text))throw new Error(`${label} must be a non-negative whole number.`);
    return BigInt(text);
  }

  function safeMethod(action){
    return {
      inputs:action.inputs.map(input=>({internalType:input.type,name:input.name,type:input.type})),
      name:(action.abi.match(/function\s+([A-Za-z0-9_]+)/)||[])[1]||'',
      payable:false
    };
  }

  function buildSafeTransactionBuilder({action,chainId,safeAddress,target,inputValues,name,description}){
    const values={};
    for(const input of action.inputs){
      const raw=inputValues[input.name];
      values[input.name]=typeof raw==='boolean'?String(raw):String(raw);
    }
    return {
      version:'1.0',
      chainId:String(chainId),
      createdAt:Date.now(),
      meta:{
        name:name||`Relic Forge — ${action.label}`,
        description:description||action.description||'Generated by Relic Forge Founder Safe Admin Calls.',
        txBuilderVersion:'1.18.0',
        createdFromSafeAddress:safeAddress,
        createdFromOwnerAddress:''
      },
      transactions:[{
        to:target,
        value:'0',
        data:null,
        contractMethod:safeMethod(action),
        contractInputsValues:values
      }]
    };
  }

  return Object.freeze({ACTIONS,byId,parseUsdCents,parseUnsigned,safeMethod,buildSafeTransactionBuilder});
});
