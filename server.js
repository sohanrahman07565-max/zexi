import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure Render Web Service can execute `node server.js` directly
const targetScript = path.join(__dirname, 'server.ts');
console.log('🚀 [Render Boot] Launching server via tsx loader...');

const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', targetScript],
  {
    stdio: 'inherit',
    env: process.env
  }
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
