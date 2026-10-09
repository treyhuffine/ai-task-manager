import {ownerToken,createClientKey,listClientKeys,revokeClientKey} from '../src/lib/auth';
import {financeOwner,listFinanceAccounts} from '../src/lib/db/finance-queries';
const command=process.argv[2];
if(command==='owner')console.log(ownerToken());
else if(command==='list')console.log(JSON.stringify(listClientKeys()));
else if(command==='revoke'&&process.argv[3]){revokeClientKey(process.argv[3]);console.log('Client revoked');}
else if(command==='create'){
 const label=process.argv[3]??'MCP client',operations=(process.argv[4]??'read').split(',');
 if(operations.some(o=>!['read','write','sync','evidence'].includes(o)))throw new Error('Unknown permission');
 const requested=process.argv[5]?.split(','),all=listFinanceAccounts(financeOwner).filter(a=>a.access!=='revoked').map(a=>a.id),accountIds=requested??all;
 const key=createClientKey({label,accountIds,operations:operations as ('read'|'write'|'sync'|'evidence')[]});console.log(JSON.stringify(key));
}else throw new Error('Usage: pnpm keys owner | list | create <label> <read,evidence,write> [accountIds] | revoke <id>');
