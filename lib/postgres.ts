import {Pool} from 'pg';
import {demoState} from './demo';


const globals=globalThis as typeof globalThis & {daybookPgPool?:Pool;daybookPgReady?:Promise<void>};

export function postgresPool():Pool {
  if(!globals.daybookPgPool){
    globals.daybookPgPool=new Pool({connectionString:process.env.DATABASE_URL||undefined,max:4,connectionTimeoutMillis:5000});
    globals.daybookPgPool.on('error',error=>console.error('Daybook PostgreSQL idle connection error:',error));
  }
  return globals.daybookPgPool;
}

export async function ensurePostgres():Promise<void> {
  if(!globals.daybookPgReady){
    globals.daybookPgReady=(async()=>{
      const client=await postgresPool().connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE SCHEMA IF NOT EXISTS daybook');
        await client.query('CREATE TABLE IF NOT EXISTS daybook.state (id integer PRIMARY KEY CHECK (id = 1), body jsonb NOT NULL)');
        await client.query('CREATE TABLE IF NOT EXISTS daybook.messages (guid text PRIMARY KEY, card_id text NOT NULL)');
        await client.query('CREATE TABLE IF NOT EXISTS daybook.files (id text PRIMARY KEY, name text NOT NULL, type text NOT NULL, size integer NOT NULL, content bytea)');
        await client.query('ALTER TABLE daybook.files ADD COLUMN IF NOT EXISTS content bytea');
        await client.query('CREATE TABLE IF NOT EXISTS daybook.ai_settings (id integer PRIMARY KEY CHECK (id = 1), api_key text, model text)');
        await client.query('CREATE TABLE IF NOT EXISTS daybook.delivered_reminders (key text PRIMARY KEY)');
        await client.query('INSERT INTO daybook.state (id,body) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING',[JSON.stringify(demoState())]);
        await client.query('COMMIT');
      } catch(error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    })().catch(error=>{globals.daybookPgReady=undefined;throw error;});
  }
  return globals.daybookPgReady;
}
