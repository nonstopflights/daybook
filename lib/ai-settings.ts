import {ensurePostgres,postgresPool} from './postgres';
type StoredAiSettings={api_key:string|null;model:string|null};

export type AiSettings={key:string;model:string;source:'settings'|'environment'|'none'};
const defaultModel='gpt-5.4-nano';

async function ensureAiSettingsTable(){
  await ensurePostgres();
  // Database initialization may be cached from before this table was introduced.
  await postgresPool().query('CREATE TABLE IF NOT EXISTS daybook.ai_settings (id integer PRIMARY KEY CHECK (id = 1), api_key text, model text)');
}

export async function readAiSettings():Promise<AiSettings>{
  await ensureAiSettingsTable();
  const row=(await postgresPool().query<StoredAiSettings>('SELECT api_key,model FROM daybook.ai_settings WHERE id=1')).rows[0];
  const key=row?.api_key??process.env.OPENAI_API_KEY??'';
  return {key,model:row?.model||process.env.OPENAI_SUMMARY_MODEL||defaultModel,source:row?.api_key!==null&&row?.api_key!==undefined?'settings':process.env.OPENAI_API_KEY?'environment':'none'};
}
export async function writeAiSettings(patch:{key?:string;model:string}):Promise<AiSettings>{
  await ensureAiSettingsTable();
  await postgresPool().query('INSERT INTO daybook.ai_settings(id,api_key,model) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET api_key=COALESCE(EXCLUDED.api_key,daybook.ai_settings.api_key),model=EXCLUDED.model',[patch.key??null,patch.model]);
  return readAiSettings();
}
