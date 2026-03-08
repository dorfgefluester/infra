const { parseArgs } = require('./cli-args.cjs');
const { writeJson, writeText } = require('./fs-utils.cjs');

const DEFAULT_PROJECT_KEY = 'dorfgefluester';
const PAGE_SIZE = 500;

function normalizeHostUrl(hostUrl) {
  return String(hostUrl || '').replace(/\/+$/, '');
}

function ratingToLetter(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const map = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };
  return map[rounded] || null;
}

function stripComponentPrefix(component) {
  if (!component) return '';
  const parts = String(component).split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : String(component);
}

function severityRank(severity) {
  const order = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];
  const index = order.indexOf(String(severity || '').toUpperCase());
  return index === -1 ? order.length : index;
}

async function fetchJson(url, { token }) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from SonarQube: ${url}\n${text}`.trim());
  }
  return res.json();
}

async function fetchMeasures({ hostUrl, token, projectKey }) {
  const metrics = [
    'bugs',
    'vulnerabilities',
    'code_smells',
    'security_rating',
    'reliability_rating',
    'sqale_rating',
    'coverage',
    'lines_to_cover',
    'duplicated_lines_density',
    'duplicated_lines'
  ];

  const url = new URL(`${hostUrl}/api/measures/component`);
  url.searchParams.set('component', projectKey);
  url.searchParams.set('metricKeys', metrics.join(','));

  const data = await fetchJson(url.toString(), { token });
  const measures = {};
  for (const measure of data?.component?.measures || []) {
    measures[measure.metric] = measure.value ?? null;
  }
  return measures;
}

async function fetchAllIssues({ hostUrl, token, projectKey, types }) {
  const issues = [];

  for (const type of types) {
    let page = 1;
    let total = null;
    let fetchedForType = 0;

    while (total === null || fetchedForType < total) {
      const url = new URL(`${hostUrl}/api/issues/search`);
      url.searchParams.set('componentKeys', projectKey);
      url.searchParams.set('resolved', 'false');
      url.searchParams.set('types', type);
      url.searchParams.set('ps', String(PAGE_SIZE));
      url.searchParams.set('p', String(page));

      const data = await fetchJson(url.toString(), { token });

      if (total === null) {
        total = Number(data?.total ?? 0);
      }

      const pageIssues = Array.isArray(data?.issues) ? data.issues : [];
      if (pageIssues.length === 0) break;

      for (const issue of pageIssues) {
        issues.push(issue);
      }

      fetchedForType += pageIssues.length;
      page++;
      if (page > 200) {
        throw new Error('Aborting SonarQube pagination after 200 pages (unexpectedly large response).');
      }
    }
  }

  return issues;
}

function summarizeIssues(issues) {
  const byType = {};
  const bySeverity = {};

  for (const issue of issues) {
    const type = String(issue.type || 'UNKNOWN');
    const severity = String(issue.severity || 'UNKNOWN');
    byType[type] = (byType[type] || 0) + 1;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }

  return { byType, bySeverity, total: issues.length };
}

function renderMarkdown({ hostUrl, projectKey, measures, issues, maxList }) {
  const summary = summarizeIssues(issues);
  const securityRating = ratingToLetter(measures?.security_rating);
  const reliabilityRating = ratingToLetter(measures?.reliability_rating);
  const maintainabilityRating = ratingToLetter(measures?.sqale_rating);

  const lines = [];
  lines.push('# SonarQube Issues (Snapshot)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Project: \`${projectKey}\``);
  lines.push(`Server: \`${hostUrl}\``);
  lines.push('');

  lines.push('## Metrics (from SonarQube)');
  lines.push('');
  lines.push(`- Security rating: ${securityRating ?? measures?.security_rating ?? 'n/a'}`);
  lines.push(`- Reliability rating: ${reliabilityRating ?? measures?.reliability_rating ?? 'n/a'}`);
  lines.push(`- Maintainability rating: ${maintainabilityRating ?? measures?.sqale_rating ?? 'n/a'}`);
  lines.push(`- Coverage: ${measures?.coverage ?? 'n/a'}% (lines to cover: ${measures?.lines_to_cover ?? 'n/a'})`);
  lines.push(`- Duplications: ${measures?.duplicated_lines_density ?? 'n/a'}% (duplicated lines: ${measures?.duplicated_lines ?? 'n/a'})`);
  lines.push(`- Open issues: vulnerabilities=${measures?.vulnerabilities ?? 'n/a'}, bugs=${measures?.bugs ?? 'n/a'}, code_smells=${measures?.code_smells ?? 'n/a'}`);
  lines.push('');

  lines.push('## Issue Totals (pulled)');
  lines.push('');
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- By type: ${Object.entries(summary.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`);
  lines.push(`- By severity: ${Object.entries(summary.bySeverity).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ') || 'n/a'}`);
  lines.push('');

  lines.push('## Top Issues (for backlog)');
  lines.push('');
  lines.push(`(Showing up to ${maxList} issues, sorted by severity.)`);
  lines.push('');

  const sorted = [...issues].sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    if (r !== 0) return r;
    return String(a.component || '').localeCompare(String(b.component || ''));
  });

  const selected = sorted.slice(0, maxList);
  for (const issue of selected) {
    const file = stripComponentPrefix(issue.component);
    const line = issue.line ? `:${issue.line}` : '';
    const link = `${hostUrl}/project/issues?id=${encodeURIComponent(projectKey)}&open=${encodeURIComponent(issue.key)}`;
    lines.push(`- [${issue.type}/${issue.severity}] \`${file}${line}\` — ${issue.message} (rule: \`${issue.rule}\`) (${link})`);
  }

  lines.push('');
  lines.push('## Full List');
  lines.push('');
  lines.push('Use the generated JSON output for the complete issue set (including pagination).');
  lines.push('');

  return lines.join('\n');
}

