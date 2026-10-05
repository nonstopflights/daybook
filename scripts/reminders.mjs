// Optional native macOS notifications. Run in your signed-in user session.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import pg from 'pg';
if(process.platform!=='darwin')throw new Error('Native reminders require macOS.');
const run=promisify(execFile);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL||undefined,max:2,connectionTimeoutMillis:5000});
async function tick(){const row=(await pool.query('SELECT body FROM daybook.state WHERE id=1')).rows[0];if(!row)return;const state=typeof row.body==='string'?JSON.parse(row.body):row.body;for(const card of state.cards){if(card.status!=='open'||!card.reminder||new Date(card.reminder).getTime()>Date.now())continue;const key=card.id+':'+card.reminder;const delivered=(await pool.query('SELECT key FROM daybook.delivered_reminders WHERE key=$1',[key])).rows[0];if(delivered)continue;try{await run('/usr/bin/osascript',['-e','on run argv\n display notification (item 1 of argv) with title "Daybook" subtitle (item 2 of argv)\nend run',card.title,card.nextAction||'A little nudge for your day.']);await pool.query('INSERT INTO daybook.delivered_reminders(key) VALUES($1) ON CONFLICT DO NOTHING',[key]);}catch{console.error('Could not deliver a reminder. It will retry.');}}}
console.log('Daybook reminders active. Allow notifications from Script Editor/osascript if macOS asks.');
await tick();setInterval(()=>void tick().catch(error=>console.error('Reminder check failed:',error)),30000);
