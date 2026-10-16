import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppFrame, RiAppProvider, installStyles } from '@ri/app-kit/ui';
import { PeopleApp } from './view/app.js';
import { peopleCss } from './view/styles.js';

installStyles(peopleCss);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RiAppProvider>
      <AppFrame>
        <PeopleApp />
      </AppFrame>
    </RiAppProvider>
  </StrictMode>,
);
