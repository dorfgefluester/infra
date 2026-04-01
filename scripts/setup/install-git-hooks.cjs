const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
}

function main() {
  const root = path.resolve(__dirname, '..', '..');
  const hooksDir = path.join(root, '.githooks');
  const prePush = path.join(hooksDir, 'pre-push');

  if (!fs.existsSync(prePush)) {
    throw new Error(`Missing hook script: ${prePush}`);
  }

  fs.chmodSync(prePush, 0o755);
  run('git', ['config', 'core.hooksPath', '.githooks'], root);
  console.log('Installed repo-managed git hooks via core.hooksPath=.githooks');
}

if (require.main === module) {
  main();
}
