import type { Metadata } from 'next';
import { ChatUiGallery } from '@/components/chat-ui/gallery/gallery';

export const metadata: Metadata = { title: 'Chat UI gallery · Ri' };
export default function GalleryPage() { return <ChatUiGallery />; }
