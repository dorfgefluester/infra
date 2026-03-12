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
    '0',
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

function summarizeTrivy(json) {
  const results = Array.isArray(json?.Results) ? json.Results : [];

  let vulnCount = 0;
  const bySeverity = {};
  let fixableCount = 0;
  const targets = new Map();
  const packages = new Map();
  const topItems = [];

  for (const result of results) {
    const targetName = result.Target || 'unknown';
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const v of vulnerabilities) {
      vulnCount++;
      const sev = String(v.Severity || 'UNKNOWN');
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
      const fixedVersion = v.FixedVersion || '';
      const packageKey = `${v.PkgName || 'unknown'}@${result.Type || 'unknown'}`;

      if (fixedVersion) {
        fixableCount++;
      }

      targets.set(targetName, {
        target: targetName,
        type: result.Type || 'unknown',
        count: (targets.get(targetName)?.count || 0) + 1,
        critical: (targets.get(targetName)?.critical || 0) + (sev === 'CRITICAL' ? 1 : 0),
        high: (targets.get(targetName)?.high || 0) + (sev === 'HIGH' ? 1 : 0),
      });

      const existingPackage = packages.get(packageKey) || {
        packageName: v.PkgName || 'unknown',
        ecosystem: result.Type || 'unknown',
        installedVersion: v.InstalledVersion || '',
        fixedVersions: new Set(),
        vulnerabilities: [],
        critical: 0,
        high: 0,
      };

      if (fixedVersion) {
        existingPackage.fixedVersions.add(fixedVersion);
      }
      existingPackage.vulnerabilities.push(v.VulnerabilityID);
      existingPackage.critical += sev === 'CRITICAL' ? 1 : 0;
      existingPackage.high += sev === 'HIGH' ? 1 : 0;
      packages.set(packageKey, existingPackage);

      topItems.push({
        severity: sev,
        pkg: v.PkgName,
        installed: v.InstalledVersion,
        fixed: fixedVersion,
        title: v.Title || v.VulnerabilityID,
        id: v.VulnerabilityID,
        target: targetName,
      });
    }
  }

  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  topItems.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));

  const packagesList = Array.from(packages.values())
    .map((pkg) => ({
      ...pkg,
      fixedVersions: Array.from(pkg.fixedVersions).sort((a, b) => a.localeCompare(b)),
      vulnerabilityCount: pkg.vulnerabilities.length,
      vulnerabilities: pkg.vulnerabilities.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      if (b.critical !== a.critical) return b.critical - a.critical;
      if (b.high !== a.high) return b.high - a.high;
      return b.vulnerabilityCount - a.vulnerabilityCount;
    });

  const targetList = Array.from(targets.values()).sort((a, b) => {
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.high !== a.high) return b.high - a.high;
    return b.count - a.count;
  });

  return {
    generatedAt: new Date().toISOString(),
    vulnerabilityCount: vulnCount,
    fixableCount,
    unfixableCount: vulnCount - fixableCount,
    bySeverity,
    topFindings: topItems,
    topPackages: packagesList,
    topTargets: targetList,
  };
}

function renderTrivyMarkdown({ summary, maxList }) {
  const { vulnerabilityCount, fixableCount, unfixableCount, bySeverity, topFindings, topPackages, topTargets } =
    summary;

  const lines = [];
  lines.push('# Trivy Findings (FS Scan Snapshot)');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Vulnerabilities: ${vulnerabilityCount}`);
  lines.push(`- Fixable now: ${fixableCount}`);
  lines.push(`- No upstream fix yet: ${unfixableCount}`);
  lines.push(
    `- By severity: ${
      Object.entries(bySeverity)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') || 'n/a'
    }`,
  );
  lines.push('');
  lines.push('## Fix First Packages');
  lines.push('');
  lines.push('(Packages with the highest concentration of critical/high findings and available fixes.)');
  lines.push('');

  for (const pkg of topPackages.slice(0, Math.min(maxList, 20))) {
    const fixed = pkg.fixedVersions.length > 0 ? pkg.fixedVersions.join(', ') : 'n/a';
    lines.push(
      `- \`${pkg.packageName}\` [${pkg.ecosystem}] ${pkg.installedVersion || ''} → ${fixed} | critical=${pkg.critical}, high=${pkg.high}, vulns=${pkg.vulnerabilityCount}`,
    );
  }
  lines.push('');
  lines.push('## Hotspot Targets');
  lines.push('');

  for (const target of topTargets.slice(0, 10)) {
    lines.push(
      `- \`${target.target}\` [${target.type}] | critical=${target.critical}, high=${target.high}, total=${target.count}`,
    );
  }
  lines.push('');
  lines.push('## Top Findings (for backlog)');
  lines.push('');
  lines.push(`(Showing up to ${maxList} items, sorted by severity.)`);
  lines.push('');

  for (const item of topFindings.slice(0, maxList)) {
    const fixed = item.fixed ? `fixed: ${item.fixed}` : 'fixed: n/a';
    lines.push(
      `- [${item.severity}] \`${item.pkg}\` ${item.installed || ''} (${fixed}) — ${item.id} (${item.target})`,
    );
  }

  lines.push('');
  lines.push('## Suggested Triage');
  lines.push('');
  lines.push('- Upgrade fixable CRITICAL/HIGH packages first, grouped by package rather than by individual CVE.');
  lines.push('- Review unfixable findings separately; suppress only with a documented reason and revisit on dependency updates.');
  lines.push('- Use the target hotspots section to focus scans on the directories or lockfiles creating the most risk.');
  lines.push('');
  lines.push('## Full Report');
  lines.push('');
  lines.push('Use the generated JSON outputs for full details (targets, CVE metadata, fix versions, package rollups).');
  lines.push('');

  return lines.join('\n');
}