function printHelp() {
  // Keep this short; the README/doc is the canonical reference.
  console.log(`
Usage:
  node scripts/quality/sonarqube-export.cjs --host-url <url> --token <token> [--project-key dorfgefluester]

Outputs:
  --out-json reports/sonarqube/issues.json
  --out-md  docs/ci/SONARQUBE_ISSUES.md

Env vars (alternatives):
  SONAR_HOST_URL, SONAR_TOKEN, SONAR_PROJECT_KEY

Optional:
  --types VULNERABILITY,BUG,CODE_SMELL
  --max-list 200
`.trim());
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printHelp();
    return;
  }

  const hostUrl = normalizeHostUrl(args['host-url'] || process.env.SONAR_HOST_URL);
  const token = args.token || process.env.SONAR_TOKEN;
  const projectKey = args['project-key'] || process.env.SONAR_PROJECT_KEY || DEFAULT_PROJECT_KEY;

  const outJson = args['out-json'] || 'reports/sonarqube/issues.json';
  const outMd = args['out-md'] || 'docs/ci/SONARQUBE_ISSUES.md';

  const typesRaw = args.types || 'VULNERABILITY,BUG,CODE_SMELL';
  const types = String(typesRaw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const maxList = Number(args['max-list'] || 200);

  if (!hostUrl) {
    throw new Error('Missing SonarQube host URL. Provide --host-url or set SONAR_HOST_URL.');
  }
  if (!token) {
    throw new Error('Missing SonarQube token. Provide --token or set SONAR_TOKEN.');
  }

  const [measures, issues] = await Promise.all([
    fetchMeasures({ hostUrl, token, projectKey }).catch((err) => {
      return { error: err.message };
    }),
    fetchAllIssues({ hostUrl, token, projectKey, types })
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    hostUrl,
    projectKey,
    types,
    measures,
    summary: summarizeIssues(issues),
    issues
  };

  writeJson(outJson, payload);
  writeText(outMd, renderMarkdown({ hostUrl, projectKey, measures, issues, maxList }));

  console.log(`Wrote SonarQube issues JSON: ${outJson}`);
  console.log(`Wrote SonarQube issues markdown: ${outMd}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
