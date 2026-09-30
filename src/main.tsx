import { render } from 'preact';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/update';
import { startDiag } from './ui/diag';
import { retryPendingOnStart } from './ui/autoSend';

registerServiceWorker();
startDiag();
retryPendingOnStart();
render(<App />, document.getElementById('app')!);
