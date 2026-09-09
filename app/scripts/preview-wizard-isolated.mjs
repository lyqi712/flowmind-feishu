import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createServer } from 'vite';

const dataDir = mkdtempSync(join(tmpdir(), 'flowmind-wizard-preview-'));
const app = createApp({ stateFile: join(dataDir, 'state.json'), env: {}, ocrService: false });
await app.locals.ready;
const api = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const ui = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 5186, strictPort: true, proxy: { '/api': `http://127.0.0.1:${api.address().port}` } } });
await ui.listen();
console.log(`Isolated wizard preview data: ${dataDir}`);
ui.printUrls();
