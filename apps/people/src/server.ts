import { serveApp } from '@ri/app-kit/sdk';
import { definition, initialize, shutdown } from './actions.js';

serveApp(definition, { initialize, shutdown });
