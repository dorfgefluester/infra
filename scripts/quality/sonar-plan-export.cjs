const fs = require('fs');

const { parseArgs } = require('./cli-args.cjs');
const { readJson, writeJson, writeText } = require('./fs-utils.cjs');

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return readJson(filePath);
  } catch (err) {
    throw new Error(`Unable to read JSON from ${filePath}: ${err.message}`);
  }
}

function stripComponentPrefix(component) {
  if (!component) return '';
  const parts = String(component).split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : String(component);
}

function toPathArea(file) {
  const normalized = String(file || '').replace(/^\/+/, '');
  if (!normalized) return '(unknown)';
  const [top, second] = normalized.split('/');
  if (!second) return top;
  return `${top}/${second}`;
}

function groupCounts(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function sortEntries(map, valueLabel) {
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, [valueLabel]: count }))
    .sort((a, b) => b[valueLabel] - a[valueLabel] || a.name.localeCompare(b.name));
}

function summarizeFiles({ issues = [], hotspots = [], reliabilityHigh = [], securityHigh = [], maintainabilityHigh = [] }) {
  const files = new Map();

  function getEntry(file) {
    const key = file || '(unknown)';
    if (!files.has(key)) {
      files.set(key, {
        file: key,
        area: toPathArea(key),
        openIssues: 0,
        hotspots: 0,
        reliabilityHigh: 0,
        securityHigh: 0,
        maintainabilityHigh: 0,
        rules: new Set(),
      });
    }
    return files.get(key);
  }

  for (const issue of issues) {
    const entry = getEntry(stripComponentPrefix(issue.component));
    entry.openIssues += 1;
    if (issue.rule) entry.rules.add(issue.rule);
  }

  for (const issue of reliabilityHigh) {
    const entry = getEntry(issue.file);
    entry.reliabilityHigh += 1;
    if (issue.rule) entry.rules.add(issue.rule);
  }

  for (const issue of securityHigh) {
    const entry = getEntry(issue.file);
    entry.securityHigh += 1;
    if (issue.rule) entry.rules.add(issue.rule);
  }

  for (const issue of maintainabilityHigh) {
    const entry = getEntry(issue.file);
    entry.maintainabilityHigh += 1;
    if (issue.rule) entry.rules.add(issue.rule);
  }

  for (const hotspot of hotspots) {
    const entry = getEntry(hotspot.file);
    entry.hotspots += 1;
  }

  return Array.from(files.values())
    .map((entry) => ({
      ...entry,
      rules: Array.from(entry.rules).sort((a, b) => a.localeCompare(b)),
      planningWeight:
        entry.securityHigh * 8 +
        entry.reliabilityHigh * 6 +
        entry.hotspots * 5 +
        entry.maintainabilityHigh * 3 +
        entry.openIssues,
    }))
    .sort((a, b) => b.planningWeight - a.planningWeight || a.file.localeCompare(b.file));
}

