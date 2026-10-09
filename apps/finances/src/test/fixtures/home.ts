import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {resetDb,initializeDatabase} from '@/lib/db';
export type TestHome={root:string;configDir:string;cleanup:()=>Promise<void>};
export async function createTestHome(input:{prefix?:string}={}):Promise<TestHome>{
 const prior=process.env.FINANCE_ROOT,root=fs.mkdtempSync(path.join(os.tmpdir(),input.prefix??'finance-test-'));
 resetDb();process.env.FINANCE_ROOT=root;initializeDatabase();const configDir=path.join(root,'config');fs.mkdirSync(configDir,{recursive:true});
 return {root,configDir,cleanup:async()=>{resetDb();if(prior===undefined)delete process.env.FINANCE_ROOT;else process.env.FINANCE_ROOT=prior;fs.rmSync(root,{recursive:true,force:true});}};
}
