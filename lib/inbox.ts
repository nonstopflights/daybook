import type {State} from './types';
// Keep every thought in an active board column, including older unassigned notes.
export function ensureInbox(state:State):void {
  let inbox=state.tags.find(tag=>tag.name.toLowerCase()==='inbox');
  if(!inbox){let id='inbox';while(state.tags.some(tag=>tag.id===id))id='_'+id;inbox={id,name:'inbox',color:'#8793a6',aliases:[],archived:false};state.tags.unshift(inbox);}
  inbox.archived=false;
  state.boardTags=[inbox.id,...state.boardTags.filter(id=>id!==inbox.id)];
  const columns=new Set(state.boardTags.filter(id=>state.tags.some(tag=>tag.id===id&&!tag.archived)));
  for(const card of state.cards)if(!card.tags.some(id=>columns.has(id)))card.tags=[...new Set([...card.tags,inbox.id])];
}