function summarizeRules(issues = []) {
  const rules = new Map();
  for (const issue of issues) {
    const key = issue.rule || '(unknown)';
    if (!rules.has(key)) {
      rules.set(key, {
        rule: key,
        count: 0,
        types: new Set(),
        severities: new Set(),
        files: new Set(),
      });
    }
    const entry = rules.get(key);
    entry.count += 1;
    if (issue.type) entry.types.add(issue.type);
    if (issue.severity) entry.severities.add(issue.severity);
    if (issue.component) entry.files.add(stripComponentPrefix(issue.component));
  }

  return Array.from(rules.values())
    .map((entry) => ({
      rule: entry.rule,
      count: entry.count,
      types: Array.from(entry.types).sort((a, b) => a.localeCompare(b)),
      severities: Array.from(entry.severities).sort((a, b) => a.localeCompare(b)),
      sampleFiles: Array.from(entry.files).sort((a, b) => a.localeCompare(b)).slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
}

function createTask({ id, title, priority, rationale, nextAction, count, files = [], rules = [] }) {
  return {
    id,
    title,
    priority,
    rationale,
    nextAction,
    count,
    files: files.filter(Boolean),
    rules: rules.filter(Boolean),
  };
}

function buildPlanningTasks({ report, issuesPayload, topFiles, topRules }) {
  const tasks = [];
  const totals = report?.totals || {};
  const hotspots = report?.hotspots?.hotspots || [];

  if ((totals.security_high || 0) > 0) {
    const files = topFiles.filter((f) => f.securityHigh > 0).slice(0, 5).map((f) => f.file);
    tasks.push(
      createTask({
        id: 'security-high',
        title: 'Resolve high-impact security findings',
        priority: 'high',
        rationale: `${totals.security_high} high-impact security findings remain open.`,
        nextAction: 'Fix or suppress with documented justification before the next release branch.',
        count: totals.security_high,
        files,
      }),
    );
  }

  if ((totals.reliability_high || 0) > 0) {
    const files = topFiles.filter((f) => f.reliabilityHigh > 0).slice(0, 5).map((f) => f.file);
    tasks.push(
      createTask({
        id: 'reliability-high',
        title: 'Stabilize high-impact reliability issues',
        priority: 'high',
        rationale: `${totals.reliability_high} high-impact reliability findings remain open.`,
        nextAction: 'Prioritize bugs with crash/corruption/progression risk and validate with targeted tests.',
        count: totals.reliability_high,
        files,
      }),
    );
  }

  if ((report?.hotspots?.total || 0) > 0) {
    const files = hotspots.slice(0, 5).map((h) => h.file);
    tasks.push(
      createTask({
        id: 'security-hotspots',
        title: 'Review open security hotspots',
        priority: 'medium',
        rationale: `${report.hotspots.total} security hotspots require review or explicit acceptance.`,
        nextAction: 'Review hotspot context in SonarQube and convert accepted risk into documented decisions.',
        count: report.hotspots.total,
        files,
      }),
    );
  }

  if ((totals.maintainability_high || 0) > 0) {
    const files = topFiles.filter((f) => f.maintainabilityHigh > 0).slice(0, 5).map((f) => f.file);
    tasks.push(
      createTask({
        id: 'maintainability-high',
        title: 'Reduce high-impact maintainability debt in hotspot files',
        priority: 'medium',
        rationale: `${totals.maintainability_high} maintainability-high findings are concentrated in a few files.`,
        nextAction: 'Group fixes by file/module to reduce repeated churn and improve readability in one pass.',
        count: totals.maintainability_high,
        files,
      }),
    );
  }

  if ((issuesPayload?.summary?.total || 0) > 0) {
    tasks.push(
      createTask({
        id: 'open-issues-triage',
        title: 'Triage remaining open Sonar issues into branch-sized work',
        priority: 'medium',
        rationale: `${issuesPayload.summary.total} open Sonar issues remain across bugs, vulnerabilities, and code smells.`,
        nextAction: 'Group by top rule and top file instead of creating one task per issue.',
        count: issuesPayload.summary.total,
        files: topFiles.slice(0, 5).map((f) => f.file),
        rules: topRules.slice(0, 5).map((r) => r.rule),
      }),
    );
  }

  return tasks;
}

function buildPlanningSummary({ issuesPayload, report }) {
  const issues = Array.isArray(issuesPayload?.issues) ? issuesPayload.issues : [];
  const reliabilityHigh = Array.isArray(report?.reliability_high) ? report.reliability_high : [];
  const securityHigh = Array.isArray(report?.security_high) ? report.security_high : [];
  const maintainabilityHigh = Array.isArray(report?.maintainability_high)
    ? report.maintainability_high
    : [];
  const hotspots = Array.isArray(report?.hotspots?.hotspots) ? report.hotspots.hotspots : [];

  const topFiles = summarizeFiles({
    issues,
    hotspots,
    reliabilityHigh,
    securityHigh,
    maintainabilityHigh,
  });
  const topRules = summarizeRules(issues);
  const topAreas = sortEntries(groupCounts(topFiles, (item) => item.area), 'count');
  const tasks = buildPlanningTasks({ report, issuesPayload, topFiles, topRules });

  return {
    generatedAt: new Date().toISOString(),
    hostUrl: report?.hostUrl || issuesPayload?.hostUrl || null,
    projectKey: report?.projectKey || issuesPayload?.projectKey || null,
    qualityGateStatus: report?.qualityGate?.status || null,
    totals: {
      openIssues: issuesPayload?.summary?.total || issues.length,
      bugs: Number(issuesPayload?.measures?.bugs ?? 0),
      vulnerabilities: Number(issuesPayload?.measures?.vulnerabilities ?? 0),
      codeSmells: Number(issuesPayload?.measures?.code_smells ?? 0),
      securityHotspots: Number(report?.totals?.hotspots ?? hotspots.length),
      reliabilityHigh: Number(report?.totals?.reliability_high ?? reliabilityHigh.length),
      reliabilityMedium: Number(report?.totals?.reliability_medium ?? 0),
      securityHigh: Number(report?.totals?.security_high ?? securityHigh.length),
      maintainabilityHigh: Number(report?.totals?.maintainability_high ?? maintainabilityHigh.length),
    },
    topAreas: topAreas.slice(0, 10),
    topFiles: topFiles.slice(0, 12),
    topRules: topRules.slice(0, 12),
    planningTasks: tasks,
    suggestedPlanningWorkflow: [
      'Review the planning tasks below and merge overlapping file-level work into one backlog item.',
      'Prefer one task per theme or module, not one task per Sonar issue.',
      'Update docs/game/IMPLEMENTATION_PLAN.md manually from this summary after triage.',
    ],
  };
}

function renderPlanningMarkdown(summary) {
  const lines = [];
  lines.push('# SonarQube Planning Summary');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Project: \`${summary.projectKey || 'unknown'}\``);
  if (summary.hostUrl) {
    lines.push(`Server: \`${summary.hostUrl}\``);
    lines.push(
      `Dashboard: ${summary.hostUrl}/dashboard?id=${encodeURIComponent(summary.projectKey || '')}`,
    );
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Quality gate: ${summary.qualityGateStatus || 'UNKNOWN'}`);
  lines.push(`- Open issues: ${summary.totals.openIssues}`);
  lines.push(`- Bugs: ${summary.totals.bugs}`);
  lines.push(`- Vulnerabilities: ${summary.totals.vulnerabilities}`);
  lines.push(`- Code smells: ${summary.totals.codeSmells}`);
  lines.push(`- Security hotspots: ${summary.totals.securityHotspots}`);
  lines.push(`- Reliability high: ${summary.totals.reliabilityHigh}`);
  lines.push(`- Security high: ${summary.totals.securityHigh}`);
  lines.push(`- Maintainability high: ${summary.totals.maintainabilityHigh}`);
  lines.push('');
  lines.push('## Plan Next');
  lines.push('');
  if (summary.planningTasks.length === 0) {
    lines.push('- No planning tasks generated from the current Sonar snapshot.');
  } else {
    for (const task of summary.planningTasks) {
      lines.push(`- [${task.priority}] ${task.title} (${task.count})`);
      lines.push(`  Rationale: ${task.rationale}`);
      lines.push(`  Next action: ${task.nextAction}`);
      if (task.files.length > 0) {
        lines.push(`  Files: ${task.files.join(', ')}`);
      }
      if (task.rules.length > 0) {
        lines.push(`  Rules: ${task.rules.join(', ')}`);
      }
    }
  }
  lines.push('');
  lines.push('## Top Areas');
  lines.push('');
  for (const area of summary.topAreas) {
    lines.push(`- ${area.name}: ${area.count}`);
  }
  lines.push('');
  lines.push('## Top Files');
  lines.push('');
  for (const file of summary.topFiles) {
    lines.push(
      `- \`${file.file}\` | issues=${file.openIssues}, relHigh=${file.reliabilityHigh}, secHigh=${file.securityHigh}, maintHigh=${file.maintainabilityHigh}, hotspots=${file.hotspots}`,
    );
  }
  lines.push('');
  lines.push('## Top Rules');
  lines.push('');
  for (const rule of summary.topRules) {
    const sampleFiles = rule.sampleFiles.length > 0 ? ` | files: ${rule.sampleFiles.join(', ')}` : '';
    lines.push(`- \`${rule.rule}\` | count=${rule.count}${sampleFiles}`);
  }
  lines.push('');
  lines.push('## Workflow');
  lines.push('');
  for (const step of summary.suggestedPlanningWorkflow) {
    lines.push(`- ${step}`);
  }
  lines.push('');
  return lines.join('\n');
}

function printHelp() {
  console.log(
    `
Usage:
  node scripts/quality/sonar-plan-export.cjs

Inputs:
  --issues-json reports/sonarqube/issues.json
  --report-json reports/sonarqube/sonar-report.json

Outputs:
  --out-json reports/sonarqube/planning-summary.json
  --out-md  reports/sonarqube/planning-summary.md
`.trim(),
  );
}

async function main() {
  const { args } = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    printHelp();
    return;
  }

  const issuesJson = args['issues-json'] || 'reports/sonarqube/issues.json';
  const reportJson = args['report-json'] || 'reports/sonarqube/sonar-report.json';
  const outJson = args['out-json'] || 'reports/sonarqube/planning-summary.json';
  const outMd = args['out-md'] || 'reports/sonarqube/planning-summary.md';

  const issuesPayload = safeReadJson(issuesJson);
  const report = safeReadJson(reportJson);

  if (!issuesPayload && !report) {
    throw new Error(`No SonarQube input found. Expected ${issuesJson} and/or ${reportJson}.`);
  }

  const summary = buildPlanningSummary({ issuesPayload, report });
  writeJson(outJson, summary);
  writeText(outMd, renderPlanningMarkdown(summary));

  console.log(`Wrote SonarQube planning summary JSON: ${outJson}`);
  console.log(`Wrote SonarQube planning summary markdown: ${outMd}`);
  console.log(renderPlanningMarkdown(summary));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exitCode = 1;
  });
}

module.exports = {
  buildPlanningSummary,
  renderPlanningMarkdown,
  summarizeFiles,
  summarizeRules,
  toPathArea,
};
