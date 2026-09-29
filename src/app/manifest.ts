import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/constants/app';

/** Identity is relative to the current origin. Never put pairing credentials or
 * a machine-specific public URL into an installable manifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Your tasks, notes, and agents, connected to your Ri computer.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#181a18',
    theme_color: '#181a18',
    icons: [
      { src: '/brand/ri-web-app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/ri-web-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/ri-web-app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
