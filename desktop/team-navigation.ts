/** Team viewers get history controls only, with no exposed API, IPC or personal bridge. */
import { installHistoryNavigation } from '../src/lib/client/history-actions';
installHistoryNavigation(process.platform);
