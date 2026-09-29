import { render } from 'preact';
import { App } from './ui/App';
import { registerServiceWorker } from './ui/update';

registerServiceWorker();
render(<App />, document.getElementById('app')!);
