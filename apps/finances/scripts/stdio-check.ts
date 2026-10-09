import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createClientKey,revokeClientKey} from '../src/lib/auth';
import * as q from '../src/lib/db/queries';
import {resetDb} from '../src/lib/db';
import {getAppRoot} from '../src/lib/config/paths';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root=fs.realpathSync(getAppRoot());
if(process.env.FINANCE_SYNTHETIC!=='1'||![fs.realpathSync('/tmp'),fs.realpathSync(os.tmpdir())].some(p=>root.startsWith(p+path.sep)))throw new Error('Stdio qualification requires a disposable synthetic folder');
const key=createClientKey({label:'Synthetic stdio qualification',accountIds:q.listFinanceAccounts(q.financeOwner).map(a=>a.id),operations:['read']});
const client=new Client({name:'stdio-test',version:'1'});
try{
 await client.connect(new StdioClientTransport({command:'pnpm',args:['--silent','mcp:stdio'],cwd:process.cwd(),env:{FINANCE_ROOT:root,FINANCE_MCP_TOKEN:key.token,PATH:process.env.PATH??'/usr/bin:/bin'},stderr:'pipe'}));
 const resource=await client.readResource({uri:'ui://personal-finance/renderer-v1.html'});if(resource.contents[0].mimeType!=='text/html;profile=mcp-app')throw new Error('Stdio renderer unavailable');
 const result=await client.callTool({name:'finance_status',arguments:{}});if(result.isError)throw new Error('Stdio status failed');
 revokeClientKey(key.id);const revoked=await client.callTool({name:'finance_status',arguments:{}});if(!revoked.isError)throw new Error('Stdio retained a revoked key');
 console.log(JSON.stringify({synthetic:true,stdio:true,revocation:true}));
}finally{await client.close();revokeClientKey(key.id);resetDb();}
