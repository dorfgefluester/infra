const { parseArgs } = require('./cli-args.cjs');
const { writeJson, writeText } = require('./fs-utils.cjs');

const DEFAULT_PROJECT_KEY = 'dorfgefluester';
const DEFAULT_PAGE_SIZE = 100;

function normalizeHostUrl(hostUrl) {
  return String(hostUrl || '').replace(/\/+$/, '');
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
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

function shorten(text, maxLen) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
}

function impactsFor(issue) {
  const impacts = Array.isArray(issue?.impacts) ? issue.impacts : [];
  return impacts
    .map((impact) => {
      return {
        softwareQuality: impact?.softwareQuality,
        severity: impact?.severity
      };
    })
    .filter((impact) => impact.softwareQuality || impact.severity);
}

async function fetchJson(url, { token }) {
  const headers = {};
  if (token) {
    headers.Authorization = `Basic ${Buffer.from(`${token}:`).toString('base64')}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from SonarQube: ${url}\n${body}`.trim());
  }
  return res.json();
}

async function tryFetchIssuesPage({ hostUrl, token, params }) {
  const url = new URL(`${hostUrl}/api/issues/search`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  // SonarQube versions differ in how "impacts" are returned. Prefer requesting all additional fields,
  // but fall back if the server rejects the parameter.
  try {
    url.searchParams.set('additionalFields', '_all');
    return await fetchJson(url.toString(), { token });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!msg.includes('additionalFields')) throw err;
    url.searchParams.delete('additionalFields');
    return await fetchJson(url.toString(), { token });
  }
}

async function fetchAllIssues({ hostUrl, token, projectKey, impactSoftwareQuality, impactSeverity, pageSize }) {
  const issues = [];
  let page = 1;
  let total = null;
  let fetched = 0;

  while (total === null || fetched < total) {
    const data = await tryFetchIssuesPage({
      hostUrl,
      token,
      params: {
        componentKeys: projectKey,
        resolved: 'false',
        ps: pageSize,
        p: page,
        impactSoftwareQualities: impactSoftwareQuality,
        impactSeverities: impactSeverity
      }
    });

    if (total === null) {
      total = Number(data?.paging?.total ?? 0);
    }

    const pageIssues = Array.isArray(data?.issues) ? data.issues : [];
    if (pageIssues.length === 0) break;

    for (const issue of pageIssues) {
      issues.push(issue);
    }

    fetched += pageIssues.length;
    page++;
    if (page > 200) {
      throw new Error('Aborting SonarQube pagination after 200 pages (unexpectedly large response).');
    }
  }

  return { issues, total: total ?? issues.length };
}

async function fetchAllIssuesByTypeSeverity({ hostUrl, token, projectKey, types, severities, pageSize }) {
  const issues = [];
  let page = 1;
  let total = null;
  let fetched = 0;

  while (total === null || fetched < total) {
    const data = await tryFetchIssuesPage({
      hostUrl,
      token,
      params: {
        componentKeys: projectKey,
        resolved: 'false',
        ps: pageSize,
        p: page,
        types,
        severities
      }
    });

    if (total === null) {
      total = Number(data?.paging?.total ?? 0);
    }

    const pageIssues = Array.isArray(data?.issues) ? data.issues : [];
    if (pageIssues.length === 0) break;

    for (const issue of pageIssues) {
      issues.push(issue);
    }

    fetched += pageIssues.length;
    page++;
    if (page > 200) {
      throw new Error('Aborting SonarQube pagination after 200 pages (unexpectedly large response).');
    }
  }

  return { issues, total: total ?? issues.length, fallback: true };
}

async function fetchImpactOrFallback({
  hostUrl,
  token,
  projectKey,
  impactSoftwareQuality,
  impactSeverity,
  pageSize,
  fallbackTypes,
  fallbackSeverities
}) {
  try {
    return await fetchAllIssues({ hostUrl, token, projectKey, impactSoftwareQuality, impactSeverity, pageSize });
  } catch (err) {
    const msg = String(err?.message || err);
    const looksLikeImpactUnsupported =
      msg.includes('impactSoftwareQualities') || msg.includes('impactSeverities') || msg.includes('Unrecognized') || msg.includes('Unknown');
    if (!looksLikeImpactUnsupported) {
      throw err;
    }
    return fetchAllIssuesByTypeSeverity({
      hostUrl,
      token,
      projectKey,
      types: fallbackTypes,
      severities: fallbackSeverities,
      pageSize
    });
  }
}

