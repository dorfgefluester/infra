const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { parseArgs } = require('./cli-args.cjs');
const { SKILL_GATE_CHECKS, getRepoRoot } = require('./skill-gate-config.cjs');

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });

  return {
    ok: (result.status ?? 1) === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    command: [command, ...args].join(' '),
  };
}

function ensureDirFor(filePath) {
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function tail(text, maxLines = 8) {
  const lines = String(text || '')
    .split('\n')
    .filter(Boolean);
  return lines.slice(-maxLines).join('\n');
}

function advisoryResult(base, details) {
  return { ...base, state: 'advisory', passed: true, details };
}

function passResult(base, details) {
  return { ...base, state: 'passed', passed: true, details };
}

function failResult(base, details) {
  return { ...base, state: 'failed', passed: false, details };
}

function changedAnnotationCount(root) {
  const rg = runCommand('rg', ['-n', '(TODO|FIXME|HACK|XXX)', 'src', 'scripts', 'tests'], { cwd: root });
  if (!rg.ok && rg.status !== 1) {
    return advisoryResult(
      {
        id: 'code_health',
        title: 'Code Health',
        skillFile: 'skills/code-health.md',
        required: false,
      },
      `Annotation scan could not run cleanly.\n${tail(rg.stderr || rg.stdout)}`,
    );
  }

  const matches = String(rg.stdout || '')
    .split('\n')
    .filter(Boolean);

  if (matches.length === 0) {
    return passResult(
      {
        id: 'code_health',
        title: 'Code Health',
        skillFile: 'skills/code-health.md',
        required: false,
      },
      'No TODO/FIXME/HACK/XXX markers found in src/, scripts/, or tests/.',
    );
  }

  return advisoryResult(
    {
      id: 'code_health',
      title: 'Code Health',
      skillFile: 'skills/code-health.md',
      required: false,
    },
    `Found ${matches.length} annotation marker(s). Review whether they are still justified.\n${matches.slice(0, 10).join('\n')}`,
  );
}

function inspectSecurityReports(root) {
  const summaryPath = path.join(root, 'reports', 'trivy', 'fs-summary.json');
  const sonarPath = path.join(root, 'reports', 'sonarqube', 'sonar-report.json');
  const messages = [];

  if (fs.existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      const vulnCount = Number(summary?.vulnerabilities ?? 0);
      messages.push(`Trivy FS summary: vulnerabilities=${vulnCount}`);
    } catch (error) {
      messages.push(`Trivy FS summary unreadable: ${error.message}`);
    }
  } else {
    messages.push('Trivy FS summary not available in this environment.');
  }

  if (fs.existsSync(sonarPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(sonarPath, 'utf8'));
      const relHigh = Number(report?.totals?.reliability_high ?? 0);
      const secHigh = Number(report?.totals?.security_high ?? 0);
      messages.push(`Sonar high-impact findings: reliability_high=${relHigh}, security_high=${secHigh}`);
    } catch (error) {
      messages.push(`Sonar report unreadable: ${error.message}`);
    }
  } else {
    messages.push('Sonar report not available in this environment.');
  }

  return advisoryResult(
    {
      id: 'security',
      title: 'Security',
      skillFile: 'skills/security.md',
      required: false,
    },
    messages.join('\n'),
  );
}

function inspectUiEvidence(root) {
  const playwrightReport = path.join(root, 'playwright-report');
  const testResults = path.join(root, 'tests', 'test-results');
  const hasEvidence = fs.existsSync(playwrightReport) || fs.existsSync(testResults);

  if (hasEvidence) {
    return advisoryResult(
      {
        id: 'ui_ux',
        title: 'UI/UX',
        skillFile: 'skills/ui-ux.md',
        required: false,
      },
      'Playwright/browser evidence exists for this workspace.',
    );
  }

  return advisoryResult(
    {
      id: 'ui_ux',
      title: 'UI/UX',
      skillFile: 'skills/ui-ux.md',
      required: false,
    },
    'No Playwright/browser evidence found in this workspace. Use dedicated UI/accessibility tests for UI-heavy changes.',
  );
}

