'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../rf26-oneofone-metadata.js');
const ui = require('../../rf26-oneofone-metadata-ui.js');
const rows = (...entries) => entries.map(([traitType,value]) => ({traitType,value}));

test('canonical names reuse spelling, case and whitespace variants', () => {
  const names = core.catalog([{name:'Origin'}],[{metadata:rows([' origin ','Ancient'])}],['ORIGIN']);
  assert.deepEqual(names,['Origin']);
  assert.equal(core.resolve('  ORIGIN  ',names),'Origin');
});
test('different punctuation remains a distinct category', () => {
  assert.deepEqual(core.catalog([],[],['Eye Color','Eye-Color']),['Eye Color','Eye-Color']);
});
test('visible generative categories and prior standalone categories share a catalog', () => {
  assert.deepEqual(core.catalog([{name:'Background'},{name:'Hidden',metadataHidden:true}],[{metadata:rows(['Origin','Ancient'])}],['Era']),['Background','Era','Origin']);
});
test('a saved unused category survives deletion of its last metadata row', () => {
  assert.deepEqual(core.catalog([],[],['Origin']),['Origin']);
});
test('creating an existing name reuses its canonical name', () => {
  const result = core.register(['Origin'],'  oRiGiN  ',[],[]);
  assert.equal(result.name,'Origin'); assert.equal(result.reused,true); assert.deepEqual(result.categories,['Origin']);
});
test('new categories persist without altering existing rows', () => {
  const original=rows(['Origin','Ancient']);
  const result=core.register(['Origin'],'Era',[],[{metadata:original}]);
  assert.equal(result.reused,false); assert.deepEqual(result.categories,['Origin','Era']);
  assert.deepEqual(original,rows(['Origin','Ancient']));
});
test('legacy rows remain untouched by catalog discovery', () => {
  const legacy=rows([' origin ','Ancient']);
  core.catalog([{name:'Origin'}],[{metadata:legacy}],[]);
  assert.equal(legacy[0].traitType,' origin ');
});
test('draft normalization preserves values and unknown fields', () => {
  const output=core.draftRows([{traitType:' ORIGIN ',value:'  Ancient  ',extra:7}],['Origin']);
  assert.deepEqual(output,[{traitType:'Origin',value:'  Ancient  ',extra:7}]);
});
test('the same category and value cannot appear twice on a token', () => {
  assert.equal(core.validateRows(rows(['Origin','Ancient'],['Origin','Ancient']),['Origin']).length,1);
});
test('duplicate detection ignores case and surrounding whitespace', () => {
  assert.equal(core.validateRows(rows(['Origin','Ancient'],[' origin ',' ancient ']),['Origin']).length,1);
});
test('a category may contain different values on the same token', () => {
  assert.deepEqual(core.validateRows(rows(['Origin','Ancient'],['Origin','Celestial']),['Origin']),[]);
});
test('incomplete nonblank rows are reported without mutating the draft', () => {
  const draft=rows(['Origin','']);
  assert.equal(core.validateRows(draft,['Origin']).length,1);
  assert.deepEqual(draft,rows(['Origin','']));
});
test('a completely empty draft row does not create an exported attribute', () => {
  assert.deepEqual(core.serializeRows(rows(['',''],['Origin','Ancient']),['Origin']),[{traitType:'Origin',value:'Ancient'}]);
});
test('duplicate implicit default 1/1 attribute is rejected', () => {
  assert.equal(core.validateRows(rows(['1/1','Relic']),['1/1'],{traitType:'1/1',value:'Relic'}).length,1);
});
test('disabled default attribute does not create a collision', () => {
  assert.deepEqual(core.validateRows(rows(['1/1','Relic']),['1/1'],null),[]);
});
test('category and value limits remain enforced', () => {
  assert.throws(()=>core.register([],'A'.repeat(81)),/1–80/);
  assert.equal(core.validateRows(rows(['A','B'.repeat(121)]),['A']).length,1);
});
test('rendered user-controlled labels are HTML escaped', () => {
  const html=core.renderRows({metadata:rows(['<script>','"><img src=x>'])},['<script>']);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&quot;&gt;&lt;img'));
});
test('export preserves the existing flat traitType/value schema', () => {
  assert.deepEqual(core.serializeRows(rows([' origin ','  Ancient ']),['Origin']),[{traitType:'Origin',value:'Ancient'}]);
});
test('different 1/1 tokens can reuse one category with different values', () => {
  const items=[{id:'a',name:'A',metadata:rows(['Origin','Ancient'])},{id:'b',name:'B',metadata:rows(['Origin','Celestial'])}];
  assert.deepEqual(core.validateProject([],items,[]),[]);
});
test('project validation identifies the affected standalone token', () => {
  const errors=core.validateProject([], [{id:'a',name:'A',metadata:rows(['Origin','Ancient'],['Origin','Ancient'])}],[]);
  assert.equal(errors[0].oneOfOneId,'a'); assert.equal(errors[0].index,1);
});
test('serialization refuses duplicate fields instead of silently deleting them', () => {
  assert.throws(()=>core.serializeRows(rows(['Origin','A'],['Origin','A']),['Origin']),/already exists/);
});
test('new category option and create/cancel controls are included', () => {
  const html=core.renderRows({metadata:rows(['Origin','A'])},['Origin']);
  assert.ok(html.includes('+ Create New Category')); assert.ok(html.includes('data-create-oneofone-category'));
  assert.ok(html.includes('data-cancel-oneofone-category'));
});

