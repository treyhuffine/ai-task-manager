import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createFinanceMcpServer} from '../src/lib/mcp/server';
import {authenticateToken} from '../src/lib/auth';
const token=process.env.FINANCE_MCP_TOKEN;
if(!token)throw new Error('Set FINANCE_MCP_TOKEN to a scoped finance client key');
// Serves MCP 2026-07-28 and 2025-era clients, one server per connection.
serveStdio(()=>createFinanceMcpServer(()=>{const p=authenticateToken(token);if(!p)throw new Error('Finance key expired or revoked');return p;}));
