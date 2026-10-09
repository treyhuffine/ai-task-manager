import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {createFinanceMcpServer} from '../src/lib/mcp/server';
import {authenticateToken} from '../src/lib/auth';
const token=process.env.FINANCE_MCP_TOKEN;
if(!token)throw new Error('Set FINANCE_MCP_TOKEN to a scoped finance client key');
const server=createFinanceMcpServer(()=>{const p=authenticateToken(token);if(!p)throw new Error('Finance key expired or revoked');return p;});
await server.connect(new StdioServerTransport());
