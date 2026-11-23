import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const configPath = path.resolve('capacitor.config.json');
const originalConfig = await fs.readFile(configPath, 'utf8');

if (process.platform === 'win32') {
  const windowsConfig = JSON.parse(originalConfig);
  const packageOptions = windowsConfig.experimental?.ios?.spm?.packageOptions;
  if (packageOptions?.['@capacitor-firebase/messaging']) packageOptions['@capacitor-firebase/messaging'].symlink = false;
  await fs.writeFile(configPath, JSON.stringify(windowsConfig, null, 2), 'utf8');
}

let result;
try {
  result = spawnSync('pnpm', ['exec', 'cap', 'sync'], { stdio: 'inherit', shell: process.platform === 'win32' });
} finally {
  if (process.platform === 'win32') await fs.writeFile(configPath, originalConfig, 'utf8');
}

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await import('./patch-ios-spm.mjs');
