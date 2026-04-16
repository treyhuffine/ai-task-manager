import pc from 'picocolors';
import { ensureLocalToken } from '@/lib/auth/bootstrap';

export function pairCommand() {
  const info = ensureLocalToken();
  if (info.created) {
    console.log(pc.green('Created new host token.'));
  }
  console.log(info.pairingUrl);
}
