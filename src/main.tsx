import { render } from 'preact';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/update';
import { startDiag } from './ui/diag';
import { retryPendingOnStart } from './ui/autoSend';
import { startSync } from './ui/sync';
import { applyView } from './ui/view';

registerServiceWorker();
startDiag();
retryPendingOnStart();
startSync();
applyView();
render(<App />, document.getElementById('app')!);
