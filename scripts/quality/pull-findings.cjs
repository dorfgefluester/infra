const { spawnSync } = require('child_process');
const { parseArgs } = require('./cli-args.cjs');

function commandExists(command) {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(bin, [command], { stdio: 'ignore' });
  return res.status === 0;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/quality/pull-findings.cjs

What it does:
  - Pulls open SonarQube issues via Web API (requires SONAR_HOST_URL + SONAR_TOKEN)
  - Runs a local Trivy FS scan (requires docker/podman or trivy binary)

Outputs (defaults):
  - reports/sonarqube/issues.json + docs/SONARQUBE_ISSUES.md
  - reports/trivy/fs.json + docs/TRIVY_FINDINGS.md

Options:
  --sonar true|false
  --trivy true|false
  --strict true|false (default false)
  --sonar-args "<args passed to sonarqube-export.cjs>"
  --trivy-args "<args passed to trivy-fs-scan.cjs>"
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

function shellSplit(raw) {
  if (!raw) return [];
  // Minimal split: supports quoted strings; good enough for local usage.
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function runNode(scriptPath, scriptArgs) {
  const res = spawnSync(process.execPath, [scriptPath, ...scriptArgs], { stdio: 'inherit' });
  return res.status ?? 1;
}

function shouldRunSonar(sonarArgs) {
  const hasHostArg = sonarArgs.includes('--host-url');
  const hasTokenArg = sonarArgs.includes('--token');
  return Boolean((hasHostArg || process.env.SONAR_HOST_URL) && (hasTokenArg || process.env.SONAR_TOKEN));
}

function shouldRunTrivy() {
  return commandExists('docker') || commandExists('podman') || commandExists('trivy');
}

function main() {
  const { args } = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelp();
    return;
  }

  const runSonar = parseBoolean(args.sonar, true);
  const runTrivy = parseBoolean(args.trivy, true);
  const strict = parseBoolean(args.strict, false);

  const sonarArgs = shellSplit(args['sonar-args']);
  const trivyArgs = shellSplit(args['trivy-args']);

  let exitCode = 0;

  if (runSonar) {
    if (!shouldRunSonar(sonarArgs)) {
      const msg = 'Skipping SonarQube export: missing SONAR_HOST_URL/SONAR_TOKEN (or --host-url/--token via --sonar-args).';
      if (strict) {
        console.error(msg);
        exitCode = 1;
      } else {
        console.warn(msg);
      }
    } else {
      const code = runNode('scripts/quality/sonarqube-export.cjs', sonarArgs);
      if (code !== 0) exitCode = code;
    }
  }

  if (runTrivy) {
    if (!shouldRunTrivy()) {
      const msg = 'Skipping Trivy FS scan: install docker, podman, or trivy binary.';
      if (strict) {
        console.error(msg);
        exitCode = 1;
      } else {
        console.warn(msg);
      }
    } else {
      const code = runNode('scripts/quality/trivy-fs-scan.cjs', trivyArgs);
      if (code !== 0) exitCode = code;
    }
  }

  process.exitCode = exitCode;
}

main();
