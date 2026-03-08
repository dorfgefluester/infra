const { spawnSync } = require('child_process');
const path = require('path');

const { parseArgs } = require('./cli-args.cjs');
const { ensureDirForFile, readJson, writeText } = require('./fs-utils.cjs');

function commandExists(command) {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(bin, [command], { stdio: 'ignore' });
  return res.status === 0;
}

function pickContainerRuntime() {
  if (commandExists('docker')) return 'docker';
  if (commandExists('podman')) return 'podman';
  return null;
}

function runDirectTrivy({ scanPath, outJson, severity, ignoreUnfixed, skipDirs }) {
  const args = [
    'fs',
    scanPath,
    '--format',
    'json',
    '--output',
    outJson,
    '--severity',
    severity,
    '--no-progress',
    '--exit-code',
    '0'
  ];

  if (ignoreUnfixed) {
    args.push('--ignore-unfixed');
  }

  for (const dir of skipDirs) {
    args.push('--skip-dirs', dir);
  }

  const res = spawnSync('trivy', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Trivy scan failed with exit code ${res.status}`);
  }
}

function renderTrivyMarkdown({ json, maxList }) {
  const results = Array.isArray(json?.Results) ? json.Results : [];

  let vulnCount = 0;
  const bySeverity = {};
  const topItems = [];

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const v of vulnerabilities) {
      vulnCount++;
      const sev = String(v.Severity || 'UNKNOWN');
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      topItems.push({
        severity: sev,
        pkg: v.PkgName,
        installed: v.InstalledVersion,
        fixed: v.FixedVersion,
        title: v.Title || v.VulnerabilityID,
        id: v.VulnerabilityID,
        target: result.Target
      });
    }
  }

  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  topItems.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));

  const lines = [];
  lines.push('# Trivy Findings (FS Scan Snapshot)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Vulnerabilities: ${vulnCount}`);
  lines.push(`- By severity: ${Object.entries(bySeverity).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`);
  lines.push('');
  lines.push('## Top Findings (for backlog)');
  lines.push('');
  lines.push(`(Showing up to ${maxList} items, sorted by severity.)`);
  lines.push('');

  for (const item of topItems.slice(0, maxList)) {
    const fixed = item.fixed ? `fixed: ${item.fixed}` : 'fixed: n/a';
    lines.push(`- [${item.severity}] \`${item.pkg}\` ${item.installed || ''} (${fixed}) — ${item.id} (${item.target})`);
  }

  lines.push('');
  lines.push('## Full Report');
  lines.push('');
  lines.push('Use the generated JSON output for full details (targets, CVE metadata, etc.).');
  lines.push('');

  return lines.join('\n');
}

function printHelp() {
  console.log(`
Usage:
  node scripts/quality/trivy-fs-scan.cjs [--path .]

Outputs:
  --out-json reports/trivy/fs.json
  --out-md  docs/TRIVY_FINDINGS.md

Options:
  --severity HIGH,CRITICAL
  --ignore-unfixed true|false
  --skip-dirs node_modules,dist,tests/coverage,playwright-report
  --max-list 200
  --runtime docker|podman|trivy
`.trim());
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

function main() {
  const { args } = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printHelp();
    return;
  }

  const scanPath = args.path || '.';
  const outJson = args['out-json'] || 'reports/trivy/fs.json';
  const outMd = args['out-md'] || 'docs/TRIVY_FINDINGS.md';

  const severity = args.severity || 'HIGH,CRITICAL';
  const ignoreUnfixed = parseBoolean(args['ignore-unfixed'], true);
  const skipDirsRaw = args['skip-dirs'] || 'node_modules,dist,tests/coverage,playwright-report,tests/test-results';
  const skipDirs = String(skipDirsRaw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const maxList = Number(args['max-list'] || 200);

  const requestedRuntime = args.runtime ? String(args.runtime).trim().toLowerCase() : '';
  const runtime = requestedRuntime && requestedRuntime !== 'trivy' ? requestedRuntime : pickContainerRuntime();
  const hasNativeTrivy = commandExists('trivy');
  if (!runtime && !hasNativeTrivy) {
    throw new Error('No Trivy runtime found. Install docker/podman or trivy binary to generate FS findings.');
  }

  if (runtime && !['docker', 'podman'].includes(runtime)) {
    throw new Error(`Unsupported --runtime value: ${runtime}. Use docker, podman, or trivy.`);
  }

  ensureDirForFile(outJson);

  const cwd = process.cwd();

  if ((!runtime || requestedRuntime === 'trivy') && hasNativeTrivy) {
    runDirectTrivy({ scanPath, outJson, severity, ignoreUnfixed, skipDirs });
    const json = readJson(outJson);
    writeText(outMd, renderTrivyMarkdown({ json, maxList }));

    console.log(`Wrote Trivy findings JSON: ${outJson}`);
    console.log(`Wrote Trivy findings markdown: ${outMd}`);
    return;
  }

  const absScanPath = path.resolve(cwd, scanPath);
  const outJsonAbs = path.resolve(cwd, outJson);

  const containerScanPath = '/src';
  const containerOutPath = `/src/${path.relative(cwd, outJsonAbs).replaceAll(path.sep, '/')}`;

  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '1000';
  const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '1000';

  const cacheDir = path.join(cwd, 'reports', 'trivy', 'cache');
  const cacheDirAbs = path.resolve(cacheDir);
  const containerCacheDir = '/tmp/trivy-cache';

  const skipDirsContainer = skipDirs
    .map((dir) => `${containerScanPath}/${dir}`.replace(/\/+$/, ''))
    .join(',');

  const baseArgs = [
    'run',
    '--rm',
    '-u',
    `${uid}:${gid}`,
    '-v',
    `${absScanPath}:${containerScanPath}`,
    '-v',
    `${cacheDirAbs}:${containerCacheDir}`,
    'aquasec/trivy:latest',
    'fs',
    containerScanPath,
    '--cache-dir',
    containerCacheDir,
    '--format',
    'json',
    '--output',
    containerOutPath,
    '--severity',
    severity,
    '--no-progress',
    '--exit-code',
    '0'
  ];

  if (ignoreUnfixed) {
    baseArgs.push('--ignore-unfixed');
  }

  if (skipDirsContainer) {
    baseArgs.push('--skip-dirs', skipDirsContainer);
  }

  const res = spawnSync(runtime, baseArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Trivy scan failed with exit code ${res.status}`);
  }

  const json = readJson(outJson);
  writeText(outMd, renderTrivyMarkdown({ json, maxList }));

  console.log(`Wrote Trivy findings JSON: ${outJson}`);
  console.log(`Wrote Trivy findings markdown: ${outMd}`);
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
}