function printHelp() {
  console.log(
    `
Usage:
  node scripts/quality/trivy-fs-scan.cjs [--path .]

Outputs:
  --out-json reports/trivy/fs.json
  --out-summary reports/trivy/fs-summary.json
  --out-md  docs/ci/TRIVY_FINDINGS.md

Options:
  --severity HIGH,CRITICAL
  --ignore-unfixed true|false
  --skip-dirs node_modules,dist,tests/coverage,playwright-report
  --max-list 200
  --runtime docker|podman|trivy
`.trim(),
  );
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
  const outSummary = args['out-summary'] || 'reports/trivy/fs-summary.json';
  const outMd = args['out-md'] || 'docs/ci/TRIVY_FINDINGS.md';

  const severity = args.severity || 'HIGH,CRITICAL';
  const ignoreUnfixed = parseBoolean(args['ignore-unfixed'], true);
  const skipDirsRaw =
    args['skip-dirs'] || 'node_modules,dist,tests/coverage,playwright-report,tests/test-results';
  const skipDirs = String(skipDirsRaw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const maxList = Number(args['max-list'] || 200);

  const requestedRuntime = args.runtime ? String(args.runtime).trim().toLowerCase() : '';
  const runtime =
    requestedRuntime && requestedRuntime !== 'trivy' ? requestedRuntime : pickContainerRuntime();
  const hasNativeTrivy = commandExists('trivy');
  if (!runtime && !hasNativeTrivy) {
    throw new Error(
      'No Trivy runtime found. Install docker/podman or trivy binary to generate FS findings.',
    );
  }

  if (runtime && !['docker', 'podman'].includes(runtime)) {
    throw new Error(`Unsupported --runtime value: ${runtime}. Use docker, podman, or trivy.`);
  }

  ensureDirForFile(outJson);
  ensureDirForFile(outSummary);

  const cwd = process.cwd();

  if ((!runtime || requestedRuntime === 'trivy') && hasNativeTrivy) {
    runDirectTrivy({ scanPath, outJson, severity, ignoreUnfixed, skipDirs });
    const json = readJson(outJson);
    const summary = summarizeTrivy(json);
    writeText(outSummary, JSON.stringify(summary, null, 2));
    writeText(outMd, renderTrivyMarkdown({ summary, maxList }));

    console.log(`Wrote Trivy findings JSON: ${outJson}`);
    console.log(`Wrote Trivy findings summary: ${outSummary}`);
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
  ensureDirForFile(path.join(cacheDir, '.keep'));

  const skipDirsContainer = skipDirs
    .map((dir) => `${containerScanPath}/${dir}`.replace(/\/+$/, ''))
    .join(',');

  const baseArgs = ['run', '--rm'];

  if (runtime === 'podman') {
    baseArgs.push('--userns=keep-id');
  } else {
    baseArgs.push('-u', `${uid}:${gid}`);
  }

  baseArgs.push(
    '-v',
    `${absScanPath}:${containerScanPath}`,
    '-v',
    `${cacheDirAbs}:${containerCacheDir}`,
    'docker.io/aquasec/trivy:latest',
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
    '0',
  );

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
  const summary = summarizeTrivy(json);
  writeText(outSummary, JSON.stringify(summary, null, 2));
  writeText(outMd, renderTrivyMarkdown({ summary, maxList }));

  console.log(`Wrote Trivy findings JSON: ${outJson}`);
  console.log(`Wrote Trivy findings summary: ${outSummary}`);
  console.log(`Wrote Trivy findings markdown: ${outMd}`);
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
}
