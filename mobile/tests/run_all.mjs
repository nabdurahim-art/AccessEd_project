// Runs every tests/test_*.mjs in its own process and prints a summary.
// Usage: npm test   (needs Node 22.13 or newer)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dir);
const register = pathToFileURL(path.join(dir, 'register.mjs')).href;
const files = readdirSync(dir).filter((f) => /^test_.*\.mjs$/.test(f)).sort();

let total = 0;
const failed = [];
for (const file of files) {
  const run = spawnSync(process.execPath, ['--no-warnings', '--import', register, path.join(dir, file)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
  });
  const output = (run.stdout || '') + (run.stderr || '');
  const checks = (output.match(/^ok /gm) || []).length;
  total += checks;
  const passed = run.status === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${file}  (${checks} checks)`);
  if (!passed) {
    failed.push(file);
    console.log(output.split('\n').slice(-25).join('\n'));
  }
}

console.log(`\n${total} checks in ${files.length} files. ${failed.length === 0 ? 'ALL PASSED' : 'FAILED: ' + failed.join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
