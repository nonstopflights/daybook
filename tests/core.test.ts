import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {parseCapture} from '../lib/capture';
import {makeCard} from '../lib/types';
import {calendarFile} from '../lib/calendar';
// Create an isolated database; never run mutations against the developer's journal.
const testDatabase='daybook_test_'+crypto.randomUUID().replaceAll('-','');
const connectionString=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
const admin=new Pool({connectionString,max:1,connectionTimeoutMillis:5000});
let created=false;
before(async()=>{
  await admin.query(`CREATE DATABASE "${testDatabase}"`);
  created=true;
  const globals=globalThis as typeof globalThis & {daybookPgPool?:Pool};
  let testConnectionString=connectionString;
  if(connectionString){const url=new URL(connectionString);url.pathname='/'+testDatabase;testConnectionString=url.toString();}
  globals.daybookPgPool=new Pool({connectionString:testConnectionString,database:testDatabase,max:4,connectionTimeoutMillis:5000});
});
after(async()=>{
  const globals=globalThis as typeof globalThis & {daybookPgPool?:Pool};
  await globals.daybookPgPool?.end();
  try{if(created)await admin.query(`DROP DATABASE "${testDatabase}"`);}finally{await admin.end();}
});
const reference=new Date(2026,8,26,12);
const tags=[{id:'errands',name:'errands',aliases:['shopping'],color:'#d47b32',archived:false}];
test('natural capture distinguishes a planned Tuesday from a Friday deadline',()=>{const p=parseCapture('Go to grocery store on Tuesday',tags,reference);assert.equal(p.kind,'task');assert.equal(p.plannedDate,'2026-09-29');assert.equal(p.dueDate,null);assert.equal(p.time,null);assert.equal(p.title,'Go to grocery store');assert.deepEqual(p.suggestedTags,['errands']);const deadline=parseCapture('Finish proposal by Friday',tags,reference);assert.equal(deadline.dueDate,'2026-10-02');assert.equal(deadline.plannedDate,null);});
test('notes, events, explicit aliases, and uncertain time remain distinguishable',()=>{assert.equal(parseCapture('Idea: a little greenhouse',tags,reference).kind,'note');const event=parseCapture('Dentist Tuesday at 2pm #shopping',tags,reference);assert.equal(event.kind,'event');assert.equal(event.time,'14:00');assert.deepEqual(event.tags,['errands']);assert.equal(parseCapture('Call Sam tomorrow morning',tags,reference).ambiguous,true);});
test('card summaries use note content and handle image-only notes',async()=>{const {miniSummary}=await import('../lib/summary');assert.equal(miniSummary('Call Alex tomorrow. Ask about the trip.'),'Call Alex tomorrow.');assert.equal(miniSummary('', ['photo.png']),'Image note');assert.equal(miniSummary(''),'New thought');});
test('calendar exports all-day ranges with an exclusive end and escapes text',()=>{const output=calendarFile(makeCard({id:'test',title:'A, B; C',plainText:'One\nTwo'}),'2026-09-29',null,30);assert.match(output,/DTSTART;VALUE=DATE:20260929/);assert.match(output,/DTEND;VALUE=DATE:20260930/);assert.match(output,/SUMMARY:A\\, B\\; C/);assert.match(output,/DESCRIPTION:One\\nTwo/);});
test('PostgreSQL mutations merge tags without duplicating cards and reject stale edits',async()=>{
  const {mutation,readState}=await import('../lib/store');
  const a=makeCard({tags:['personal','ideas']});
  await mutation({type:'create',card:a});
  await mutation({type:'tag-merge',from:'ideas',to:'personal'});
  let state=await readState();
  assert.deepEqual(state.cards.find(c=>c.id===a.id)?.tags,['personal']);
  assert.equal(state.tags.some(t=>t.id==='ideas'),false);
  assert.ok(state.tags.find(t=>t.id==='personal')?.aliases.includes('ideas'));
  assert.ok(!state.boardTags.includes('ideas'));
  await assert.rejects(mutation({type:'update',id:a.id,expectedUpdatedAt:'old',patch:{title:'Lost edit'}}),/changed elsewhere/);
  await mutation({type:'migrate',id:a.id,to:'2026-10-01'});
  state=await readState();
  assert.equal(state.cards.find(c=>c.id===a.id)?.history.length,1);
  assert.equal(state.cards.find(c=>c.id===a.id)?.plannedDate,'2026-10-01');
});
test('PostgreSQL attachment storage saves and reads file bytes',async()=>{const {saveFile,readStoredFile}=await import('../lib/store');const id=crypto.randomUUID();await saveFile({id,name:'test.png',type:'image/png',size:3},Buffer.from([1,2,3]));const result=await readStoredFile(id);assert.equal(result?.file.name,'test.png');assert.deepEqual(result?.data,Buffer.from([1,2,3]));});
test('view preferences persist and older exports default to visible',async()=>{
  const {mutation,readState}=await import('../lib/store');
  assert.deepEqual((await readState()).preferences,{today:true,journal:true,future:true,showCardTitles:false});
  await Promise.all([mutation({type:'preferences',patch:{today:false}}),mutation({type:'preferences',patch:{journal:false}}),mutation({type:'preferences',patch:{future:false}})]);
  assert.deepEqual((await readState()).preferences,{today:false,journal:false,future:false,showCardTitles:false});
  const {preferences,...legacy}=await readState();
  await mutation({type:'import',state:legacy});
  assert.deepEqual((await readState()).preferences,{today:true,journal:true,future:true,showCardTitles:false});
});
test('repeating completion produces one next occurrence even on duplicate saves',async()=>{
  const {mutation,readState}=await import('../lib/store');
  const card=makeCard({title:'Repeat me',kind:'task',recurrence:'monthly',plannedDate:'2026-01-31'});
  await mutation({type:'create',card});
  await mutation({type:'update',id:card.id,patch:{status:'done'}});
  await mutation({type:'update',id:card.id,patch:{status:'done'}});
  const matches=(await readState()).cards.filter(c=>c.title==='Repeat me');
  assert.equal(matches.length,2);
  assert.equal(matches.find(c=>c.status==='open')?.plannedDate,'2026-02-28');
});
test('batch archive updates selected cards together and rejects invalid selections',async()=>{
  const {mutation,readState}=await import('../lib/store');
  const first=makeCard({title:'Batch first',focus:true}),second=makeCard({title:'Batch second'});
  await mutation({type:'create',card:first});
  await mutation({type:'create',card:second});
  await assert.rejects(mutation({type:'batch-archive',ids:[first.id,'missing']}),/Select active thoughts/);
  assert.equal((await readState()).cards.find(c=>c.id===first.id)?.status,'open');
  await mutation({type:'batch-archive',ids:[first.id,second.id]});
  const state=await readState();
  assert.equal(state.cards.find(c=>c.id===first.id)?.status,'archived');
  assert.equal(state.cards.find(c=>c.id===first.id)?.focus,false);
  assert.equal(state.cards.find(c=>c.id===second.id)?.status,'archived');
});
test('iMessage receiver scopes senders and deduplicates repeated webhooks',async()=>{process.env.IMESSAGE_TOKEN='test-token';process.env.IMESSAGE_CHAT_GUID='chat-1';process.env.IMESSAGE_ALLOWED_SENDERS='me@example.com';const {normalizeMessage,checkMessageAccess,receiveMessage}=await import('../lib/imessage');const m=normalizeMessage({guid:'message-1',text:'Idea: a message note',sender:'me@example.com',chatGuid:'chat-1'});assert.throws(()=>checkMessageAccess('wrong',m),/Invalid receiver token/);assert.throws(()=>checkMessageAccess('test-token',{...m,sender:'stranger@example.com'}),/outside/);checkMessageAccess('test-token',m);assert.equal((await receiveMessage(m)).duplicate,false);assert.equal((await receiveMessage(m)).duplicate,true);});
test('password sessions reject missing credentials and cross-origin writes',async()=>{const {NextRequest}=await import('next/server.js');const {authorize,sessionToken}=await import('../lib/auth');const saved=process.env.APP_PASSWORD;process.env.APP_PASSWORD='unit-test-password';try{assert.throws(()=>authorize(new NextRequest('http://localhost:3000/api/state',{headers:{host:'localhost:3000'}})),/Sign in/);const cookie='daybook_session='+sessionToken(Date.now()+60000);authorize(new NextRequest('http://localhost:3000/api/state',{headers:{host:'localhost:3000',cookie}}));assert.throws(()=>authorize(new NextRequest('http://localhost:3000/api/state',{method:'POST',headers:{host:'localhost:3000',cookie,origin:'https://untrusted.example'}})),/Invalid origin/);authorize(new NextRequest('http://localhost:3000/api/state',{method:'POST',headers:{host:'localhost:3000',cookie,origin:'http://localhost:3000'}}));}finally{if(saved===undefined)delete process.env.APP_PASSWORD;else process.env.APP_PASSWORD=saved;}});

test('PostgreSQL transactions roll back failed mutations and attachment lookups handle missing records',async()=>{
  const {transact,readState,readStoredFile}=await import('../lib/store');
  const before=await readState();
  await assert.rejects(transact(state=>{state.cards=[];throw new Error('abort transaction');}),/abort transaction/);
  assert.deepEqual(await readState(),before);
  assert.equal(await readStoredFile(crypto.randomUUID()),undefined);
});
