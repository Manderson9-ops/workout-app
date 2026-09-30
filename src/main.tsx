import { render } from 'preact';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/update';
import { startDiag } from './ui/diag';

registerServiceWorker();
startDiag();
render(<App />, document.getElementById('app')!);
