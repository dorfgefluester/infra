const fs = require('fs');

const { parseArgs } = require('./cli-args.cjs');
const { readJson } = require('./fs-utils.cjs');

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

function printHelp() {
  console.log(
    `
Usage:
  node scripts/quality/npm-audit-summary.cjs --input reports/npm-audit/audit.json

Options:
  --label "npm Audit"
  --max-packages 10
  --max-via 12
`.trim(),
  );
}

function normalizeSeverity(value) {
  const severity = String(value || 'info').trim().toLowerCase();
  return SEVERITY_ORDER.includes(severity) ? severity : 'info';
}

function compareSeverity(left, right) {
  return SEVERITY_ORDER.indexOf(normalizeSeverity(left)) - SEVERITY_ORDER.indexOf(normalizeSeverity(right));
}

function listViaEntries(via) {
  if (!Array.isArray(via)) {
    return [];
  }

  return via
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      source: entry.source || null,
      name: entry.name || '(unknown package)',
      title: entry.title || '',
      severity: normalizeSeverity(entry.severity),
      url: entry.url || '',
      range: entry.range || '',
    }));
}

function summarizeAudit(report) {
  const vulnerabilityMap = report?.vulnerabilities && typeof report.vulnerabilities === 'object'
    ? report.vulnerabilities
    : {};
  const metadataCounts = report?.metadata?.vulnerabilities && typeof report.metadata.vulnerabilities === 'object'
    ? report.metadata.vulnerabilities
    : {};

  const packageEntries = [];
  const transitiveAdvisories = [];

  for (const [name, vulnerability] of Object.entries(vulnerabilityMap)) {
    const severity = normalizeSeverity(vulnerability?.severity);
    const isDirect = vulnerability?.isDirect === true || vulnerability?.isDirectDependency === true;
    const viaEntries = listViaEntries(vulnerability?.via);

    packageEntries.push({
      name,
      severity,
      isDirect,
      fixAvailable: vulnerability?.fixAvailable ?? false,
      range: vulnerability?.range || '',
      nodes: Array.isArray(vulnerability?.nodes) ? vulnerability.nodes.length : 0,
      viaCount: viaEntries.length,
    });

    for (const advisory of viaEntries) {
      transitiveAdvisories.push({
        packageName: name,
        isDirect,
        ...advisory,
      });
    }
  }

  packageEntries.sort((left, right) => {
    const bySeverity = compareSeverity(left.severity, right.severity);
    if (bySeverity !== 0) return bySeverity;
    if (left.isDirect !== right.isDirect) return left.isDirect ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  transitiveAdvisories.sort((left, right) => {
    const bySeverity = compareSeverity(left.severity, right.severity);
    if (bySeverity !== 0) return bySeverity;
    if (left.isDirect !== right.isDirect) return left.isDirect ? -1 : 1;
    if (left.packageName !== right.packageName) return left.packageName.localeCompare(right.packageName);
    return left.name.localeCompare(right.name);
  });

  return {
    metadataCounts: {
      critical: Number(metadataCounts.critical || 0),
      high: Number(metadataCounts.high || 0),
      moderate: Number(metadataCounts.moderate || 0),
      low: Number(metadataCounts.low || 0),
      info: Number(metadataCounts.info || 0),
      total: Number(metadataCounts.total || packageEntries.length),
    },
    packageEntries,
    transitiveAdvisories,
    dependencyCount: Number(report?.metadata?.dependencies?.total || 0),
  };
}

function renderSummary({ label, summary, maxPackages, maxVia }) {
  const lines = [];
  lines.push(`=== ${label} Summary ===`);
  lines.push('Source: package-lock.json via npm audit');
  lines.push(`Dependencies scanned: ${summary.dependencyCount || 'n/a'}`);
  lines.push(
    `Vulnerabilities: critical=${summary.metadataCounts.critical}, high=${summary.metadataCounts.high}, moderate=${summary.metadataCounts.moderate}, low=${summary.metadataCounts.low}, info=${summary.metadataCounts.info}, total=${summary.metadataCounts.total}`,
  );

  if (summary.packageEntries.length === 0) {
    lines.push('Affected packages: none');
    return lines.join('\n');
  }

  lines.push('Top affected packages:');
  for (const pkg of summary.packageEntries.slice(0, maxPackages)) {
    const fix = pkg.fixAvailable
      ? typeof pkg.fixAvailable === 'object'
        ? `fix=${pkg.fixAvailable.name || 'available'}`
        : 'fix=available'
      : 'fix=none';
    lines.push(
      `- [${pkg.severity.toUpperCase()}] ${pkg.name} | direct=${pkg.isDirect ? 'yes' : 'no'} | via=${pkg.viaCount} | nodes=${pkg.nodes} | ${fix}${pkg.range ? ` | range=${pkg.range}` : ''}`,
    );
  }

  if (summary.transitiveAdvisories.length > 0) {
    lines.push('Top advisories:');
    for (const advisory of summary.transitiveAdvisories.slice(0, maxVia)) {
      const title = advisory.title ? ` | ${advisory.title}` : '';
      const url = advisory.url ? ` | ${advisory.url}` : '';
      lines.push(
        `- [${advisory.severity.toUpperCase()}] ${advisory.packageName} via ${advisory.name}${advisory.range ? ` (${advisory.range})` : ''}${title}${url}`,
      );
    }
  } else {
    lines.push('Top advisories: none');
  }

  lines.push('Note: dependency vulnerabilities come from npm audit/package-lock.json, not native SonarQube code analysis.');
  return lines.join('\n');
}

function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const inputPath = args.input || args.i;
  if (!inputPath) {
    throw new Error('Missing required --input argument.');
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`npm audit report not found: ${inputPath}`);
  }

  const summary = summarizeAudit(readJson(inputPath));
  const label = String(args.label || 'npm Audit');
  const maxPackages = Number(args['max-packages'] || 10);
  const maxVia = Number(args['max-via'] || 12);

  console.log(renderSummary({ label, summary, maxPackages, maxVia }));
}

main();
