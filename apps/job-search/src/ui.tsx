/** @jsxRuntime automatic */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installStyles, RiAppProvider } from '@ri/app-kit/ui';
import { JobSearchApp } from './view/app.js';
import { JOB_SEARCH_CSS } from './view/styles.js';

installStyles(JOB_SEARCH_CSS);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RiAppProvider>
      <JobSearchApp />
    </RiAppProvider>
  </StrictMode>,
);
