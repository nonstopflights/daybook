import {ensureInbox} from './inbox';
import {makeCard,localDate,defaultViewPreferences,type State,type Card} from './types';
import {cardSchema,tagSchema,collectionSchema,stateSchema,preferencesSchema} from './schema';
import {ensurePostgres,postgresPool} from './postgres';
function normalizeState(body:string|State):State {const state=(typeof body==='string'?JSON.parse(body):body) as State;const oldColors:Record<string,string>={'#4f4f4f':'#a23b72','#717171':'#2c7a7b','#949494':'#9a5b13','#606060':'#6458a6','#828282':'#327346','#a3a3a3':'#b34f45'};const normalized={...state,tags:state.tags.map(tag=>({...tag,color:oldColors[tag.color.toLowerCase()]||tag.color})),preferences:{...defaultViewPreferences,...state.preferences}};ensureInbox(normalized);return normalized;}
export async function readState():Promise<State> {
  await ensurePostgres();
  const result=await postgresPool().query<{body:State}>('SELECT body FROM daybook.state WHERE id=1');
  return normalizeState(result.rows[0].body);
}
export type Transaction={findMessage:(guid:string)=>Promise<string|null>;putMessage:(guid:string,cardId:string)=>Promise<void>};
export async function transact<T>(fn:(state:State,tx:Transaction)=>T|Promise<T>):Promise<T> {
  await ensurePostgres();const client=await postgresPool().connect();
  try {
    await client.query('BEGIN');
    const row=await client.query<{body:State}>('SELECT body FROM daybook.state WHERE id=1 FOR UPDATE');
    const state=normalizeState(row.rows[0].body);
    const tx:Transaction={findMessage:async guid=>(await client.query<{card_id:string}>('SELECT card_id FROM daybook.messages WHERE guid=$1',[guid])).rows[0]?.card_id||null,putMessage:async(guid,cardId)=>{await client.query('INSERT INTO daybook.messages(guid,card_id) VALUES($1,$2)',[guid,cardId]);}};
    const result=await fn(state,tx);ensureInbox(state);state.version++;
    await client.query('UPDATE daybook.state SET body=$1::jsonb WHERE id=1',[JSON.stringify(state)]);
    await client.query('COMMIT');return result;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export type FileRecord={id:string;name:string;type:string;size:number};
export async function saveFile(record:FileRecord,content:Buffer):Promise<void>{
  await ensurePostgres();
  await postgresPool().query('INSERT INTO daybook.files(id,name,type,size,content) VALUES($1,$2,$3,$4,$5)',[record.id,record.name,record.type,record.size,content]);
}
export async function findFile(id:string):Promise<FileRecord|undefined>{
  await ensurePostgres();
  return (await postgresPool().query<FileRecord>('SELECT id,name,type,size::integer AS size FROM daybook.files WHERE id=$1',[id])).rows[0];
}
export async function readStoredFile(id:string):Promise<{file:FileRecord;data:Buffer}|undefined>{
  await ensurePostgres();
  const row=(await postgresPool().query<FileRecord & {content:Buffer|null}>('SELECT id,name,type,size::integer AS size,content FROM daybook.files WHERE id=$1',[id])).rows[0];
  if(!row)return undefined;
  if(row.content===null)throw new Error('Attachment content is missing; run npm run migrate:attachments before serving legacy attachments.');
  const {content,...file}=row;
  return {file,data:content};
}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
export function mutation(action:Record<string,unknown>):Promise<State> {return transact(s=>{const stamp=new Date().toISOString();const find=(id:unknown)=>{const c=s.cards.find(c=>c.id===id);if(!c)throw new HttpError(404,'Thought not found');return c;};
switch(action.type){
case 'preferences':{s.preferences=preferencesSchema.parse({...s.preferences,...preferencesSchema.partial().parse(action.patch)});break;}
case 'create':{const card=cardSchema.parse(makeCard(action.card as Partial<Card>));if(s.cards.some(c=>c.id===card.id))throw new HttpError(409,'Thought already exists');s.cards.unshift(card);break;}
case 'update':{const old=find(action.id);if(action.expectedUpdatedAt&&old.updatedAt!==action.expectedUpdatedAt)throw new HttpError(409,'This thought changed elsewhere. Close and reopen it before editing.');const patch=action.patch as Partial<Card>;const card=cardSchema.parse({...old,...patch,id:old.id,createdAt:old.createdAt,updatedAt:new Date(Math.max(Date.now(),Date.parse(old.updatedAt)+1)).toISOString()});if(card.status==='done'&&old.status!=='done'&&card.recurrence!=='none'){const base=new Date((card.plannedDate||localDate())+'T12:00:00');if(card.recurrence==='daily')base.setDate(base.getDate()+1);if(card.recurrence==='weekly')base.setDate(base.getDate()+7);if(card.recurrence==='monthly'){const day=base.getDate();base.setDate(1);base.setMonth(base.getMonth()+1);const last=new Date(base.getFullYear(),base.getMonth()+1,0).getDate();base.setDate(Math.min(day,last));}const plannedDate=localDate(base);s.cards.unshift(makeCard({...card,id:crypto.randomUUID(),status:'open',focus:false,plannedDate,dueDate:null,reminder:null,journalDate:plannedDate,history:[],createdAt:stamp,updatedAt:stamp}));}s.cards=s.cards.map(c=>c.id===card.id?card:c);break;}
case 'batch-archive':{const ids=action.ids;if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new HttpError(400,'Invalid selection');const selected=new Set(ids as string[]);if(selected.size===0||[...selected].some(id=>!s.cards.some(c=>c.id===id&&c.status!=='archived')))throw new HttpError(400,'Select active thoughts to archive');s.cards.forEach(c=>{if(selected.has(c.id)){c.status='archived';c.focus=false;c.updatedAt=stamp;}});break;}
case 'migrate':{const c=find(action.id);const to=action.to as string;cardSchema.shape.plannedDate.parse(to);if(!to)throw new HttpError(400,'Choose a date');c.history.push({at:stamp,action:'migrated',from:c.plannedDate||c.journalDate,to});c.plannedDate=to;c.journalDate=to;c.updatedAt=stamp;c.focus=false;c.deferred=false;break;}
case 'tag-save':{const tag=tagSchema.parse(action.tag);if(s.tags.some(t=>t.id!==tag.id&&t.name.toLowerCase()===tag.name.toLowerCase()))throw new HttpError(409,'That tag already exists');const names=[tag.name,...tag.aliases].map(x=>x.toLowerCase());if(new Set(names).size!==names.length||s.tags.some(t=>t.id!==tag.id&&[t.name,...t.aliases].some(n=>names.includes(n.toLowerCase()))))throw new HttpError(409,'Tag names and aliases must be unique');const existing=s.tags.find(t=>t.id===tag.id);if(existing)Object.assign(existing,tag);else {s.tags.push(tag);s.boardTags.push(tag.id);}break;}
case 'tag-delete':{const id=action.id as string;s.tags=s.tags.filter(t=>t.id!==id);s.boardTags=s.boardTags.filter(t=>t!==id);s.cards.forEach(c=>{if(c.tags.includes(id)){c.tags=c.tags.filter(t=>t!==id);c.updatedAt=stamp;}});break;}
case 'tag-merge':{const from=action.from as string,to=action.to as string;if(from===to)throw new HttpError(400,'Choose a different destination');const a=s.tags.find(t=>t.id===from),b=s.tags.find(t=>t.id===to);if(!a||!b)throw new HttpError(404,'Tag not found');b.aliases=[...new Set([...b.aliases,a.name,...a.aliases])].filter(n=>n.toLowerCase()!==b.name.toLowerCase());s.cards.forEach(c=>{if(c.tags.includes(from)){c.tags=[...new Set(c.tags.map(t=>t===from?to:t))];c.updatedAt=stamp;}});s.tags=s.tags.filter(t=>t.id!==from);s.boardTags=[...new Set(s.boardTags.map(t=>t===from?to:t))];break;}
case 'board-tags':{const ids=action.ids as string[];if(!Array.isArray(ids)||ids.some(id=>!s.tags.some(t=>t.id===id)))throw new HttpError(400,'Invalid columns');s.boardTags=[...new Set(ids)];break;}
case 'collection-save':{const col=collectionSchema.parse(action.collection);if(s.collections.some(c=>c.id!==col.id&&c.name.toLowerCase()===col.name.toLowerCase()))throw new HttpError(409,'Collection already exists');const existing=s.collections.find(c=>c.id===col.id);if(existing)Object.assign(existing,col);else s.collections.push(col);break;}
case 'collection-delete':{const id=action.id as string;s.collections=s.collections.filter(c=>c.id!==id);s.cards.forEach(c=>{if(c.collectionId===id){c.collectionId=null;c.updatedAt=stamp;}});break;}
case 'reflection':{const date=action.date as string;cardSchema.shape.journalDate.parse(date);if(typeof action.text!=='string'||action.text.length>20000)throw new HttpError(400,'Invalid reflection');s.reflections[date]=action.text;break;}
case 'import':{const imported=stateSchema.parse(action.state);const ids=imported.cards.map(c=>c.id);if(new Set(ids).size!==ids.length||new Set(imported.tags.map(t=>t.id)).size!==imported.tags.length)throw new HttpError(400,'Duplicate record IDs');Object.assign(s,imported);break;}
default:throw new HttpError(400,'Unknown action');}
const tagIds=new Set(s.tags.map(t=>t.id)),colIds=new Set(s.collections.map(c=>c.id));s.cards.forEach(c=>{c.tags=[...new Set(c.tags.filter(t=>tagIds.has(t)))];if(c.collectionId&&!colIds.has(c.collectionId))c.collectionId=null;});return s;});}