function executeCheck(check, mode, root) {
  const base = {
    id: check.id,
    title: check.title,
    skillFile: check.skillFile,
    required: check.requiredModes.includes(mode),
  };

  if (check.id === 'git_hygiene') {
    const args = mode === 'local' ? ['diff', '--check'] : ['diff', '--check'];
    const result = runCommand('git', args, { cwd: root });
    return result.ok
      ? passResult(base, 'No whitespace or conflict-marker diff issues detected.')
      : failResult(base, `Command failed: ${result.command}\n${tail(result.stdout || result.stderr)}`);
  }

  if (check.id === 'code_review' && mode === 'local') {
    const result = runCommand('npm', ['run', 'lint'], { cwd: root });
    return result.ok
      ? passResult(base, 'Lint passed.')
      : failResult(base, `Command failed: ${result.command}\n${tail(result.stdout || result.stderr)}`);
  }

  if (check.id === 'architecture') {
    const result = runCommand('npm', ['run', 'typecheck'], { cwd: root });
    return result.ok
      ? passResult(base, 'Type/static structure check passed.')
      : failResult(base, `Command failed: ${result.command}\n${tail(result.stdout || result.stderr)}`);
  }

  if (check.id === 'testing') {
    if (mode === 'local') {
      const result = runCommand('npm', ['test', '--', '--runInBand'], { cwd: root });
      return result.ok
        ? passResult(base, 'Unit/integration Jest suite passed locally.')
        : failResult(base, `Command failed: ${result.command}\n${tail(result.stdout || result.stderr)}`);
    }

    const junitPath = path.join(root, 'tests', 'junit', 'jest-junit.xml');
    const coveragePath = path.join(root, 'tests', 'coverage', 'lcov.info');
    const missing = [junitPath, coveragePath].filter((filePath) => !fs.existsSync(filePath));
    return missing.length === 0
      ? passResult(base, 'CI test evidence exists (JUnit + coverage artifacts).')
      : failResult(base, `Missing CI test evidence:\n${missing.map((item) => `- ${path.relative(root, item)}`).join('\n')}`);
  }

  if (check.id === 'performance') {
    if (mode === 'local') {
      const buildResult = runCommand('npm', ['run', 'build'], { cwd: root });
      if (!buildResult.ok) {
        return failResult(base, `Build failed: ${buildResult.command}\n${tail(buildResult.stdout || buildResult.stderr)}`);
      }
    } else {
      const distAssetsDir = path.join(root, 'dist', 'assets');
      if (!fs.existsSync(distAssetsDir)) {
        return failResult(base, 'Missing dist/assets from earlier CI build stage.');
      }
    }

    const budgetResult = runCommand('node', ['scripts/quality/check-bundle-budget.cjs'], { cwd: root });
    return budgetResult.ok
      ? passResult(base, 'Bundle budget passed.')
      : failResult(base, `Bundle budget failed: ${budgetResult.command}\n${tail(budgetResult.stdout || budgetResult.stderr)}`);
  }

  if (check.id === 'documentation') {
    const result = runCommand('npm', ['run', 'validate-translations'], { cwd: root });
    return result.ok
      ? passResult(base, 'Translation/content validation completed.')
      : failResult(base, `Translation validation failed: ${result.command}\n${tail(result.stdout || result.stderr)}`);
  }

  if (check.id === 'security') {
    return inspectSecurityReports(root);
  }

  if (check.id === 'ui_ux') {
    return inspectUiEvidence(root);
  }

  if (check.id === 'code_health') {
    return changedAnnotationCount(root);
  }

  return advisoryResult(base, 'No automation mapped for this skill yet.');
}

function iconFor(state) {
  if (state === 'passed') {
    return '[x]';
  }
  if (state === 'failed') {
    return '[ ]';
  }
  return '[~]';
}

function toMarkdown(mode, results) {
  const lines = [
    '# Skill Gate Report',
    '',
    `- Mode: ${mode}`,
    `- Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const result of results) {
    const requirement = result.required ? 'required' : 'advisory';
    lines.push(`## ${iconFor(result.state)} ${result.title} (${requirement})`);
    lines.push('');
    lines.push(`- Skill: ${result.skillFile}`);
    lines.push(`- Status: ${result.state}`);
    lines.push(`- Details: ${result.details}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2)) {
  const { args } = parseArgs(argv);
  const mode = String(args.mode || 'local');
  if (!['local', 'ci'].includes(mode)) {
    console.error(`Unsupported mode "${mode}". Use local or ci.`);
    process.exit(2);
  }

  const root = getRepoRoot();
  const results = SKILL_GATE_CHECKS.map((check) => executeCheck(check, mode, root));
  const failedRequired = results.filter((item) => item.required && item.state === 'failed');
  const payload = {
    mode,
    generatedAt: new Date().toISOString(),
    failedRequiredCount: failedRequired.length,
    results,
  };

  const outJson = args['out-json'] ? path.resolve(root, args['out-json']) : null;
  const outMd = args['out-md'] ? path.resolve(root, args['out-md']) : null;
  if (outJson) {
    ensureDirFor(outJson);
    fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  if (outMd) {
    ensureDirFor(outMd);
    fs.writeFileSync(outMd, toMarkdown(mode, results), 'utf8');
  }

  console.log(`Skill gate (${mode}) completed.`);
  for (const result of results) {
    console.log(`- ${result.title}: ${result.state}${result.required ? ' [required]' : ' [advisory]'}`);
  }

  if (failedRequired.length > 0) {
    console.error(`Required skill-gate checks failed: ${failedRequired.map((item) => item.title).join(', ')}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { executeCheck, main, toMarkdown };
