import {backupFinance,restoreFinance} from '../src/lib/backup';
import {resetDb} from '../src/lib/db';
const [command,destination]=process.argv.slice(2);
if(!destination||!['create','restore'].includes(command))throw new Error('Usage: pnpm backup create <new-backup-folder> | restore <backup-folder>. Stop the server before restoring into an empty FINANCE_ROOT.');
try{console.log(command==='create'?await backupFinance(destination):restoreFinance(destination));}finally{resetDb();}