async function fetchQualityGate({ hostUrl, token, projectKey }) {
  const url = new URL(`${hostUrl}/api/qualitygates/project_status`);
  url.searchParams.set('projectKey', projectKey);
  const data = await fetchJson(url.toString(), { token });
  return {
    status: data?.projectStatus?.status ?? null,
    conditions: Array.isArray(data?.projectStatus?.conditions) ? data.projectStatus.conditions : []
  };
}

async function fetchMeasures({ hostUrl, token, projectKey }) {
  const metrics = [
    'security_rating',
    'reliability_rating',
    'sqale_rating',
    'coverage',
    'duplicated_lines_density',
    'bugs',
    'vulnerabilities',
    'code_smells',
    'security_hotspots',
    'ncloc'
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

async function fetchHotspots({ hostUrl, token, projectKey, pageSize }) {
  const url = new URL(`${hostUrl}/api/hotspots/search`);
  url.searchParams.set('projectKey', projectKey);
  url.searchParams.set('ps', String(pageSize));
  const data = await fetchJson(url.toString(), { token });

  const hotspots = Array.isArray(data?.hotspots) ? data.hotspots : [];
  return {
    total: Number(data?.paging?.total ?? hotspots.length),
    hotspots: hotspots.map((h) => {
      return {
        message: h?.message ?? null,
        file: stripComponentPrefix(h?.component),
        line: h?.line ?? null,
        vulnerabilityProbability: h?.vulnerabilityProbability ?? null
      };
    })
  };
}

function toReportIssue(issue, { defaultImpact } = {}) {
  const impacts = impactsFor(issue);
  const normalizedImpacts = impacts.length > 0 ? impacts : (defaultImpact ? [defaultImpact] : []);
  return {
    key: issue?.key ?? null,
    message: issue?.message ?? null,
    file: stripComponentPrefix(issue?.component),
    line: issue?.line ?? null,
    rule: issue?.rule ?? null,
    impacts: normalizedImpacts
  };
}

function renderMarkdown({ hostUrl, projectKey, qualityGate, measures, relHigh, relMed, secHigh, maintHigh, hotspots }) {
  const securityRating = ratingToLetter(measures?.security_rating);
  const reliabilityRating = ratingToLetter(measures?.reliability_rating);
  const maintainabilityRating = ratingToLetter(measures?.sqale_rating);

  const lines = [];
  lines.push('# SonarQube Report (Snapshot)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Project: \`${projectKey}\``);
  lines.push(`Server: \`${hostUrl}\``);
  lines.push(`Dashboard: ${hostUrl}/dashboard?id=${encodeURIComponent(projectKey)}`);
  lines.push('');

  lines.push('## Quality Gate');
  lines.push('');
  lines.push(`- Status: ${qualityGate?.status ?? 'UNKNOWN'}`);
  const conditions = Array.isArray(qualityGate?.conditions) ? qualityGate.conditions : [];
  const failing = conditions.filter((c) => c?.status && String(c.status).toUpperCase() !== 'OK');
  if (failing.length > 0) {
    lines.push(`- Failing conditions: ${failing.length}`);
    for (const c of failing.slice(0, 12)) {
      const metric = c.metricKey || c.metric || 'unknown-metric';
      const actual = c.actualValue ?? 'n/a';
      const threshold = c.errorThreshold ?? 'n/a';
      const comparator = c.comparator ?? '';
      lines.push(`  - ${metric}: ${actual} ${comparator} ${threshold}`.trimEnd());
    }
  }
  lines.push('');

  lines.push('## Measures');
  lines.push('');
  lines.push(`- Security: ${securityRating ?? measures?.security_rating ?? 'n/a'} (${measures?.vulnerabilities ?? 'n/a'} vulnerabilities)`);
  lines.push(`- Reliability: ${reliabilityRating ?? measures?.reliability_rating ?? 'n/a'} (${measures?.bugs ?? 'n/a'} bugs)`);
  lines.push(`- Maintainability: ${maintainabilityRating ?? measures?.sqale_rating ?? 'n/a'} (${measures?.code_smells ?? 'n/a'} code smells)`);
  lines.push(`- Coverage: ${measures?.coverage ?? 'n/a'}% (ncloc: ${measures?.ncloc ?? 'n/a'})`);
  lines.push(`- Duplications: ${measures?.duplicated_lines_density ?? 'n/a'}%`);
  lines.push(`- Hotspots: ${measures?.security_hotspots ?? 'n/a'}`);
  lines.push('');

  const section = (title, data, maxList = 20) => {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(`- Total: ${data?.total ?? data?.issues?.length ?? 0}`);
    lines.push('');
    const list = Array.isArray(data?.issues) ? data.issues : [];
    for (const issue of list.slice(0, maxList)) {
      const loc = `${issue.file || 'unknown'}:${issue.line ?? '?'}`;
      const url = `${hostUrl}/project/issues?id=${encodeURIComponent(projectKey)}&open=${encodeURIComponent(issue.key || '')}`;
      const message = shorten(issue.message, 110);
      const rule = issue.rule ? ` (rule: \`${issue.rule}\`)` : '';
      lines.push(`- \`${loc}\` — ${message}${rule} (${url})`);
    }
    lines.push('');
  };

  section('Reliability (HIGH impact)', relHigh, 30);
  section('Reliability (MEDIUM impact)', relMed, 30);
  section('Security (HIGH impact)', secHigh, 30);
  section('Maintainability (HIGH impact)', maintHigh, 30);

  lines.push('## Security Hotspots');
  lines.push('');
  if (hotspots?.unavailable) {
    lines.push(`- Unavailable: ${hotspots.unavailable}`);
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`- Total: ${hotspots?.total ?? 0}`);
  lines.push('');
  for (const h of (hotspots?.hotspots || []).slice(0, 20)) {
    const loc = `${h.file || 'unknown'}:${h.line ?? '?'}`;
    const prob = h.vulnerabilityProbability || '?';
    lines.push(`- [${prob}] \`${loc}\` — ${shorten(h.message, 110)}`);
  }
  lines.push('');

  return lines.join('\n');
}

function printHelp() {
  console.log(`
Usage:
  node scripts/quality/sonar-report.cjs --host-url <url> --token <token> [--project-key dorfgefluester]

Env vars (alternatives):
  SONAR_HOST_URL, SONAR_TOKEN (or SONAR_AUTH_TOKEN), SONAR_PROJECT_KEY

Outputs (defaults):
  --out-json reports/sonarqube/sonar-report.json
  --out-md  reports/sonarqube/sonar-report.md

Behavior:
  --strict true|false   (default true)
  Exits with code 1 when either HIGH-impact Reliability or HIGH-impact Security issues exist (when strict).
`.trim());
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const hostUrl = normalizeHostUrl(args['host-url'] || args.host || process.env.SONAR_HOST_URL);
  const token = args.token || process.env.SONAR_TOKEN || process.env.SONAR_AUTH_TOKEN || '';
  const projectKey = args['project-key'] || args.project || process.env.SONAR_PROJECT_KEY || DEFAULT_PROJECT_KEY;

  const outJson = args['out-json'] || 'reports/sonarqube/sonar-report.json';
  const outMd = args['out-md'] || 'reports/sonarqube/sonar-report.md';

  const strict = parseBoolean(args.strict, true);
  const pageSize = Number(args['page-size'] || DEFAULT_PAGE_SIZE);

  if (!hostUrl) throw new Error('Missing SonarQube host URL. Provide --host-url/--host or set SONAR_HOST_URL.');
  if (!token) throw new Error('Missing SonarQube token. Provide --token or set SONAR_TOKEN/SONAR_AUTH_TOKEN.');

  const [qualityGate, measures, relHigh, relMed, secHigh, maintHigh] = await Promise.all([
    fetchQualityGate({ hostUrl, token, projectKey }),
    fetchMeasures({ hostUrl, token, projectKey }),
    fetchImpactOrFallback({
      hostUrl,
      token,
      projectKey,
      impactSoftwareQuality: 'RELIABILITY',
      impactSeverity: 'HIGH',
      pageSize,
      fallbackTypes: 'BUG',
      fallbackSeverities: 'BLOCKER,CRITICAL'
    }),
    fetchImpactOrFallback({
      hostUrl,
      token,
      projectKey,
      impactSoftwareQuality: 'RELIABILITY',
      impactSeverity: 'MEDIUM',
      pageSize,
      fallbackTypes: 'BUG',
      fallbackSeverities: 'MAJOR'
    }),
    fetchImpactOrFallback({
      hostUrl,
      token,
      projectKey,
      impactSoftwareQuality: 'SECURITY',
      impactSeverity: 'HIGH',
      pageSize,
      fallbackTypes: 'VULNERABILITY',
      fallbackSeverities: 'BLOCKER,CRITICAL'
    }),
    fetchImpactOrFallback({
      hostUrl,
      token,
      projectKey,
      impactSoftwareQuality: 'MAINTAINABILITY',
      impactSeverity: 'HIGH',
      pageSize,
      fallbackTypes: 'CODE_SMELL',
      fallbackSeverities: 'BLOCKER,CRITICAL'
    })
  ]);

  let hotspots = null;
  try {
    hotspots = await fetchHotspots({ hostUrl, token, projectKey, pageSize: 20 });
  } catch (err) {
    hotspots = { unavailable: err?.message || String(err) };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    hostUrl,
    projectKey,
    qualityGate,
    measures,
    reliability_high: relHigh.issues.map((issue) =>
      toReportIssue(issue, { defaultImpact: { softwareQuality: 'RELIABILITY', severity: 'HIGH' } })
    ),
    reliability_medium: relMed.issues.map((issue) =>
      toReportIssue(issue, { defaultImpact: { softwareQuality: 'RELIABILITY', severity: 'MEDIUM' } })
    ),
    security_high: secHigh.issues.map((issue) =>
      toReportIssue(issue, { defaultImpact: { softwareQuality: 'SECURITY', severity: 'HIGH' } })
    ),
    maintainability_high: maintHigh.issues.map((issue) =>
      toReportIssue(issue, { defaultImpact: { softwareQuality: 'MAINTAINABILITY', severity: 'HIGH' } })
    ),
    totals: {
      reliability_high: relHigh.total,
      reliability_medium: relMed.total,
      security_high: secHigh.total,
      maintainability_high: maintHigh.total,
      hotspots: hotspots?.total ?? null
    },
    queryMode: {
      reliability_high: relHigh.fallback ? 'fallback' : 'impact',
      reliability_medium: relMed.fallback ? 'fallback' : 'impact',
      security_high: secHigh.fallback ? 'fallback' : 'impact',
      maintainability_high: maintHigh.fallback ? 'fallback' : 'impact'
    },
    hotspots
  };

  writeJson(outJson, report);
  writeText(outMd, renderMarkdown({ hostUrl, projectKey, qualityGate, measures, relHigh: { ...relHigh, issues: report.reliability_high }, relMed: { ...relMed, issues: report.reliability_medium }, secHigh: { ...secHigh, issues: report.security_high }, maintHigh: { ...maintHigh, issues: report.maintainability_high }, hotspots }));

  // Also print the markdown to stdout for quick inspection (matches the bash-script intent).
  console.log(renderMarkdown({ hostUrl, projectKey, qualityGate, measures, relHigh: { ...relHigh, issues: report.reliability_high }, relMed: { ...relMed, issues: report.reliability_medium }, secHigh: { ...secHigh, issues: report.security_high }, maintHigh: { ...maintHigh, issues: report.maintainability_high }, hotspots }));

  const gateTriggered = (relHigh.total > 0) || (secHigh.total > 0);
  if (strict && gateTriggered) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
