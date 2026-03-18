const fs = require('fs');

const { parseArgs } = require('./cli-args.cjs');
const { readJson } = require('./fs-utils.cjs');

const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

function printHelp() {
  console.log(
    `
Usage:
  node scripts/quality/trivy-summary.cjs --input reports/trivy/fs.json

Options:
  --label "Trivy FS Scan"
  --max-findings 12
  --max-packages 8
`.trim(),
  );
}

function normalizeSeverity(value) {
  const severity = String(value || 'UNKNOWN').trim().toUpperCase();
  return SEVERITY_ORDER.includes(severity) ? severity : 'UNKNOWN';
}

function compareSeverity(a, b) {
  return SEVERITY_ORDER.indexOf(normalizeSeverity(a)) - SEVERITY_ORDER.indexOf(normalizeSeverity(b));
}

function formatSeverityCounts(counts) {
  return SEVERITY_ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => `${severity}=${counts[severity]}`)
    .join(', ');
}

function summarizeTrivyReport(report) {
  const results = Array.isArray(report?.Results) ? report.Results : [];
  const severityCounts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [severity, 0]));
  const packageCounts = new Map();
  const findings = [];

  for (const result of results) {
    const vulnerabilities = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : [];
    for (const vulnerability of vulnerabilities) {
      const severity = normalizeSeverity(vulnerability?.Severity);
      const pkgName = vulnerability?.PkgName || '(unknown package)';
      const installedVersion = vulnerability?.InstalledVersion || 'unknown';
      const fixedVersion = vulnerability?.FixedVersion || 'n/a';
      const target = result?.Target || result?.ArtifactName || '(unknown target)';
      const vulnId = vulnerability?.VulnerabilityID || 'UNKNOWN-ID';
      const title = vulnerability?.Title || vulnerability?.PrimaryURL || '';

      severityCounts[severity] += 1;
      packageCounts.set(pkgName, (packageCounts.get(pkgName) || 0) + 1);
      findings.push({
        severity,
        pkgName,
        installedVersion,
        fixedVersion,
        target,
        vulnId,
        title,
      });
    }
  }

  findings.sort((left, right) => {
    const bySeverity = compareSeverity(left.severity, right.severity);
    if (bySeverity !== 0) return bySeverity;
    if (left.pkgName !== right.pkgName) return left.pkgName.localeCompare(right.pkgName);
    return left.vulnId.localeCompare(right.vulnId);
  });

  const topPackages = [...packageCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([pkgName, count]) => ({ pkgName, count }));

  return {
    totalFindings: findings.length,
    severityCounts,
    topPackages,
    findings,
    targetCount: results.length,
  };
}

function renderSummary({ label, summary, maxFindings, maxPackages }) {
  const lines = [];
  lines.push(`=== ${label} Summary ===`);
  lines.push(`Targets scanned: ${summary.targetCount}`);
  lines.push(`Vulnerabilities: ${summary.totalFindings}`);
  lines.push(`By severity: ${formatSeverityCounts(summary.severityCounts) || 'none'}`);

  if (summary.topPackages.length > 0) {
    lines.push(`Top packages: ${summary.topPackages.slice(0, maxPackages).map((item) => `${item.pkgName} (${item.count})`).join(', ')}`);
  } else {
    lines.push('Top packages: none');
  }

  if (summary.findings.length === 0) {
    lines.push('Top findings: none');
    return lines.join('\n');
  }

  lines.push('Top findings:');
  for (const finding of summary.findings.slice(0, maxFindings)) {
    const parts = [
      `[${finding.severity}]`,
      finding.vulnId,
      `${finding.pkgName}@${finding.installedVersion}`,
      `fixed=${finding.fixedVersion}`,
      `target=${finding.target}`,
    ];
    lines.push(`- ${parts.join(' | ')}`);
    if (finding.title) {
      lines.push(`  ${finding.title}`);
    }
  }

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
    throw new Error(`Trivy report not found: ${inputPath}`);
  }

  const label = String(args.label || 'Trivy');
  const maxFindings = Number(args['max-findings'] || 12);
  const maxPackages = Number(args['max-packages'] || 8);
  const report = readJson(inputPath);
  const summary = summarizeTrivyReport(report);

  console.log(renderSummary({ label, summary, maxFindings, maxPackages }));
}

main();
