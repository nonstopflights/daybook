import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';

test('AI settings work when cached database initialization predates their table',async()=>{
  const globals=globalThis as typeof globalThis & {daybookPgPool?:Pool;daybookPgReady?:Promise<void>};
  const previousPool=globals.daybookPgPool;
  const previousReady=globals.daybookPgReady;
  const previousEnv={key:process.env.OPENAI_API_KEY,model:process.env.OPENAI_SUMMARY_MODEL};
  let tableExists=false;
  let row:{api_key:string|null;model:string|null}|undefined;
  globals.daybookPgReady=Promise.resolve();
  globals.daybookPgPool={
    async query(sql:string,values?:[string|null,string]){
      if(sql.startsWith('CREATE TABLE IF NOT EXISTS daybook.ai_settings')){
        tableExists=true;
        return {rows:[]};
      }
      if(!tableExists)throw Object.assign(new Error('relation "daybook.ai_settings" does not exist'),{code:'42P01'});
      if(sql.startsWith('SELECT api_key,model'))return {rows:row?[row]:[]};
      if(sql.startsWith('INSERT INTO daybook.ai_settings')){
        row={api_key:values![0]??row?.api_key??null,model:values![1]};
        return {rows:[]};
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as Pool;
  process.env.OPENAI_API_KEY='test-environment-key';
  process.env.OPENAI_SUMMARY_MODEL='test-environment-model';
  try{
    const {readAiSettings,writeAiSettings}=await import('../lib/ai-settings');
    assert.deepEqual(await readAiSettings(),{key:'test-environment-key',model:'test-environment-model',source:'environment'});
    // Saving must also handle an older database without a preceding settings read.
    tableExists=false;
    assert.deepEqual(await writeAiSettings({key:'test-saved-key',model:'test-saved-model'}),{key:'test-saved-key',model:'test-saved-model',source:'settings'});
    assert.deepEqual(await writeAiSettings({model:'test-new-model'}),{key:'test-saved-key',model:'test-new-model',source:'settings'});
    assert.deepEqual(await writeAiSettings({key:'',model:'test-new-model'}),{key:'',model:'test-new-model',source:'settings'});
  }finally{
    globals.daybookPgPool=previousPool;
    globals.daybookPgReady=previousReady;
    for(const [name,value] of [['OPENAI_API_KEY',previousEnv.key],['OPENAI_SUMMARY_MODEL',previousEnv.model]]){
      if(value===undefined)delete process.env[name!];else process.env[name!]=value;
    }
  }
});