function fakeEditor() {
  const listeners={}; const state={layers:[],oneOfOnes:[{id:'a',name:'Relic',metadata:rows(['Origin','Ancient']),includeDefaultAttribute:true}],saved:['Origin']};
  const errorHost={innerHTML:''};
  const card={dataset:{oneofoneId:'a'},querySelector:()=>errorHost};
  const newInput={value:'',focused:false,focus(){this.focused=true;}};
  const form={classList:{remove(){},add(){}},querySelector:()=>newInput};
  const row={dataset:{metaIndex:'0'},querySelector(selector){return selector==='.rf26-meta-create'?form:newInput;}};
  const list={addEventListener(name,fn){listeners[name]=fn;},querySelectorAll(){return [card];}};
  let invalidations=0,renders=0,removed=null,lastStatus='';
  ui.bind(list,{core,getItem:id=>state.oneOfOnes.find(i=>i.id===id),layers:()=>state.layers,items:()=>state.oneOfOnes,catalog:()=>core.catalog(state.layers,state.oneOfOnes,state.saved),saved:()=>state.saved,setSaved:v=>{state.saved=v;},render:()=>{renders++;},remove:id=>{removed=id;},status:m=>{lastStatus=m;},invalidate:()=>{invalidations++;}});
  function target(classes=[],values={}) {
    return {classList:{contains:c=>classes.includes(c)},closest:selector=>selector==='[data-oneofone-id]'?card:selector==='[data-meta-index]'?row:null,...values};
  }
  function dispatch(name,t,extra={}) {listeners[name]({target:t,...extra});}
  return {state,newInput,target,dispatch,get invalidations(){return invalidations;},get renders(){return renders;},get removed(){return removed;},get lastStatus(){return lastStatus;},errorHost};
}
test('existing category selection writes the canonical name',()=>{
  const e=fakeEditor(); e.dispatch('change',e.target(['oneofone-meta-category'],{value:'Origin'}));
  assert.equal(e.state.oneOfOnes[0].metadata[0].traitType,'Origin'); assert.equal(e.invalidations,1);
});
test('creating a case-variant category reuses the original',()=>{
  const e=fakeEditor(); e.newInput.value=' origin ';
  e.dispatch('click',e.target([], {closest:s=>s==='[data-create-oneofone-category]'?{}:s==='[data-oneofone-id]'?{dataset:{oneofoneId:'a'}}:s==='[data-meta-index]'?{dataset:{metaIndex:'0'},querySelector:()=>e.newInput}:null}));
  assert.deepEqual(e.state.saved,['Origin']); assert.equal(e.state.oneOfOnes[0].metadata[0].traitType,'Origin');
  assert.match(e.lastStatus,/Reused/);
});
test('creating a new category saves it and updates the active row',()=>{
  const e=fakeEditor(); e.newInput.value='Era';
  const t=e.target([], {closest:s=>s==='[data-create-oneofone-category]'?{}:s==='[data-oneofone-id]'?{dataset:{oneofoneId:'a'}}:s==='[data-meta-index]'?{dataset:{metaIndex:'0'},querySelector:()=>e.newInput}:null});
  e.dispatch('click',t); assert.deepEqual(e.state.saved,['Origin','Era']);
  assert.equal(e.state.oneOfOnes[0].metadata[0].traitType,'Era'); assert.equal(e.invalidations,1);
});
test('typing a metadata value retains its draft and invalidates compiled output',()=>{
  const e=fakeEditor(); e.dispatch('input',e.target(['oneofone-meta-value'],{value:'Celestial'}));
  assert.equal(e.state.oneOfOnes[0].metadata[0].value,'Celestial'); assert.equal(e.invalidations,1);
});
test('selecting New preserves the old category until creation is confirmed',()=>{
  const e=fakeEditor(); e.dispatch('change',e.target(['oneofone-meta-category'],{value:'__rf26_new_category__'}));
  assert.equal(e.state.oneOfOnes[0].metadata[0].traitType,'Origin'); assert.equal(e.invalidations,0); assert.equal(e.newInput.focused,true);
});
test('canceling category creation preserves the original row',()=>{
  const e=fakeEditor(); e.dispatch('click',e.target([], {closest:s=>s==='[data-cancel-oneofone-category]'?{}:s==='[data-oneofone-id]'?{dataset:{oneofoneId:'a'}}:s==='[data-meta-index]'?{dataset:{metaIndex:'0'}}:null}));
  assert.equal(e.state.oneOfOnes[0].metadata[0].traitType,'Origin'); assert.equal(e.renders,1);
});
test('duplicate metadata values display an error instead of being discarded',()=>{
  const e=fakeEditor();e.state.oneOfOnes[0].metadata.push({traitType:'Origin',value:'Ancient'});
  e.dispatch('input',e.target(['oneofone-meta-value'],{value:'Ancient'}));
  assert.match(e.errorHost.innerHTML,/already exists/);assert.equal(e.state.oneOfOnes[0].metadata.length,2);
});
test('artwork and token name overrides remain editable',()=>{
  const e=fakeEditor();e.dispatch('input',e.target(['oneofone-token-name'],{value:'The First Relic'}));
  assert.equal(e.state.oneOfOnes[0].tokenName,'The First Relic');
});
test('default attribute toggle remains supported',()=>{
  const e=fakeEditor();e.dispatch('change',e.target(['oneofone-default-attribute'],{checked:false}));
  assert.equal(e.state.oneOfOnes[0].includeDefaultAttribute,false);
});
