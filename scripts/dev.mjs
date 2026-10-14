import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const server = await createServer();
let child;
let closing;
function cleanup() {
  closing ??= (async () => {
    child?.kill();
    await server.close();
  })();
  return closing;
}
const stop = () => {
  void cleanup();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await server.listen();
  const env = { ...process.env, GALAXY_DEV_URL: server.resolvedUrls.local[0] };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(require('electron'), ['.'], { env, stdio: 'inherit', windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
  });
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await cleanup();
}
