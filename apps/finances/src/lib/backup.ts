import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {getRawDb,resetDb} from './db';
import {getAppRoot,getConfigDir} from './config/paths';
export async function backupFinance(destination:string){
 const target=path.resolve(destination),root=getAppRoot();
 if(target===root||target.startsWith(root+path.sep))throw new Error('Choose a backup destination outside the live finance folder');
 fs.mkdirSync(target,{mode:0o700});
 try{
  await getRawDb().backup(path.join(target,'finance.db'));
  const db=new Database(path.join(target,'finance.db'),{readonly:true});
  try{for(const row of db.prepare('SELECT file_name FROM finance_attachment_refs').all() as {file_name:string}[]){
   if(path.basename(row.file_name)!==row.file_name)throw new Error('Invalid attachment path');
   fs.mkdirSync(path.join(target,'attachments'),{recursive:true,mode:0o700});
   fs.copyFileSync(path.join(root,'attachments',row.file_name),path.join(target,'attachments',row.file_name));
  }}finally{db.close();}
  fs.cpSync(getConfigDir(),path.join(target,'config'),{recursive:true});
  fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),contains:'Private finance records and sealed configuration. Retain securely. Restores require review.'}),{mode:0o600});
  return target;
 }catch(e){fs.rmSync(target,{recursive:true,force:true});throw e;}
}
export function restoreFinance(source:string){
 const root=getAppRoot(),from=path.resolve(source);
 if(fs.existsSync(root)&&fs.readdirSync(root).length)throw new Error('Restore into an empty data folder while the server is stopped');
 const manifest=JSON.parse(fs.readFileSync(path.join(from,'manifest.json'),'utf8'));if(manifest.version!==1)throw new Error('Unsupported backup');
 const db=new Database(path.join(from,'finance.db'),{readonly:true});try{if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Backup integrity check failed');}finally{db.close();}
 resetDb();fs.mkdirSync(root,{recursive:true,mode:0o700});fs.mkdirSync(path.join(root,'config'),{mode:0o700});
 fs.writeFileSync(path.join(root,'config','finance-review-required'),'Restored data requires an explicit owner review.',{mode:0o600});
 fs.copyFileSync(path.join(from,'finance.db'),path.join(root,'finance.db'));
 for(const directory of ['attachments','config'])if(fs.existsSync(path.join(from,directory)))fs.cpSync(path.join(from,directory),path.join(root,directory),{recursive:true});
 fs.writeFileSync(path.join(root,'config','finance-review-required'),'Restored data requires an explicit owner review.',{mode:0o600});
 return root;
}
