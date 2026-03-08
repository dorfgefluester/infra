const { spawnSync } = require('node:child_process');
const path = require('node:path');

function resolveBiomeBin() {
  const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
  return path.join(process.cwd(), 'node_modules', '.bin', binName);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) {
    throw res.error;
  }
  return res.status ?? 0;
}

async function main() {
  const biome = resolveBiomeBin();
  const status = run(biome, [
    'check',
    'src',
    'scripts',
    'tests',
    '--files-ignore-unknown=true',
    '--formatter-enabled=false',
    '--organize-imports-enabled=false',
    '--diagnostic-level=error',
    '--reporter=summary'
  ]);

  process.exit(status);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(2);
});

