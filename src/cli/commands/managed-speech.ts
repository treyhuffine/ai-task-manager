import https from 'node:https';
import type { Command } from 'commander';
import { serviceRequest, type ServiceSession } from '@/lib/service/client';
import type { ManagedSpeechStatus } from '@/lib/stt/managed/manager';

export async function managedSpeechRequest(command?: object): Promise<ManagedSpeechStatus> {
  const session = await serviceRequest<ServiceSession>('/session');
  const origin = new URL(session.origin);
  if (origin.protocol !== 'https:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password) throw new Error('The local service returned an invalid speech management origin');
  return new Promise((resolve, reject) => {
    const body = command ? JSON.stringify(command) : undefined;
    const request = https.request(new URL('/api/service/speech', origin), {
      method: body ? 'POST' : 'GET',
      // Trust only the leaf supplied over the private, identity-checked socket.
      // No OS trust installation and no certificate-verification bypass.
      ca: session.certificate, allowPartialTrustChain: true, agent: false,
      headers: { Authorization: `Bearer ${session.token}`, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) request.destroy(new Error('Invalid speech management response size'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString());
          if (response.statusCode !== 200) throw new Error(value.error || `Speech management returned ${response.statusCode}`);
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Speech management request timed out')));
    request.on('error', reject); request.end(body);
  });
}

export function registerManagedSpeechCommand(voice: Command) {
  const managed = voice.command('managed').description('Manage the optional packaged local speech model through the running Ri service');
  const actions: Array<[string, string, object | undefined]> = [
    ['status', 'Show model installation and helper readiness', undefined],
    ['install', 'Download the pinned model or verify and repair its files', { action: 'install' }],
    ['pause', 'Pause the download and retain partial files for resume', { action: 'cancel' }],
    ['remove', 'Remove the downloaded model and partial files', { action: 'uninstall' }],
    ['enable', 'Use the installed managed Parakeet model', { action: 'configure', enabled: true }],
    ['disable', 'Use the configured external service instead', { action: 'configure', enabled: false }],
    ['allow-cloud', 'Allow automatic provider selection to send audio to Groq when local speech is unavailable', { action: 'configure', cloudFallback: true }],
    ['local-only', 'Disable automatic cloud fallback', { action: 'configure', cloudFallback: false }],
  ];
  for (const [name, description, body] of actions) {
    managed.command(name, name === 'status' ? { isDefault: true } : {}).description(description).action(async () => {
      try { console.log(JSON.stringify(await managedSpeechRequest(body), null, 2)); }
      catch (error) { console.error(error instanceof Error ? error.message : 'Speech management failed'); process.exitCode = 1; }
    });
  }
}
