#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function run(cmd, args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\nStep failed: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

run('git', ['pull', '--ff-only'], 'git pull');
run('npm', ['install'], 'npm install');
run('npm', ['run', 'build:all'], 'npm run build:all');

console.log('\nUpdate complete. Plugin reinstalled to Roblox Plugins folder if it exists.');
console.log('Restart Roblox Studio to load the new plugin build.');
