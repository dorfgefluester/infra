const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function resolveBiomeBin() {
  const binName = process.platform === 'win32' ? 'biome.cmd' : 'biome';
  return path.join(process.cwd(), 'node_modules', '.bin', binName);
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (res.error) {
    throw res.error;
  }
  return res.status ?? 0;
}

function getBiomeMajorVersion(biome) {
  const res = spawnSync(biome, ['--version'], {
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (res.error) {
    throw res.error;
  }

  const match = String(res.stdout || '').match(/(\d+)\./);
  return match ? Number(match[1]) : 0;
}

function collectLintTargets(baseDir, collected = []) {
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const resolvedPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      collectLintTargets(resolvedPath, collected);
      continue;
    }

    if (/\.(c?js)$/.test(entry.name)) {
      collected.push(resolvedPath);
    }
  }

  return collected;
}

async function main() {
  const biome = resolveBiomeBin();
  const biomeMajorVersion = getBiomeMajorVersion(biome);
  const versionSpecificArgs =
    biomeMajorVersion >= 2
      ? ['--assist-enabled=false', '--skip=organizeImports']
      : ['--organize-imports-enabled=false', '--assists-enabled=false'];
  const targets = ['src', 'scripts', 'tests'].flatMap((directory) =>
    collectLintTargets(path.join(process.cwd(), directory)),
  );
  const status = run(biome, [
    'check',
    ...targets,
    '--files-ignore-unknown=true',
    '--formatter-enabled=false',
    '--diagnostic-level=error',
    '--reporter=summary',
    ...versionSpecificArgs,
  ]);

  process.exit(status);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(2);
});
