'use client';

import { useEffect } from 'react';
import { QuickCaptureModal } from './quick-capture-modal';
import { setQuickCaptureOpen, useQuickCaptureOpen } from '@/lib/client/quick-capture';
import '@/lib/client/desktop';

/** One capture surface across dashboard and full-page documents. */
export function QuickCaptureHost() {
  const open = useQuickCaptureOpen();
  useEffect(() => window.riDesktop?.onQuickCapture(() => setQuickCaptureOpen(true)), []);
  return <QuickCaptureModal open={open} onOpenChange={setQuickCaptureOpen} />;
}
