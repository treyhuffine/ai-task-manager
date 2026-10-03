/** Source launcher for the same HTTP/WebSocket host used by the packaged service. */
import { DEFAULT_PORT, DEV_PORT } from '../src/lib/auth/port';
import { acquireServiceOwner } from '../src/lib/service/owner';
const args = process.argv.slice(2);
const dev = args[0] === 'dev';
if (dev) args.shift();
process.env.RI_DESKTOP_MODE = dev ? 'development' : 'production';
Object.assign(process.env, { NODE_ENV: dev ? 'development' : 'production' });
process.env.PORT ||= String(dev ? DEV_PORT : DEFAULT_PORT);
// The direct launch remains LAN reachable, like next start/dev. Supervised
// launches keep the service's loopback default behind their public gateway.
process.env.RI_HTTP_HOST ||= '0.0.0.0';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') process.env.PORT = args[++i];
  else if (args[i] === '--hostname' || args[i] === '-H') process.env.RI_HTTP_HOST = args[++i];
  else if (args[i] === '--turbo' || args[i] === '--turbopack') process.env.RI_NEXT_BUNDLER = 'turbopack';
  else if (args[i] === '--webpack') process.env.RI_NEXT_BUNDLER = 'webpack';
  else throw new Error(`Unsupported server argument: ${args[i]}`);
}
if (!/^\d+$/.test(process.env.PORT ?? '') || Number(process.env.PORT) < 1 || Number(process.env.PORT) > 65535) throw new Error('Invalid server port');
// pnpm dev's parent owns its lease. A direct production launcher owns its own.
if (!dev) process.once('exit', acquireServiceOwner());
void import('../src/service/http-server');
export {};
