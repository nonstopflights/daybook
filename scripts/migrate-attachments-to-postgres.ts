import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {ensurePostgres,postgresPool} from '../lib/postgres';

async function main(){
  await ensurePostgres();
  const client=await postgresPool().connect();
  const source=process.env.DAYBOOK_LEGACY_ATTACHMENTS_DIR||path.resolve('data','attachments');
  try{
    const files=(await client.query<{id:string;size:number}>('SELECT id,size FROM daybook.files WHERE content IS NULL')).rows;
    for(const file of files){
      if(!/^[a-f0-9-]{36}$/.test(file.id))throw new Error('Invalid attachment ID in PostgreSQL');
      if((await stat(path.join(source,file.id))).size!==file.size)throw new Error(`Attachment size mismatch: ${file.id}`);
    }
    await client.query('BEGIN');
    try{for(const file of files)await client.query('UPDATE daybook.files SET content=$1 WHERE id=$2 AND content IS NULL',[await readFile(path.join(source,file.id)),file.id]);await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}
    console.log(`Migrated ${files.length} legacy attachments into PostgreSQL.`);
  }finally{client.release();await postgresPool().end();}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Attachment migration failed');process.exitCode=1;});
