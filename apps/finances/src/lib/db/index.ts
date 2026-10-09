import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {drizzle,type BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import {getAppRoot,getDbPath} from '@/lib/config/paths';
import {processState} from '@/lib/process-state';
const state=processState<{path:string|null;raw:Database.Database|null;db:BetterSQLite3Database<typeof schema>|null}>('database',()=>({path:null,raw:null,db:null}));
export function initializeDatabase(){
 const file=getDbPath();
 if(state.db&&state.path===file)return state.db;
 resetDb();fs.mkdirSync(getAppRoot(),{recursive:true,mode:0o700});
 const raw=new Database(file);fs.chmodSync(file,0o600);raw.pragma('journal_mode = WAL');raw.pragma('busy_timeout = 5000');
 raw.exec("CREATE TABLE IF NOT EXISTS finance_migrations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), digest TEXT NOT NULL)");
 const dir=path.resolve(process.cwd(),'drizzle');
 try{
  for(const name of fs.readdirSync(dir).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort()){
   const sql=fs.readFileSync(path.join(dir,name),'utf8'),digest=createHash('sha256').update(sql).digest('hex');
   const old=raw.prepare('SELECT digest FROM finance_migrations WHERE id=?').get(name) as {digest:string}|undefined;
   if(old){if(old.digest!==digest)throw new Error('An applied finance migration changed: '+name);continue;}
   raw.pragma('foreign_keys = OFF');
   raw.transaction(()=>{raw.exec(sql);if((raw.pragma('foreign_key_check') as unknown[]).length)throw new Error('Finance migration broke a foreign key');raw.prepare('INSERT INTO finance_migrations (id,digest) VALUES (?,?)').run(name,digest);})();
  }
  raw.pragma('foreign_keys = ON');state.raw=raw;state.path=file;state.db=drizzle(raw,{schema,casing:'snake_case'});return state.db;
 }catch(e){raw.close();throw e;}
}
export function getDb(){return initializeDatabase();}
export function getRawDb(){initializeDatabase();return state.raw!;}
export function resetDb(){state.raw?.close();state.path=null;state.raw=null;state.db=null;}
