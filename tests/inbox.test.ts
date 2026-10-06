import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureInbox} from '../lib/inbox';
import {demoState} from '../lib/demo';
import {makeCard} from '../lib/types';
test('existing unassigned notes enter inbox while organized notes retain their columns',()=>{
  const state=demoState();const note=makeCard();state.cards.push(note);ensureInbox(state);
  assert.equal(state.boardTags[0],'inbox');assert.deepEqual(note.tags,['inbox']);
  assert.deepEqual(state.cards.find(card=>card.id==='garden')?.tags,['ideas']);
  ensureInbox(state);assert.equal(state.tags.filter(tag=>tag.name==='inbox').length,1);assert.deepEqual(note.tags,['inbox']);
});
test('reuses an existing inbox and routes notes from hidden or archived columns there',()=>{
  const state=demoState();state.tags.push({id:'my-inbox',name:'inbox',color:'#8793a6',aliases:[],archived:true});
  state.boardTags=state.boardTags.filter(id=>id!=='ideas');ensureInbox(state);
  assert.equal(state.boardTags[0],'my-inbox');assert.equal(state.tags.find(tag=>tag.id==='my-inbox')?.archived,false);
  assert.deepEqual(state.cards.find(card=>card.id==='garden')?.tags,['ideas','my-inbox']);
  const note=makeCard();state.cards.push(note);ensureInbox(state);assert.deepEqual(note.tags,['my-inbox']);
});
