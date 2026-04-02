const { spawnSync } = require('child_process');

const { resolveSonarToken } = require('./sonar-config.cjs');

const DEFAULT_SONAR_HOST_URL = 'http://192.168.1.189:9000';

function runStep(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const hostUrl = String(process.env.SONAR_HOST_URL || DEFAULT_SONAR_HOST_URL).trim();
  const token = resolveSonarToken();

  if (!token) {
    console.error('Missing Sonar token. Set SONAR_TOKEN / SONAR_AUTH_TOKEN or store dorfgefluester.sonar.token in local git config.');
    process.exit(1);
  }

  const env = {
    ...process.env,
    SONAR_HOST_URL: hostUrl,
    SONAR_TOKEN: token,
  };

  runStep('npm', ['test', '--', '--ci', '--coverage'], { env });
  runStep('node', ['scripts/quality/sonarqube-export.cjs'], { env });
  runStep(
    'node',
    [
      'scripts/quality/sonar-report.cjs',
      '--out-json',
      'sonar-report.json',
    ],
    { env },
  );
}

main();
