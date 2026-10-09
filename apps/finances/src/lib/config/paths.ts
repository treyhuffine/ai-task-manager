import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
export function getAppRoot(){return path.resolve(process.env.FINANCE_ROOT??path.join(os.homedir(),'.personal-finance'));}
export function getDbPath(){return path.join(getAppRoot(),'finance.db');}
export function getConfigDir(){const dir=path.join(getAppRoot(),'config');fs.mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
export function getAttachmentsDir(){return path.join(getAppRoot(),'attachments');}
export function ensureAttachmentsDir(){const dir=getAttachmentsDir();fs.mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
export function getDevAppRoot(){return path.join(os.homedir(),'.personal-finance-dev');}
export function getTestAppRoot(){return path.join(os.tmpdir(),'personal-finance-test');}
export function publicBaseUrl(){return process.env.FINANCE_PUBLIC_URL??null;}
