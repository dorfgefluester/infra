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

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function listResults(json) {
  return Array.isArray(json?.Results) ? json.Results : [];
}

function listVulnerabilities(result) {
  return Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
}

function incrementSeverity(bySeverity, severity) {
  bySeverity[severity] = (bySeverity[severity] || 0) + 1;
}

function updateTargetSummary(targets, targetName, type, severity) {
  const current = targets.get(targetName) || {
    target: targetName,
    type,
    count: 0,
    critical: 0,
    high: 0,
  };

  current.count += 1;
  current.critical += severity === 'CRITICAL' ? 1 : 0;
  current.high += severity === 'HIGH' ? 1 : 0;
  targets.set(targetName, current);
}

function getOrCreatePackageSummary(packages, packageKey, packageName, ecosystem, installedVersion) {
  return (
    packages.get(packageKey) || {
      packageName,
      ecosystem,
      installedVersion,
      fixedVersions: new Set(),
      vulnerabilities: [],
      critical: 0,
      high: 0,
    }
  );
}

function updatePackageSummary(packageSummary, vulnerabilityId, fixedVersion, severity) {
  if (fixedVersion) {
    packageSummary.fixedVersions.add(fixedVersion);
  }

  packageSummary.vulnerabilities.push(vulnerabilityId);
  packageSummary.critical += severity === 'CRITICAL' ? 1 : 0;
  packageSummary.high += severity === 'HIGH' ? 1 : 0;
}

function createTopFinding(vulnerability, severity, fixedVersion, targetName) {
  return {
    severity,
    pkg: vulnerability.PkgName,
    installed: vulnerability.InstalledVersion,
    fixed: fixedVersion,
    title: vulnerability.Title || vulnerability.VulnerabilityID,
    id: vulnerability.VulnerabilityID,
    target: targetName,
  };
}

function sortBySeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

function sortPackages(a, b) {
  if (b.critical !== a.critical) return b.critical - a.critical;
  if (b.high !== a.high) return b.high - a.high;
  return b.vulnerabilityCount - a.vulnerabilityCount;
}

function sortTargets(a, b) {
  if (b.critical !== a.critical) return b.critical - a.critical;
  if (b.high !== a.high) return b.high - a.high;
  return b.count - a.count;
}

function buildPackagesList(packages) {
  return Array.from(packages.values())
    .map((pkg) => ({
      ...pkg,
      fixedVersions: Array.from(pkg.fixedVersions).sort((a, b) => a.localeCompare(b)),
      vulnerabilityCount: pkg.vulnerabilities.length,
      vulnerabilities: pkg.vulnerabilities.sort((a, b) => a.localeCompare(b)),
    }))
    .sort(sortPackages);
}

function buildTargetList(targets) {
  return Array.from(targets.values()).sort(sortTargets);
}

function summarizeTrivy(json) {
  const results = listResults(json);

  let vulnCount = 0;
  const bySeverity = {};
  let fixableCount = 0;
  const targets = new Map();
  const packages = new Map();
  const topItems = [];

  for (const result of results) {
    const targetName = result.Target || 'unknown';
    const targetType = result.Type || 'unknown';
    const vulnerabilities = listVulnerabilities(result);
    for (const v of vulnerabilities) {
      vulnCount++;
      const sev = String(v.Severity || 'UNKNOWN');
      incrementSeverity(bySeverity, sev);
      const fixedVersion = v.FixedVersion || '';
      const packageName = v.PkgName || 'unknown';
      const packageKey = `${packageName}@${targetType}`;

      if (fixedVersion) {
        fixableCount++;
      }

      updateTargetSummary(targets, targetName, targetType, sev);

      const packageSummary = getOrCreatePackageSummary(
        packages,
        packageKey,
        packageName,
        targetType,
        v.InstalledVersion || '',
      );
      updatePackageSummary(packageSummary, v.VulnerabilityID, fixedVersion, sev);
      packages.set(packageKey, packageSummary);

      topItems.push(createTopFinding(v, sev, fixedVersion, targetName));
    }
  }

  topItems.sort(sortBySeverity);
  const packagesList = buildPackagesList(packages);
  const targetList = buildTargetList(targets);

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

function resolveRuntime(requestedRuntime) {
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

  return { runtime, hasNativeTrivy };
}

function writeFindingsArtifacts({ outJson, outSummary, outMd, maxList }) {
  const json = readJson(outJson);
  const summary = summarizeTrivy(json);

  writeText(outSummary, JSON.stringify(summary, null, 2));
  writeText(outMd, renderTrivyMarkdown({ summary, maxList }));

  console.log(`Wrote Trivy findings JSON: ${outJson}`);
  console.log(`Wrote Trivy findings summary: ${outSummary}`);
  console.log(`Wrote Trivy findings markdown: ${outMd}`);
}

function buildContainerTrivyArgs({
  runtime,
  absScanPath,
  cacheDirAbs,
  containerScanPath,
  containerCacheDir,
  containerOutPath,
  severity,
  ignoreUnfixed,
  skipDirs,
}) {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '1000';
  const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '1000';
  const skipDirsContainer = skipDirs
    .map((dir) => `${containerScanPath}/${dir}`.replace(/\/+$/, ''))
    .join(',');
  const containerArgs = ['run', '--rm'];

  if (runtime === 'podman') {
    containerArgs.push('--userns=keep-id');
  } else {
    containerArgs.push('-u', `${uid}:${gid}`);
  }

  containerArgs.push(
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
    containerArgs.push('--ignore-unfixed');
  }

  if (skipDirsContainer) {
    containerArgs.push('--skip-dirs', skipDirsContainer);
  }

  return containerArgs;
}

function runContainerTrivy({ runtime, scanPath, outJson, severity, ignoreUnfixed, skipDirs }) {
  const cwd = process.cwd();
  const absScanPath = path.resolve(cwd, scanPath);
  const outJsonAbs = path.resolve(cwd, outJson);
  const cacheDir = path.join(cwd, 'reports', 'trivy', 'cache');
  const cacheDirAbs = path.resolve(cacheDir);
  const containerScanPath = '/src';
  const containerCacheDir = '/tmp/trivy-cache';
  const containerOutPath = `/src/${path.relative(cwd, outJsonAbs).replaceAll(path.sep, '/')}`;
  const containerArgs = buildContainerTrivyArgs({
    runtime,
    absScanPath,
    cacheDirAbs,
    containerScanPath,
    containerCacheDir,
    containerOutPath,
    severity,
    ignoreUnfixed,
    skipDirs,
  });

  ensureDirForFile(path.join(cacheDir, '.keep'));

  const res = spawnSync(runtime, containerArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error(`Trivy scan failed with exit code ${res.status}`);
  }
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
  const { runtime, hasNativeTrivy } = resolveRuntime(requestedRuntime);

  ensureDirForFile(outJson);
  ensureDirForFile(outSummary);
  ensureDirForFile(outMd);

  if ((!runtime || requestedRuntime === 'trivy') && hasNativeTrivy) {
    runDirectTrivy({ scanPath, outJson, severity, ignoreUnfixed, skipDirs });
    writeFindingsArtifacts({ outJson, outSummary, outMd, maxList });
    return;
  }

  runContainerTrivy({ runtime, scanPath, outJson, severity, ignoreUnfixed, skipDirs });
  writeFindingsArtifacts({ outJson, outSummary, outMd, maxList });
}

try {
  main();
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
}
